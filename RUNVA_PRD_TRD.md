# RUNVA — Prove It Before You Ship
## Product Requirements Document (PRD) + Technical Requirements Document (TRD)

**Document version:** 1.0 — October 17, 2026  
**Event:** Build Agents That Run Code — CreateOS × Stripe Projects  
**Product:** RUNVA  
**Category:** Autonomous software reliability / verification agent  
**Stage:** Hackathon MVP, built from scratch during the official build window  
**Source of truth:** This file governs product scope, implementation order, test criteria, demo, and submission.

> **Product promise:** RUNVA does not ask you to trust an AI-generated patch. It makes a bug happen, fixes it, and gives you independently checked evidence that the fix works.

---

# PART A — PRODUCT REQUIREMENTS (PRD)

## A1. One-page executive brief

**The problem.** Modern applications are glued together by webhook and API integrations. An integration can look fine in a happy-path test, but duplicate, out-of-order, concurrent, or retried events can cause double fulfillment, repeated side effects, and silent data corruption. Engineers often cannot prove that a proposed fix survives the exact failure that motivated it. Existing coding assistants generally return suggestions or patches; the engineer must still build adversarial reproduction, run real tests, interpret failures, and verify the repair.

**The solution.** RUNVA is an autonomous reliability engineer for integration code. Given a narrow code fixture and a plain-English safety contract, RUNVA:

1. Inspects the code and the intended invariant.
2. **Writes executable adversarial replay tests** for the suspected failure.
3. Boots a real isolated CreateOS Sandbox and **runs those tests against the original code**.
4. Captures the actual failing assertion, logs, and process exit code.
5. **Writes a minimal candidate patch** from the evidence.
6. Reruns the test and automatically repairs its own patch when it fails (maximum **two repair retries** after the first candidate).
7. Runs a separately maintained, deterministic **independent verifier** against the candidate in an isolated execution context.
8. Returns a before/after evidence receipt, source-code diff, pass/fail assertions, and a downloadable verification report.

**The initial wedge.** Stripe-style order-fulfillment webhooks, using **synthetic events only**. The system must detect and repair duplicate fulfillment, including concurrent duplicate deliveries and distinct event IDs that refer to the same underlying order or payment. **No live Stripe payments, customers, or client credentials are needed or allowed.**

**Positioning.** “From broken integration to verified repair.” Not a generic code editor or log analyzer. RUNVA's differentiated deliverable is a reproducible, machine-checked **proof of repair**.

**Why a user cares.** A backend developer can move from “I think this patch handles retries” to “here are the exact events, observed failure, repair diff, and independently verified replay results.”

**Hackathon MVP constraint.** Ship one exceptional end-to-end workflow, not a broad platform of half-finished integrations.

## A2. Target user and use cases

**Primary user:** A backend engineer at a SaaS or commerce business who owns webhook-based order fulfillment. They need to prevent repeated side effects when webhooks are delivered more than once.

**Secondary user:** A platform/SRE engineer verifying an incident fix before release.

**Jobs to be done:**
- “Show me how this handler breaks under retries or concurrency.”
- “Write executable tests that reproduce the problem, not just an explanation.”
- “Repair the handler and validate the new behavior automatically.”
- “Give me an artifact that teammates can inspect and rerun.”

**Explicit non-goals for this event:** Full GitHub PR automation, arbitrary private repo ingestion, access to production Stripe, processing real payments, full payment-signature validation, multi-language support, dozens of scenarios, self-hosting, arbitrary shell access from the browser, or guaranteed correctness for untested cases.

## A3. Brand and experience

**Name:** RUNVA  
**Tagline:** **Prove it before you ship.**  
**One-line pitch:** The AI reliability engineer that breaks your integration, repairs it, and proves the repair in a real sandbox.  
**Visual direction:** Serious developer tool: deep navy/charcoal canvas, restrained electric cyan/violet highlights, high-contrast pass/fail states, readable monospace code, crisp typography, evidence-first interface. Avoid marketing fluff, cartoon robots, and fake terminal animation.

**Signature visual:** A side-by-side evidence panel:

| BEFORE — FAILURE REPRODUCED | AFTER — REPAIR VERIFIED |
|---|---|
| 20 duplicate deliveries | 20 duplicate deliveries |
| 20 fulfillments observed | **1** fulfillment observed |
| Failing assertion + real exit code | Passing assertion + real exit code |
| Original code hash | Patched code hash |

The numbers above are **demo targets**. The UI must show them only when real executions produce those values; never hardcode a success screenshot or fake log.

## A4. User journey and screens

### Primary golden path: “Fix my webhook”
1. User lands on **Mission Control** and selects **Webhook Reliability — Duplicate Fulfillment**.
2. A clear card shows the code fixture, the safety contract, and the **Run Autonomous Verification** action.
3. RUNVA visibly progresses through **Inspect → Write tests → Execute baseline → Reproduce failure → Write patch → Execute patch → Independent verification → Receipt**.
4. The **Execution Timeline** shows real activity, timestamps, model-produced filenames/summary, sandbox ID (shortened), stdout/stderr snippets, exit codes, retry count, and phase status.
5. A **Code Diff** shows the actual agent-created modifications to `handler.mjs`.
6. **Evidence Desk** shows immutable verifier checks, replay scenario outcomes, original-versus-patched results, and SHA-256 hashes.
7. User downloads an `.md` report and the patch. They can run a fresh verification if there is time.

