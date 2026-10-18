#!/usr/bin/env node
// RUNVA twin-VM experiment (CreateOS pause / fork / resume). A SEPARATE proof from the main RUNVA loop,
// which always judges a candidate in a FRESH VM, never a fork.
//
//   1. VM A: upload the frozen verifier + the original vulnerable handler, run the verifier -> expect it to FAIL
//      (exit 1, V1 fulfills the order 20x).
//   2. Pause VM A: CreateOS snapshots that exact failing state.
//   3. Fork the paused VM A -> VM B. B inherits A's bytes (same verifier sha256, same baseline handler, same nonce).
//      In B, overwrite ONLY /workspace/target/handler.mjs with the agent-patched handler from
//      evidence/runs/run_9ce5ab644beb2546eb and run the same verifier -> expect PASS (exit 0, 6/6, V1 = 1).
//   4. Resume VM A and re-run the verifier against the untouched baseline -> expect it to still FAIL.
//   5. Destroy both VMs (every path), confirm via the REST list that none remain, write evidence/twin-vm/<stamp>/.
//
//   set -a; . ./.env; set +a
//   node web/scripts/twin-vm.mjs
//
// env: CREATEOS_SANDBOX_API_KEY (required, never printed or written)
//      CREATEOS_SANDBOX_BASE_URL (default https://api-eu.sb.createos.sh)
//
// Handlers are only ever executed inside the VMs. The host reads them as text, hashes and uploads them.
// If pause/fork is refused, the exact error is recorded and the script falls back to a fresh VM B
// (labelled "fallback: no fork"); it never pretends a fork happened.
// Exit codes: 0 = all expectations met, 1 = ran but a result differs, 2 = usage / hash refusal, 3 = infra error.
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@nodeops-createos/sandbox";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, "..", "..");
const FIXTURE_DIR = path.join(HERE, "..", "fixtures", "webhook-idempotency");
const VERIFIER_PATH = path.join(FIXTURE_DIR, "verifier.mjs");
const BASELINE_PATH = path.join(FIXTURE_DIR, "handler.vulnerable.mjs");
const RUN_ID = "run_9ce5ab644beb2546eb";
const RUN_DIR = path.join(REPO, "evidence", "runs", RUN_ID);
const PATCH_PATH = path.join(RUN_DIR, "patch.diff");
const CASE_IDS = ["V1", "V2", "V3", "V4", "V5", "V6"];
const SHAPE = "s-1vcpu-1gb";
const ROOTFS = "devbox:1";
// NON-EMPTY allowlist. An empty list means allow-all on CreateOS, so never send [].
const EGRESS = ["registry.npmjs.org:443"];
const BASE_URL = (process.env.CREATEOS_SANDBOX_BASE_URL || "https://api-eu.sb.createos.sh").replace(/\/+$/, "");
const P_VERIFIER = "/workspace/verification.mjs";
const P_HANDLER = "/workspace/target/handler.mjs";
const P_NONCE = "/workspace/.twin-nonce";

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const short = (id) => (id && id.length > 12 ? `${id.slice(0, 10)}…` : String(id));
const rel = (p) => path.relative(REPO, p);

const API_KEY = process.env.CREATEOS_SANDBOX_API_KEY || "";
const SECRETS = [API_KEY, process.env.OPENROUTER_API_KEY || "", process.env.STRIPE_TEST_SECRET_KEY || ""].filter((s) => s.length >= 8);
const KEYLIKE = /\b(?:sk|rk|pk)_(?:test|live)_[A-Za-z0-9]{8,}|\bwhsec_[A-Za-z0-9]{8,}|\bsk-[A-Za-z0-9_-]{12,}/g;
const redact = (s) => {
  let out = String(s ?? "");
  for (const k of SECRETS) out = out.split(k).join("[redacted]");
  return out.replace(KEYLIKE, "[redacted]");
};
const errText = (e) => {
  const status = e?.status ?? e?.statusCode;
  const code = e?.code;
  const extra = [status !== undefined ? `status=${status}` : "", code !== undefined ? `code=${code}` : ""].filter(Boolean).join(" ");
  return redact(e instanceof Error ? `${e.name}: ${e.message}${extra ? ` (${extra})` : ""}` : String(e));
};

