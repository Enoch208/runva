# RUNVA demo video script

Target length: **2:30–2:45**. One team member on camera for the open and close (picture-in-picture is fine for the middle).

**Rules for this recording**
- Every number spoken must be on screen at that moment, from a real run. Brackets like `[real run duration]` mark values you read off the screen or receipt. Never fill them from memory or from this doc.
- Record one continuous, real end-to-end run. Cut **idle time only**, and label each cut on screen ("waiting on VM, 0:XX cut"). Don't splice in footage from a different run.
- If the live run ends FAILED or INFRA_ERROR, say so. Then switch to the backup completed real run (see checklist) and label it on screen: "Earlier real run, [run id]".
- Never show `.env`, API keys, Stripe account IDs or account emails.

---

## Full cut (≈2:40)

### 0:00–0:10 — Hook (on camera)
**SCREEN:** Presenter, face to camera. Lower third: "RUNVA — Prove it before you ship."

**SAY:** "One payment, twenty webhook retries, twenty shipments. That's a real failure mode, and a happy-path test will never catch it."

### 0:10–0:25 — What RUNVA is (on camera)
**SCREEN:** Presenter. Cut to the browser at the end of the line.

**SAY:** "I'm [name], and this is RUNVA. It doesn't just suggest a fix. It breaks your webhook handler, repairs it, and proves the repair by running real code in a CreateOS sandbox."

### 0:25–0:40 — Mission Control and the contract
**SCREEN:** RUNVA Mission Control (home page). Point at the safety contract: *one paid order leads to exactly one fulfillment, even under duplicate, concurrent, or differently-ID'd delivery*. Show the baseline `handler.mjs` panel briefly: it dedupes on `event.id`.

**SAY:** "Here's the contract: one paid order, exactly one fulfillment. This handler looks idempotent because it dedupes on the event ID. RUNVA's job is to prove whether that's true."

### 0:40–1:00 — Run: live timeline
**SCREEN:** Click **Start a run**. The live timeline fills in. Point at, in order:
1. "Agent wrote adversarial tests" → open `agent-tests.mjs` for about a second.
2. "Creating CreateOS sandbox" → sandbox ID `[sandbox id]`, shape, region.
3. File uploads and the commands being run.

**SAY:** "I click run. The model writes adversarial replay tests: real code, not a description. RUNVA boots a fresh CreateOS Firecracker VM, uploads the handler and the tests, and runs them. Nothing the model writes ever runs on our server."

### 1:00–1:20 — Baseline failure
**SCREEN:** "Failure reproduced" event. Zoom on the frozen verifier result vs. baseline: **V1 observed `[V1 baseline fulfillments]` fulfillments, expected 1**; V2 failing; the real non-zero exit code `[baseline exit code]`; the stdout tail.

**SAY:** "And it breaks. Twenty concurrent deliveries of the same event, [V1 baseline fulfillments] fulfillments. Two event IDs for the same order also ship twice. That's real stdout and a real exit code from the VM."

> Say the number on screen. The seeded baseline is expected to show 20, but read it, don't assume it.

### 1:20–1:45 — Generated patch diff
**SCREEN:** "Asking the model for a minimal patch" event, then the diff view. Highlight the change: idempotency keyed on the order, with concurrent deliveries coordinated. If a repair happened, show the "Repair 1: feeding real sandbox failures back to the model" event and the failing output it was given.

**SAY (no repair):** "From that failure output, the model writes a minimal patch, keyed on the order instead of the event, and safe under concurrency. Candidate [attempt number] passes in the work VM."

**SAY (if a repair occurred):** "The first patch still failed, so RUNVA fed the real failure back and the model repaired its own patch. It passed on attempt [attempt number]."

> Don't force or fake a repair. Use whichever line matches the run.

### 1:45–2:05 — Fresh-VM verdict
**SCREEN:** "Creating a FRESH CreateOS sandbox for independent verification" → a new sandbox ID `[fresh sandbox id]` that differs from the work VM. "Verifier integrity: in-VM sha256 matches the frozen hash." Then the V1–V6 table: **V1 observed `[V1 final fulfillments]` fulfillment**, all cases passing, exit `[final exit code]`. Status badge: **VERIFIED**.

**SAY:** "Now the part that matters. We don't ask the model whether it fixed anything. A brand-new VM gets only the final handler and our frozen verifier, and we check the verifier's hash inside that VM. Twenty deliveries, [V1 final fulfillments] fulfillment. V1 through V6 pass, exit zero. Verified."

> Only say "verified" if the badge on screen says VERIFIED.

