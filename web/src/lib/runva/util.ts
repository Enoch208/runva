import { createHash, randomBytes } from "node:crypto";

export const sha256 = (s: string): string => createHash("sha256").update(s, "utf8").digest("hex");

export const nowIso = (): string => new Date().toISOString();

/** Keep the last `max` bytes-ish of a string (char-based), marking truncation. */
export function tail(s: string | undefined | null, max = 4096): string {
  if (!s) return "";
  if (s.length <= max) return s;
  return `…[truncated ${s.length - max} chars]\n` + s.slice(s.length - max);
}

/** Shorten a sandbox id for display, e.g. "sb-3f9a12…". */
export function shortId(id: string | undefined | null): string {
  if (!id) return "unknown";
  // ULID-style ids share a timestamp prefix, so keep the head AND the tail to stay distinguishable.
  return id.length > 14 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id;
}

export function newRunId(): string {
  return `run_${randomBytes(9).toString("hex")}`;
}

export class CancelledError extends Error {
  constructor(message = "Run cancelled") {
    super(message);
    this.name = "CancelledError";
  }
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    const r = signal.reason;
    if (r instanceof Error) throw r;
    throw new CancelledError(typeof r === "string" ? r : "Run cancelled");
  }
}

/** Remove anything that looks like a credential from free text before it is stored/displayed. */
export function redact(s: string): string {
  if (!s) return s;
  let out = s;
  const secrets = [
    process.env.CREATEOS_SANDBOX_API_KEY,
    process.env.CREATEOS_PLAN_API_KEY,
    process.env.CREATEOS_PROJECT_API_KEY,
    process.env.OPENROUTER_API_KEY,
    process.env.ANTHROPIC_API_KEY,
  ].filter((v): v is string => typeof v === "string" && v.length >= 8);
  for (const v of secrets) out = out.split(v).join("[redacted]");
  out = out.replace(/\b(sk-[A-Za-z0-9_-]{12,})/g, "[redacted]");
  return out;
}

export function errMessage(e: unknown): string {
  if (e instanceof Error) return redact(e.message);
  return redact(String(e));
}
