import {
  createClient,
  CreateosSandboxApiError,
  CreateosSandboxAuthError,
  CreateosSandboxConnectionError,
  CreateosSandboxPaymentRequiredError,
  CreateosSandboxPermissionError,
  CreateosSandboxRateLimitError,
  CreateosSandboxTimeoutError,
  type CreateosSandboxClient,
  type Sandbox,
} from "@nodeops-createos/sandbox";
import type { CommandEvidence } from "./types";
import { sandboxEnv, runEnv } from "./env";
import { CancelledError, errMessage, nowIso, redact, shortId, tail } from "./util";

export type ErrorCategory = "code" | "infra" | "llm" | "cancelled";

/** A classified, user-presentable failure. `message`/`hint` are safe to show (no secrets). */
export class RunvaError extends Error {
  category: ErrorCategory;
  hint?: string;
  details?: Record<string, unknown>;
  constructor(category: ErrorCategory, message: string, hint?: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "RunvaError";
    this.category = category;
    this.hint = hint;
    this.details = details;
  }
}

let cachedClient: { key: string; client: CreateosSandboxClient } | null = null;

export function getSandboxClient(): CreateosSandboxClient {
  const env = sandboxEnv();
  if (!env.apiKey) {
    throw new RunvaError(
      "infra",
      "CreateOS sandbox credential is not configured",
      "Set CREATEOS_SANDBOX_API_KEY (createos.sh dashboard → API keys)",
    );
  }
  const cacheKey = `${env.baseUrl}|${env.apiKey.length}|${env.apiKey.slice(-4)}`;
  if (cachedClient && cachedClient.key === cacheKey) return cachedClient.client;
  const client = createClient({ apiKey: env.apiKey, baseUrl: env.baseUrl, timeoutMs: 60_000 });
  cachedClient = { key: cacheKey, client };
  return client;
}

/** Map SDK/network errors into infra RunvaErrors with actionable hints. Never includes auth headers. */
export function classifySandboxError(err: unknown, step: string, signal?: AbortSignal): RunvaError {
  if (err instanceof RunvaError) return err;
  if (signal?.aborted) {
    const r = signal.reason;
    if (r instanceof RunvaError) return r;
    if (r instanceof CancelledError) return new RunvaError("cancelled", r.message);
    return new RunvaError("cancelled", `Run aborted during ${step}`);
  }
  const base: Record<string, unknown> = { step };
  if (err instanceof CreateosSandboxApiError) {
    base.statusCode = err.statusCode;
    if (err.requestId) base.requestId = err.requestId;
    if (err.code) base.code = err.code;
    if (err.endpoint) base.endpoint = err.endpoint;
  }
  const msg = errMessage(err);
  if (err instanceof CreateosSandboxAuthError)
    return new RunvaError("infra", `CreateOS rejected the API key (401) during ${step}`, "Check CREATEOS_SANDBOX_API_KEY is valid (createos.sh dashboard → API keys).", base);
  if (err instanceof CreateosSandboxPaymentRequiredError)
    return new RunvaError("infra", `CreateOS requires payment/credits (402) during ${step}`, "The CreateOS account appears to be out of credits. Top up or use the hackathon-credited account.", base);
  if (err instanceof CreateosSandboxPermissionError)
    return new RunvaError("infra", `CreateOS denied the request (403) during ${step}: ${msg}`, "Likely a quota: the free tier allows one sandbox at a time. Make sure no stale RUNVA sandbox is still running, then retry.", base);
  if (err instanceof CreateosSandboxRateLimitError)
    return new RunvaError("infra", `CreateOS rate-limited the request (429) during ${step}`, `Wait ${err.retryAfterSeconds ?? 30}s and retry.`, base);
  if (err instanceof CreateosSandboxTimeoutError)
    return new RunvaError("infra", `CreateOS did not respond in time during ${step}`, "The CreateOS control plane timed out. Retry in a minute; check CREATEOS_SANDBOX_BASE_URL.", base);
  if (err instanceof CreateosSandboxConnectionError)
    return new RunvaError("infra", `Could not reach CreateOS during ${step}: ${msg}`, "Network error reaching the CreateOS control plane. Check connectivity and CREATEOS_SANDBOX_BASE_URL.", base);
  if (err instanceof CreateosSandboxApiError)
    return new RunvaError("infra", `CreateOS API error ${err.statusCode} during ${step}: ${msg}`, "CreateOS returned an error. Retry shortly; if it persists, check the control-plane status.", base);
  return new RunvaError("infra", `Sandbox failure during ${step}: ${msg}`, "Unexpected sandbox error; see the event log.", base);
}

