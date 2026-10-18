// RUNVA orchestrator — PRD B4. Host code only hashes, diffs, parses JSON and asserts.
// Model-generated code is NEVER executed on the host: it is uploaded to and run inside CreateOS sandboxes.
import { createTwoFilesPatch } from "diff";
import type { CommandEvidence, EventKind, PatchAttempt, RunStatus, RunSummary, VerifierResult } from "./types";
import { applyBaselineOverride, loadFixture, type BaselineOverride, type Fixture } from "./fixture";
import { getLlm, type FailureEvidence, type LLMAdapter, type LlmCallMeta } from "./llm";
import { RunvaError, SandboxSession, classifySandboxError, getSandboxClient } from "./sandbox";
import { failingCases, hostVerdictPass, parseVerdict } from "./verifier";
import { llmEnv, modelLabel, runEnv, sandboxEnv } from "./env";
import { CancelledError, errMessage, newRunId, nowIso, sha256, throwIfAborted } from "./util";
import { markEnded, registerRun, type RunRecord } from "./run-store";

const TARGET = "/workspace/target/handler.mjs";
const VERIFIER = "/workspace/verification.mjs";
const AGENT_TESTS = "/workspace/agent-tests.mjs";

// ---------------------------------------------------------------- events

function emit(S: RunSummary, kind: EventKind, title: string, details?: Record<string, unknown>): void {
  S.events.push({ seq: S.events.length + 1, runId: S.runId, at: nowIso(), status: S.status, kind, title, ...(details ? { details } : {}) });
}

function phase(S: RunSummary, status: RunStatus, title: string, details?: Record<string, unknown>): void {
  S.status = status;
  emit(S, "phase", title, details);
}

function cmdDetails(c: CommandEvidence, extra?: Record<string, unknown>): Record<string, unknown> {
  return { label: c.label, cmd: c.cmd, exitCode: c.exitCode, execMs: c.execMs, sandboxId: c.sandboxId, stdoutTail: c.stdout, stderrTail: c.stderr, ...extra };
}

function llmDetails(meta: LlmCallMeta, extra?: Record<string, unknown>): Record<string, unknown> {
  return { provider: meta.provider, model: meta.model, latencyMs: meta.latencyMs, formatRetries: meta.formatRetries, ...(meta.usage ? { usage: meta.usage } : {}), ...extra };
}

function diffStat(diff: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const l of diff.split("\n")) {
    if (l.startsWith("+++") || l.startsWith("---")) continue;
    if (l.startsWith("+")) added++;
    else if (l.startsWith("-")) removed++;
  }
  return { added, removed };
}

export function unifiedDiff(baseline: string, candidate: string, label = "candidate"): string {
  return createTwoFilesPatch("a/handler.mjs", "b/handler.mjs", baseline, candidate, "baseline", label);
}

// ---------------------------------------------------------------- run creation

export function newSummary(runId: string): RunSummary {
  return {
    runId,
    scenarioId: "webhook-idempotency",
    status: "CREATED",
    startedAt: nowIso(),
    contract: "",
    baselineSource: "",
    baselineSha256: "",
    verifierSha256: "",
    model: modelLabel(),
    provider: llmEnv().provider,
    credentialSource: sandboxEnv().apiKeySource ?? undefined,
    attempts: [],
    attemptCount: 0,
    caseResults: [],
    events: [],
    sandboxes: [],
    freshVerifierVm: sandboxEnv().freshVerifierVm,
    links: { report: `/api/runs/${runId}/report`, patch: `/api/runs/${runId}/patch` },
  };
}

/**
 * Optional start input. `baselineOverride` is set ONLY by the CLI (scripts/e2e-run.ts --handler);
 * POST /api/runs never passes it, so the web demo always runs the repo fixture.
 */
export type StartRunOptions = { baselineOverride?: BaselineOverride };

