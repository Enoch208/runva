import { z } from "zod";
import { llmEnv, runEnv, type LlmEnv } from "./env";
import { RunvaError } from "./sandbox";
import { errMessage, tail } from "./util";
import type { Fixture } from "./fixture";
import type { CommandEvidence, VerdictCase } from "./types";

const MAX_CODE_BYTES = 40 * 1024;

export const TestsSchema = z.object({
  summary: z.string().min(1).max(2000),
  testFilename: z.literal("agent-tests.mjs"),
  testCode: z.string().min(1),
});
export const PatchSchema = z.object({
  diagnosis: z.string().min(1).max(4000),
  changeSummary: z.string().min(1).max(4000),
  targetFilename: z.literal("handler.mjs"),
  sourceCode: z.string().min(1),
});
export type TestsOutput = z.infer<typeof TestsSchema>;
export type PatchOutput = z.infer<typeof PatchSchema>;

export type LlmCallMeta = { provider: string; model: string; latencyMs: number; formatRetries: number; usage?: Record<string, number> };

/** Real failure evidence from a sandbox run, fed into patch/repair prompts. */
export type FailureEvidence = {
  label: string;
  verifierExitCode: number | null;
  verifierParseError?: string;
  failingCases: VerdictCase[];
  verifierStdout: string;
  verifierStderr: string;
  agentTests?: CommandEvidence;
  syntaxCheck?: CommandEvidence;
};

export interface LLMAdapter {
  readonly provider: string;
  readonly model: string;
  generateTests(fx: Fixture, signal?: AbortSignal): Promise<{ out: TestsOutput; meta: LlmCallMeta }>;
  generatePatch(fx: Fixture, evidence: FailureEvidence, signal?: AbortSignal): Promise<{ out: PatchOutput; meta: LlmCallMeta }>;
  repairPatch(
    fx: Fixture,
    previous: { sourceCode: string; diagnosis: string; changeSummary: string; attempt: number },
    evidence: FailureEvidence,
    signal?: AbortSignal,
  ): Promise<{ out: PatchOutput; meta: LlmCallMeta }>;
}

// ---------------------------------------------------------------- prompts

const SYSTEM = [
  "You are RUNVA's autonomous code agent. You reason about a small Node.js webhook handler and its business invariant.",
  "You ALWAYS respond with exactly one JSON object and nothing else: no prose before or after, no markdown code fences.",
  "Code goes inside JSON string values (escape newlines and quotes correctly).",
].join(" ");

function fixtureContext(fx: Fixture): string {
  return [
    `## Scenario: ${fx.scenario.title}`,
    `Safety contract: ${fx.scenario.contract}`,
    "",
    "## Invariant / interface (plain English, authoritative)",
    fx.invariant.trim(),
    "",
    "## Original target module: handler.mjs (lives at /workspace/target/handler.mjs in the sandbox)",
    "```js",
    fx.handlerSource.trimEnd(),
    "```",
  ].join("\n");
}

const PATCH_RULES = [
  "Rules for the patch (hard constraints):",
  "- Return the COMPLETE replacement source of handler.mjs (targetFilename must be exactly \"handler.mjs\"). You may only edit this one file.",
  "- Keep the exported function name and signature `handleWebhook(event, deps)` and the shape of its return value exactly as in the original. Keep valid-event behavior unchanged.",
  "- Idempotency must hold at the ORDER / business-effect level, not just the event id: two different event ids for the same order must cause ONE fulfillment. An event-id-only cache is insufficient.",
  "- Concurrent/overlapping deliveries for the same order must never both call deps.fulfillOrder (coordinate in-flight work, e.g. share one in-flight promise per order).",
  "- Never permanently record an order as fulfilled/processed BEFORE deps.fulfillOrder succeeds. If fulfillOrder throws, the delivery must report failure (do not swallow the error into a success) and a later retry must be able to fulfill exactly once.",
  "- Unknown event types must not fulfill anything and must be safely acknowledged/ignored as in the original.",
  "- In-memory state is acceptable for this single-process fixture. Do not add dependencies or imports other than Node built-ins (\"node:*\"). No network, no filesystem, no timers left running, no process.exit, no console noise.",
  "- Do not try to detect or special-case a test harness. Keep the change small and readable.",
].join("\n");