export type SandboxPurpose = "work" | "fresh-verifier";

/** One CreateOS microVM owned by a single RUNVA run. All model-generated code executes here, never on the host. */
export class SandboxSession {
  readonly sandbox: Sandbox;
  readonly id: string;
  readonly shortId: string;
  readonly shape: string;
  readonly region: string;
  readonly egress: string[];
  readonly createMs: number;
  readonly spawnMs?: number;
  readonly purpose: SandboxPurpose;
  destroyed = false;

  private constructor(sandbox: Sandbox, purpose: SandboxPurpose, createMs: number) {
    const env = sandboxEnv();
    const data = sandbox.data;
    this.sandbox = sandbox;
    this.id = sandbox.id;
    this.shortId = shortId(sandbox.id);
    this.shape = data.shape || env.shape;
    this.region = data.region || env.regionLabel;
    this.egress = data.egress && data.egress.length ? data.egress : env.egress;
    this.createMs = createMs;
    this.spawnMs = data.spawn_ms;
    this.purpose = purpose;
  }

  static async create(runId: string, purpose: SandboxPurpose, signal?: AbortSignal, onRetry?: (reason: string) => void): Promise<SandboxSession> {
    const env = sandboxEnv();
    const client = getSandboxClient();
    const t0 = Date.now();
    const name = `runva-${runId.replace(/^run_/, "").slice(0, 10)}-${purpose === "work" ? "w" : "v"}`;
    const req = {
      shape: env.shape,
      rootfs: env.rootfs,
      ingress_enabled: false,
      // NON-EMPTY allowlist = restrictive. [] would mean allow-all on CreateOS.
      egress: env.egress,
      name,
    };
    try {
      let sb: Sandbox;
      try {
        sb = await client.createSandbox(req, { timeoutMs: runEnv().sandboxCreateTimeoutMs, signal, retry: false });
      } catch (e) {
        // Free tier = one VM at a time. On a quota/rate-limit rejection wait 20s and retry exactly once.
        if (!(e instanceof CreateosSandboxPermissionError || e instanceof CreateosSandboxRateLimitError) || signal?.aborted) throw e;
        onRetry?.(e instanceof CreateosSandboxRateLimitError ? "rate-limited (429)" : "quota/permission (403)");
        await new Promise<void>((resolve, reject) => {
          const t = setTimeout(resolve, 20_000);
          signal?.addEventListener("abort", () => (clearTimeout(t), reject(signal.reason)), { once: true });
        });
        sb = await client.createSandbox(req, { timeoutMs: runEnv().sandboxCreateTimeoutMs, signal, retry: false });
      }
      return new SandboxSession(sb, purpose, Date.now() - t0);
    } catch (e) {
      // The control plane may still finish creating the VM after we gave up (timeout/cancel):
      // best-effort, bounded cleanup of the VM with OUR unique name only. Never touches other sandboxes.
      if (signal?.aborted || e instanceof CreateosSandboxTimeoutError || e instanceof CreateosSandboxConnectionError) {
        await destroyByName(name).catch(() => undefined);
      }
      throw classifySandboxError(e, "createSandbox", signal);
    }
  }

  async mkdir(dir: string, signal?: AbortSignal): Promise<void> {
    try {
      const r = await this.sandbox.runCommand("mkdir", ["-p", dir], { timeoutMs: 30_000, signal, retry: false });
      if (r.result.exit_code !== 0) throw new RunvaError("infra", `mkdir ${dir} failed in sandbox (exit ${r.result.exit_code})`, tail(r.result.stderr, 300));
    } catch (e) {
      throw classifySandboxError(e, `mkdir ${dir}`, signal);
    }
  }

  async upload(p: string, content: string, signal?: AbortSignal): Promise<void> {
    try {
      await this.sandbox.files.upload(p, content, { timeoutMs: 30_000, signal });
    } catch (e) {
      throw classifySandboxError(e, `upload ${p}`, signal);
    }
  }