### Screen inventory (minimum viable)
- **Landing / Mission Control:** headline, concise product promise, preset scenario, integration diagram, primary CTA. No lengthy onboarding.
- **Active Run:** persistent phase indicator, terminal/log window, “code being written” tab, test/replay table, current sandbox state, and a visible Cancel action.
- **Result:** BEFORE/AFTER comparison, verified/not verified verdict, numbered assertions, diff, report download, and an honest “scope of proof” disclosure.

### UI requirements
- Must look good at a 1440px demo viewport and remain usable on mobile.
- Progress and status must represent backend events rather than client-side timers.
- Failed and inconclusive runs must look different from successful verification.
- Buttons cannot be decorative: Start, Cancel, View Diff, Download Report must work.
- Never call an LLM response itself a passing test. A passing result requires an observed sandbox exit code and verifier assertions.

## A5. Golden demo fixture and deterministic contract

### Synthetic fixture
A newly created Node.js `handler.mjs` that exports `handleWebhook(event, deps)` (or an equivalently small interface agreed in code). The supplied `deps.fulfillOrder(orderId)` performs a simulated fulfillment and records invocations in memory. The **baseline handler is intentionally vulnerable**: it performs fulfillment on each qualifying webhook delivery without enforcing idempotency at the business-operation level.

Synthetic event shape:

```json
{
  "id": "evt_demo_001",
  "type": "payment_intent.succeeded",
  "data": {
    "object": {
      "id": "pi_demo_001",
      "metadata": { "order_id": "order_demo_001" }
    }
  }
}
```

**Use only mocked/synthetic events.** “Stripe-style” describes the structure; it does not imply actual Stripe event ingestion or real customer data.

### Frozen independent verifier (owned by RUNVA, not editable by the patching model)

| ID | Replay scenario | Expected contract |
|---|---|---|
| V1 | Send the same event 20 times, including overlapping requests | Fulfillment for that order occurs exactly once |
| V2 | Send two different event IDs for the **same** payment/order | One business fulfillment, not two |
| V3 | Deliver an unknown event type | No fulfillment; safe acknowledgement/ignore behavior |
| V4 | Deliver two **different** valid orders | Exactly one fulfillment for **each** order |
| V5 | Simulated fulfillment fails once, then event is retried | Event is not marked completed prematurely; later retry succeeds exactly once |
| V6 | Required handler export / module interface works | No syntax error, no missing export, no unexpected crash |

**Test isolation:** Each scenario gets fresh simulated state. Use async barriers and a delayed `fulfillOrder` for the concurrent test; do not count sequential duplicates as proof of concurrency safety. Treat every verification result as deterministic and rerunnable.

**Expected initial demonstration:** The original intentionally vulnerable handler fails V1 and V2. The repaired handler passes all V1–V6. If real observations differ, show the observed outcome and investigate; do not falsify before/after values.

**Repair constraints:** Preserve the public handler signature and valid-event behavior. Modify only the designated target module (`handler.mjs`). Do not change expected outputs, disable assertions, edit frozen tests, or hide errors. An implementation may use in-memory state and in-flight coordination **for this single-process fixture**. The receipt must expressly state that production-grade durability requires a transactional/idempotent datastore; passing the fixture is **not** a guarantee across process crashes or multiple service instances.

## A6. Agent behavior: autonomous, evidence-driven, genuine

**Agent inputs:** Target source; plain-language invariant; fixture interface; permissible edit surface; chosen scenario. **Agent outputs:** executable test source, minimal patch source/diff, reasoning summary, and optional second/third candidate code.

**Policy:**
1. The agent must actually call the configured code-capable LLM for test generation and patch generation. No canned patch or deterministic string replacement pretending to be autonomous.
2. The agent must write its own test code and the initial patch. The generated tests run against the baseline; frozen host-owned tests independently validate the result.
3. Each repair retry is conditioned on **real stdout/stderr, exit code and failing assertions** from the previous sandbox run.
4. Cap at **one initial candidate + two repair retries**. Stop early when all verification gates pass.
5. If the code is already safe, demonstrate that without fabricating a failure. If failure cannot be reproduced, label the run **INCONCLUSIVE** instead of claiming success.
6. The agent can only edit `handler.mjs` and its own generated adversarial test file. It cannot edit the independent verifier, pass/fail evaluator, invariant definitions, or immutable expected results.
7. The verifier is authored and controlled outside the agent prompt/edit surface; its content hash is captured before execution. Assert results **on the host** from trusted structured output, not from the model's opinion.
8. All model-generated code runs **inside CreateOS Sandbox**, never using `eval`, `vm`, `child_process`, or a local shell on the app host.
9. No fixed scripted “successful” transcript. A genuine LLM refusal, error, or failed patch must be shown honestly.

