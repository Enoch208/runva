# RUNVA submission kit

Copy-paste text for the official form, the Stripe Projects leaderboard, and build-in-public posts. Fill every `[bracket]` before you submit.

- **Deadline:** 5:30 PM PT, Oct 17 2026 (01:30 WAT, Oct 18)
- **Stripe Projects leaderboard code:** `CreateOS-2026`
- **Sponsor X handle:** @createosai
- **Links:** demo `https://production-runva.tyzo.nodeops.app` · repo `https://github.com/Enoch208/runva` · video `[video link]`

---

## Project name

RUNVA

## Tagline

Prove it before you ship.

## One-liner

The AI reliability engineer that breaks your integration, repairs it, and proves the repair in a real sandbox.

## Description: 100 words

RUNVA is an autonomous reliability engineer for webhook integrations. Webhooks get retried, and one payment can trigger twenty shipments. Given a handler and a plain-English safety contract, RUNVA writes adversarial replay tests, runs them against the original code inside a CreateOS Firecracker microVM, and captures the real failure: stdout, stderr, exit code. It writes a minimal patch, repairs its own patch from new failure output, then hands the final candidate to a frozen, hash-pinned verifier in a brand-new VM. The LLM never decides pass or fail. You get a downloadable proof receipt: before/after counts, diff, per-case assertions, and SHA-256 hashes.

## Description: 250 words

Webhooks get retried. When one payment's webhook arrives twenty times at once, a handler that looks idempotent can ship the order twenty times. Happy-path tests don't catch it, and an AI-suggested fix is just a suggestion.

RUNVA is an autonomous reliability engineer that closes the loop with real execution. Given a webhook handler and a plain-English safety contract ("one paid order, exactly one fulfillment"), it writes adversarial replay tests, boots a CreateOS Firecracker microVM, and runs them against the original code. It captures the real failure (stdout, stderr, exit code) and writes a minimal patch from that evidence. If the patch still fails, RUNVA feeds the new output back and the model repairs its own patch, up to two retries.

The model never grades itself. The final candidate goes to a frozen, hash-pinned verifier that RUNVA owns and whose source the model never sees. It runs in a brand-new VM that holds only the final handler and the verifier, and the verifier's hash is re-checked inside that VM. Each of six cases runs in an isolated worker that counts side effects the handler can't touch. Host code, not the LLM, decides VERIFIED, FAILED, INCONCLUSIVE or INFRA_ERROR.

Every run proves its sandbox is locked down (ingress off, egress allowlist, a blocked outbound request) and destroys its VMs in finally. You get a downloadable receipt with before/after counts, the diff, per-case assertions and SHA-256 identifiers, plus a script to re-verify any patch.

Synthetic events only, no live payments. Not a production guarantee.

---

## How RUNVA uses CreateOS

CreateOS is the execution layer. Without it there's no proof, only a model's opinion. All model-written code runs in CreateOS, never on our server.

- **Firecracker microVMs per run.** `@nodeops-createos/sandbox` (server-only, EU endpoint) creates an ephemeral VM for each run (default shape `s-1vcpu-1gb`). Baseline, agent tests, syntax checks and every patch candidate execute there.
- **File API.** `files.upload` writes `target/handler.mjs` (model-editable), `agent-tests.mjs` (model-generated) and `verification.mjs` (frozen) into `/workspace`. The verifier is re-uploaded before every candidate run, so a patch can't overwrite it.
- **Buffered exec.** `runCommand` returns real `stdout`, `stderr`, `exit_code` and `exec_ms`. RUNVA runs `node --check`, `timeout N node …` and `sha256sum` and treats non-zero exits as evidence, not errors. Those outputs are what the model repairs from and what the receipt shows.
- **Egress allowlist.** Every VM is created with `ingress_enabled: false` and a **non-empty** egress allowlist, because on CreateOS an empty list means allow-all. Each run proves it with a `curl` to a non-allowlisted host from inside the VM, and the exit code goes into the receipt.
- **Fresh verifier VM.** After the repair loop, the work VM is destroyed and a second, fresh VM gets only the final handler and the frozen verifier. RUNVA measures the verifier's SHA-256 inside that VM against the host-pinned hash, then runs the independent verdict.
- **Destroy in `finally`.** VMs are destroyed on success, failure, timeout and cancel. If a create call times out, RUNVA cleans up the orphan by its unique run-scoped name.
- **Hosted on CreateOS.** The RUNVA web app (Next.js, single Node process) is deployed on CreateOS.
- **Independent re-verification.** `node web/scripts/reverify.mjs <handler.mjs>` lets anyone with a CreateOS key re-run the frozen verifier on a patch in a fresh VM, without trusting RUNVA's run, UI or model.

## How RUNVA uses Stripe Projects

- The repo is a **Stripe Projects workspace** (`.projects/state.json`), initialized with the Stripe CLI `projects` plugin.
- The **`createos` provider is linked**, and the **`createos/free` plan** and a **`createos/project` resource** were provisioned through `stripe projects`. That's how the CreateOS stack RUNVA runs on was set up.
- `stripe projects status` shows the linked provider and resources.
- **No live Stripe payments, APIs or customer data.** The webhook events RUNVA replays are synthetic, Stripe-shaped `payment_intent.succeeded` payloads. The domain is Stripe-style fulfillment, and the provisioning runs through Stripe Projects.

## Judging track fit

> Track names below are as reported. Match them to the exact names on the form: `[confirm track names]`.

