// Runs the FROZEN host-owned verifier against the vulnerable baseline and a few known-wrong handlers.
// Only trusted fixture code and tiny inline handlers written in this file run on the host here.
// There is deliberately NO correct reference fix in this repo: a correct fix must come from the LLM.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { loadFixture } from "@/lib/runva/fixture";
import { sha256 } from "@/lib/runva/util";
import { hostVerdictPass, parseVerdict } from "@/lib/runva/verifier";
import type { Verdict } from "@/lib/runva/types";

const FIXTURE_DIR = path.join(__dirname, "..", "fixtures", "webhook-idempotency");
const VERIFIER_PATH = path.join(FIXTURE_DIR, "verifier.mjs");
const BASELINE_PATH = path.join(FIXTURE_DIR, "handler.vulnerable.mjs");
// Dev-only, outside the repo. When absent (public CI) the positive-control test is skipped.
const REFERENCE_FIX =
  "/private/tmp/claude-501/-Users-enoch-Projects-createos-hackathon/c36c6643-3e69-4f5b-af83-915f5a07f484/scratchpad/fixture-dev/patches/reference.mjs";

const workspaces: string[] = [];
afterAll(() => {
  for (const w of workspaces) rmSync(w, { recursive: true, force: true });
});

type Run = { code: number | null; stdout: string; stderr: string; verdict: Verdict | null; parseError?: string; ms: number };

/** Lay out tmp/verification.mjs + tmp/target/handler.mjs (same layout as /workspace in the VM) and run it. */
function runVerifier(handlerSource: string): Promise<Run> {
  const ws = mkdtempSync(path.join(tmpdir(), "runva-fx-"));
  workspaces.push(ws);
  mkdirSync(path.join(ws, "target"));
  writeFileSync(path.join(ws, "verification.mjs"), readFileSync(VERIFIER_PATH));
  writeFileSync(path.join(ws, "target", "handler.mjs"), handlerSource);
  const t0 = Date.now();
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [path.join(ws, "verification.mjs")], { cwd: ws, env: { PATH: process.env.PATH ?? "" } });
    let stdout = "";
    let stderr = "";
    p.stdout.on("data", (d) => (stdout += d));
    p.stderr.on("data", (d) => (stderr += d));
    const killer = setTimeout(() => p.kill("SIGKILL"), 15_000);
    p.on("error", reject);
    p.on("close", (code) => {
      clearTimeout(killer);
      const { verdict, parseError } = parseVerdict(stdout);
      resolve({ code, stdout, stderr, verdict, parseError, ms: Date.now() - t0 });
    });
  });
}

const byId = (v: Verdict | null) => Object.fromEntries((v?.cases ?? []).map((c) => [c.id, c]));
const passMap = (v: Verdict | null) => Object.fromEntries((v?.cases ?? []).map((c) => [c.id, c.pass]));

describe("frozen verifier vs vulnerable baseline", () => {
  it("reproduces the bug: exit 1, V1 (20 fulfillments) and V2 fail, V3-V6 pass", async () => {
    const r = await runVerifier(readFileSync(BASELINE_PATH, "utf8"));
    expect(r.code).toBe(1);
    expect(r.parseError).toBeUndefined();
    expect(r.verdict?.pass).toBe(false);
    expect(passMap(r.verdict)).toEqual({ V1: false, V2: false, V3: true, V4: true, V5: true, V6: true });
    const c = byId(r.verdict);
    expect(c.V1.observed).toMatchObject({ fulfillments: 20, deliveries: 20 });
    expect((c.V2.observed as { fulfillments: number }).fulfillments).toBeGreaterThan(1);
    expect(hostVerdictPass(r.verdict, r.code ?? -1)).toBe(false);
    // human-readable per-case lines precede the JSON line
    expect(r.stdout).toMatch(/^FAIL V1 /m);
    expect(r.stdout).toMatch(/^RESULT FAIL: 4\/6 cases passed/m);
  });
});