/** Create + register a run and start orchestration asynchronously. Caller must have passed checkCanStart(). */
export function startRun(opts: StartRunOptions = {}): { record: RunRecord; done: Promise<void> } {
  const runId = newRunId();
  const record: RunRecord = { summary: newSummary(runId), abort: new AbortController(), startedAtMs: Date.now() };
  registerRun(record);
  emit(record.summary, "phase", "Run created", {
    scenarioId: "webhook-idempotency",
    model: record.summary.model,
    maxRunMs: runEnv().maxRunMs,
    ...(opts.baselineOverride ? { baseline: "user-supplied", baselineLabel: opts.baselineOverride.label } : {}),
  });
  const done = orchestrate(record, opts).catch((e) => {
    // orchestrate() handles its own errors; this is a last-resort guard so a bug never leaves a run hanging.
    const S = record.summary;
    if (!S.finishedAt) {
      S.error = { category: "infra", message: `internal orchestrator error: ${errMessage(e)}` };
      phase(S, "INFRA_ERROR", "Internal error");
      S.finishedAt = nowIso();
      S.durationMs = Date.now() - record.startedAtMs;
      markEnded(S.runId);
    }
  });
  return { record, done };
}

export function cancelRun(record: RunRecord): boolean {
  if (record.summary.finishedAt) return false;
  record.abort.abort(new CancelledError("Cancelled by user"));
  emit(record.summary, "phase", "Cancellation requested — cleaning up sandbox");
  return true;
}

// ---------------------------------------------------------------- sandbox steps

type VerifierRun = VerifierResult & { parseError?: string };

async function runVerifier(S: RunSummary, vm: SandboxSession, label: string, handlerSource: string, fx: Fixture, signal: AbortSignal): Promise<VerifierRun> {
  const { evidence, stdout } = await vm.node(label, VERIFIER, signal);
  const { verdict, parseError } = parseVerdict(stdout);
  const result: VerifierRun = {
    verdict,
    exitCode: evidence.exitCode,
    handlerSha256: sha256(handlerSource),
    verifierSha256: fx.verifierSha256,
    command: evidence,
    ...(parseError ? { parseError } : {}),
  };
  const passed = hostVerdictPass(verdict, evidence.exitCode);
  const failing = failingCases(verdict).map((c) => c.id);
  emit(
    S,
    "command",
    `${label}: exit ${evidence.exitCode}${verdict ? ` — ${verdict.cases.length - failing.length}/${verdict.cases.length} cases pass` : " — verdict unparseable"}`,
    cmdDetails(evidence, { verdictParsed: !!verdict, parseError, hostPass: passed, failing, handlerSha256: result.handlerSha256, verifierSha256: fx.verifierSha256 }),
  );
  for (const c of verdict?.cases ?? []) {
    emit(S, "assertion", `${c.id} ${c.pass ? "PASS" : "FAIL"} — ${c.title}`, { label, id: c.id, pass: c.pass, observed: c.observed, expected: c.expected, details: c.details });
  }
  return result;
}

function evidenceFrom(label: string, v: VerifierRun | undefined, agentTests?: CommandEvidence, syntaxCheck?: CommandEvidence): FailureEvidence {
  return {
    label,
    verifierExitCode: v ? v.exitCode : null,
    verifierParseError: v?.parseError,
    failingCases: failingCases(v?.verdict ?? null),
    verifierStdout: v?.command.stdout ?? "",
    verifierStderr: v?.command.stderr ?? "",
    agentTests,
    syntaxCheck,
  };
}

async function createVm(S: RunSummary, purpose: "work" | "fresh-verifier", signal: AbortSignal): Promise<SandboxSession> {
  const env = sandboxEnv();
  emit(S, "sandbox", purpose === "work" ? "Creating CreateOS sandbox" : "Creating a FRESH CreateOS sandbox for independent verification", {
    shape: env.shape,
    rootfs: env.rootfs,
    egress: env.egress,
    ingressEnabled: false,
    credentialSource: env.apiKeySource,
  });
  const vm = await SandboxSession.create(S.runId, purpose, signal, (reason) =>
    emit(S, "sandbox", `CreateOS rejected create: ${reason} — waiting 20s and retrying once`, { purpose, reason }),
  );
  S.sandboxes!.push({ id: vm.shortId, purpose, shape: vm.shape, region: vm.region, createMs: vm.createMs, destroyed: false });
  if (purpose === "work" || !S.sandbox) S.sandbox = { id: vm.shortId, shape: vm.shape, region: vm.region, egress: vm.egress };
  emit(S, "sandbox", `Sandbox ${vm.shortId} running (created in ${vm.createMs}ms)`, {
    sandboxId: vm.shortId,
    purpose,
    createMs: vm.createMs,
    spawnMs: vm.spawnMs,
    shape: vm.shape,
    region: vm.region,
    egress: vm.egress,
  });
  return vm;
}