// durable-idempotency: same handler interface, but deps.db is a node:sqlite database shared by several processes.
const DURABLE_PATCH_RULES = [
  "Rules for the patch (hard constraints):",
  "- Return the COMPLETE replacement source of handler.mjs (targetFilename must be exactly \"handler.mjs\"). You may only edit this one file.",
  "- Keep the exported function name and signature `handleWebhook(event, deps)` and the shape of its return value exactly as in the original. Keep valid-event behavior unchanged.",
  "- deps = { db, fulfillOrder }. deps.db is a `node:sqlite` DatabaseSync connected to ONE database FILE that is shared by several OS processes running this same module (WAL mode and busy_timeout are already set by the harness). Processes are also restarted between deliveries.",
  "- Module-level memory (Map, Set, in-flight promises, flags) is NOT shared between processes and does NOT survive a restart, so it cannot provide idempotency. The database is the only shared, durable state: idempotency MUST be enforced in deps.db.",
  "- Idempotency must hold at the ORDER / business-effect level, not just the event id: two different event ids for the same order must cause ONE fulfillment, across processes and restarts.",
  "- Create what you need with `CREATE TABLE IF NOT EXISTS` (safe to run from every process on every call), keyed by the order id as PRIMARY KEY (or UNIQUE). You may reuse the table the original module creates or add your own; never drop or rewrite tables this module did not create. Keep a row for every completed order (completed state must persist in deps.db).",
  "- Claim the order ATOMICALLY before calling deps.fulfillOrder, e.g. `INSERT INTO <table>(order_id, ...) VALUES (?, ...) ON CONFLICT DO NOTHING` and proceed only if `.run(...).changes === 1`, or a short `BEGIN IMMEDIATE` … `COMMIT` transaction that checks and inserts. Only the delivery that won the claim may call deps.fulfillOrder. A SELECT-then-INSERT outside a transaction races across processes.",
  "- Never hold a transaction open across an `await` (fulfillOrder is async; other processes would block or fail with SQLITE_BUSY). Claim in one short statement/transaction, await fulfillOrder outside any transaction, then record completion in another short statement. If you use BEGIN, always COMMIT or ROLLBACK in a finally.",
  "- Never record the order as completed BEFORE deps.fulfillOrder succeeds. If fulfillOrder throws, release the claim (delete it, or mark it retryable) and report failure (do not swallow the error into a success), so a later retry, possibly in a different process, fulfills exactly once.",
  "- A delivery that loses the claim (another delivery holds it or already completed it) must not call deps.fulfillOrder; acknowledge it as the invariant describes.",
  "- DatabaseSync is synchronous: db.exec(sql); db.prepare(sql).run(...params) returns { changes, lastInsertRowid }; .get(...params) returns a row or undefined; .all(...params). Always use bound `?` parameters, never string-concatenate ids into SQL.",
  "- Unknown event types must not fulfill anything and must not write a claim; acknowledge/ignore them as in the original.",
  "- Await everything: no fire-and-forget promises, no unhandled rejections (they crash a Node process), no swallowed errors turned into success.",
  "- Use only deps.db for state: do not open your own database connection, files or paths. Do not add dependencies or imports other than Node built-ins (\"node:*\"). No network, no timers left running, no process.exit, no console noise.",
  "- Where the invariant above is more specific than these rules (e.g. return values, stale or crashed claims), follow the invariant.",
  "- Do not try to detect or special-case a test harness. Keep the change small and readable.",
].join("\n");

const patchRules = (fx: Fixture): string => (fx.scenarioId === "durable-idempotency" ? DURABLE_PATCH_RULES : PATCH_RULES);

function patchSchemaHint(): string {
  return 'Respond with JSON exactly of the form: {"diagnosis": "brief mechanism of the failure", "changeSummary": "what you changed and why", "targetFilename": "handler.mjs", "sourceCode": "<complete replacement module source>"}';
}

