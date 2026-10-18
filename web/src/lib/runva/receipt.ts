import type { CommandEvidence, RunSummary, VerifierResult } from "./types";

export const SCOPE =
  "Verified for these synthetic conditions in this sandbox. Not a production guarantee.";
export const DURABILITY =
  "The fix may use in-memory state and in-flight coordination, which is valid only for this single-process fixture. Production durability requires a transactional/idempotent datastore; passing this fixture is not a guarantee across process crashes, restarts, or multiple service instances.";
export const DURABILITY_DB =
  "The fix keeps its idempotency state in a SQLite database file that the frozen verifier shares between several Node processes inside this sandbox, so it was exercised across separate processes and restarts. That is still one machine and one SQLite file: passing this fixture is not a guarantee for other datastores, network partitions, or production load.";

/** Scope note on durability for this run's scenario (webhook-idempotency keeps the original wording). */
export const durabilityFor = (S: Pick<RunSummary, "scenarioId">): string => (S.scenarioId === "durable-idempotency" ? DURABILITY_DB : DURABILITY);

const fence = (s: string, lang = "") => {
  const body = (s ?? "").replace(/```/g, "ˋˋˋ");
  return "```" + lang + "\n" + body.replace(/\n+$/, "") + "\n```";
};

function cmdBlock(c: CommandEvidence | undefined): string {
  if (!c) return "_not run_";
  const lines = [
    `- Command: \`${c.cmd}\` in sandbox \`${c.sandboxId}\``,
    `- Exit code: **${c.exitCode}**${c.execMs !== undefined ? ` · ${c.execMs} ms` : ""} · at ${c.at}`,
    "",
    "stdout (tail):",
    fence(c.stdout || "(empty)"),
  ];
  if (c.stderr?.trim()) lines.push("", "stderr (tail):", fence(c.stderr));
  return lines.join("\n");
}

function caseTable(v: VerifierResult | undefined): string {
  if (!v) return "_not run_";
  if (!v.verdict) return `Verdict could not be parsed (exit code ${v.exitCode}) — treated as NOT verified.`;
  const rows = v.verdict.cases.map(
    (c) => `| ${c.id} | ${c.pass ? "PASS" : "**FAIL**"} | ${c.title.replace(/\|/g, "\\|")} | \`${JSON.stringify(c.observed)}\` | \`${JSON.stringify(c.expected)}\` |`,
  );
  return [
    `Verdict: **${v.verdict.pass ? "PASS" : "FAIL"}** · process exit code **${v.exitCode}** · ${v.verdict.durationMs} ms · handler sha256 \`${v.handlerSha256}\``,
    "",
    "| Case | Result | Scenario | Observed | Expected |",
    "|---|---|---|---|---|",
    ...rows,
  ].join("\n");
}

