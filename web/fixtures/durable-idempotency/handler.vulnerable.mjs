// Payment webhook handler: fulfills an order when its payment succeeds.
// Runs on several worker processes; order state lives in the shared SQLite database (deps.db).

export async function handleWebhook(event, deps) {
  if (event.type !== "payment_intent.succeeded") {
    return { ok: true, action: "ignored" };
  }

  const { db, fulfillOrder } = deps;
  db.exec(`CREATE TABLE IF NOT EXISTS orders (
    order_id      TEXT PRIMARY KEY,
    status        TEXT NOT NULL,
    last_event_id TEXT,
    updated_at    TEXT NOT NULL
  )`);

  const orderId = event.data.object.metadata.order_id;

  // Stripe redelivers webhooks, so skip orders we've already fulfilled.
  const row = db.prepare("SELECT status FROM orders WHERE order_id = ?").get(orderId);
  if (row?.status === "fulfilled") {
    return { ok: true, action: "duplicate" };
  }

  await fulfillOrder(orderId);

  // Record the fulfillment only after it succeeds, so a failed attempt can be retried.
  db.prepare(
    `INSERT INTO orders (order_id, status, last_event_id, updated_at)
     VALUES (?, 'fulfilled', ?, ?)
     ON CONFLICT(order_id) DO UPDATE SET
       status = 'fulfilled', last_event_id = excluded.last_event_id, updated_at = excluded.updated_at`,
  ).run(orderId, event.id, new Date().toISOString());

  return { ok: true, action: "fulfilled" };
}