function evidenceBlock(ev: FailureEvidence): string {
  const parts: string[] = [`## Real sandbox evidence (${ev.label})`];
  if (ev.syntaxCheck && ev.syntaxCheck.exitCode !== 0) {
    parts.push(`node --check exit code: ${ev.syntaxCheck.exitCode}`, "stderr:", "```", tail(ev.syntaxCheck.stderr, 2000), "```");
  }
  if (ev.verifierExitCode !== null) {
    parts.push(`Frozen independent verifier exit code: ${ev.verifierExitCode}${ev.verifierParseError ? ` (verdict unparseable: ${ev.verifierParseError})` : ""}`);
    if (ev.failingCases.length) {
      parts.push("Failing verifier cases:");
      for (const c of ev.failingCases) {
        parts.push(`- ${c.id} ${c.title}: observed=${JSON.stringify(c.observed)} expected=${JSON.stringify(c.expected)}${c.details ? ` details=${c.details}` : ""}`);
      }
    }
    parts.push("Verifier stdout (tail):", "```", tail(ev.verifierStdout, 2500), "```");
    if (ev.verifierStderr.trim()) parts.push("Verifier stderr (tail):", "```", tail(ev.verifierStderr, 1500), "```");
  }
  if (ev.agentTests) {
    parts.push(`Your adversarial tests (agent-tests.mjs) exit code: ${ev.agentTests.exitCode}`, "stdout (tail):", "```", tail(ev.agentTests.stdout, 2000), "```");
    if (ev.agentTests.stderr.trim()) parts.push("stderr (tail):", "```", tail(ev.agentTests.stderr, 1000), "```");
  }
  return parts.join("\n");
}

const TEST_REQUIREMENTS = [
  "- Import the target with a relative import: `import { handleWebhook } from \"./target/handler.mjs\";` (it resolves to /workspace/target/handler.mjs). If you need isolated module state per test, use dynamic imports with a unique query string, e.g. `await import(`./target/handler.mjs?t=${n}`)`.",
  "- Use only Node built-ins (node:assert, node:timers/promises, ...). No npm packages, no network, no file writes.",
  "- Provide your own fake deps exactly as the interface above describes; make fulfillOrder async with a small delay so overlapping deliveries really overlap (fire them with Promise.all), and record every call.",
  "- Use unique event ids / order ids per test so tests do not interfere.",
  "- Probe: the same event delivered many times including concurrently; two different event ids for the same order; an unknown event type; two different orders; fulfillOrder failing once then the event being retried.",
  "- Catch errors per test so one failure does not hide the others. Print one line per test: `PASS <name>` or `FAIL <name>: <observed vs expected>`, then a summary line.",
  "- Set process.exitCode = 1 if any test fails, else 0. Finish well within 20 seconds; leave no timers or handles open.",
  "- Keep it focused and compact: about 5–7 tests, under ~150 lines total, no comments beyond a one-line header.",
  "- These tests run against the CURRENT (possibly vulnerable) handler first; failing tests there are expected and useful. Do not assume any particular fix.",
];

const DURABLE_TEST_REQUIREMENTS = [
  "- Import the target with a relative import: `import { handleWebhook } from \"./target/handler.mjs\";` (it resolves to /workspace/target/handler.mjs).",
  "- Build your OWN database for every test: `import { DatabaseSync } from \"node:sqlite\";` create a fresh directory with `mkdtempSync(join(tmpdir(), \"agent-\"))` (node:fs, node:os, node:path), open `new DatabaseSync(file)` and run `db.exec(\"PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;\")`. Pass deps = { db, fulfillOrder }. Write files ONLY inside those temp directories; close every DatabaseSync when done.",
  "- Module memory is per process, so the important probes must use SEPARATE OS processes sharing one db file. Re-run this same file as a child: `spawn(process.execPath, [\"--no-warnings\", fileURLToPath(import.meta.url), \"child\", JSON.stringify(args)])` (node:child_process, node:url); when `process.argv[2] === \"child\"`, open its own DatabaseSync on the given file (same PRAGMAs), import the handler, perform its deliveries, close the db and print ONE JSON line as its last stdout line. Only run the test suite when not in child mode. Await each child's exit; kill any child that runs longer than 15s.",
  "- In each child, fulfillOrder is a fake that `await`s a small delay (~50–150 ms) so deliveries overlap, optionally throws on its first call (for the failure test), and counts its SUCCESSFUL calls. The child reports { fulfilled: <count>, results: [<settled result or error per delivery>] } in its JSON line; the parent sums `fulfilled` across children. To make concurrent children really overlap, pass a common start timestamp (now + ~800 ms) and have each child wait until then, then fire several deliveries with Promise.all.",
  "- Use only Node built-ins, always with the `node:` prefix (node:sqlite, node:child_process, node:fs, node:os, node:path, node:url, node:assert, node:timers/promises). No npm packages, no network.",
  "- Use unique event ids / order ids per test so tests do not interfere.",
  "- Probe: the same event delivered by several (3–5) concurrent processes sharing one db file → exactly one fulfillment; two different event ids for the same order in different processes → one fulfillment; a restart (a NEW process receives a duplicate after another process already fulfilled the order) → no second fulfillment; fulfillOrder failing in one process, then the event retried in a new process → that delivery reports failure and the retry fulfills exactly once; an unknown event type → ignored, nothing fulfilled.",
  "- Catch errors per test so one failure does not hide the others. Print one line per test: `PASS <name>` or `FAIL <name>: <observed vs expected>`, then a summary line.",
  "- Set process.exitCode = 1 if any test fails, else 0. The sandbox has 1 vCPU and each node child takes a few hundred ms to start: keep the total under ~40 seconds; leave no timers, handles or child processes behind.",
  "- Keep it focused and compact: about 5–7 tests, under ~200 lines total, no comments beyond a one-line header.",
  "- These tests run against the CURRENT (possibly vulnerable) handler first; failing tests there are expected and useful. Do not assume any particular fix.",
];

