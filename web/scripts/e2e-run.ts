// RUNVA end-to-end run from the CLI (no Next server). Usage, from web/:
//   set -a; . ../.env; set +a; NODE_OPTIONS=--conditions=import pnpm dlx tsx scripts/e2e-run.ts             # full run
//   set -a; . ../.env; set +a; NODE_OPTIONS=--conditions=import pnpm dlx tsx scripts/e2e-run.ts --baseline  # sandbox + frozen verifier on baseline only (no LLM)
//   ... scripts/e2e-run.ts --handler path/to/handler.mjs  # bring your own handler: it replaces handler.vulnerable.mjs as the baseline
//       (read as text, hashed, uploaded only into the sandbox; the host never imports or runs it. Same contract: handleWebhook(event, deps).)
//   ... scripts/e2e-run.ts --scenario durable-idempotency  # pick a preset fixture (default webhook-idempotency); combines with --repeat/--baseline/--handler
// (--conditions=import is required because the CreateOS SDK is ESM-only and tsx loads these .ts files as CJS.)
// Prints the live timeline, then a summary. Always exits (the SDK can keep a handle open).
import { runBudgetMs, startRun } from "../src/lib/runva/orchestrator";
import { checkCanStart } from "../src/lib/runva/run-store";
import { SandboxSession, listSandboxesBounded } from "../src/lib/runva/sandbox";
import {
  DEFAULT_SCENARIO_ID,
  MAX_BASELINE_BYTES,
  SCENARIO_IDS,
  applyBaselineOverride,
  isScenarioId,
  loadFixture,
  scenarioLimits,
  validateBaselineOverride,
  type BaselineOverride,
} from "../src/lib/runva/fixture";
import { parseVerdict, hostVerdictPass } from "../src/lib/runva/verifier";
import { llmEnv, sandboxEnv } from "../src/lib/runva/env";
import { buildReceiptJson, renderPatchFile, renderReceipt } from "../src/lib/runva/receipt";
import { redact } from "../src/lib/runva/util";
import type { RunEvent, RunSummary, ScenarioId } from "../src/lib/runva/types";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const t0 = Date.now();

/** --handler <path>: load a user-supplied baseline as TEXT (never imported/executed here). */
function userBaseline(): BaselineOverride | undefined {
  const i = process.argv.indexOf("--handler");
  if (i < 0) return undefined;
  const arg = process.argv[i + 1];
  if (!arg || arg.startsWith("--")) throw new Error("--handler needs a path to a .mjs file");
  const abs = path.resolve(process.cwd(), arg);
  let st;
  try {
    st = statSync(abs);
  } catch {
    throw new Error(`--handler: file not found: ${arg}`);
  }
  if (!st.isFile()) throw new Error(`--handler: not a regular file: ${arg}`);
  if (st.size > MAX_BASELINE_BYTES) throw new Error(`--handler: ${arg} is ${st.size} bytes; the limit is ${MAX_BASELINE_BYTES} bytes`);
  const rel = path.relative(process.cwd(), abs);
  const label = rel && !rel.startsWith("..") && !path.isAbsolute(rel) ? rel : path.basename(abs);
  return validateBaselineOverride(readFileSync(abs, "utf8"), label);
}
let USER_BASELINE: BaselineOverride | undefined; // set in main()

/** --scenario <id>: one of the preset fixtures (allowlisted). */
function scenarioArg(): ScenarioId {
  const i = process.argv.indexOf("--scenario");
  if (i < 0) return DEFAULT_SCENARIO_ID;
  const arg = process.argv[i + 1];
  if (!isScenarioId(arg)) throw new Error(`--scenario must be one of: ${SCENARIO_IDS.join(", ")}`);
  return arg;
}
let SCENARIO: ScenarioId = DEFAULT_SCENARIO_ID; // set in main()
const el = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`.padStart(7);

function printEvent(e: RunEvent) {
  const d = e.details ?? {};
  const bits: string[] = [];
  for (const k of ["exitCode", "execMs", "createMs", "latencyMs", "sandboxId", "failing", "attempt"]) if (d[k] !== undefined) bits.push(`${k}=${JSON.stringify(d[k])}`);
  console.log(`${el()} #${String(e.seq).padStart(3)} [${e.status}] ${e.kind.padEnd(9)} ${e.title}${bits.length ? "  (" + bits.join(" ") + ")" : ""}`);
}