### State machine
`CREATED → INSPECTING → TESTS_GENERATED → BASELINE_RUNNING → FAILURE_REPRODUCED → PATCH_GENERATING → PATCH_TESTING → [REPAIRING ↔ PATCH_TESTING] → INDEPENDENT_VERIFYING → VERIFIED | FAILED | INCONCLUSIVE | CANCELLED | INFRA_ERROR`

Do not call a run **VERIFIED** unless the unmodified verifier passed in a real CreateOS execution and artifacts were saved. Keep distinct categories for code failure versus infrastructure failure.

## A7. Product requirements with priority and proof

| Priority | Requirement | Definition of done |
|---|---|---|
| **P0** | Real CreateOS execution | SDK creates a VM, transfers generated files, runs them, returns exit code/stdout/stderr, and destroys the VM |
| **P0** | Meaningful Stripe Projects | Existing initialized project provisions and records the CreateOS service via Stripe Projects; stack/status/share evidence is saved (never the secret values) |
| **P0** | Real autonomous repair loop | LLM writes executable test and patch; a real failed run triggers a patch or retry; no manual edit needed |
| **P0** | Demonstrated broken baseline | At least V1 and V2 fail for the seeded baseline with captured evidence |
| **P0** | Independent verdict | Same frozen verifier passes V1–V6 for patched code and emits machine-readable assertions |
| **P0** | Clear developer-facing UI | A user can launch and inspect a full run with visible, honest progress |
| **P0** | Safety and cleanup | No secrets in client/sandbox; concurrency gate; timeout and sandbox cleanup on all paths |
| **P0** | Submission assets | Public repo/README, viewable 2–3 minute demo with human on camera, public post, official submission and leaderboard links |
| **P1** | Downloadable receipt and patch | Export a human-readable Markdown verification receipt and patch/diff with SHA-256 identifiers |
| **P1** | Live phase updates | Poll or SSE streams actual server-side events; reconnection shows accumulated events |
| **P1** | Security proof | Show CreateOS configured network egress allowlist, blocked unrelated outbound destination, and no host execution |
| **P2** | Fresh final verifier VM | Independent final verification runs in a newly created sequential sandbox, with the original already destroyed |
| **P2** | Sandbox pause/resume or fork | Only if plan capabilities, time and credits permit; do not compromise MVP |
| **P2** | Additional fixture or GitHub URL import | Only after the golden path, deployment, and demo are reliable |

**No scope creep rule:** There is no second scenario until the first one passes end to end in a deployed build.

## A8. Acceptance metrics and failure behavior

**Ship bar:**
- A first-time judge can understand the problem and start the run within 20 seconds of opening the UI.
- The **baseline produces an actual nonzero test/verifier exit code** tied to a real sandbox execution.
- The agent-generated candidate is genuinely different from the baseline and the changed lines are visible.
- The final verifier shows exact per-scenario counts (V1–V6) from executed code.
- A failure path is never incorrectly displayed as success.
- One typical demo run should aim to complete in **under 3 minutes** on reliable infra. This is an engineering target, not a guaranteed timing claim; display honest execution duration.
- A sandbox is destroyed on success, error, timeout, and user cancellation. No accumulation of idle VMs.
- The main demo can be rerun at least 3 times successfully before recording.

**Important error states:** Missing or wrong CreateOS API key; credit/quota exhausted; sandbox region mismatch; streaming endpoint unavailable; sandbox timeout; LLM returns invalid JSON or invalid code; tests cannot reproduce baseline; candidate passes generated tests but fails independent checks; verifier has a syntax bug; deployment process restart. Every error needs actionable UI copy. Never replace an infrastructure failure with fake proof.

## A9. How the product maps to judging criteria

These are **our product decisions, not official scoring weights**.

| Hackathon signal | Evidence in RUNVA |
|---|---|
| Sponsor tools | Stripe Projects-provisioned CreateOS account/service + real CreateOS VM execution, file API, network policy and artifact download |
| Agent capability | Model writes replay tests, runs them, observes a true failure, writes a candidate patch, and self-corrects based on test output |
| Real-world use | Payment webhook retries can cause duplicate irreversible business actions |
| Execution | One-click end-to-end workflow, deterministic before/after assertions, fail-safe cleanup, deployed demo |
| Creativity | **Proof receipt**, with frozen verifier, before/after behavioral comparison and reproducible scenario evidence, instead of “AI says fixed” |

**Narrative rule:** Explain sponsor tools as product necessities (isolation, actual execution, controlled networking, provisioning), not as decorative hackathon checkboxes.

---

# PART B — TECHNICAL REQUIREMENTS (TRD)

## B1. Build environment and implementation decisions

**Use the existing repository** at `~/Projects/createos-hackathon`. Stripe Projects was already initialized, `createos/project` free plan was already provisioned, and `.env` was pulled. **Do not run `stripe projects init` or re-provision this service.** The repository may already have a Next.js app under `web/`; if so, keep it. Do not replace existing project infrastructure merely to match a diagram in this document.

**Preferred hackathon implementation:** One **Next.js 15+/16+ App Router + TypeScript** app under `web/`, using server-side Node runtime route handlers for the orchestration and a React/Tailwind/shadcn UI, deployed to a persistent **Railway** Node service. A separate **Fastify** backend is an acceptable alternative only if it already exists or is meaningfully easier; do **not** build two frameworks/services from scratch just for architecture purity. The previously envisioned React/Vite + Fastify architecture remains an acceptable fallback, but time-to-working-demo wins.