### 2:05–2:15 — Egress-blocked proof
**SCREEN:** The timeline event "Egress blocked: example.com unreachable from sandbox (curl exit `[curl exit code]`)", with the allowlist visible.

**SAY:** "The sandbox is locked down too: ingress off, egress on an allowlist. Every run proves it. A curl to a non-allowlisted host fails from inside the VM."

### 2:15–2:25 — Receipt download
**SCREEN:** Click the Markdown receipt download (the `.json` receipt and `.diff` patch sit next to it). Open the Markdown: run status, sandbox IDs, commands with exit codes, before/after table, diff, SHA-256 hashes, and the scope section. Total time: `[real run duration]`.

**SAY:** "You get a receipt: every command, every exit code, the diff, the hashes, and an honest scope. This proves these synthetic conditions in a sandbox. It's not a production guarantee."

### 2:25–2:38 — Sponsor stack
**SCREEN:** Terminal running `stripe projects status`, cropped or masked so no account ID or email shows. Then the editor at `web/src/lib/runva/sandbox.ts`, on the `createSandbox({ shape, rootfs, ingress_enabled: false, egress, name })` call and the comment "NON-EMPTY allowlist = restrictive".

**SAY:** "Stripe Projects provisioned our CreateOS stack from the CLI. The CreateOS sandbox SDK gives us the VMs, file uploads, real exit codes and network policy. The app itself is hosted on CreateOS."

### 2:38–2:45 — Close (on camera)
**SCREEN:** Presenter. Lower third: repo link and demo link.

**SAY:** "RUNVA. Evidence, not confidence. Prove it before you ship."

---

## Backup cut (30 seconds)

Use this if the full cut runs long or for a social clip. Same rules: real run, real numbers.

| Time | Screen | Say |
|---|---|---|
| 0:00–0:05 | Presenter on camera | "One payment, twenty webhook retries, twenty shipments." |
| 0:05–0:12 | Click **Start a run** → timeline: tests written, CreateOS VM created | "RUNVA writes attack tests and runs them in a real CreateOS sandbox." |
| 0:12–0:17 | Baseline: V1 `[V1 baseline fulfillments]` fulfillments, exit `[baseline exit code]` | "Baseline: [V1 baseline fulfillments] fulfillments. Bug reproduced." |
| 0:17–0:22 | Patch diff | "The model patches it from the real failure output." |
| 0:22–0:27 | Fresh VM → V1 `[V1 final fulfillments]` fulfillment, VERIFIED, egress-blocked event | "A fresh VM and a frozen verifier: [V1 final fulfillments] fulfillment. Verified, with egress locked down." |
| 0:27–0:30 | Receipt download, then presenter | "Evidence, not confidence. RUNVA." |

---

## Before you hit record (checklist)

**App and accounts**
- [ ] Deployed RUNVA URL `[demo link]` open in a clean browser profile or incognito window, with the access code ready if `RUNVA_ACCESS_CODE` is set.
- [ ] `GET /api/health` shows `sandboxConfigured: true`, `llmConfigured: true`, `activeRunId: null`.
- [ ] No stale RUNVA sandbox running. The free tier allows one sandbox at a time, so a leftover VM causes a 403 at create.
- [ ] Backup: a **completed real VERIFIED run** open in a second tab (`/runs/[run id]`), with its receipt also saved in `evidence/runs/`.

**Terminal and editor**
- [ ] Terminal in the repo root, large font, with `stripe projects status` already run once to check the output. Crop or mask any account ID or email before recording, or record only the provider and resource lines.
- [ ] Editor open on `web/src/lib/runva/sandbox.ts` at the `createSandbox` call, with the egress comment visible.
- [ ] `.env` closed and no secrets in any visible tab, terminal history or shell prompt.

**Screen**
- [ ] Notifications off (macOS Focus on), menu bar clean, bookmarks bar hidden.
- [ ] Browser zoom about 125% so code and numbers read on a phone.
- [ ] Downloads folder empty, so the receipt is easy to find.

**Recording**
- [ ] Presenter framed, lit from the front, mic checked (10-second test clip played back).
- [ ] Screen recorder capturing the full window at 1080p or higher.
- [ ] Note the start time of the run. After recording, fill every `[bracket]` from the screen or receipt, then label idle-time cuts.

**After recording**
- [ ] Watch the whole video once for leaked secrets, account IDs or emails.
- [ ] Final length is between 2:30 and 2:45, and a team member is on camera.
- [ ] Upload, set to public or unlisted-viewable, and paste the link into `docs/SUBMISSION.md`.
