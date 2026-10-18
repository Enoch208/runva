// Shared RUNVA contract. Backend, UI and fixture all build against this file.
// Changes must be additive (new optional fields) so parallel work stays compatible.

export type RunStatus =
  | "CREATED"
  | "INSPECTING"
  | "TESTS_GENERATED"
  | "BASELINE_RUNNING"
  | "FAILURE_REPRODUCED"
  | "PATCH_GENERATING"
  | "PATCH_TESTING"
  | "REPAIRING"
  | "INDEPENDENT_VERIFYING"
  | "VERIFIED"
  | "FAILED"
  | "INCONCLUSIVE"
  | "CANCELLED"
  | "INFRA_ERROR";

export const TERMINAL_STATUSES: readonly RunStatus[] = [
  "VERIFIED",
  "FAILED",
  "INCONCLUSIVE",
  "CANCELLED",
  "INFRA_ERROR",
];

export type EventKind = "phase" | "llm" | "sandbox" | "command" | "assertion" | "artifact" | "error";

export type RunEvent = {
  seq: number;
  runId: string;
  at: string; // ISO timestamp
  status: RunStatus;
  kind: EventKind;
  title: string;
  details?: Record<string, unknown>; // sanitized, never secrets
};

/** One real sandbox command execution, as returned by the CreateOS SDK. */
export type CommandEvidence = {
  label: string; // e.g. "baseline: agent tests", "attempt 2: verifier"
  cmd: string; // e.g. "node /workspace/verification.mjs"
  exitCode: number;
  stdout: string; // tail-truncated
  stderr: string; // tail-truncated
  execMs?: number;
  sandboxId: string; // shortened, e.g. "sb_3f9a…"
  at: string;
};

/** One frozen verifier case result (V1–V6). Parsed on the host from verifier stdout. */
export type VerdictCase = {
  id: "V1" | "V2" | "V3" | "V4" | "V5" | "V6";
  title: string;
  pass: boolean;
  observed: unknown; // e.g. { fulfillments: 20 }
  expected: unknown; // e.g. { fulfillments: 1 }
  details?: string;
};

/** Final stdout line of verifier.mjs. schema is always "runva.verdict.v1". */
export type Verdict = {
  schema: "runva.verdict.v1";
  pass: boolean;
  cases: VerdictCase[];
  durationMs: number;
};

/** Host-evaluated result of running the frozen verifier against one handler version. */
export type VerifierResult = {
  verdict: Verdict | null; // null when stdout could not be parsed
  exitCode: number;
  handlerSha256: string;
  verifierSha256: string;
  command: CommandEvidence;
};

export type PatchAttempt = {
  attempt: number; // 1 = initial candidate, 2–3 = repair retries
  diagnosis: string;
  changeSummary: string;
  sourceCode: string;
  sourceSha256: string;
  diff: string; // unified diff vs baseline handler.mjs
  agentTests?: CommandEvidence;
  verifier?: VerifierResult;
  model: string;
  /** additive (backend): `node --check` result for this candidate in the sandbox */
  syntaxCheck?: CommandEvidence;
};

export type GeneratedTests = {
  summary: string;
  testFilename: "agent-tests.mjs";
  testCode: string;
  sha256: string;
  model: string;
};

export type RunSummary = {
  runId: string;
  scenarioId: "webhook-idempotency";
  status: RunStatus;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  contract: string; // one-sentence safety contract
  baselineSource: string;
  baselineSha256: string;
  verifierSha256: string;
  model: string;
  sandbox?: { id: string; shape: string; region: string; egress: string[] };
  generatedTests?: GeneratedTests;
  baselineAgentTests?: CommandEvidence;
  baselineResult?: VerifierResult; // frozen verifier vs vulnerable baseline
  attempts: PatchAttempt[];
  attemptCount: number;
  finalResult?: VerifierResult; // frozen verifier vs final candidate
  caseResults: VerdictCase[]; // latest final verifier cases ([] until available)
  error?: { category: "code" | "infra" | "llm" | "cancelled"; message: string; hint?: string };
  events: RunEvent[];
  links: { report: string; patch: string };
  // ---- additive (backend) optional fields ----
  /** LLM provider used, e.g. "openrouter" | "anthropic" */
  provider?: string;
  /** NAME (never value) of the env var that supplied the CreateOS credential, always "CREATEOS_SANDBOX_API_KEY" */
  credentialSource?: string;
  /** Every CreateOS VM this run used, in order. */
  sandboxes?: SandboxRecord[];
  /** Egress-restriction proof: an outbound request to a non-allowlisted host from inside the VM. */
  egressCheck?: { blocked: boolean; command: CommandEvidence };
  /** Final verification ran in a fresh VM containing only the final handler + frozen verifier. */
  freshVerifierVm?: boolean;
  /** sha256 of /workspace/verification.mjs measured INSIDE the final VM vs the host-frozen hash. */
  verifierIntegrity?: { expectedSha256: string; observedSha256: string | null; match: boolean };
  /** Where the baseline handler came from: the repo fixture, or a user file passed to the CLI with --handler (never via the web API). */
  baselineOrigin?: { kind: "fixture" | "user"; label: string; sha256: string; bytes: number };
};

/** additive (backend) */
export type SandboxRecord = {
  id: string; // shortened
  purpose: "work" | "fresh-verifier";
  shape: string;
  region: string;
  createMs: number;
  destroyed: boolean;
  destroyMs?: number;
};

/** POST /api/runs body */
export type StartRunRequest = { scenarioId: "webhook-idempotency"; accessCode?: string };
/** POST /api/runs response (201) — or { error } with 409 busy / 401 bad code / 429 cooldown */
export type StartRunResponse = { runId: string; status: RunStatus };

export type HealthResponse = { ok: boolean; sandboxConfigured: boolean; llmConfigured: boolean; model: string; activeRunId: string | null };