**Core packages:**
- `@nodeops-createos/sandbox` — official TypeScript sandbox SDK.
- OpenRouter chat completions API — configurable code-capable model for generating tests and patches (LLM can be swapped without changing orchestrator).
- `zod` — validate LLM outputs and HTTP payloads.
- `diff` (optional) — produce human-readable source diff.
- `vitest` (optional for host tests) — backend/unit tests.
- Node built-ins `node:test`, `node:assert/strict`, `node:crypto` for executable synthetic fixture and verifier to avoid dependency installs inside sandbox.
- No production database required for P0. Keep per-run event log and artifacts in a bounded in-memory store on one persistent Node instance; optionally save JSON files for a local demo. Document that deployment restarts erase memory. Add persistence only after P0 is stable.

**Runtime requirements:** Node.js 20+; sandbox rootfs `devbox:1`, shape `s-1vcpu-1gb` (subject to `listShapes()` and available credits); EU endpoint required by the event organizer. Default to **one active sandbox at a time**, respecting free-tier concurrency. Never assume free parallel forks.

## B2. System diagram

```text
Browser / RUNVA dashboard
       |
       | POST /api/runs   GET /api/runs/:id   GET /api/runs/:id/events
       v
Node server (trusted host)
  ├─ Run coordinator and in-memory run/event store
  ├─ Fixture + frozen independent verifier (host-owned)
  ├─ LLM adapter (OpenRouter; secret stays on host)
  ├─ Artifact and SHA-256 evidence builder
  └─ CreateOS Sandbox SDK (server only)
          |
          | create sandbox → upload files → execute → capture stdout/stderr/exit
          v
CreateOS Firecracker sandbox (EU, ephemeral)
  /workspace/target/handler.mjs      (model-editable)
  /workspace/agent-tests.mjs          (model-generated)
  /workspace/verification.mjs         (host-owned; never given to model for editing)
          |
          └─ structured test evidence → trusted host evaluator

Stripe Projects CLI (already configured)
   └─ provisions/tracks CreateOS service and injects its provider credentials
      [separate from the account-specific Sandbox API key]
```

**Trust boundary:** The app server sees API keys. A sandbox sees only synthetic data and the files it needs. Model-produced text must not control host file paths, network calls, arbitrary system tools, or success verdicts.

## B3. Credentials and account safety

**Application-side environment contract** (do not insert real values in the repository):

```dotenv
# Host-only: obtained from the CreateOS account with hackathon credits
CREATEOS_SANDBOX_API_KEY=<secret>
CREATEOS_SANDBOX_BASE_URL=https://api-eu.sb.createos.sh/

# Host-only: provider used for actual test/patch generation
OPENROUTER_API_KEY=<secret>
OPENROUTER_MODEL=<valid-code-capable-model-id>

# Optional app behavior
RUNVA_MAX_REPAIR_RETRIES=2
RUNVA_MAX_ACTIVE_RUNS=1
RUNVA_MAX_RUN_MS=180000
```

Do not confuse `CREATEOS_PROJECT_API_KEY` (from Stripe Projects provisioning) with `CREATEOS_SANDBOX_API_KEY` expected by the Sandbox SDK. They may represent distinct products/identities. **Confirm the Sandbox key maps to the CreateOS account receiving hackathon credits.** Use a server-side identity/sandbox smoke test to prove access. Never copy the provider keys into the browser or publish them in docs/logs.

**Important existing account constraint:** The Stripe Projects workspace was initialized under a third-party live Stripe account, not the user's personal sandbox. Obtain and retain explicit authorization before further account actions; avoid paid resources, Stripe Payments, customer records, or changes to billing. The app demo should **not** make live Stripe API calls. Do not put client account names, emails, account IDs, or production secrets in the public repository or demo.

**Git ignore requirements:** `.env`, `.env.*` except `.env.example`, `.projects/vault/`, auth/session caches, `.next/`, `node_modules/`, `artifacts/private/`, and any credential files. Run `git status --short` and a secret scan before first push. Source-controlled `README` must document key *names*, not key *values*.

## B4. Orchestrator algorithm (canonical order)

```text
startRun(input):
  validate request, rate-limit, acquire one-run concurrency lock
  create runId; append event(CREATED)
  load baseline handler + freeze verifier hash
  agent writes a new adversarial test module from problem statement
  validate generated test JSON/code and allowed file names

  create CreateOS sandbox with size, region/endpoint, egress allowlist
  upload baseline handler + agent-generated tests
  execute syntax check, generated tests, then frozen baseline verifier
  parse actual stdout/stderr/exit_code and structured assertions
  if baseline not reproducibly unsafe:
     stop INCONCLUSIVE and show observed evidence

  candidate = LLM.generatePatch(baseline, contract, failure evidence)
  for attempt in 1..3:   # first patch plus max two retries
     validate candidate scope and syntax
     overwrite ONLY sandbox target handler
     execute generated tests and trusted verifier
     gather real failures, stdout/stderr, exit code
     if all trusted checks pass: VERIFIED; break
     if attempt < 3: candidate = LLM.repair(candidate, failure evidence)
     else: FAILED

  compute evidence, diff, hashes, Markdown receipt
  always destroy sandbox, release run lock, redact secrets
  persist run events and return final honest status
```