const testRequirements = (fx: Fixture): string[] => (fx.scenarioId === "durable-idempotency" ? DURABLE_TEST_REQUIREMENTS : TEST_REQUIREMENTS);

function testsPrompt(fx: Fixture): string {
  return [
    fixtureContext(fx),
    "",
    "## Task: write adversarial tests",
    "Write ONE complete, runnable Node.js (v24) ES module that will be saved as /workspace/agent-tests.mjs and run with `cd /workspace && node agent-tests.mjs`.",
    "Requirements:",
    ...testRequirements(fx),
    "",
    'Respond with JSON exactly of the form: {"summary": "what failure these tests try to expose", "testFilename": "agent-tests.mjs", "testCode": "<complete module source>"}',
  ].join("\n");
}

function patchPrompt(fx: Fixture, ev: FailureEvidence): string {
  return [
    fixtureContext(fx),
    "",
    evidenceBlock(ev),
    "",
    "## Task: produce a minimal patch for handler.mjs",
    "The evidence above comes from REAL executions in an isolated CreateOS sandbox. An independent frozen verifier (which you cannot see or edit) will judge your patch against the invariant.",
    patchRules(fx),
    "",
    patchSchemaHint(),
  ].join("\n");
}

function repairPrompt(
  fx: Fixture,
  prev: { sourceCode: string; diagnosis: string; changeSummary: string; attempt: number },
  ev: FailureEvidence,
): string {
  return [
    fixtureContext(fx),
    "",
    `## Your previous candidate (attempt ${prev.attempt}) — it did NOT pass`,
    `Your diagnosis was: ${prev.diagnosis}`,
    `Your change summary was: ${prev.changeSummary}`,
    "```js",
    prev.sourceCode.trimEnd(),
    "```",
    "",
    evidenceBlock(ev),
    "",
    "## Task: repair the candidate",
    "Analyze why the previous candidate failed using the real evidence above, then return a corrected COMPLETE handler.mjs. It must differ from the previous candidate.",
    patchRules(fx),
    "",
    patchSchemaHint(),
  ].join("\n");
}

// ---------------------------------------------------------------- JSON extraction / validation

export function extractJson(text: string): unknown {
  const t = text.trim();
  try {
    return JSON.parse(t);
  } catch {
    /* fallthrough */
  }
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) {
    try {
      return JSON.parse(fence[1].trim());
    } catch {
      /* fallthrough */
    }
  }
  const first = t.indexOf("{");
  const last = t.lastIndexOf("}");
  if (first >= 0 && last > first) return JSON.parse(t.slice(first, last + 1));
  throw new Error("no JSON object found in model output");
}

const norm = (s: string) => s.replace(/\r\n/g, "\n").trim();
const byteLen = (s: string) => Buffer.byteLength(s, "utf8");

