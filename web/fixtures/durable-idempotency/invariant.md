# Safety contract: durable webhook idempotency (multi-process, SQLite)

**Invariant:** one paid order leads to exactly one fulfillment, across duplicate and concurrent deliveries handled by several worker processes, different event IDs for the same order, and process restarts.

## Interface (keep it exactly)
- `export async function handleWebhook(event, deps)` resolves `{ ok: boolean, action: "fulfilled" | "duplicate" | "ignored" }`
- `deps.db`: a `DatabaseSync` from `node:sqlite`, already open on a database file that several OS processes use at the same time (`journal_mode=WAL` and `busy_timeout=5000` already set). The handler owns its schema (`CREATE TABLE IF NOT EXISTS ...`).
- `deps.fulfillOrder(orderId: string)` is async and may throw (transient failure).
- Every worker process imports handler.mjs fresh: module-level memory is NOT shared between processes and is lost on restart.
- Event shape: `{ id, type, data: { object: { id, metadata: { order_id } } } }`

## Required behavior
- `payment_intent.succeeded`: fulfill `data.object.metadata.order_id` exactly once per order, whichever process receives which delivery, however they overlap, and even after a process restart.
- Duplicates (including while another process is still fulfilling the order) resolve `{ ok: true, action: "duplicate" }`, not rejected.
- Any other event type: `{ ok: true, action: "ignored" }`, never fulfill.
- If `fulfillOrder` throws: reject (or resolve `ok: false`), do NOT record the order as completed, and leave it claimable so a later retry from any process fulfills it exactly once.

## Constraints
- Edit only `handler.mjs`. Keep the export name and signature. Node built-ins only (`node:sqlite` is available), no dependencies.
- Use `deps.db` for idempotency, keyed by the order (not only `event.id`). In-memory Sets/Maps cannot coordinate processes or survive restarts.
- Claim and record atomically: e.g. a `PRIMARY KEY`/`UNIQUE (order_id)` row inserted with `INSERT ... ON CONFLICT DO NOTHING` (check `changes`), or a short `BEGIN IMMEDIATE` transaction. SELECT-then-await-then-write races across processes.
- Never hold a transaction open across an `await`: one connection is shared by all deliveries in a process.
- Never mark an order completed before `fulfillOrder` succeeds. On failure, release the claim (or make it re-claimable) before rethrowing.
- Don't hide errors: no swallowed failures, no fake acknowledgements, no unhandled promise rejections (they crash Node).