**Performance optimization:** Host-owned fixture and verifier exist before the LLM call. You can reuse a **single sequential sandbox** for baseline and candidate attempts, wiping/resetting synthetic state between invocations. For stronger final proof, spawn a **fresh sequential verifier VM after destroying the first VM** (P2 only). Parallel candidates are unnecessary and can violate free concurrency.

**Do not fake a live “stream.”** Start with run-step status updates and buffered `runCommand` results, which reliably return stdout, stderr, `exit_code` and `exec_ms`. If streaming works on this control plane, use `streamCommand`; if it returns 404, fall back to buffered execution without marking the run failed solely because streaming is unavailable. The CreateOS docs explicitly warn this can happen on some deployments.

## B5. CreateOS SDK integration contract (verified API shape)

```ts
import { createClient } from "@nodeops-createos/sandbox";

// Reads CREATEOS_SANDBOX_API_KEY and CREATEOS_SANDBOX_BASE_URL on the SERVER.
const client = createClient();
const sandbox = await client.createSandbox({
  shape: "s-1vcpu-1gb",
  rootfs: "devbox:1",
  region: "eu",
  ingress_enabled: false,
  // IMPORTANT: [] would mean OPEN egress. A non-empty allowlist is restrictive.
  egress: ["registry.npmjs.org:443"],
});

try {
  await sandbox.runCommand("mkdir", ["-p", "/workspace/target"]);
  await sandbox.files.upload("/workspace/target/handler.mjs", candidateSource);
  await sandbox.files.upload("/workspace/verification.mjs", verifierSource);

  const output = await sandbox.runCommand("node", ["/workspace/verification.mjs"], {
    timeoutMs: 60_000,
  });

  const { stdout, stderr, exit_code } = output.result;
  // Parse structured verifier output; only host assertions set VERIFIED.
} finally {
  await sandbox.destroy();
}
```

**Note:** This is an integration reference, not a full solution. Check installed SDK typings for `region`, `egress`, and compatible rootfs if compilation differs. Sandbox parent directories must exist before `files.upload`. The allowlist above is an example, not blanket safe networking: prebundled Node built-ins need no outbound network, and unrelated outbound hosts should be blocked. **Never use an empty egress list to mean blocked; CreateOS treats empty as allow-all.** Do not expose an ingress URL for this test-only workload.

**Execution boundary:** Do not execute `candidateSource` via local `node`, `eval`, `Function`, `vm`, or shell. All candidate-generated code execution must happen in CreateOS. Local trusted utility code (hashing, JSON validation, code diffs, host assertions) is allowed.

**Cleanup:** `destroy` runs inside `finally`; create an independent stale-sandbox cleanup command on startup/exit if practical, but never delete sandboxes not owned by RUNVA. Timeout/cancel must trigger cleanup and a truthful terminal status. Capture SDK error type and request ID when safe, never auth headers.

## B6. LLM contract: predictable, inspectable, non-scripted

Implement `LLMAdapter.generateTests` and `LLMAdapter.generatePatch`/`repairPatch` against OpenRouter `POST https://openrouter.ai/api/v1/chat/completions`, with the model name configured in `OPENROUTER_MODEL`. Use an explicit response schema and `zod` validation; retry malformed **formatting** once but do not fabricate generated code when the API is unavailable.

**Test generation input:** Immutable public scenario spec + original handler source + generated-test path contract. **Output schema:**

```json
{
  "summary": "what failure this test attempts to expose",
  "testFilename": "agent-tests.mjs",
  "testCode": "...complete runnable Node.js module..."
}
```

**Patch generation / repair input:** Original source or previous candidate + immutable required behavior + actual failure evidence (failing assertions, stdout, stderr, exit code). **Output schema:**

```json
{
  "diagnosis": "brief mechanism of failure",
  "changeSummary": "what changed and why",
  "targetFilename": "handler.mjs",
  "sourceCode": "...complete replacement module..."
}
```

Validate target filename against an explicit allowlist. Never let the LLM set `verified=true`, test counts, run status, or output paths. Before accepting output, enforce size bounds and confirm that `sourceCode` is nonempty and differs from the baseline when a patch was required. Display the actual generated source (syntax highlighted), not only an AI explanation.

**Agent prompt constraints:** Never change function signatures, frozen harness expectations, or business requirements to pass tests. Understand idempotency at the **order/business effect** level; an event-ID-only cache is insufficient for V2. Ensure concurrent attempts cannot both execute `fulfillOrder`; avoid permanently recording success before a side effect succeeds; support retries on transient failure. Keep changes small and avoid adding external dependencies.

## B7. Independent verification and evidence integrity

A **trusted host-owned verifier** is responsible for V1–V6. Agent-generated tests are great for discovery but do not replace the independent verifier. Freeze the verifier source for the run and calculate `verifier_sha256` before sending it to the sandbox. The agent never receives an editable path to this verifier.