export function renderReceipt(S: RunSummary): string {
  const final = S.attempts.find((a) => a.verifier && S.finalResult && a.sourceSha256 === S.finalResult.handlerSha256) ?? S.attempts[S.attempts.length - 1];
  const sb = S.sandboxes ?? [];
  const out: string[] = [];
  out.push(`# RUNVA verification receipt — ${S.status}`);
  out.push("");
  out.push(`> ${SCOPE}`);
  out.push("");
  out.push("## Run");
  out.push(`- Run ID: \`${S.runId}\``);
  out.push(`- Started: ${S.startedAt}${S.finishedAt ? ` · Finished: ${S.finishedAt}` : " · (still running)"}${S.durationMs !== undefined ? ` · Duration: ${(S.durationMs / 1000).toFixed(1)} s` : ""}`);
  out.push(`- Workflow: \`${S.scenarioId}\`${S.scenarioTitle ? ` — ${S.scenarioTitle}` : ""} (synthetic Stripe-style events only; no live Stripe API calls)`);
  out.push(`- Safety contract: ${S.contract || "(not loaded)"}`);
  if (S.baselineOrigin?.kind === "user") out.push(`- Baseline: **user-supplied file** \`${S.baselineOrigin.label}\` (${S.baselineOrigin.bytes} bytes, sha256 \`${S.baselineOrigin.sha256}\`), passed via the CLI \`--handler\` flag; uploaded only into the sandbox, never executed on the host`);
  out.push(`- Final status: **${S.status}**`);
  if (S.error) out.push(`- Error (${S.error.category}): ${S.error.message}${S.error.hint ? ` — hint: ${S.error.hint}` : ""}`);
  out.push("");
  out.push("## Execution environment (CreateOS Sandbox)");
  if (sb.length) {
    for (const s of sb) out.push(`- \`${s.id}\` — ${s.purpose === "work" ? "work VM (baseline + candidates)" : "fresh independent-verifier VM"} · shape \`${s.shape}\` · region \`${s.region}\` · created in ${s.createMs} ms · ${s.destroyed ? "destroyed" : "NOT confirmed destroyed"}`);
  } else out.push("- No sandbox was created in this run.");
  if (S.sandbox) out.push(`- Egress allowlist: ${S.sandbox.egress.map((e) => `\`${e}\``).join(", ")} · ingress disabled`);
  if (S.egressCheck) out.push(`- Egress proof: \`${S.egressCheck.command.cmd}\` exit ${S.egressCheck.command.exitCode} → ${S.egressCheck.blocked ? "blocked (as required)" : "NOT blocked"}`);
  if (S.credentialSource) out.push(`- CreateOS credential supplied via env var \`${S.credentialSource}\` (value never logged)`);
  out.push("");
  out.push("## Hashes (reproducibility identifiers, not proof of correctness)");
  out.push(`- Baseline handler.mjs: \`${S.baselineSha256 || "n/a"}\``);
  out.push(`- Final candidate handler.mjs: \`${S.finalResult?.handlerSha256 ?? final?.sourceSha256 ?? "n/a"}\``);
  out.push(`- Frozen verifier: \`${S.verifierSha256 || "n/a"}\``);
  if (S.verifierIntegrity) out.push(`- Verifier sha256 measured inside the final VM: \`${S.verifierIntegrity.observedSha256 ?? "unavailable"}\` → ${S.verifierIntegrity.match ? "matches" : "does NOT match / unavailable"}`);
  if (S.generatedTests) out.push(`- Agent tests agent-tests.mjs: \`${S.generatedTests.sha256}\``);
  out.push("");
  out.push("## Model");
  out.push(`- Model: \`${S.model}\` (key never logged)`);
  out.push(`- Patch attempts: ${S.attemptCount} (1 initial + up to 2 repairs, each conditioned on real sandbox output)`);
  if (S.generatedTests) out.push(`- Test-generation summary: ${S.generatedTests.summary}`);
  out.push("");
  out.push("## Baseline (vulnerable handler)");
  out.push("### Agent-generated tests vs baseline");
  out.push(cmdBlock(S.baselineAgentTests));
  out.push("");
  out.push("### Frozen verifier vs baseline");
  out.push(caseTable(S.baselineResult));
  out.push("");
  if (S.attempts.length) {
    out.push("## Patch attempts");
    for (const a of S.attempts) {
      out.push(`### Attempt ${a.attempt} (\`${a.model}\`)`);
      out.push(`- Diagnosis: ${a.diagnosis}`);
      out.push(`- Change: ${a.changeSummary}`);
      out.push(`- sha256: \`${a.sourceSha256}\``);
      if (a.syntaxCheck) out.push(`- Syntax check exit: ${a.syntaxCheck.exitCode}`);
      if (a.agentTests) out.push(`- Agent tests exit: ${a.agentTests.exitCode}`);
      if (a.verifier) out.push(`- Frozen verifier: exit ${a.verifier.exitCode}, ${a.verifier.verdict ? (a.verifier.verdict.pass ? "PASS" : `FAIL (${a.verifier.verdict.cases.filter((c) => !c.pass).map((c) => c.id).join(", ")})`) : "unparseable"}`);
      out.push("");
    }
  }
  out.push("## Final independent verifier result");
  out.push(S.freshVerifierVm && sb.some((s) => s.purpose === "fresh-verifier") ? "Ran in a fresh VM that contained only the final handler and the frozen verifier." : "");
  out.push(caseTable(S.finalResult));
  if (S.finalResult) {
    out.push("");
    out.push(cmdBlock(S.finalResult.command));
  }
  out.push("");
  if (final) {
    out.push("## Code diff (baseline → final candidate)");
    out.push(fence(final.diff, "diff"));
    out.push("");
  }
  if (S.generatedTests) {
    out.push("## Agent-generated test file (agent-tests.mjs)");
    out.push("Evidence only — the frozen verifier alone decides the verdict.");
    out.push(fence(S.generatedTests.testCode, "js"));
    out.push("");
  }
  out.push("## Scope and limitations");
  out.push(`- ${SCOPE}`);
  out.push(`- ${durabilityFor(S)}`);
  out.push("- Hashes identify the exact bytes that ran; they are not cryptographic proof of correct behavior. RUNVA claims only the observed assertions above — not formal verification or universal correctness.");
  out.push("- All model-generated code executed only inside CreateOS sandboxes; the RUNVA host never executed it.");
  out.push("");
  return out.join("\n");
}