const logLines = [];
const log = (...a) => {
  const line = redact(a.join(" "));
  logLines.push(line);
  console.log(line);
};
const logErr = (...a) => {
  const line = redact(a.join(" "));
  logLines.push(line);
  console.error(line);
};
function refuse(msg) {
  console.error(`refusing to run: ${msg}`);
  process.exit(2);
}
if (!API_KEY) refuse("CREATEOS_SANDBOX_API_KEY is not set");

// ---------------------------------------------------------------- inputs (read as text only, never imported on the host)

/** Same extraction as reverify.mjs: a RUNVA patch file carries the complete final source as "# " lines at its tail. */
function extractFinalHandler(file) {
  const raw = readFileSync(file, "utf8");
  const marker = raw.split("\n").findIndex((l) => l.trim() === "# Final handler.mjs (complete source)");
  if (marker < 0) throw new Error(`${rel(file)} has no "# Final handler.mjs (complete source)" section`);
  const lines = raw.split("\n").slice(marker + 2); // skip the "# ----" separator after the marker
  while (lines.length && !lines[lines.length - 1].startsWith("#")) lines.pop();
  return lines.map((l) => (l.startsWith("# ") ? l.slice(2) : l === "#" ? "" : l)).join("\n");
}

const verifierSource = readFileSync(VERIFIER_PATH, "utf8");
const baselineSource = readFileSync(BASELINE_PATH, "utf8");
const patchedSource = extractFinalHandler(PATCH_PATH);
const verifierSha = sha256(Buffer.from(verifierSource, "utf8"));
const baselineSha = sha256(Buffer.from(baselineSource, "utf8"));
const patchedSha = sha256(Buffer.from(patchedSource, "utf8"));
const summary = JSON.parse(readFileSync(path.join(RUN_DIR, "summary.json"), "utf8"));
if (summary.finalResult?.handlerSha256 !== patchedSha)
  refuse(`patched sha256 ${patchedSha} does not match ${RUN_ID} summary.finalResult.handlerSha256 (${summary.finalResult?.handlerSha256})`);
if (summary.baselineSha256 !== baselineSha)
  refuse(`baseline sha256 ${baselineSha} does not match ${RUN_ID} summary.baselineSha256 (${summary.baselineSha256})`);
const nonce = randomBytes(16).toString("hex"); // written into A before pause; must reappear in the fork

// ---------------------------------------------------------------- verdict (same rule as the host gate / reverify.mjs)

