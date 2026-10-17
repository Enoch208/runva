# Safety contract: payment webhook idempotency

**Invariant:** one paid order leads to exactly one fulfillment, even when a webhook is delivered more than once, concurrently, or under a different event ID.

## Interface (keep it exactly)
- `export async function handleWebhook(event, deps)` resolves `{ ok: boolean, action: "fulfilled" | "duplicate" | "ignored" }`
- `deps.fulfillOrder(orderId: string)` is async and may throw (transient failure)
- Event shape: `{ id, type, data: { object: { id, metadata: { order_id } } } }`

## Required behavior
- `payment_intent.succeeded`: fulfill `data.object.metadata.order_id` exactly once per order, across duplicate deliveries, overlapping (concurrent) deliveries, and different event IDs that refer to the same order/payment.
- Duplicates are acknowledged with `{ ok: true, action: "duplicate" }`, not rejected.
- Any other event type: `{ ok: true, action: "ignored" }` and never fulfill.
- If `fulfillOrder` throws, reject (or resolve `ok: false`) and do NOT record the order as completed, so a later retry fulfills it exactly once.

## Constraints
- Edit only `handler.mjs`. Keep the export name and signature. Node built-ins only, no dependencies.
- Idempotency must be at the business level (the order), not just the event. A cache keyed only on `event.id` is insufficient.
- Concurrent deliveries must be coordinated: a check-then-await-then-record sequence races.
- Never mark an order completed before its fulfillment has succeeded.
- Don't hide errors: no swallowed failures, no fake acknowledgements, no unhandled promise rejections (they crash Node).
- Module-level in-memory state is fine for this single-process fixture. Production needs a transactional/idempotent datastore.