**Machine-readable verifier output**: one JSON object written as the final stdout line, with `{ "schema": "runva.verdict.v1", "pass": boolean, "cases": [{"id":"V1","pass":true,"observed":...,"expected":...,"details":...}], "durationMs": number }`. Host validates this JSON and checks the actual process `exit_code`. If stdout cannot be parsed or the process exits unexpectedly, verdict is FAIL/INCONCLUSIVE, not VERIFIED.

**Evidence receipt contents:**
- RUNVA run ID, timestamp, chosen workflow, one-sentence safety contract.
- Real CreateOS sandbox execution reference (sanitized ID), chosen shape and region.
- Baseline source hash, patched source hash, frozen verifier hash.
- Model used (provider/name, no key), patch attempt count, test creation evidence.
- Baseline test output (exit code and failing assertions) and final verifier output (exit code and all case results).
- Code diff and generated test file; download links if implemented.
- Explicit scope statement: “Verified for these synthetic conditions in this sandbox. Not a production guarantee.”

**Evidence policy:** Hashes are reproducibility identifiers, **not cryptographic proof of correct behavior**. The product can claim *observed verified assertions* only, not formal verification, universal correctness, or fault tolerance across restart/multi-node deployment.

## B8. HTTP/API contract

Prefer a **single persistent Node server** for the hackathon demo, not serverless functions with short execution limits. If using Next.js App Router, set Node runtime for handlers, keep one process/replica, and don't assume that a background task survives server restarts.

| Endpoint | Request/response | Responsibility |
|---|---|---|
| `POST /api/runs` | `{scenarioId:"webhook-idempotency"}` → `{runId,status}` | Acquire concurrency guard, begin asynchronous run |
| `GET /api/runs/:id` | `RunSummary` | Current phase, progress, timestamps, latest counts, errors |
| `GET /api/runs/:id/events` | SSE or JSON event poll | Ordered timeline events; reconnect uses `seq` cursor |
| `POST /api/runs/:id/cancel` | `{cancelled:true}` | Signal run abort and cleanup |
| `GET /api/runs/:id/report` | `text/markdown` download | Honest verification receipt |
| `GET /api/runs/:id/patch` | Source/diff download | Actual candidate, without secrets |
| `GET /api/health` | `{ok, sandboxConfigured, llmConfigured}` | Readiness; never expose keys or Stripe account data |

**Public demo safeguards:** Since an unauthenticated demo is costly, use a server-side demo access code or simple session guard for run creation, plus **one active run globally** and a cooldown. GET summary endpoints may be publicly viewable via a non-guessable run ID. Do not allow client-supplied arbitrary code in P0; use the preset fixture. Response body size limits and rate limits are mandatory.

**Run model:**

```ts
type RunStatus =
  | "CREATED" | "INSPECTING" | "TESTS_GENERATED" | "BASELINE_RUNNING"
  | "FAILURE_REPRODUCED" | "PATCH_GENERATING" | "PATCH_TESTING"
  | "REPAIRING" | "INDEPENDENT_VERIFYING" | "VERIFIED"
  | "FAILED" | "INCONCLUSIVE" | "CANCELLED" | "INFRA_ERROR";

type RunEvent = {
  seq: number;
  runId: string;
  at: string;                 // ISO timestamp
  status: RunStatus;
  kind: "phase" | "llm" | "sandbox" | "command" | "assertion" | "artifact" | "error";
  title: string;
  details?: Record<string, unknown>; // sanitized
};
```

`RunSummary` includes `scenarioId`, `status`, `startedAt`, `finishedAt?`, `attemptCount`, `baselineResult?`, `finalResult?`, `caseResults[]`, `events[]` and links to patch/report. Do not return raw, unconstrained LLM text as trusted HTML.

## B9. Repository structure (adapt to existing files)

```text
createos-hackathon/                      # EXISTING root; preserve
├── .projects/                           # Stripe Projects-managed
├── .env                                 # generated provider keys; never commit
├── .gitignore
├── README.md
├── docs/
│   └── RUNVA_PRD_TRD.md                 # this document
├── web/                                 # use existing Next.js app if present
│   ├── src/app/page.tsx                  # Mission Control
│   ├── src/app/runs/[id]/page.tsx         # live run + result
│   ├── src/app/api/runs/route.ts         # start
│   ├── src/app/api/runs/[id]/route.ts    # status
│   ├── src/app/api/runs/[id]/events/route.ts
│   ├── src/app/api/runs/[id]/cancel/route.ts
│   ├── src/app/api/runs/[id]/report/route.ts
│   ├── src/lib/runva/orchestrator.ts
│   ├── src/lib/runva/sandbox.ts
│   ├── src/lib/runva/llm.ts
│   ├── src/lib/runva/verifier.ts
│   ├── src/lib/runva/receipt.ts
│   ├── src/lib/runva/run-store.ts
│   ├── src/lib/runva/types.ts
│   └── src/components/runva/{MissionControl,RunTimeline,DiffView,ProofReceipt}.tsx
├── fixtures/
│   └── webhook-idempotency/
│       ├── handler.vulnerable.mjs        # intentionally broken starter
│       ├── invariant.md                 # contract visible to agent
│       └── verifier.mjs                  # frozen; never editable by agent
├── scripts/
│   └── smoke-sandbox.ts
└── .env.example                          # key NAMES / placeholders only
```