function disallowedImports(code: string): string[] {
  const specs = [...code.matchAll(/(?:import\s[^'"]*?from\s*|import\s*\(\s*|import\s+|require\s*\(\s*)["'`]([^"'`]+)["'`]/g)].map((m) => m[1]);
  // node:sqlite (and every other "node:*" built-in) is accepted by the prefix rule; sqlite has no bare alias.
  const bareBuiltins = ["assert", "events", "timers", "timers/promises", "util", "crypto", "async_hooks", "perf_hooks", "child_process", "fs", "fs/promises", "os", "path", "url"];
  return specs.filter((s) => !s.startsWith("node:") && !s.startsWith("./") && !s.startsWith("../") && !bareBuiltins.includes(s));
}

export function validateTests(raw: unknown): TestsOutput {
  const out = TestsSchema.parse(raw);
  if (byteLen(out.testCode) > MAX_CODE_BYTES) throw new Error(`testCode exceeds ${MAX_CODE_BYTES} bytes`);
  if (!/handler\.mjs/.test(out.testCode)) throw new Error("testCode must import ./target/handler.mjs");
  const bad = disallowedImports(out.testCode);
  if (bad.length) throw new Error(`testCode imports non-built-in modules: ${bad.join(", ")}`);
  return out;
}

export function validatePatch(raw: unknown, baseline: string, previous?: string): PatchOutput {
  const out = PatchSchema.parse(raw);
  if (byteLen(out.sourceCode) > MAX_CODE_BYTES) throw new Error(`sourceCode exceeds ${MAX_CODE_BYTES} bytes`);
  if (!/export[\s\S]*handleWebhook|handleWebhook[\s\S]*export/.test(out.sourceCode)) throw new Error("sourceCode must export handleWebhook");
  if (norm(out.sourceCode) === norm(baseline)) throw new Error("sourceCode is identical to the baseline handler; a patch is required");
  if (previous !== undefined && norm(out.sourceCode) === norm(previous)) throw new Error("sourceCode is identical to the previous failed candidate");
  const bad = disallowedImports(out.sourceCode);
  if (bad.length) throw new Error(`sourceCode imports non-built-in modules: ${bad.join(", ")}`);
  return out;
}

// ---------------------------------------------------------------- transport

type ChatTurn = { role: "user" | "assistant"; content: string };

function llmHttpError(provider: string, status: number, body: string): RunvaError {
  const snippet = tail(body.replace(/\s+/g, " "), 300);
  const hints: Record<number, string> = {
    400: "The provider rejected the request; check the model id (OPENROUTER_MODEL / ANTHROPIC_MODEL).",
    401: `The ${provider} API key was rejected. Check ${provider === "openrouter" ? "OPENROUTER_API_KEY" : "ANTHROPIC_API_KEY"}.`,
    402: `The ${provider} account has insufficient credits.`,
    403: `The ${provider} key is not allowed to use this model.`,
    404: "Model not found; check the configured model id.",
    429: `${provider} rate-limited the request; wait and retry.`,
  };
  return new RunvaError("llm", `LLM provider ${provider} returned HTTP ${status}: ${snippet}`, hints[status] ?? `${provider} is unavailable; retry shortly.`, { status });
}

async function callProvider(env: Exclude<LlmEnv, { provider: "none" }>, turns: ChatTurn[], signal?: AbortSignal, jsonMode = true): Promise<{ text: string; usage?: Record<string, number> }> {
  const timeout = AbortSignal.timeout(runEnv().llmTimeoutMs);
  const sig = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let res: Response;
  try {
    if (env.provider === "openrouter") {
      res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        signal: sig,
        headers: {
          Authorization: `Bearer ${env.apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://runva.local",
          "X-Title": "RUNVA",
        },
        body: JSON.stringify({
          model: env.model,
          messages: [{ role: "system", content: SYSTEM }, ...turns],
          ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
          temperature: 0.2,
          max_tokens: 12000,
        }),
      });
    } else {
      res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        signal: sig,
        headers: { "x-api-key": env.apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({ model: env.model, system: SYSTEM, messages: turns, max_tokens: 12000, temperature: 0.2 }),
      });
    }
  } catch (e) {
    if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new RunvaError("cancelled", "Run cancelled during LLM call");
    if (timeout.aborted) throw new RunvaError("llm", `LLM call to ${env.provider} timed out after ${runEnv().llmTimeoutMs}ms`, "The model provider is slow or down. Retry, or raise RUNVA_LLM_TIMEOUT_MS.");
    throw new RunvaError("llm", `Could not reach LLM provider ${env.provider}: ${errMessage(e)}`, "Network error reaching the model provider.");
  }
  const body = await res.text();
  // Some upstream routes reject response_format; fall back once to prompt-only JSON (still zod-validated).
  if (!res.ok && jsonMode && env.provider === "openrouter" && (res.status === 400 || res.status === 404) && /response_format|json/i.test(body)) {
    return callProvider(env, turns, signal, false);
  }
  if (!res.ok) throw llmHttpError(env.provider, res.status, body);
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(body);
  } catch {
    throw new RunvaError("llm", `LLM provider ${env.provider} returned a non-JSON HTTP body`, "Provider outage or proxy error; retry shortly.");
  }
  if (env.provider === "openrouter") {
    const err = json.error as { message?: string; code?: number } | undefined;
    if (err) throw new RunvaError("llm", `OpenRouter error: ${tail(String(err.message ?? "unknown"), 300)}`, "The upstream model returned an error; retry or change OPENROUTER_MODEL.");
    const choices = json.choices as { message?: { content?: string | null; refusal?: string | null }; finish_reason?: string }[] | undefined;
    const msg = choices?.[0]?.message;
    if (msg?.refusal) throw new RunvaError("llm", `Model refused: ${tail(msg.refusal, 300)}`);
    const text = msg?.content ?? "";
    const u = json.usage as Record<string, number> | undefined;
    return { text, usage: u ? { prompt_tokens: u.prompt_tokens, completion_tokens: u.completion_tokens } : undefined };
  }
  const content = json.content as { type: string; text?: string }[] | undefined;
  const text = (content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("");
  if (json.stop_reason === "refusal") throw new RunvaError("llm", "Model refused the request");
  const u = json.usage as Record<string, number> | undefined;
  return { text, usage: u ? { input_tokens: u.input_tokens, output_tokens: u.output_tokens } : undefined };
}

/** Call the model, parse + validate; retry ONCE on malformed formatting with the concrete validation error. */
async function callValidated<T>(env: Exclude<LlmEnv, { provider: "none" }>, prompt: string, validate: (raw: unknown) => T, signal?: AbortSignal): Promise<{ out: T; meta: LlmCallMeta }> {
  const t0 = Date.now();
  const turns: ChatTurn[] = [{ role: "user", content: prompt }];
  let lastErr = "";
  for (let i = 0; i < 2; i++) {
    const { text, usage } = await callProvider(env, turns, signal);
    try {
      const out = validate(extractJson(text));
      return { out, meta: { provider: env.provider, model: env.model, latencyMs: Date.now() - t0, formatRetries: i, usage } };
    } catch (e) {
      lastErr = e instanceof z.ZodError ? e.issues.slice(0, 4).map((x) => `${x.path.join(".") || "(root)"}: ${x.message}`).join("; ") : errMessage(e);
      turns.push({ role: "assistant", content: tail(text, 6000) || "(empty)" });
      turns.push({ role: "user", content: `Your previous response was rejected by the validator: ${lastErr}. Respond again with ONLY the JSON object in the exact required schema, fixing that problem.` });
    }
  }
  throw new RunvaError("llm", `Model output failed validation twice: ${lastErr}`, "The model did not follow the required JSON contract; no code was fabricated. Retry the run or try a stronger OPENROUTER_MODEL.");
}

export function getLlm(): LLMAdapter {
  const env = llmEnv();
  if (env.provider === "none") {
    throw new RunvaError("llm", "No LLM provider is configured", "Set OPENROUTER_API_KEY (and optionally OPENROUTER_MODEL) or ANTHROPIC_API_KEY on the server. RUNVA never substitutes canned code.");
  }
  return {
    provider: env.provider,
    model: env.model,
    generateTests: (fx, signal) => callValidated(env, testsPrompt(fx), validateTests, signal),
    generatePatch: (fx, ev, signal) => callValidated(env, patchPrompt(fx, ev), (raw) => validatePatch(raw, fx.handlerSource), signal),
    repairPatch: (fx, prev, ev, signal) => callValidated(env, repairPrompt(fx, prev, ev), (raw) => validatePatch(raw, fx.handlerSource, prev.sourceCode), signal),
  };
}