async function cleanupCheck() {
  try {
    const list = await listSandboxesBounded(15_000);
    const live = list.filter((s) => !["destroyed", "destroying", "failed"].includes(s.status));
    const ours = live.filter((s) => (s.name ?? "").startsWith("runva-"));
    console.log(`cleanup check: ${live.length} non-destroyed sandbox(es) on account; ${ours.length} RUNVA-named: ${JSON.stringify(ours.map((s) => ({ id: s.id.slice(0, 10), status: s.status, name: s.name })))}`);
    console.log(`cleanup check: all statuses seen: ${JSON.stringify(list.map((s) => `${s.id.slice(0, 10)}:${s.status}`))}`);
  } catch (e) {
    console.log(`cleanup check: listSandboxes unavailable (${(e as Error).message})`);
  }
}

async function baselineOnly() {
  let fx = await loadFixture(SCENARIO);
  if (USER_BASELINE) fx = applyBaselineOverride(fx, USER_BASELINE);
  console.log(`fixture ${SCENARIO} loaded${USER_BASELINE ? ` (baseline = user file ${USER_BASELINE.label})` : ""}: baseline sha256=${fx.handlerSha256.slice(0, 16)}… verifier sha256=${fx.verifierSha256.slice(0, 16)}…`);
  const vm = await SandboxSession.create("run_e2ebaseline", "work");
  console.log(`${el()} sandbox ${vm.shortId} created in ${vm.createMs}ms (shape=${vm.shape} region=${vm.region} egress=${vm.egress.join(",")})`);
  try {
    await vm.mkdir("/workspace/target");
    await vm.upload("/workspace/target/handler.mjs", fx.handlerSource);
    await vm.upload("/workspace/verification.mjs", fx.verifierSource);
    console.log(`${el()} uploaded baseline + frozen verifier`);
    const eg = await vm.exec("egress", "curl https://example.com", "curl", ["-sS", "-m", "4", "-o", "/dev/null", "https://example.com"], { timeoutMs: 20_000 });
    console.log(`${el()} egress check: curl exit ${eg.exitCode} → ${eg.exitCode !== 0 ? "BLOCKED" : "NOT BLOCKED"} ${eg.stderr.trim().slice(0, 120)}`);
    const syn = await vm.nodeCheck("syntax", "/workspace/target/handler.mjs");
    console.log(`${el()} node --check baseline: exit ${syn.exitCode}`);
    const { evidence, stdout } = await vm.node("baseline verifier", "/workspace/verification.mjs", undefined, scenarioLimits(SCENARIO).verifierTimeoutMs);
    const { verdict, parseError } = parseVerdict(stdout);
    console.log(`${el()} frozen verifier on baseline: exit ${evidence.exitCode} execMs=${evidence.execMs} parsed=${!!verdict}${parseError ? " (" + parseError + ")" : ""}`);
    for (const c of verdict?.cases ?? []) console.log(`        ${c.id} ${c.pass ? "PASS" : "FAIL"}  observed=${JSON.stringify(c.observed)} expected=${JSON.stringify(c.expected)}`);
    console.log(`host verdict pass = ${hostVerdictPass(verdict, evidence.exitCode)} (expected false for the vulnerable baseline)`);
  } finally {
    const d = await vm.destroy();
    console.log(`${el()} sandbox destroyed ok=${d.ok} in ${d.ms}ms${d.error ? " error=" + d.error : ""}`);
  }
}

function sanitize(text: string): string {
  // Keys are never stored, but scrub anyway; also drop anything that looks like an email address.
  return redact(text).replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]");
}

function saveEvidence(S: RunSummary): string {
  const dir = path.resolve(process.cwd(), "..", "evidence", "runs", S.runId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "receipt.md"), sanitize(renderReceipt(S)));
  writeFileSync(path.join(dir, "receipt.json"), sanitize(JSON.stringify(buildReceiptJson(S), null, 2)) + "\n");
  writeFileSync(path.join(dir, "summary.json"), sanitize(JSON.stringify(S, null, 2)) + "\n");
  const patch = renderPatchFile(S);
  if (patch) writeFileSync(path.join(dir, "patch.diff"), sanitize(patch));
  if (S.generatedTests) writeFileSync(path.join(dir, "agent-tests.mjs"), sanitize(S.generatedTests.testCode));
  return dir;
}

const v1 = (r: RunSummary["baselineResult"]) => {
  const c = r?.verdict?.cases.find((x) => x.id === "V1");
  const o = c?.observed as { fulfillments?: number } | null | undefined;
  return o && typeof o.fulfillments === "number" ? o.fulfillments : null;
};

