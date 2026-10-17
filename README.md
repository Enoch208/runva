# RUNVA — Prove it before you ship

**The AI reliability engineer that breaks your integration, repairs it, and proves the repair in a real sandbox.**

Webhooks get retried. One payment can trigger the same fulfillment twice — under duplicate delivery, concurrent delivery, or two event IDs for the same order. A happy-path test won't catch it, and an AI-suggested patch is just a suggestion.

RUNVA doesn't ask you to trust an AI patch. It:

1. **Writes adversarial replay tests** for the failure (LLM-generated, real code).
2. **Runs them against the original handler inside a CreateOS sandbox VM** and captures the real failure: stdout, stderr, exit code.
3. **Writes a minimal patch** from that evidence.
4. **Re-runs, and repairs its own patch** from the new failure output (up to 2 retries).
5. **Independently verifies** the final patch with a frozen, host-owned verifier (V1–V6) in a **fresh VM**.
6. Returns a **proof receipt**: before/after counts, diff, per-case assertions, SHA-256 identifiers. You can download it as Markdown.

A run is only marked **VERIFIED** when the unmodified verifier passes in a real CreateOS execution. Runs that fail, can't be reproduced, or hit an infrastructure error are labeled honestly as FAILED, INCONCLUSIVE or INFRA_ERROR.

## The golden scenario: duplicate fulfillment

`handler.mjs` exports `handleWebhook(event, deps)`. The seeded baseline *looks* idempotent: it dedupes on `event.id`. But the check happens before an `await` and is keyed on the wrong thing, so it fails under concurrency and under different event IDs for the same order.

| Case | Replay scenario | Contract |
|---|---|---|
| V1 | Same event delivered 20× concurrently | Exactly 1 fulfillment |
| V2 | Two different event IDs for the same order | 1 fulfillment, not 2 |
| V3 | Unknown / non-paid event types | 0 fulfillments, acknowledged |
| V4 | Two different orders | Exactly 1 each |
| V5 | Fulfillment fails once, then retry | Not marked done early; retry fulfills once |
| V6 | Module interface | Export exists, no crash |

Observed baseline (frozen verifier, real execution): **V1 fails with 20 fulfillments from 20 deliveries**, and V2 fails. V3–V6 pass.

The verifier runs each case in an isolated `worker_thread` with a fresh module import. It counts side effects in its own closure, never from the handler's return value. It routes handler output to stderr so a patch can't forge the verdict line, and it treats unhandled rejections and timeouts as failures.

## Architecture

```text
Browser (Next.js UI)  ──  POST /api/runs · GET /api/runs/:id · cancel · report · patch
        │
Node server (trusted host)
  ├─ orchestrator: state machine, ≤3 patch attempts, one active run, timeout + cancel
  ├─ LLM adapter (OpenRouter): generateTests / generatePatch / repairPatch, zod-validated JSON
  ├─ frozen verifier + fixture (host-owned, SHA-256 pinned, never shown to the model)
  └─ CreateOS Sandbox SDK (server-only)
        │  create VM → upload → run → capture stdout/stderr/exit_code → destroy (finally)
        ▼
CreateOS Firecracker VM (EU, ephemeral, ingress off, egress allowlist)
  /workspace/target/handler.mjs   ← model-editable
  /workspace/agent-tests.mjs      ← model-generated
  /workspace/verification.mjs     ← frozen; hash re-checked inside the final VM
```

**Execution boundary:** model-generated code never runs on the host. There's no `eval`, `vm`, `child_process` or local import of candidate code. The host only hashes, diffs, and parses JSON.

## Sponsor integration

- **CreateOS Sandbox** (`@nodeops-createos/sandbox`): every test, baseline and patch run happens in a real Firecracker microVM. A work VM handles baseline and repair, then a **fresh VM** runs the final independent verification. Egress is restricted to an allowlist; each run proves it by attempting an outbound request to a non-allowlisted host from inside the VM. VMs are destroyed in `finally` on success, failure, timeout and cancel.
- **CreateOS hosting**: the RUNVA app itself is deployed on CreateOS.
- **Stripe Projects**: the repo is a Stripe Projects workspace (`.projects/state.json`) with the CreateOS provider linked and the `createos/free` plan and `createos/project` resources provisioned via `stripe projects`. No live Stripe APIs, payments or customer data are used; events are synthetic.

## Run it locally

```bash
cd web
pnpm install
cp ../.env.example ../.env   # fill CREATEOS_SANDBOX_API_KEY and OPENROUTER_API_KEY
set -a; . ../.env; set +a
node scripts/smoke-sandbox.mjs   # Gate 1: real VM hello-world, nonzero exit, egress check
pnpm dev                         # http://localhost:3000
```

Environment variables (names only; see `.env.example`): `CREATEOS_SANDBOX_API_KEY`, `CREATEOS_SANDBOX_BASE_URL`, `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, `RUNVA_MAX_RUN_MS`, `RUNVA_FRESH_VERIFIER_VM`, `RUNVA_ACCESS_CODE`.

## Scope of proof

Verified for these synthetic conditions in this sandbox — **not a production guarantee**. The fixture is single-process; production durability requires a transactional/idempotent datastore and isn't covered across process crashes or multiple instances. Hashes identify artifacts; they aren't proof of correctness. Run state is in memory and is lost on server restart.

Built from scratch for *Build Agents That Run Code — CreateOS × Stripe Projects*, October 17, 2026.