export function renderPatchFile(S: RunSummary): string | null {
  const final = S.attempts.find((a) => S.finalResult && a.sourceSha256 === S.finalResult.handlerSha256) ?? S.attempts[S.attempts.length - 1];
  if (!final) return null;
  return [
    `# RUNVA patch — run ${S.runId} — status ${S.status} — attempt ${final.attempt} — sha256 ${final.sourceSha256}`,
    `# ${SCOPE}`,
    "",
    final.diff.trimEnd(),
    "",
    "# ---------------------------------------------------------------------------",
    "# Final handler.mjs (complete source)",
    "# ---------------------------------------------------------------------------",
    ...final.sourceCode.split("\n").map((l) => `# ${l}`),
    "",
  ].join("\n");
}

/** Machine-readable receipt (schema runva.receipt.v1). Sanitized: no keys, short sandbox ids only. */
export function buildReceiptJson(S: RunSummary) {
  const final = S.attempts.find((a) => S.finalResult && a.sourceSha256 === S.finalResult.handlerSha256) ?? S.attempts[S.attempts.length - 1];
  const verdictOf = (v: VerifierResult | undefined) =>
    v
      ? {
          exitCode: v.exitCode,
          verdictParsed: !!v.verdict,
          pass: v.verdict?.pass ?? false,
          durationMs: v.verdict?.durationMs ?? null,
          handlerSha256: v.handlerSha256,
          sandboxId: v.command.sandboxId,
          at: v.command.at,
          cases: (v.verdict?.cases ?? []).map((c) => ({ id: c.id, title: c.title, pass: c.pass, observed: c.observed, expected: c.expected, details: c.details ?? null })),
        }
      : null;
  return {
    schema: "runva.receipt.v1" as const,
    runId: S.runId,
    scenarioId: S.scenarioId,
    scenarioTitle: S.scenarioTitle ?? null,
    contract: S.contract,
    startedAt: S.startedAt,
    finishedAt: S.finishedAt ?? null,
    durationMs: S.durationMs ?? null,
    status: S.status,
    verified: S.status === "VERIFIED",
    error: S.error ?? null,
    model: S.model,
    provider: S.provider ?? null,
    credentialSource: S.credentialSource ?? null,
    sandbox: S.sandbox ? { shape: S.sandbox.shape, region: S.sandbox.region, egress: S.sandbox.egress, ingressEnabled: false } : null,
    sandboxes: S.sandboxes ?? [],
    freshVerifierVm: !!S.freshVerifierVm && (S.sandboxes ?? []).some((s) => s.purpose === "fresh-verifier"),
    hashes: {
      algorithm: "sha256",
      baselineHandler: S.baselineSha256 || null,
      candidateHandler: S.finalResult?.handlerSha256 ?? final?.sourceSha256 ?? null,
      verifier: S.verifierSha256 || null,
      agentTests: S.generatedTests?.sha256 ?? null,
    },
    egressCheck: S.egressCheck
      ? { blocked: S.egressCheck.blocked, cmd: S.egressCheck.command.cmd, exitCode: S.egressCheck.command.exitCode, stderr: S.egressCheck.command.stderr.slice(0, 300), sandboxId: S.egressCheck.command.sandboxId }
      : null,
    verifierIntegrity: S.verifierIntegrity ?? null,
    ...(S.baselineOrigin ? { baselineOrigin: S.baselineOrigin } : {}),
    baseline: {
      agentTestsExitCode: S.baselineAgentTests?.exitCode ?? null,
      verifier: verdictOf(S.baselineResult),
    },
    attemptCount: S.attemptCount,
    attempts: S.attempts.map((a) => ({
      attempt: a.attempt,
      model: a.model,
      sourceSha256: a.sourceSha256,
      diagnosis: a.diagnosis,
      changeSummary: a.changeSummary,
      syntaxExitCode: a.syntaxCheck?.exitCode ?? null,
      agentTestsExitCode: a.agentTests?.exitCode ?? null,
      verifierExitCode: a.verifier?.exitCode ?? null,
      failingCases: a.verifier?.verdict ? a.verifier.verdict.cases.filter((c) => !c.pass).map((c) => c.id) : null,
    })),
    final: { verifier: verdictOf(S.finalResult) },
    scope: SCOPE,
    durability: durabilityFor(S),
    hashNote: "Hashes are reproducibility identifiers for the exact bytes that ran, not cryptographic proof of correct behavior.",
    executionBoundary: "All model-generated code executed only inside CreateOS sandboxes; the RUNVA host never executed it.",
  };
}