function metrics(S: RunSummary) {
  return {
    runId: S.runId,
    scenario: S.scenarioId,
    status: S.status,
    baseline: S.baselineOrigin ? `${S.baselineOrigin.kind}:${S.baselineOrigin.label}` : null,
    attempts: S.attemptCount,
    durationMs: S.durationMs,
    vmCreateMs: (S.sandboxes ?? []).map((s) => `${s.purpose}:${s.createMs}`).join(" "),
    baselineV1Fulfillments: v1(S.baselineResult),
    finalV1Fulfillments: v1(S.finalResult),
    egressBlocked: S.egressCheck ? S.egressCheck.blocked : null,
    verifierIntegrityMatch: S.verifierIntegrity ? S.verifierIntegrity.match : null,
    allVmsDestroyed: (S.sandboxes ?? []).every((s) => s.destroyed),
  };
}

async function full(): Promise<RunSummary> {
  let gate = checkCanStart(process.env.RUNVA_ACCESS_CODE);
  while (!gate.ok && gate.status === 429) {
    await new Promise((r) => setTimeout(r, ((gate as { retryAfterSec?: number }).retryAfterSec ?? 5) * 1000));
    gate = checkCanStart(process.env.RUNVA_ACCESS_CODE);
  }
  if (!gate.ok) throw new Error(gate.error);
  const { record, done } = startRun({ baselineOverride: USER_BASELINE, scenarioId: SCENARIO });
  let seen = 0;
  const tick = setInterval(() => {
    for (const e of record.summary.events.slice(seen)) printEvent(e);
    seen = record.summary.events.length;
  }, 250);
  await done;
  clearInterval(tick);
  for (const e of record.summary.events.slice(seen)) printEvent(e);
  const S = record.summary;
  console.log("\n================ SUMMARY ================");
  console.log(
    JSON.stringify(
      {
        runId: S.runId,
        scenarioId: S.scenarioId,
        scenarioTitle: S.scenarioTitle,
        status: S.status,
        durationMs: S.durationMs,
        model: S.model,
        credentialSource: S.credentialSource,
        baselineOrigin: S.baselineOrigin,
        sandboxes: S.sandboxes,
        egressBlocked: S.egressCheck?.blocked,
        baselineVerifier: S.baselineResult && { exit: S.baselineResult.exitCode, failing: S.baselineResult.verdict?.cases.filter((c) => !c.pass).map((c) => c.id) },
        baselineAgentTestsExit: S.baselineAgentTests?.exitCode,
        attempts: S.attempts.map((a) => ({ attempt: a.attempt, syntax: a.syntaxCheck?.exitCode, agentTests: a.agentTests?.exitCode, verifierExit: a.verifier?.exitCode, failing: a.verifier?.verdict?.cases.filter((c) => !c.pass).map((c) => c.id), changeSummary: a.changeSummary.slice(0, 160) })),
        final: S.finalResult && { exit: S.finalResult.exitCode, pass: S.finalResult.verdict?.pass, cases: S.caseResults.map((c) => `${c.id}:${c.pass ? "PASS" : "FAIL"}`) },
        verifierIntegrity: S.verifierIntegrity,
        error: S.error,
      },
      null,
      2,
    ),
  );
  if (!process.argv.includes("--no-save")) console.log(`evidence saved: ${saveEvidence(S)}`);
  console.log("METRICS " + JSON.stringify(metrics(S)));
  return S;
}

async function main() {
  const sb = sandboxEnv();
  const llm = llmEnv();
  USER_BASELINE = userBaseline();
  SCENARIO = scenarioArg();
  console.log(`scenario: ${SCENARIO} (run budget ${Math.round(runBudgetMs(SCENARIO) / 1000)}s)`);
  if (USER_BASELINE) console.log(`baseline: user-supplied ${USER_BASELINE.label} (${Buffer.byteLength(USER_BASELINE.source)} bytes) — text only, uploaded to the sandbox, never run on this host`);
  console.log(`config: sandboxKey=${sb.apiKeySource ?? "MISSING"} baseUrl=${sb.baseUrl} shape=${sb.shape} egress=${sb.egress.join(",")} llm=${llm.provider}:${llm.model} freshVerifierVm=${sb.freshVerifierVm}`);
  const ri = process.argv.indexOf("--repeat");
  const repeat = ri > 0 ? Math.max(1, Math.min(5, Number(process.argv[ri + 1]) || 1)) : 1;
  if (process.argv.includes("--baseline")) await baselineOnly();
  else {
    const all: ReturnType<typeof metrics>[] = [];
    for (let i = 0; i < repeat; i++) {
      console.log(`\n######## RUN ${i + 1}/${repeat} ########`);
      all.push(metrics(await full()));
    }
    if (repeat > 1) console.table(all);
  }
  if (sb.apiKey && !process.argv.includes("--no-cleanup-check")) await cleanupCheck();
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("E2E ERROR:", e instanceof Error ? `${e.name}: ${e.message}` : e);
    process.exit(1);
  });