If the `web` Next.js app does not exist, create it once without deleting `.projects/`. If implementing the prior React/Vite + Fastify stack instead, mirror the same modules, APIs, and behaviors and avoid duplicating server-side execution logic.

## B10. Implementation sequence and acceptance gates

**Gate 0 — Existing setup and account correctness (critical, short).**
- Confirm Stripe Projects `status` lists `createos/project`, Free tier. Do **not** reinitialize.
- Confirm CreateOS Sandbox API key belongs to the user account holding credits, not a different browser session.
- Confirm credentials are server-only. Confirm third-party Stripe account authorization; never access payments.
- `createos` CLI/SDK EU endpoint is reachable.

**Gate 1 — Real sandbox smoke test.**
- `scripts/smoke-sandbox.ts` creates 1 VM, uploads hello-world `.mjs`, executes Node, asserts nonempty stdout + exit 0, destroys VM in `finally`.
- Include one intentional nonzero command and correctly read stderr/exit code.
- If this gate fails, stop feature development and fix credentials or SDK compatibility first.

**Gate 2 — Deterministic fixture + frozen verifier.**
- Implement vulnerable webhook handler and V1–V6 harness using only Node built-ins.
- Run original fixture in a real sandbox and capture reproducible failure for V1/V2.
- Run a manually created **temporary reference repair only in local development** to verify the test harness can pass; remove/reference-lock it before demonstrating so the actual app uses the LLM to create a new patch.
- Test harness must remain frozen for real runs.

**Gate 3 — Agent writes/tests/repairs.**
- LLM generates executable adversarial tests from instructions; upload and run them in CreateOS.
- LLM generates complete replacement target code; upload and run.
- On real failure, feed logs back and permit up to two repair retries.
- The frozen verifier determines the final verdict.

**Gate 4 — UI + trustworthy evidence.**
- Build the hero/mission, timeline, before/after, patch diff, verifier case table, truthful statuses.
- Show test output generated by actual SDK calls, not a canned console demo.
- Add receipt download and sanitization.

**Gate 5 — Deploy + rehearse.**
- Deploy persistent Node service (Railway or comparable); ensure long-running execution is allowed.
- Run from deployed URL three times. Verify errors, cancellation and sandbox cleanup.
- Ensure no secrets in Git diff/history; private account details excluded.
- Push public repo and test on a fresh browser without local cookies.

**Gate 6 — Submit before deadline.**
- Record a 2–3 minute video with a real teammate **on camera** narrating problem, actual sandbox execution, generated test, failed baseline, generated patch, final independent pass, Stripe Projects integration.
- Create public X/LinkedIn post; tag `@createosai` on X or CreateOS on LinkedIn.
- Submit official hackathon form **before 5:30 PM PT October 17 = 1:30 AM Nigeria time October 18**, and also Stripe Projects leaderboard with organizer code **`CreateOS-2026`**.
- Keep 15+ minutes of buffer. Do not rely on commits made after submission lock.

## B11. Runtime reliability and test matrix

| Test | Expected outcome |
|---|---|
| Sandbox smoke test | VM created, code executed, stdout captured, VM destroyed |
| Baseline V1/V2 | Nonzero exit + clear assertions showing duplicate effects |
| Real LLM test generation | New runnable `.mjs` from current prompt; tracked in artifacts |
| Candidate repair loop | New patch source; real sandbox exec; up to two evidence-driven retries |
| Frozen V1–V6 | All assertions pass before VERIFIED is emitted |
| Candidate syntax error | Capture stderr, trigger repair if budget remains |
| LLM outage | Honest INFRA_ERROR; no fabricated patch or pass |
| CreateOS 401/402/403/429 | Honest actionable error, cleanup, no retry storm |
| Stream 404 | Fall back to buffered exec and phase-by-phase progress |
| User cancels | Abort if possible; VM cleanup and CANCELLED status |
| Two simultaneous users | Second request receives busy/rate-limit response; no extra VM |
| Missing secrets | Health check shows missing configuration without exposing values |
| Public repo | No `.env` or vault secrets anywhere in committed history |
| Reproducibility | Repeatable passing verifier on same synthetic scenario |

## B12. Suggested 2:40-minute demo script and on-screen choreography

**0:00–0:20 — Human on camera.** “Webhooks get retried. One payment can trigger the same fulfillment more than once. A passing happy-path test does not prove your integration is safe.”

**0:20–0:40 — Product and contract.** Show RUNVA Mission Control and the invariant: **one paid order → one fulfillment, even under duplicate or concurrent delivery**. “RUNVA generates attacks against this behavior and then repairs the code.”

**0:40–1:05 — AI writes tests and CreateOS runs code.** Start the live run; point to real generated `.mjs` and CreateOS sandbox creation/execution trace.

**1:05–1:25 — Baseline breaks.** Show actual V1/V2 failures: 20 duplicate deliveries, repeated fulfillment; stdout, exit code, failed assertion. “It found and reproduced the exact bug.”