  /** Run a buffered command and return sanitized evidence. Non-zero exit codes are evidence, not errors. */
  async exec(
    label: string,
    displayCmd: string,
    cmd: string,
    args: string[],
    opts: { timeoutMs?: number; signal?: AbortSignal } = {},
  ): Promise<CommandEvidence> {
    return (await this.execFull(label, displayCmd, cmd, args, opts)).evidence;
  }

  /** Like exec, but also returns the full (untruncated) stdout for host-side parsing. */
  async execFull(
    label: string,
    displayCmd: string,
    cmd: string,
    args: string[],
    opts: { timeoutMs?: number; signal?: AbortSignal } = {},
  ): Promise<{ evidence: CommandEvidence; stdout: string }> {
    const at = nowIso();
    const t0 = Date.now();
    try {
      const r = await this.sandbox.runCommand(cmd, args, {
        timeoutMs: opts.timeoutMs ?? runEnv().commandTimeoutMs + 15_000,
        signal: opts.signal,
        retry: false,
      });
      const stderr = r.result.error ? `${r.result.stderr || ""}\n[agent error] ${r.result.error}` : r.result.stderr;
      return {
        stdout: r.result.stdout || "",
        evidence: {
          label,
          cmd: displayCmd,
          exitCode: typeof r.result.exit_code === "number" ? r.result.exit_code : -1,
          stdout: redact(tail(r.result.stdout, 4096)),
          stderr: redact(tail(stderr, 4096)),
          execMs: typeof r.exec_ms === "number" ? r.exec_ms : Date.now() - t0,
          sandboxId: this.shortId,
          at,
        },
      };
    } catch (e) {
      throw classifySandboxError(e, label, opts.signal);
    }
  }

  /** Run `node <file>` from /workspace with an in-VM wall-clock limit (exit 124 on timeout). */
  async node(label: string, file: string, signal?: AbortSignal): Promise<{ evidence: CommandEvidence; stdout: string }> {
    const limitSec = Math.round(runEnv().commandTimeoutMs / 1000);
    return this.execFull(label, `node ${file}`, "sh", ["-c", `cd /workspace && timeout ${limitSec} node ${file}`], { signal });
  }

  async nodeCheck(label: string, file: string, signal?: AbortSignal): Promise<CommandEvidence> {
    return this.exec(label, `node --check ${file}`, "node", ["--check", file], { signal, timeoutMs: 30_000 });
  }

  /** Always safe to call; never throws. Uses its own timeout so it still runs after cancel/timeout. */
  async destroy(): Promise<{ ok: boolean; ms: number; error?: string }> {
    if (this.destroyed) return { ok: true, ms: 0 };
    const t0 = Date.now();
    try {
      await this.sandbox.destroy({ timeoutMs: 30_000 });
      this.destroyed = true;
      return { ok: true, ms: Date.now() - t0 };
    } catch (e) {
      // One retry after a short pause, then give up (no retry storms).
      try {
        await new Promise((r) => setTimeout(r, 1500));
        await this.sandbox.destroy({ timeoutMs: 30_000 });
        this.destroyed = true;
        return { ok: true, ms: Date.now() - t0 };
      } catch (e2) {
        return { ok: false, ms: Date.now() - t0, error: errMessage(e2) || errMessage(e) };
      }
    }
  }
}

/** Best-effort, bounded listing of sandboxes (the SDK list call may hang; never use in the product hot path). */
export async function listSandboxesBounded(timeoutMs = 15_000): Promise<Sandbox[]> {
  const client = getSandboxClient();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(new Error("listSandboxes timeout")), timeoutMs);
  try {
    return await Promise.race([
      client.listSandboxes({ limit: 50, signal: ac.signal, timeoutMs }),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("listSandboxes timeout")), timeoutMs + 1000).unref?.()),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Destroy a non-terminal sandbox by its exact RUNVA-generated name (orphan cleanup after a timed-out create). */
async function destroyByName(name: string): Promise<void> {
  await new Promise((r) => setTimeout(r, 3000));
  const list = await listSandboxesBounded(10_000);
  for (const sb of list) {
    if (sb.name === name && !["destroyed", "destroying"].includes(sb.status)) {
      await sb.destroy({ timeoutMs: 30_000 }).catch(() => undefined);
    }
  }
}
