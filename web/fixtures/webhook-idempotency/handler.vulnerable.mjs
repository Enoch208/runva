// Payment webhook handler: fulfills an order when its payment succeeds.

// Stripe redelivers webhooks, so remember which events we've already handled.
const processedEvents = new Set();

export async function handleWebhook(event, deps) {
  if (event.type !== "payment_intent.succeeded") {
    return { ok: true, action: "ignored" };
  }

  if (processedEvents.has(event.id)) {
    return { ok: true, action: "duplicate" };
  }

  const orderId = event.data.object.metadata.order_id;
  await deps.fulfillOrder(orderId);

  // Only mark the event handled after fulfillment succeeds, so a failed attempt can be retried.
  processedEvents.add(event.id);
  return { ok: true, action: "fulfilled" };
}