**1:25–1:55 — Autonomous patch.** Show generated code diff, repair iteration if it occurs, and rerun. Do not force fake failures if the model passes on first patch.

**1:55–2:20 — Proof receipt.** Show V1–V6 passing from frozen independent verification, hashes, and proof scope. “We didn't ask the model whether it fixed the code. We tested it independently.”

**2:20–2:40 — Sponsor implementation and real use.** Briefly show `stripe projects status`/stack documentation and CreateOS sandbox SDK usage/egress configuration. “Stripe Projects provisions the stack; CreateOS isolates execution. RUNVA returns evidence, not confidence theatre.”

If the run takes longer than the video window, record a continuous authentic end-to-end run and edit out **idle time only**, with clear labels. Do not splice unrelated runs or fabricate output. Have an already completed **real** run accessible as a fallback for explaining the result while still showing live code execution.

## B13. Submission and release checklist

- [ ] Newly written hackathon code (no prior product repo/code reused).
- [ ] Stripe Projects provider linked and free CreateOS resource documented.
- [ ] Real CreateOS Sandbox SDK integrated and run succeeds on EU endpoint.
- [ ] Wrong-account risk resolved: credited Sandbox key, explicit authority for provider account.
- [ ] Agent independently generates tests and patch, executes code, interprets failures.
- [ ] Seeded vulnerable baseline fails V1/V2 honestly.
- [ ] Frozen verifier passes V1–V6 honestly after patch; or result explicitly marked failed/inconclusive.
- [ ] Actual stdout/stderr/exit codes visible; no fabricated results.
- [ ] Sandbox egress restricted and `destroy()` in `finally`.
- [ ] Public GitHub repo with README (overview, how to run, architecture, sponsor integration, demo scope).
- [ ] Secrets excluded from Git and from video.
- [ ] Deployed demo URL working from incognito browser.
- [ ] Viewable 2–3 minute demo video with a member on camera.
- [ ] Public X/LinkedIn build-in-public post tagging sponsor.
- [ ] Official form submitted before 5:30 PM PT; Stripe Projects leaderboard also submitted with `CreateOS-2026`.
- [ ] Team members and Discord handles prepared for both forms; person ready if selected for top-five live demo.

---

# PART C — CURSOR IMPLEMENTATION DIRECTIVE

**Read and implement this entire file.** Treat **P0** requirements, verifier integrity, secrets protection, and submission timing as hard constraints. This is a **brand-new hackathon product**; do not import proprietary or prebuilt application logic from another project. Keep existing Stripe Projects integration and `.env` intact. Do not reinitialize, add billable services, or use third-party account payment data.

**Working method:**
1. Inspect current repository structure and available scripts. Identify whether `web/` already exists; adapt rather than overwrite.
2. Run a credential-presence check **without printing secret values**. Confirm the account key used by CreateOS SDK belongs to the credited user.
3. Implement Gate 1 smoke test and prove remote execution first.
4. Implement the vulnerable webhook, immutable verifier, and deterministic fixture, including baseline failure evidence.
5. Implement the REAL code-generation/test-generation/repair orchestration using the selected OpenRouter model; do not substitute hardcoded patch strings or mock LLM responses for the demo path.
6. Add the visual RUNVA console and downloadable evidence receipt.
7. Deploy and run full e2e tests, then prepare the public README, video, and submission.

**Work in short, verifiable increments.** After each gate, report files changed, commands executed, real tests passing/failing, current blocker, and next gate. Never claim a step is finished if it was not executed. Resolve straightforward implementation choices without requesting unnecessary approval. Ask before provisioning anything paid or accessing a third-party account beyond already authorized free project scope.

**Definition of 'done':** From a fresh browser at the deployed URL, one user action triggers a real LLM-generated adversarial test, real CreateOS execution of the vulnerable handler, a real LLM-generated patch, a new execution and independent pass/fail verdict, and a downloadable receipt. The system also destroys its sandbox and never exposes keys. If a non-core stretch feature threatens this flow, omit the feature.

---

# Appendix — Official technical references (checked October 17, 2026)

1. CreateOS Sandbox SDK: https://createos.sh/docs/Sandbox/SDK/Overview/
2. CreateOS Sandbox SDK tutorial: https://createos.sh/docs/Sandbox/SDK/Tutorial/
3. CreateOS Sandbox SDK reference: https://createos.sh/docs/Sandbox/SDK/Reference/Overview/
4. CreateOS sandbox limits: https://createos.sh/docs/Sandbox/Limits/
5. CreateOS egress policy (empty list allows all): https://createos.sh/docs/Sandbox/REST-API/Egress/
6. CreateOS buffered vs streaming command caveat: https://createos.sh/docs/Sandbox/SDK/How-To/Streaming/
7. Stripe Projects participant guide: https://projects.dev/hackathon-participants
8. Stripe Projects: https://docs.stripe.com/projects
9. OpenRouter chat completions: https://openrouter.ai/docs/api/api-reference/chat/send-chat-completion-request

**Truthfulness note:** This document is a plan and acceptance specification, not evidence that the code has already been implemented or verified. Actual results must come from live executions and be labeled accurately.