- **Autonomous agents.** One click starts a closed loop with no human in it: write tests, execute in a VM, observe the real failure, patch, re-execute, repair from new output (bounded to 3 candidates), verify in a fresh VM, write the receipt. The agent acts on what the code actually does, not on what it predicts.
- **Explainable agents.** Every claim is tied to an artifact: the generated test file, the exact commands, stdout and stderr tails, exit codes, sandbox IDs, the diff, per-case observed vs. expected values, and SHA-256 identifiers. The model's diagnosis is shown as a claim, next to the evidence that confirms or refutes it. Receipts download as Markdown and JSON.
- **Reasoning architecture.** The generator and the judge are separated by design. The LLM proposes; a frozen, hash-pinned, worker-isolated verifier disposes; host code sets the status from an explicit state machine (`CREATED → … → VERIFIED | FAILED | INCONCLUSIVE | CANCELLED | INFRA_ERROR`). Repairs are conditioned on real execution output, not self-critique.
- **Connected agent context.** The agent's context at each step is live output from a real CreateOS execution: failing case IDs, exit codes, stdout and stderr. That output feeds into the next model call, so the model reasons over what happened rather than over its own earlier text. The infrastructure it runs on was provisioned through Stripe Projects.

## What's real vs. scoped

**Real**
- LLM calls generate the tests and patches. No hardcoded patch strings or mocked model responses on the demo path.
- Every test and candidate runs in a real CreateOS Firecracker VM, and the stdout, stderr and exit codes shown are what the VM returned.
- The seeded baseline fails V1 and V2 against the frozen verifier in real execution.
- Egress restriction is checked on every run. VMs are destroyed in `finally`.
- Committed real run receipts are in `evidence/runs/`.

**Scoped (honest limits)**
- One scenario: webhook idempotency on a single-process synthetic fixture. Not arbitrary repos, languages or user-uploaded code.
- Synthetic events only, with no live Stripe traffic and no signature validation.
- VERIFIED means "passes these six cases under these synthetic conditions in this sandbox", not a production guarantee. Production durability needs a transactional or idempotent datastore and isn't covered across crashes or multiple instances.
- Hashes identify artifacts. They don't prove correctness.
- Run state is in memory (lost on restart). One active run at a time, with an access code and cooldown on the public demo.

## Tech stack

- **App:** Next.js 16 (App Router, Node runtime), React 19, TypeScript, Tailwind CSS 4
- **Agent:** OpenRouter (default model `anthropic/claude-sonnet-5.5`, or the Anthropic API directly), zod-validated JSON contracts, `diff` for unified diffs
- **Execution:** CreateOS Sandbox SDK `@nodeops-createos/sandbox`, Firecracker microVMs (EU)
- **Verifier:** plain Node ESM with `node:worker_threads`, built-ins only
- **Tests:** Vitest (`cd web && pnpm test`)
- **Infra:** Stripe Projects (Stripe CLI `projects` plugin), CreateOS hosting

## Team

| Name | Role | Discord handle |
|---|---|---|
| [name] | [role] | [discord handle] |
| [name] | [role] | [discord handle] |

Live demo contact if selected for the top five: `[name / Discord handle]`

---

## X post 1 (hook)

```text
One payment, twenty webhook retries, twenty shipments.

RUNVA writes attack tests, runs them in a real @createosai sandbox, patches the bug, and proves the fix with a frozen verifier in a fresh VM. The LLM never grades itself.

https://production-runva.tyzo.nodeops.app
https://github.com/Enoch208/runva
```

## X post 2 (receipt angle)

```text
Most AI coding agents hand you a patch. RUNVA hands you a receipt.

Real CreateOS VMs, real exit codes, a hash-pinned verifier the model can't touch, egress locked down on every run.

Built for @createosai x Stripe Projects.
https://production-runva.tyzo.nodeops.app
https://github.com/Enoch208/runva
```

> Both posts are 280 characters or fewer, counting each link as 23 characters (X's t.co length). Attach the 30-second backup cut from `docs/DEMO_SCRIPT.md` as the video.

## LinkedIn post

> Type `@CreateOS` and select the company page from the dropdown so it becomes a real tag.

```text
One payment. Twenty webhook retries. Twenty shipments.

That's the bug we went after at the Build Agents That Run Code hackathon with @CreateOS and Stripe Projects.

AI coding tools are good at producing patches. They're bad at proving them. So we built RUNVA, an autonomous reliability engineer that:

- writes adversarial replay tests for a webhook handler
- runs them against the original code in a real CreateOS Firecracker VM and captures the actual failure (stdout, stderr, exit code)
- writes a patch from that evidence, and repairs its own patch when the re-run still fails
- hands the final candidate to a frozen, hash-pinned verifier in a brand-new VM, so the model never grades its own work
- gives you a downloadable receipt: before/after counts, the diff, per-case assertions, and hashes

The sandbox is locked down (ingress off, egress allowlist), and every run proves it. The stack was provisioned through Stripe Projects, and the app is hosted on CreateOS.

What it isn't: a production guarantee. It covers one scenario with synthetic events, and the receipt says exactly that.

Demo: https://production-runva.tyzo.nodeops.app
Code: https://github.com/Enoch208/runva

Built by [team names].
```

---

## Final submission checklist

- [ ] Video uploaded and viewable, 2:30–2:45, team member on camera → `[video link]`
- [ ] Deployed demo works from an incognito window → `https://production-runva.tyzo.nodeops.app`
- [ ] Repo public, with README and `evidence/runs/` committed → `https://github.com/Enoch208/runva`
- [ ] No secrets, Stripe account IDs or account emails in the repo, video or posts
- [ ] X post published, tagging @createosai, and LinkedIn post published, tagging CreateOS
- [ ] Official form submitted before 5:30 PM PT (01:30 WAT)
- [ ] Stripe Projects leaderboard submitted with code `CreateOS-2026`
- [ ] Team names and Discord handles entered on both forms
