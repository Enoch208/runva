// Orders service: Stripe-style webhook endpoint backed by a (tiny, in-memory) orders table.
//
// Example input for `scripts/e2e-run.ts --handler`. It follows the RUNVA contract:
//   export async function handleWebhook(event, deps) -> { ok, action: "fulfilled" | "duplicate" | "ignored" }
//   deps.fulfillOrder(orderId) is async and may throw.
//
// It looks idempotent: it checks the order's status before shipping and only marks it fulfilled
// after fulfillOrder succeeds. Whether that holds up under real webhook delivery is for RUNVA to find out.

const PAYMENT_EVENTS = new Set(["payment_intent.succeeded"]);

// orders table: orderId -> { id, status: "pending" | "paid" | "fulfilled", paymentIntentId, attempts, lastError, updatedAt }
const orders = new Map();
// append-only audit trail (kept in memory instead of console noise)
const auditLog = [];

function audit(orderId, entry) {
  auditLog.push({ at: new Date().toISOString(), orderId, ...entry });
  if (auditLog.length > 500) auditLog.shift();
}

// Simulates `SELECT ... FROM orders WHERE id = $1`, inserting a pending row on first sight.
async function findOrCreateOrder(orderId) {
  await Promise.resolve();
  let row = orders.get(orderId);
  if (!row) {
    row = { id: orderId, status: "pending", paymentIntentId: null, attempts: 0, lastError: null, updatedAt: Date.now() };
    orders.set(orderId, row);
  }
  return row;
}

async function saveOrder(row) {
  row.updatedAt = Date.now();
  orders.set(row.id, row);
}

export async function handleWebhook(event, deps) {
  if (!PAYMENT_EVENTS.has(event?.type)) {
    return { ok: true, action: "ignored" };
  }

  const payment = event.data?.object ?? {};
  const orderId = payment.metadata?.order_id;
  if (!orderId) {
    audit(null, { eventId: event.id, note: "payment event without order_id, skipped" });
    return { ok: true, action: "ignored" };
  }

  const order = await findOrCreateOrder(orderId);
  if (order.status === "fulfilled") {
    audit(orderId, { eventId: event.id, note: "already fulfilled" });
    return { ok: true, action: "duplicate" };
  }

  order.status = "paid";
  order.paymentIntentId = payment.id ?? order.paymentIntentId;
  order.attempts += 1;
  await saveOrder(order);

  try {
    await deps.fulfillOrder(orderId);
  } catch (err) {
    order.lastError = err instanceof Error ? err.message : String(err);
    await saveOrder(order);
    audit(orderId, { eventId: event.id, note: "fulfillment failed", error: order.lastError });
    throw err; // let the webhook return 5xx so Stripe retries
  }

  order.status = "fulfilled";
  order.lastError = null;
  await saveOrder(order);
  audit(orderId, { eventId: event.id, note: "fulfilled" });
  return { ok: true, action: "fulfilled" };
}