async function destroyVm(S: RunSummary, vm: SandboxSession): Promise<void> {
  if (vm.destroyed) return;
  const r = await vm.destroy();
  const rec = S.sandboxes?.find((x) => x.id === vm.shortId && !x.destroyed);
  if (rec && r.ok) {
    rec.destroyed = true;
    rec.destroyMs = r.ms;
  }
  if (r.ok) emit(S, "sandbox", `Sandbox ${vm.shortId} destroyed`, { sandboxId: vm.shortId, destroyMs: r.ms });
  else emit(S, "error", `Failed to destroy sandbox ${vm.shortId} — manual cleanup may be needed`, { sandboxId: vm.shortId, error: r.error });
}

// ---------------------------------------------------------------- main algorithm

type Outcome = { status: Exclude<RunStatus, "CREATED">; title: string; error?: RunSummary["error"] };

async function orchestrate(rec: RunRecord, opts: StartRunOptions = {}): Promise<void> {
  const S = rec.summary;
  const signal = rec.abort.signal;
  const { maxRunMs, maxRepairRetries } = runEnv();
  const timer = setTimeout(
    () => rec.abort.abort(new RunvaError("infra", `Run exceeded the ${Math.round(maxRunMs / 1000)}s time budget`, "Raise RUNVA_MAX_RUN_MS or retry; the LLM or CreateOS was slow.")),
    maxRunMs,
  );
  const vms: SandboxSession[] = [];
  let outcome: Outcome | null = null;

  try {
    // ---- INSPECTING: load host-owned fixture and freeze the verifier hash BEFORE any LLM call
    phase(S, "INSPECTING", "Inspecting target and freezing the independent verifier");
    let fx: Fixture;
    try {
      fx = await loadFixture(S.scenarioId);
    } catch (e) {
      throw new RunvaError("infra", `Could not load fixture: ${errMessage(e)}`, "Ensure web/fixtures/webhook-idempotency/ is deployed with the server (outputFileTracingIncludes).");
    }
    // CLI-only: replace the baseline with the user's file (text; hashed here, executed only inside the VM).
    const user = opts.baselineOverride;
    if (user) fx = applyBaselineOverride(fx, user);
    S.contract = fx.scenario.contract;
    S.baselineSource = fx.handlerSource;
    S.baselineSha256 = fx.handlerSha256;
    S.verifierSha256 = fx.verifierSha256;
    S.baselineOrigin = { kind: user ? "user" : "fixture", label: user ? user.label : "fixtures/webhook-idempotency/handler.vulnerable.mjs", sha256: fx.handlerSha256, bytes: Buffer.byteLength(fx.handlerSource) };
    emit(S, "artifact", user ? `Baseline handler.mjs loaded from user-supplied file ${user.label}` : "Baseline handler.mjs loaded", {
      file: "handler.mjs",
      sha256: fx.handlerSha256,
      bytes: Buffer.byteLength(fx.handlerSource),
      lines: fx.handlerSource.split("\n").length,
      ...(user ? { origin: "user", label: user.label } : {}),
    });
    emit(S, "artifact", "Frozen verifier hashed (agent cannot see or edit it)", { file: "verification.mjs", sha256: fx.verifierSha256, bytes: Buffer.byteLength(fx.verifierSource), cases: ["V1", "V2", "V3", "V4", "V5", "V6"] });

    // Preflight both providers before spending anything (throws a classified RunvaError with a hint).
    getSandboxClient();
    const llm: LLMAdapter = getLlm();

    // ---- LLM: adversarial tests
    emit(S, "llm", `Asking ${llm.model} to write adversarial tests`, { provider: llm.provider, model: llm.model, inputs: ["scenario", "invariant.md", "handler.mjs"] });
    const t = await llm.generateTests(fx, signal);
    throwIfAborted(signal);
    S.generatedTests = { summary: t.out.summary, testFilename: "agent-tests.mjs", testCode: t.out.testCode, sha256: sha256(t.out.testCode), model: `${t.meta.provider}:${t.meta.model}` };
    phase(S, "TESTS_GENERATED", "Agent wrote adversarial tests", llmDetails(t.meta, { file: "agent-tests.mjs", summary: t.out.summary, sha256: S.generatedTests.sha256, bytes: Buffer.byteLength(t.out.testCode) }));

    // ---- Sandbox VM1: upload baseline + agent tests + frozen verifier
    const vm = await createVm(S, "work", signal);
    vms.push(vm);
    await vm.mkdir("/workspace/target", signal);
    await vm.upload(TARGET, fx.handlerSource, signal);
    await vm.upload(AGENT_TESTS, t.out.testCode, signal);
    await vm.upload(VERIFIER, fx.verifierSource, signal);
    emit(S, "artifact", "Uploaded baseline handler, agent tests and frozen verifier to the sandbox", {
      sandboxId: vm.shortId,
      files: [
        { path: TARGET, sha256: fx.handlerSha256 },
        { path: AGENT_TESTS, sha256: S.generatedTests.sha256 },
        { path: VERIFIER, sha256: fx.verifierSha256 },
      ],
    });

    // One cheap security proof per run: outbound traffic to a non-allowlisted host must fail.
    const eg = await vm.exec("security: egress check", "curl -sS -m 4 https://example.com", "curl", ["-sS", "-m", "4", "-o", "/dev/null", "https://example.com"], { signal, timeoutMs: 20_000 });
    S.egressCheck = { blocked: eg.exitCode !== 0, command: eg };
    emit(S, "command", eg.exitCode !== 0 ? `Egress blocked: example.com unreachable from sandbox (curl exit ${eg.exitCode})` : "WARNING: sandbox reached example.com — egress not restricted", cmdDetails(eg, { blocked: eg.exitCode !== 0, allowlist: vm.egress }));

    // ---- BASELINE_RUNNING
    phase(S, "BASELINE_RUNNING", user ? "Running the user-supplied baseline in the sandbox" : "Running the vulnerable baseline in the sandbox");
    const bSyntax = await vm.nodeCheck("baseline: syntax check", TARGET, signal);
    emit(S, "command", `Baseline syntax check: exit ${bSyntax.exitCode}`, cmdDetails(bSyntax));
    const bTests = (await vm.node("baseline: agent tests", AGENT_TESTS, signal)).evidence;
    S.baselineAgentTests = bTests;
    emit(S, "command", `Agent tests vs baseline: exit ${bTests.exitCode}${bTests.exitCode !== 0 ? " (failures exposed)" : " (no failure exposed)"}`, cmdDetails(bTests));
    const base = await runVerifier(S, vm, "baseline: frozen verifier", fx.handlerSource, fx, signal);
    S.baselineResult = stripRun(base);

    if (!base.verdict) {
      outcome = {
        status: "INCONCLUSIVE",
        title: "Inconclusive — verifier output on baseline could not be parsed",
        error: { category: "code", message: `Frozen verifier verdict unparseable on baseline (${base.parseError ?? "unknown"}); exit ${base.exitCode}`, hint: "See the verifier stdout/stderr in the event log." },
      };
      return;
    }
    if (hostVerdictPass(base.verdict, base.exitCode)) {
      outcome = { status: "INCONCLUSIVE", title: "Inconclusive — the baseline already passes every verifier case; no failure reproduced" };
      return;
    }
    const bFailing = failingCases(base.verdict).map((c) => c.id);
    phase(S, "FAILURE_REPRODUCED", `Failure reproduced: ${bFailing.join(", ") || "verifier exit " + base.exitCode} fail on baseline`, { failing: bFailing, exitCode: base.exitCode, agentTestsExposed: bTests.exitCode !== 0 });

    // ---- PATCH loop: 1 initial candidate + up to 2 repairs
    const maxAttempts = 1 + maxRepairRetries;
    let evidence = evidenceFrom("baseline run", base, bTests);
    let passing: PatchAttempt | null = null;
    let prev: PatchAttempt | null = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      throwIfAborted(signal);
      let gen;
      if (attempt === 1) {
        phase(S, "PATCH_GENERATING", "Asking the model for a minimal patch, conditioned on the real failures", { attempt });
        emit(S, "llm", `Asking ${llm.model} for patch candidate 1`, { provider: llm.provider, model: llm.model, attempt, evidence: { failing: evidence.failingCases.map((c) => c.id), verifierExitCode: evidence.verifierExitCode } });
        gen = await llm.generatePatch(fx, evidence, signal);
      } else {
        phase(S, "REPAIRING", `Repair ${attempt - 1}: feeding real sandbox failures back to the model`, { attempt });
        emit(S, "llm", `Asking ${llm.model} to repair candidate ${attempt - 1}`, {
          provider: llm.provider,
          model: llm.model,
          attempt,
          evidence: { failing: evidence.failingCases.map((c) => c.id), verifierExitCode: evidence.verifierExitCode, syntaxExit: evidence.syntaxCheck?.exitCode },
        });
        gen = await llm.repairPatch(fx, { sourceCode: prev!.sourceCode, diagnosis: prev!.diagnosis, changeSummary: prev!.changeSummary, attempt: attempt - 1 }, evidence, signal);
      }
      throwIfAborted(signal);
      const src = gen.out.sourceCode;
      const diff = unifiedDiff(fx.handlerSource, src, `candidate ${attempt}`);
      const pa: PatchAttempt = {
        attempt,
        diagnosis: gen.out.diagnosis,
        changeSummary: gen.out.changeSummary,
        sourceCode: src,
        sourceSha256: sha256(src),
        diff,
        model: `${gen.meta.provider}:${gen.meta.model}`,
      };
      S.attempts.push(pa);
      S.attemptCount = attempt;
      const st = diffStat(diff);
      emit(S, "artifact", `Candidate ${attempt}: handler.mjs (+${st.added} −${st.removed} lines)`, llmDetails(gen.meta, { attempt, file: "handler.mjs", sha256: pa.sourceSha256, diagnosis: pa.diagnosis, changeSummary: pa.changeSummary, ...st }));

      // ---- PATCH_TESTING: overwrite ONLY the target handler; re-upload the frozen verifier each time
      phase(S, "PATCH_TESTING", `Testing candidate ${attempt} in sandbox ${vm.shortId}`, { attempt });
      await vm.upload(TARGET, src, signal);
      await vm.upload(VERIFIER, fx.verifierSource, signal);
      const syn = await vm.nodeCheck(`attempt ${attempt}: syntax check`, TARGET, signal);
      pa.syntaxCheck = syn;
      emit(S, "command", `Candidate ${attempt} syntax check: exit ${syn.exitCode}`, cmdDetails(syn, { attempt }));
      if (syn.exitCode !== 0) {
        evidence = evidenceFrom(`candidate ${attempt} (syntax error)`, undefined, undefined, syn);
        prev = pa;
        continue;
      }
      const at = (await vm.node(`attempt ${attempt}: agent tests`, AGENT_TESTS, signal)).evidence;
      pa.agentTests = at;
      emit(S, "command", `Agent tests vs candidate ${attempt}: exit ${at.exitCode}`, cmdDetails(at, { attempt }));
      const v = await runVerifier(S, vm, `attempt ${attempt}: frozen verifier`, src, fx, signal);
      pa.verifier = stripRun(v);
      if (hostVerdictPass(v.verdict, v.exitCode)) {
        emit(S, "assertion", `Candidate ${attempt} passes all frozen verifier cases in the work VM`, { attempt, exitCode: v.exitCode, agentTestsExit: at.exitCode });
        if (at.exitCode !== 0) emit(S, "assertion", "Note: agent-written tests still fail; only the frozen verifier decides the verdict", { attempt, agentTestsExit: at.exitCode });
        passing = pa;
        break;
      }
      emit(S, "assertion", `Candidate ${attempt} rejected by the frozen verifier`, { attempt, failing: failingCases(v.verdict).map((c) => c.id), exitCode: v.exitCode, parseError: v.parseError });
      evidence = evidenceFrom(`candidate ${attempt}`, v, at);
      prev = pa;
    }

    if (!passing) {
      const last = S.attempts[S.attempts.length - 1];
      if (last?.verifier) {
        S.finalResult = last.verifier;
        S.caseResults = last.verifier.verdict?.cases ?? [];
      }
      outcome = {
        status: "FAILED",
        title: `Failed — no candidate passed the frozen verifier after ${S.attemptCount} attempt(s)`,
        error: { category: "code", message: `No candidate passed the frozen verifier after ${S.attemptCount} attempt(s).`, hint: "The model's patches are shown with their real failures; nothing was marked verified." },
      };
      return;
    }

    // ---- INDEPENDENT_VERIFYING
    const fresh = sandboxEnv().freshVerifierVm;
    phase(S, "INDEPENDENT_VERIFYING", fresh ? "Independent verification: fresh VM with only the final handler + frozen verifier" : "Independent verification: re-running the frozen verifier", { attempt: passing.attempt, freshVm: fresh });
    let fvm = vm;
    if (fresh) {
      await destroyVm(S, vm);
      fvm = await createVm(S, "fresh-verifier", signal);
      vms.push(fvm);
      await fvm.mkdir("/workspace/target", signal);
      await fvm.upload(TARGET, passing.sourceCode, signal);
    } else {
      await fvm.upload(TARGET, passing.sourceCode, signal);
    }
    await fvm.upload(VERIFIER, fx.verifierSource, signal);
    emit(S, "artifact", "Uploaded final handler + frozen verifier", { sandboxId: fvm.shortId, files: [{ path: TARGET, sha256: passing.sourceSha256 }, { path: VERIFIER, sha256: fx.verifierSha256 }] });

    // Measure the verifier hash INSIDE the VM before it runs (proves which bytes were executed).
    const hs = await fvm.exec("final: verifier integrity", `sha256sum ${VERIFIER}`, "sha256sum", [VERIFIER], { signal, timeoutMs: 20_000 });
    const observed = hs.exitCode === 0 ? (hs.stdout.trim().split(/\s+/)[0] ?? null) : null;
    S.verifierIntegrity = { expectedSha256: fx.verifierSha256, observedSha256: observed, match: observed === fx.verifierSha256 };
    emit(S, "assertion", observed === fx.verifierSha256 ? "Verifier integrity: in-VM sha256 matches the frozen hash" : `Verifier integrity check ${observed ? "MISMATCH" : "unavailable"}`, { expected: fx.verifierSha256, observed, sandboxId: fvm.shortId });

    const fin = await runVerifier(S, fvm, "final: independent verifier", passing.sourceCode, fx, signal);
    S.finalResult = stripRun(fin);
    S.caseResults = fin.verdict?.cases ?? [];
    const integrityOk = observed === null || observed === fx.verifierSha256;
    if (hostVerdictPass(fin.verdict, fin.exitCode) && integrityOk) {
      outcome = { status: "VERIFIED", title: `VERIFIED — candidate ${passing.attempt} passes V1–V6 in ${fresh ? "a fresh" : "the"} CreateOS sandbox (exit 0)` };
    } else {
      outcome = {
        status: "FAILED",
        title: "Failed — candidate did not pass independent verification",
        error: {
          category: "code",
          message: !integrityOk ? "Verifier integrity mismatch in the final VM" : `Independent verifier did not pass (exit ${fin.exitCode}${fin.parseError ? `, ${fin.parseError}` : ""})`,
        },
      };
    }
  } catch (e) {
    const err = toRunvaError(e, signal);
    if (err.category === "cancelled") outcome = { status: "CANCELLED", title: "Cancelled", error: { category: "cancelled", message: err.message } };
    else {
      emit(S, "error", err.message, { category: err.category, hint: err.hint, ...(err.details ?? {}) });
      outcome = {
        status: "INFRA_ERROR",
        title: err.category === "llm" ? "Stopped — LLM provider error (no code was fabricated)" : err.category === "code" ? "Stopped — error" : "Stopped — infrastructure error",
        error: { category: err.category, message: err.message, ...(err.hint ? { hint: err.hint } : {}) },
      };
    }
  } finally {
    clearTimeout(timer);
    for (const v of vms) await destroyVm(S, v);
    const o: Outcome = outcome ?? { status: "INFRA_ERROR", title: "Stopped — unknown error", error: { category: "infra", message: "run ended without an outcome" } };
    if (o.error) S.error = o.error;
    S.finishedAt = nowIso();
    S.durationMs = Date.now() - rec.startedAtMs;
    phase(S, o.status, o.title, { durationMs: S.durationMs, attempts: S.attemptCount, ...(o.error ? { error: o.error } : {}) });
    markEnded(S.runId);
  }
}

function stripRun(v: VerifierRun): VerifierResult {
  return { verdict: v.verdict, exitCode: v.exitCode, handlerSha256: v.handlerSha256, verifierSha256: v.verifierSha256, command: v.command };
}

function toRunvaError(e: unknown, signal: AbortSignal): RunvaError {
  if (signal.aborted) {
    const r = signal.reason;
    if (r instanceof RunvaError) return r; // e.g. run timeout (infra)
    return new RunvaError("cancelled", r instanceof Error ? r.message : "Run cancelled");
  }
  if (e instanceof CancelledError) return new RunvaError("cancelled", e.message);
  if (e instanceof RunvaError) return e;
  return classifySandboxError(e, "run", signal);
}