function parseVerdict(stdout) {
  const lines = (stdout || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const last = lines[lines.length - 1];
  if (!last) return { verdict: null, error: "verifier produced no stdout" };
  let v;
  try {
    v = JSON.parse(last);
  } catch {
    return { verdict: null, error: "last stdout line is not JSON" };
  }
  if (!v || v.schema !== "runva.verdict.v1" || typeof v.pass !== "boolean" || !Array.isArray(v.cases))
    return { verdict: null, error: "last stdout line is not a runva.verdict.v1 object" };
  if (!v.cases.every((c) => c && CASE_IDS.includes(c.id) && typeof c.pass === "boolean"))
    return { verdict: null, error: "verdict cases do not match the schema" };
  return { verdict: v };
}
const verdictPasses = (v, exitCode) =>
  !!v && exitCode === 0 && v.pass === true && CASE_IDS.every((id) => v.cases.some((c) => c.id === id)) && v.cases.every((c) => c.pass === true);

// ---------------------------------------------------------------- CreateOS

const client = createClient({ apiKey: API_KEY, baseUrl: BASE_URL });
/** Every sandbox this script created (or that the control plane forked for it). Each is destroyed in `finally`. */
const mine = []; // { role, sb, name, destroyed, destroyMs, destroyError }

async function createFresh(role, tag) {
  const name = `runva-${tag}-${randomBytes(4).toString("hex")}`; // CreateOS caps names at 22 chars
  const spec = { shape: SHAPE, rootfs: ROOTFS, ingress_enabled: false, egress: EGRESS, name };
  for (let attempt = 1; ; attempt++) {
    try {
      const sb = await client.createSandbox(spec, { timeoutMs: 120_000, retry: false });
      mine.push({ role, sb, name, destroyed: false });
      return sb;
    } catch (e) {
      const status = e?.status ?? e?.statusCode;
      const busy = status === 429 || status === 403 || /rate|limit|quota|concurren|one sandbox/i.test(String(e?.message));
      if (attempt === 1 && busy) {
        log(`  createSandbox refused (${errText(e)}); waiting 20s and retrying once`);
        await sleep(20_000);
        continue;
      }
      throw e;
    }
  }
}

async function run(sb, cmd, args, timeoutMs = 60_000) {
  const r = await sb.runCommand(cmd, args, { timeoutMs, retry: false });
  return {
    exitCode: typeof r.result.exit_code === "number" ? r.result.exit_code : -1,
    stdout: r.result.stdout || "",
    stderr: (r.result.stderr || "") + (r.result.error ? `\n[agent error] ${r.result.error}` : ""),
    execMs: r.exec_ms,
  };
}

async function inVmHashes(sb, label) {
  const sums = await run(sb, "sha256sum", [P_VERIFIER, P_HANDLER], 30_000);
  const m = Object.fromEntries(
    sums.stdout
      .trim()
      .split("\n")
      .map((l) => l.trim().split(/\s+/))
      .filter((p) => p.length === 2)
      .map(([h, f]) => [f, h]),
  );
  const out = { verifier: m[P_VERIFIER] ?? null, handler: m[P_HANDLER] ?? null };
  const tag = (h) => (h === verifierSha ? "frozen verifier" : h === baselineSha ? "baseline handler" : h === patchedSha ? "patched handler" : "UNKNOWN");
  log(`  ${label.padEnd(9)} in-VM sha256 verification.mjs ${out.verifier ?? "unavailable"} (${tag(out.verifier)})`);
  log(`  ${label.padEnd(9)} in-VM sha256 target/handler.mjs ${out.handler ?? "unavailable"} (${tag(out.handler)})`);
  return out;
}

async function verify(sb, label) {
  log(`\n$ node ${P_VERIFIER}   # in ${label}`);
  const ver = await run(sb, "node", [P_VERIFIER], 90_000);
  const { verdict, error } = parseVerdict(ver.stdout);
  for (const l of ver.stdout.trimEnd().split("\n").slice(0, -1)) log(`  ${l}`);
  log(`  verifier exit code: ${ver.exitCode}${ver.execMs !== undefined ? ` · exec ${ver.execMs}ms` : ""}`);
  if (!verdict) {
    log(`  verdict could not be parsed (${error}); treated as NOT verified`);
    return { exitCode: ver.exitCode, execMs: ver.execMs ?? null, parsed: false, error, pass: false, cases: [], v1Observed: null };
  }
  const v1 = verdict.cases.find((c) => c.id === "V1");
  const passed = verdict.cases.filter((c) => c.pass).length;
  const res = {
    exitCode: ver.exitCode,
    execMs: ver.execMs ?? null,
    parsed: true,
    pass: verdictPasses(verdict, ver.exitCode),
    verdictPass: verdict.pass,
    passedCases: `${passed}/${verdict.cases.length}`,
    cases: verdict.cases.map((c) => ({ id: c.id, pass: c.pass })),
    failing: verdict.cases.filter((c) => !c.pass).map((c) => c.id),
    v1Observed: v1?.observed ?? null,
    durationMs: verdict.durationMs ?? null,
  };
  log(`  verdict: pass=${verdict.pass} ${res.passedCases} ${res.cases.map((c) => `${c.id}:${c.pass ? "pass" : "FAIL"}`).join(" ")} · V1 fulfillments ${res.v1Observed?.fulfillments}`);
  return res;
}

/** REST list (the SDK's listSandboxes() can hang), always with a timeout. Returns raw sandbox views. */
async function restList() {
  const all = [];
  for (let offset = 0, page = 0; page < 20; page++) {
    const res = await fetch(`${BASE_URL}/v1/sandboxes?limit=500&offset=${offset}`, {
      headers: { "X-Api-Key": API_KEY, Accept: "application/json" },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`GET /v1/sandboxes -> HTTP ${res.status}`);
    const j = await res.json();
    const body = j && j.status === "success" && "data" in j ? j.data : j;
    const items = Array.isArray(body) ? body : Array.isArray(body?.data) ? body.data : Array.isArray(body?.items) ? body.items : null;
    if (!items) throw new Error("GET /v1/sandboxes returned an unrecognized shape");
    all.push(...items);
    const total = body?.pagination?.total;
    if (typeof total !== "number" || items.length === 0 || offset + items.length >= total) break;
    offset += items.length;
  }
  return all;
}

/** If a fork request errored after the server created a clone, find and adopt that clone so it gets destroyed. */
async function adoptStrayForks(sourceId) {
  try {
    const stray = (await restList()).filter((v) => v.forked_from === sourceId && !["destroyed", "destroying"].includes(v.status));
    for (const v of stray) {
      if (mine.some((m) => m.sb.id === v.id)) continue;
      mine.push({ role: "B (stray fork, adopted for cleanup)", sb: await client.getSandbox(v.id, { timeoutMs: 20_000, retry: false }), name: v.name ?? null, destroyed: false });
      log(`  found stray fork ${short(v.id)} of A after the fork error; it will be destroyed`);
    }
  } catch (e) {
    logErr(`  could not scan for stray forks: ${errText(e)}`);
  }
}

// ---------------------------------------------------------------- main

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const OUT_DIR = path.join(REPO, "evidence", "twin-vm", stamp);
const result = {
  schema: "runva.twin-vm.v1",
  createdAt: new Date().toISOString(),
  note:
    "Separate controlled experiment using CreateOS pause/fork/resume. The main RUNVA verdict still runs the frozen verifier in a FRESH VM, never a fork.",
  mode: null, // "fork" or "fallback: no fork"
  baseUrl: BASE_URL,
  spec: { shape: SHAPE, rootfs: ROOTFS, ingressEnabled: false, egress: EGRESS },
  inputs: {
    verifier: { path: rel(VERIFIER_PATH), sha256: verifierSha },
    baselineHandler: { path: rel(BASELINE_PATH), sha256: baselineSha, recordedIn: `${RUN_ID} summary.baselineSha256` },
    patchedHandler: { source: `${rel(PATCH_PATH)} (embedded final source)`, sha256: patchedSha, recordedIn: `${RUN_ID} summary.finalResult.handlerSha256` },
    snapshotNonce: { path: P_NONCE, note: "random value written into VM A before pause; read back from the fork" },
  },
  sandboxes: [],
  steps: {},
  errors: {},
  timings: {},
  onlyDifference: null,
  expectationsMet: null,
  outcome: null,
  cleanup: null,
};

let exitCode = 3;
let A;
let B;
const t0 = Date.now();
try {
  mkdirSync(OUT_DIR, { recursive: true });
  log("RUNVA twin-VM experiment: CreateOS pause · fork · resume");
  log(`  verifier  ${rel(VERIFIER_PATH)} sha256 ${verifierSha}`);
  log(`  baseline  ${rel(BASELINE_PATH)} sha256 ${baselineSha} (matches ${RUN_ID})`);
  log(`  patched   ${rel(PATCH_PATH)} final source sha256 ${patchedSha} (matches ${RUN_ID} summary.json)`);

  // 1. VM A: frozen verifier + vulnerable baseline -> expect FAIL.
  let c0 = Date.now();
  A = await createFresh("A (original: baseline, paused then resumed)", "tw");
  result.timings.createAMs = Date.now() - c0;
  log(`\n[1] VM A ${short(A.id)} created in ${result.timings.createAMs}ms · shape ${SHAPE} · rootfs ${ROOTFS} · ingress off · egress ${(A.data?.egress?.length ? A.data.egress : EGRESS).join(",")}`);
  const mk = await run(A, "mkdir", ["-p", "/workspace/target"], 30_000);
  if (mk.exitCode !== 0) throw new Error(`mkdir failed in A (exit ${mk.exitCode}): ${mk.stderr.trim()}`);
  await A.files.upload(P_VERIFIER, verifierSource);
  await A.files.upload(P_HANDLER, baselineSource);
  await A.files.upload(P_NONCE, nonce);
  const aHashes = await inVmHashes(A, "A");
  if (aHashes.verifier !== verifierSha || aHashes.handler !== baselineSha) throw new Error("bytes in VM A do not match the host hashes");
  const node = await run(A, "node", ["--version"], 30_000);
  log(`  A         node ${node.stdout.trim()} (inside the VM)`);
  const aRun1 = await verify(A, "VM A (baseline, before pause)");
  result.steps.a_before_pause = { hashes: aHashes, verdict: aRun1, nodeVersion: node.stdout.trim() };

  // 2. Pause A: snapshot the failing state.
  let pauseOk = false;
  log(`\n[2] pausing VM A ${short(A.id)} (snapshot of the failing state)`);
  try {
    const p0 = Date.now();
    await A.pause({ timeoutMs: 120_000, retry: false });
    result.timings.pauseRequestMs = Date.now() - p0;
    await A.waitUntilPaused({ timeoutMs: 180_000 });
    result.timings.pauseMs = Date.now() - p0;
    pauseOk = true;
    log(`  A         status=${A.status} · pause request ${result.timings.pauseRequestMs}ms · paused after ${result.timings.pauseMs}ms${A.data?.paused_at ? ` · paused_at ${A.data.paused_at}` : ""}`);
  } catch (e) {
    result.errors.pause = errText(e);
    logErr(`  pause FAILED: ${result.errors.pause}`);
  }

  // 3. Fork A -> B (fork requires a paused source).
  if (pauseOk) {
    log(`\n[3] forking paused VM A -> VM B`);
    const f0 = Date.now();
    try {
      B = await A.fork({ ingress_enabled: false, egress: EGRESS }, { timeoutMs: 180_000, retry: false });
      mine.push({ role: "B (fork of paused A: patched handler)", sb: B, name: B.name ?? null, destroyed: false });
      result.timings.forkRequestMs = Date.now() - f0;
      log(`  B         ${short(B.id)} returned in ${result.timings.forkRequestMs}ms · status=${B.status} · forked_from ${short(B.data?.forked_from)}`);
      if (B.status !== "running") await B.waitUntilRunning({ timeoutMs: 180_000 });
      result.timings.forkMs = Date.now() - f0;
      log(`  B         running after ${result.timings.forkMs}ms · egress ${(B.data?.egress?.length ? B.data.egress : ["(inherited)"]).join(",")} · ingress ${B.data?.ingress_enabled ? "on" : "off"}`);
    } catch (e) {
      result.errors.fork = errText(e);
      logErr(`  fork FAILED: ${result.errors.fork}`);
      if (!B) await adoptStrayForks(A.id);
      else throw e; // the fork exists but never came up: infra error, cleanup in finally
    }
  }

  if (B) {
    result.mode = "fork";
    // Inherited state: same verifier bytes, same baseline handler, same nonce.
    const bInherited = await inVmHashes(B, "B (fork)");
    const n = await run(B, "cat", [P_NONCE], 30_000);
    const nonceInherited = n.exitCode === 0 && n.stdout.trim() === nonce;
    log(`  B (fork)  snapshot nonce ${nonceInherited ? "matches A (inherited from the snapshot)" : "MISSING / DIFFERENT"}`);
    if (bInherited.verifier !== aHashes.verifier) throw new Error("fork B does not carry A's verifier bytes");
    // Overwrite ONLY target/handler.mjs.
    await B.files.upload(P_HANDLER, patchedSource);
    log(`  B (fork)  overwrote ONLY ${P_HANDLER} with the agent-patched handler`);
    const bHashes = await inVmHashes(B, "B (fork)");
    if (bHashes.verifier !== verifierSha || bHashes.handler !== patchedSha) throw new Error("bytes in VM B do not match the expected hashes after the overwrite");
    const bRun = await verify(B, "VM B (fork, patched handler)");
    result.steps.b_fork = { inheritedHashes: bInherited, nonceInherited, hashes: bHashes, verdict: bRun };
  } else {
    // Fallback: a fresh VM B with the same uploads. Clearly labelled; not a fork.
    result.mode = "fallback: no fork";
    log(`\n[3] FALLBACK (no fork): creating a fresh VM B with the same verifier upload`);
    c0 = Date.now();
    B = await createFresh("B (fallback: fresh VM, patched handler)", "tb");
    result.timings.createBMs = Date.now() - c0;
    log(`  B         ${short(B.id)} created in ${result.timings.createBMs}ms (fresh VM, NOT a fork)`);
    const mkb = await run(B, "mkdir", ["-p", "/workspace/target"], 30_000);
    if (mkb.exitCode !== 0) throw new Error(`mkdir failed in B (exit ${mkb.exitCode}): ${mkb.stderr.trim()}`);
    await B.files.upload(P_VERIFIER, verifierSource);
    await B.files.upload(P_HANDLER, patchedSource);
    const bHashes = await inVmHashes(B, "B (fresh)");
    if (bHashes.verifier !== verifierSha || bHashes.handler !== patchedSha) throw new Error("bytes in VM B do not match the host hashes");
    const bRun = await verify(B, "VM B (fresh fallback, patched handler)");
    result.steps.b_fallback = { hashes: bHashes, verdict: bRun };
  }

  // 4. Resume A and re-run against the untouched baseline.
  if (pauseOk) {
    log(`\n[4] resuming VM A ${short(A.id)}`);
    const r0 = Date.now();
    await A.resume({ timeoutMs: 120_000, retry: false });
    result.timings.resumeRequestMs = Date.now() - r0;
    if (A.status !== "running") await A.waitUntilRunning({ timeoutMs: 180_000 });
    result.timings.resumeMs = Date.now() - r0;
    log(`  A         running again · resume request ${result.timings.resumeRequestMs}ms · running after ${result.timings.resumeMs}ms`);
  } else {
    log(`\n[4] (pause failed, so A was never paused) re-running the verifier in VM A`);
  }
  const aAfter = await inVmHashes(A, "A");
  const an = await run(A, "cat", [P_NONCE], 30_000);
  const aRun2 = await verify(A, pauseOk ? "VM A (resumed, untouched baseline)" : "VM A (not paused, untouched baseline)");
  result.steps.a_after_resume = { resumed: pauseOk, hashes: aAfter, nonceIntact: an.exitCode === 0 && an.stdout.trim() === nonce, verdict: aRun2 };

  // Verdict of the experiment.
  const bStep = result.steps.b_fork ?? result.steps.b_fallback;
  result.onlyDifference =
    bStep.hashes.verifier === aHashes.verifier && aAfter.verifier === aHashes.verifier && bStep.hashes.handler !== aHashes.handler && aAfter.handler === aHashes.handler;
  const aFails = (r) => r.parsed && r.exitCode === 1 && !r.pass && r.v1Observed?.fulfillments === 20;
  const bPasses = (r) => r.pass && r.exitCode === 0 && r.v1Observed?.fulfillments === 1;
  result.expectationsMet = {
    aBeforePauseFails20: aFails(aRun1),
    bPasses6of6Fulfills1: bPasses(bStep.verdict),
    aAfterResumeStillFails20: aFails(aRun2),
    onlyDifference: result.onlyDifference,
    forkUsed: result.mode === "fork",
    ...(result.mode === "fork" ? { forkInheritedVerifierAndNonce: result.steps.b_fork.inheritedHashes.verifier === verifierSha && result.steps.b_fork.nonceInherited } : {}),
  };
  const allOk = Object.values(result.expectationsMet).every(Boolean);
  result.outcome = `${result.mode === "fork" ? "FORK" : "FALLBACK (no fork)"}: A baseline V1 fulfillments ${aRun1.v1Observed?.fulfillments} (exit ${aRun1.exitCode}) · B patched V1 fulfillments ${bStep.verdict.v1Observed?.fulfillments} (exit ${bStep.verdict.exitCode}, ${bStep.verdict.passedCases}) · A after resume V1 fulfillments ${aRun2.v1Observed?.fulfillments} (exit ${aRun2.exitCode}) · only handler.mjs differs: ${result.onlyDifference}`;
  log(`\nResult: ${result.outcome}`);
  log(allOk ? "PASS: identical snapshot + identical verifier bytes; only handler.mjs differs -> 20 fulfillments vs 1" : `UNEXPECTED: ${JSON.stringify(result.expectationsMet)}`);
  exitCode = allOk ? 0 : 1;
} catch (e) {
  result.errors.fatal = errText(e);
  result.outcome = `INFRA_ERROR: ${result.errors.fatal}`;
  logErr(`INFRA ERROR: ${result.errors.fatal}`);
  if (A && !result.errors.fork && !B) await adoptStrayForks(A.id);
  exitCode = 3;
} finally {
  // 5. Destroy every sandbox this script created, fork first.
  log("\n[5] cleanup");
  for (const m of [...mine].reverse()) {
    const d0 = Date.now();
    try {
      await m.sb.destroy({ timeoutMs: 30_000, retry: false });
      m.destroyed = true;
      m.destroyMs = Date.now() - d0;
      log(`  destroyed ${m.role.split(" ")[0]} ${short(m.sb.id)} in ${m.destroyMs}ms`);
    } catch (e) {
      m.destroyError = errText(e);
      logErr(`  destroy FAILED for ${short(m.sb.id)}: ${m.destroyError}`);
    }
  }
  for (const m of mine) {
    if (m.role.startsWith("A")) result.timings.destroyAMs = m.destroyMs ?? null;
    else result.timings.destroyBMs = m.destroyMs ?? null;
  }
  // Confirm via the REST list that none of ours remain (by id, or as a fork of A).
  const ids = new Set(mine.map((m) => m.sb.id));
  const cleanup = { checkedAt: null, polls: 0, remaining: [], error: null };
  try {
    const w0 = Date.now();
    for (;;) {
      cleanup.polls++;
      const views = await restList();
      const ours = views.filter((v) => ids.has(v.id) || (A && v.forked_from === A.id));
      for (const v of ours) {
        if (!ids.has(v.id) && !["destroyed", "destroying"].includes(v.status)) {
          // A fork of A we did not know about: it is ours, destroy it too.
          try {
            await (await client.getSandbox(v.id, { timeoutMs: 20_000, retry: false })).destroy({ timeoutMs: 30_000, retry: false });
            log(`  destroyed untracked fork ${short(v.id)}`);
          } catch (e) {
            logErr(`  destroy FAILED for untracked fork ${short(v.id)}: ${errText(e)}`);
          }
          ids.add(v.id);
        }
      }
      cleanup.remaining = ours.filter((v) => v.status !== "destroyed").map((v) => ({ id: short(v.id), status: v.status }));
      if (cleanup.remaining.length === 0 || Date.now() - w0 > 60_000) break;
      await sleep(3_000);
    }
    cleanup.checkedAt = new Date().toISOString();
    cleanup.allDestroyed = cleanup.remaining.length === 0;
    cleanup.noneRunning = cleanup.remaining.every((r) => r.status === "destroying");
    log(`  REST list check (${cleanup.polls} poll(s)): ${cleanup.allDestroyed ? "0 of our sandboxes remain" : `remaining ${JSON.stringify(cleanup.remaining)}`}`);
  } catch (e) {
    cleanup.error = errText(e);
    logErr(`  REST list check FAILED: ${cleanup.error}`);
  }
  result.cleanup = cleanup;
  result.sandboxes = mine.map((m) => ({
    role: m.role,
    idShort: short(m.sb.id),
    name: m.name,
    forkedFrom: m.sb.data?.forked_from ? short(m.sb.data.forked_from) : null,
    destroyed: m.destroyed,
    destroyMs: m.destroyMs ?? null,
    destroyError: m.destroyError ?? null,
  }));
  result.timings.totalMs = Date.now() - t0;
  log(`  total     ${result.timings.totalMs}ms`);
  log("Scope: one controlled experiment with synthetic events in these sandboxes. Not a production guarantee.");
  try {
    mkdirSync(OUT_DIR, { recursive: true });
    const json = redact(JSON.stringify(result, null, 2)) + "\n";
    for (const k of SECRETS) if (json.includes(k)) throw new Error("result contains a secret value; refusing to save");
    writeFileSync(path.join(OUT_DIR, "result.json"), json);
    writeFileSync(path.join(OUT_DIR, "console.log"), logLines.join("\n") + "\n");
    console.log(`  evidence  ${rel(OUT_DIR)}/`);
  } catch (e) {
    console.error(`could not write evidence: ${errText(e)}`);
  }
}
// The SDK keeps a handle open after destroy, so exit explicitly.
process.exit(exitCode);