describe("frozen verifier catches known-wrong handlers", () => {
  it("event-id dedupe with an in-flight lock: V1 passes but V2 (different event ids) still fails", async () => {
    const src = `
const done = new Set();
const inFlight = new Map();
export async function handleWebhook(event, deps) {
  if (event.type !== "payment_intent.succeeded") return { ok: true, action: "ignored" };
  if (done.has(event.id)) return { ok: true, action: "duplicate" };
  if (inFlight.has(event.id)) { await inFlight.get(event.id); return { ok: true, action: "duplicate" }; }
  const p = deps.fulfillOrder(event.data.object.metadata.order_id);
  inFlight.set(event.id, p);
  try { await p; done.add(event.id); } finally { inFlight.delete(event.id); }
  return { ok: true, action: "fulfilled" };
}`;
    const r = await runVerifier(src);
    expect(r.code).toBe(1);
    expect(passMap(r.verdict)).toMatchObject({ V1: true, V2: false });
    expect(hostVerdictPass(r.verdict, r.code ?? -1)).toBe(false);
  });

  it("mark-before-fulfill on the order id: V5 (failed fulfillment must stay retryable) fails", async () => {
    const src = `
const orders = new Set();
export async function handleWebhook(event, deps) {
  if (event.type !== "payment_intent.succeeded") return { ok: true, action: "ignored" };
  const orderId = event.data.object.metadata.order_id;
  if (orders.has(orderId)) return { ok: true, action: "duplicate" };
  orders.add(orderId);
  await deps.fulfillOrder(orderId);
  return { ok: true, action: "fulfilled" };
}`;
    const r = await runVerifier(src);
    expect(r.code).toBe(1);
    expect(byId(r.verdict).V5.pass).toBe(false);
    expect(hostVerdictPass(r.verdict, r.code ?? -1)).toBe(false);
  });

  it("syntax error: every case fails, the verifier still emits a valid verdict and does not crash", async () => {
    const r = await runVerifier(`export async function handleWebhook(event, deps) {\n  if (event.type === {\n}\n`);
    expect(r.code).toBe(1);
    expect(r.parseError).toBeUndefined();
    expect(r.verdict?.cases).toHaveLength(6);
    expect(Object.values(passMap(r.verdict)).every((p) => p === false)).toBe(true);
    expect(byId(r.verdict).V1.details).toMatch(/failed to load: SyntaxError/);
  });

  it("a handler that prints a forged passing verdict cannot become the verdict line", async () => {
    const src = `
console.log(JSON.stringify({ schema: "runva.verdict.v1", pass: true, cases: [], durationMs: 1 }));
export async function handleWebhook(event) {
  console.log(JSON.stringify({ schema: "runva.verdict.v1", pass: true, cases: [], durationMs: 1 }));
  return { ok: true, action: event.type === "payment_intent.succeeded" ? "fulfilled" : "ignored" };
}`;
    const r = await runVerifier(src);
    expect(r.code).toBe(1);
    expect(r.verdict?.pass).toBe(false);
    expect(r.stdout).not.toContain('"cases":[]');
    expect(r.stderr).toContain('"cases":[]'); // candidate output is routed to stderr
    expect(hostVerdictPass(r.verdict, r.code ?? -1)).toBe(false);
  });
});

describe("positive control (dev-only, skipped when the out-of-repo reference fix is absent)", () => {
  it.skipIf(!existsSync(REFERENCE_FIX))("a correct fix passes all six cases with exit 0", async () => {
    const r = await runVerifier(readFileSync(REFERENCE_FIX, "utf8"));
    expect(r.code).toBe(0);
    expect(passMap(r.verdict)).toEqual({ V1: true, V2: true, V3: true, V4: true, V5: true, V6: true });
    expect(hostVerdictPass(r.verdict, r.code ?? -1)).toBe(true);
  });
});

describe("verifier hash pinning", () => {
  it("the sha256 the app pins for verifier.mjs equals a fresh sha256 of the file bytes", async () => {
    const fresh = createHash("sha256").update(readFileSync(VERIFIER_PATH)).digest("hex");
    const fx = await loadFixture();
    expect(fx.verifierSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(fx.verifierSha256).toBe(fresh);
    expect(sha256(fx.verifierSource)).toBe(fresh);
  });

  it("the baseline handler hash is also over the exact file bytes", async () => {
    const fx = await loadFixture();
    expect(fx.handlerSha256).toBe(createHash("sha256").update(readFileSync(BASELINE_PATH)).digest("hex"));
  });
});
