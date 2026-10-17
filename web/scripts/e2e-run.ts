// RUNVA end-to-end run from the CLI (no Next server). Usage, from web/:
//   set -a; . ../.env; set +a; NODE_OPTIONS=--conditions=import pnpm dlx tsx scripts/e2e-run.ts             # full run
//   set -a; . ../.env; set +a; NODE_OPTIONS=--conditions=import pnpm dlx tsx scripts/e2e-run.ts --baseline  # sandbox + frozen verifier on baseline only (no LLM)
// (--conditions=import is required because the CreateOS SDK is ESM-only and tsx loads these .ts files as CJS.)
// Prints the live timeline, then a summary. Always exits (the SDK can keep a handle open).
import { startRun } from "../src/lib/runva/orchestrator";
import { checkCanStart } from "../src/lib/runva/run-store";
import { SandboxSession, listSandboxesBounded } from "../src/lib/runva/sandbox";
import { loadFixture } from "../src/lib/runva/fixture";
import { parseVerdict, hostVerdictPass } from "../src/lib/runva/verifier";
import { llmEnv, sandboxEnv } from "../src/lib/runva/env";
import type { RunEvent } from "../src/lib/runva/types";

const t0 = Date.now();
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
  const fx = await loadFixture();
  console.log(`fixture loaded: baseline sha256=${fx.handlerSha256.slice(0, 16)}… verifier sha256=${fx.verifierSha256.slice(0, 16)}…`);
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
    const { evidence, stdout } = await vm.node("baseline verifier", "/workspace/verification.mjs");
    const { verdict, parseError } = parseVerdict(stdout);
    console.log(`${el()} frozen verifier on baseline: exit ${evidence.exitCode} execMs=${evidence.execMs} parsed=${!!verdict}${parseError ? " (" + parseError + ")" : ""}`);
    for (const c of verdict?.cases ?? []) console.log(`        ${c.id} ${c.pass ? "PASS" : "FAIL"}  observed=${JSON.stringify(c.observed)} expected=${JSON.stringify(c.expected)}`);
    console.log(`host verdict pass = ${hostVerdictPass(verdict, evidence.exitCode)} (expected false for the vulnerable baseline)`);
  } finally {
    const d = await vm.destroy();
    console.log(`${el()} sandbox destroyed ok=${d.ok} in ${d.ms}ms${d.error ? " error=" + d.error : ""}`);
  }
}

async function full() {
  const gate = checkCanStart(process.env.RUNVA_ACCESS_CODE);
  if (!gate.ok) throw new Error(gate.error);
  const { record, done } = startRun();
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
        status: S.status,
        durationMs: S.durationMs,
        model: S.model,
        credentialSource: S.credentialSource,
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
}

async function main() {
  const sb = sandboxEnv();
  const llm = llmEnv();
  console.log(`config: sandboxKey=${sb.apiKeySource ?? "MISSING"} baseUrl=${sb.baseUrl} shape=${sb.shape} egress=${sb.egress.join(",")} llm=${llm.provider}:${llm.model} freshVerifierVm=${sb.freshVerifierVm}`);
  if (process.argv.includes("--baseline")) await baselineOnly();
  else await full();
  if (sb.apiKey && !process.argv.includes("--no-cleanup-check")) await cleanupCheck();
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("E2E ERROR:", e instanceof Error ? `${e.name}: ${e.message}` : e);
    process.exit(1);
  });
