// RUNVA real-Stripe-event replay harness (host-owned; runs inside the CreateOS VM; Node built-ins only).
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const DELIVERIES = 20;
const FULFILL_DELAY_MS = 25;
const HANDLERS = [
  ["baseline", "/workspace/baseline/handler.mjs"],
  ["patched", "/workspace/patched/handler.mjs"],
];
const rawEvent = readFileSync("/workspace/stripe-event.json", "utf8");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Results go to the real stdout; anything a handler logs is routed to stderr so it can't forge a result line.
const emit = process.stdout.write.bind(process.stdout);
for (const m of ["log", "info", "debug"]) console[m] = (...a) => console.error(...a);

let failed = false;
for (const [name, file] of HANDLERS) {
  const mod = await import(pathToFileURL(file).href + "?fresh=" + Date.now());
  if (typeof mod.handleWebhook !== "function") throw new Error(name + ": handleWebhook export missing");
  const calls = new Map(); // orderId -> fulfillOrder call count, kept in the harness's own closure
  const deps = {
    async fulfillOrder(orderId) {
      calls.set(orderId, (calls.get(orderId) || 0) + 1);
      await sleep(FULFILL_DELAY_MS);
    },
  };
  const probe = JSON.parse(rawEvent);
  const orderId = probe.data.object.metadata.order_id;
  const t0 = Date.now();
  // Each delivery parses its own copy of the body, like separate HTTP redeliveries of the same event id.
  const settled = await Promise.race([
    Promise.allSettled(Array.from({ length: DELIVERIES }, () => mod.handleWebhook(JSON.parse(rawEvent), deps))),
    sleep(10_000).then(() => null),
  ]);
  if (!settled) {
    failed = true;
    emit(JSON.stringify({ handler: name, error: "timeout after 10s" }) + "\n");
    continue;
  }
  const actions = {};
  let acknowledged = 0;
  let rejected = 0;
  for (const s of settled) {
    if (s.status === "fulfilled") {
      if (s.value && s.value.ok === true) acknowledged++;
      const a = String(s.value && s.value.action);
      actions[a] = (actions[a] || 0) + 1;
    } else rejected++;
  }
  emit(
    JSON.stringify({
      handler: name,
      deliveries: DELIVERIES,
      fulfillments: calls.get(orderId) || 0,
      acknowledged,
      orderId,
      eventId: probe.id,
      eventType: probe.type,
      totalFulfillOrderCalls: [...calls.values()].reduce((a, b) => a + b, 0),
      rejected,
      actions,
      durationMs: Date.now() - t0,
    }) + "\n",
  );
}
process.exit(failed ? 1 : 0);
