# RUNVA verification receipt — VERIFIED

> Verified for these synthetic conditions in this sandbox. Not a production guarantee.

## Run
- Run ID: `run_9ce5ab644beb2546eb`
- Started: 2026-10-17T22:14:35.374Z · Finished: 2026-10-17T22:15:41.908Z · Duration: 66.5 s
- Workflow: `webhook-idempotency` (synthetic Stripe-style events only; no live Stripe API calls)
- Safety contract: One paid order leads to exactly one fulfillment, even when the webhook is delivered more than once, concurrently, or under a different event ID; a failed fulfillment is never marked complete.
- Final status: **VERIFIED**

## Execution environment (CreateOS Sandbox)
- `sb-01m55yy…` — work VM (baseline + candidates) · shape `s-1vcpu-1gb` · region `eu` · created in 669 ms · destroyed
- `sb-01m55yy…` — fresh independent-verifier VM · shape `s-1vcpu-1gb` · region `eu` · created in 577 ms · destroyed
- Egress allowlist: `registry.npmjs.org:443` · ingress disabled
- Egress proof: `curl -sS -m 4 https://example.com` exit 35 → blocked (as required)
- CreateOS credential supplied via env var `CREATEOS_SANDBOX_API_KEY` (value never logged)

## Hashes (reproducibility identifiers, not proof of correctness)
- Baseline handler.mjs: `a0932076a37e182ee69129b65ba8976e8916939062b862154dbb2f3835e896f0`
- Final candidate handler.mjs: `f2cbd01890ab9c45877c352de4380f936ee79912e1c498be9077835e37590d00`
- Frozen verifier: `3222f1a24ac7179ee829b5b53ebe336f2ff23c9de39d8923850fae717d3791e1`
- Verifier sha256 measured inside the final VM: `3222f1a24ac7179ee829b5b53ebe336f2ff23c9de39d8923850fae717d3791e1` → matches
- Agent tests agent-tests.mjs: `0affd9663269df2d8f4cf3d1995765137af65406f749db9da63783e45a1bf7fb`

## Model
- Model: `openrouter:anthropic/claude-sonnet-5.5` (key never logged)
- Patch attempts: 1 (1 initial + up to 2 repairs, each conditioned on real sandbox output)
- Test-generation summary: Tests try to expose: (1) concurrent deliveries of the same event all fulfilling because the event is recorded only after the await; (2) the same order arriving under different event IDs (sequential and concurrent) being fulfilled more than once because idempotency is keyed on event.id only; (3) unknown event types being ignored without fulfilling; (4) distinct orders being fulfilled independently; (5) a failed fulfillment being recorded as complete, or a retry (sequential or concurrent) not fulfilling exactly once; (6) fake acknowledgements and unhandled rejections.

## Baseline (vulnerable handler)
### Agent-generated tests vs baseline
- Command: `node /workspace/agent-tests.mjs` in sandbox `sb-01m55yy…`
- Exit code: **1** · 402.068 ms · at 2026-10-17T22:15:23.275Z

stdout (tail):
```
PASS sequential redelivery of same event fulfills once
FAIL 10 concurrent deliveries of same event fulfill exactly once: fulfillOrder called 10 times, expected 1; results=[{"ok":true,"action":"fulfilled"},{"ok":true,"action":"fulfilled"},{"ok":true,"action":"fulfilled"},{"ok":true,"action":"fulfilled"},{"ok":true,"action":"fulfilled"},{"ok":true,"action":"fulfilled"},{"ok":true,"action":"fulfilled"},{"ok":true,"action":"fulfilled"},{"ok":true,"action":"fulfilled"},{"ok":true,"action":"fulfilled"}] |  | 10 !== 1 | 
FAIL different event ids, same order, sequential: fulfill once: fulfillments=2, expected 1 (order-level idempotency) |  | 2 !== 1 | 
FAIL different event ids, same order, concurrent: fulfill once: fulfillOrder called 4 times, expected 1; results=[{"ok":true,"action":"fulfilled"},{"ok":true,"action":"fulfilled"},{"ok":true,"action":"fulfilled"},{"ok":true,"action":"fulfilled"}] |  | 4 !== 1 | 
PASS unknown event types are ignored and never fulfill
PASS ignored event does not block later real payment for same order
PASS two different orders concurrently are both fulfilled
FAIL three orders each delivered twice concurrently: one fulfillment each: successes=["order_m1","order_m1","order_m2","order_m2","order_m3","order_m3"] | + actual - expected |  |   [ |     'order_m1', | +   'order_m1', |     'order_m2', | +   'order_m2', |     'order_m3', | +   'order_m3' |   ] | 
PASS failed fulfillment is not recorded; retry of same event fulfills once
PASS failed fulfillment then retry under a new event id fulfills once
FAIL concurrent deliveries while first attempt fails: no fake ack, eventually exactly one fulfillment: multiple fulfilled claims: ["rejected",{"ok":true,"action":"fulfilled"},{"ok":true,"action":"fulfilled"},{"ok":true,"action":"fulfilled"}]
FAIL concurrent retries after a failure fulfill exactly once: successes=5, expected 1; results=[{"ok":true,"action":"fulfilled"},{"ok":true,"action":"fulfilled"},{"ok":true,"action":"fulfilled"},{"ok":true,"action":"fulfilled"},{"ok":true,"action":"fulfilled"}] |  | 5 !== 1 | 
PASS no unhandled promise rejections
SUMMARY 7 passed, 6 failed
```

### Frozen verifier vs baseline
Verdict: **FAIL** · process exit code **1** · 395 ms · handler sha256 `a0932076a37e182ee69129b65ba8976e8916939062b862154dbb2f3835e896f0`

| Case | Result | Scenario | Observed | Expected |
|---|---|---|---|---|
| V1 | **FAIL** | Same event delivered 20 times concurrently fulfills the order once | `{"fulfillments":20,"deliveries":20,"acknowledged":20}` | `{"fulfillments":1,"deliveries":20,"acknowledged":20}` |
| V2 | **FAIL** | Different event IDs for the same payment/order fulfill it once | `{"fulfillments":3,"deliveries":3,"acknowledged":3}` | `{"fulfillments":1,"deliveries":3,"acknowledged":3}` |
| V3 | PASS | Unknown event types are acknowledged and ignored | `{"fulfillments":0,"deliveries":2,"ignored":2}` | `{"fulfillments":0,"deliveries":2,"ignored":2}` |
| V4 | PASS | Two different orders are each fulfilled exactly once | `{"fulfillments":2,"perOrder":{"order_demo_004a":1,"order_demo_004b":1},"fulfilled":2}` | `{"fulfillments":2,"perOrder":{"order_demo_004a":1,"order_demo_004b":1},"fulfilled":2}` |
| V5 | PASS | Failed fulfillment is not marked complete; retry fulfills exactly once | `{"fulfillments":1,"firstDeliveryAcknowledged":false,"retryAcknowledged":true,"redeliveryAcknowledged":true}` | `{"fulfillments":1,"firstDeliveryAcknowledged":false,"retryAcknowledged":true,"redeliveryAcknowledged":true}` |
| V6 | PASS | Module exports handleWebhook and fulfills a valid event | `{"exportType":"function","result":{"ok":true,"action":"fulfilled"},"fulfillments":1}` | `{"exportType":"function","result":{"ok":true,"action":"fulfilled"},"fulfillments":1}` |

## Patch attempts
### Attempt 1 (`openrouter:anthropic/claude-sonnet-5.5`)
- Diagnosis: The handler only deduplicated on event.id, and only recorded the event after `await fulfillOrder` finished. Overlapping deliveries of the same event all passed the check before any of them recorded it. Events with different IDs for the same order never matched the cache at all. Both cases led to repeated fulfillment of one order.
- Change: Idempotency is now keyed on the order ID. A module-level Set holds orders whose fulfillment succeeded. A Map holds one in-flight fulfillment promise per order, and it is set synchronously before any await. Later deliveries for an order that is completed or in flight do not call fulfillOrder. In-flight waiters await the shared promise and return 'duplicate' once it succeeds. If it fails, they reject with the same error, so there is no fake acknowledgement. The order is added to the completed Set only after fulfillOrder succeeds, and the in-flight entry is always cleared afterwards, so a later retry fulfills exactly once.
- sha256: `f2cbd01890ab9c45877c352de4380f936ee79912e1c498be9077835e37590d00`
- Syntax check exit: 0
- Agent tests exit: 0
- Frozen verifier: exit 0, PASS

## Final independent verifier result
Ran in a fresh VM that contained only the final handler and the frozen verifier.
Verdict: **PASS** · process exit code **0** · 1046 ms · handler sha256 `f2cbd01890ab9c45877c352de4380f936ee79912e1c498be9077835e37590d00`

| Case | Result | Scenario | Observed | Expected |
|---|---|---|---|---|
| V1 | PASS | Same event delivered 20 times concurrently fulfills the order once | `{"fulfillments":1,"deliveries":20,"acknowledged":20}` | `{"fulfillments":1,"deliveries":20,"acknowledged":20}` |
| V2 | PASS | Different event IDs for the same payment/order fulfill it once | `{"fulfillments":1,"deliveries":3,"acknowledged":3}` | `{"fulfillments":1,"deliveries":3,"acknowledged":3}` |
| V3 | PASS | Unknown event types are acknowledged and ignored | `{"fulfillments":0,"deliveries":2,"ignored":2}` | `{"fulfillments":0,"deliveries":2,"ignored":2}` |
| V4 | PASS | Two different orders are each fulfilled exactly once | `{"fulfillments":2,"perOrder":{"order_demo_004a":1,"order_demo_004b":1},"fulfilled":2}` | `{"fulfillments":2,"perOrder":{"order_demo_004a":1,"order_demo_004b":1},"fulfilled":2}` |
| V5 | PASS | Failed fulfillment is not marked complete; retry fulfills exactly once | `{"fulfillments":1,"firstDeliveryAcknowledged":false,"retryAcknowledged":true,"redeliveryAcknowledged":true}` | `{"fulfillments":1,"firstDeliveryAcknowledged":false,"retryAcknowledged":true,"redeliveryAcknowledged":true}` |
| V6 | PASS | Module exports handleWebhook and fulfills a valid event | `{"exportType":"function","result":{"ok":true,"action":"fulfilled"},"fulfillments":1}` | `{"exportType":"function","result":{"ok":true,"action":"fulfilled"},"fulfillments":1}` |

- Command: `node /workspace/verification.mjs` in sandbox `sb-01m55yy…`
- Exit code: **0** · 1418.466 ms · at 2026-10-17T22:15:40.081Z

stdout (tail):
```
…[truncated 692 chars]
lled 1x; results: ok:fulfilled x1, ok:duplicate x2
PASS V3 Unknown event types are acknowledged and ignored
     observed fulfillments=0 deliveries=2 ignored=2
     expected fulfillments=0 deliveries=2 ignored=2
     customer.created -> resolved ok=true action=ignored; payment_intent.payment_failed -> resolved ok=true action=ignored; fulfillOrder calls: 0
PASS V4 Two different orders are each fulfilled exactly once
     observed fulfillments=2 perOrder={"order_demo_004a":1,"order_demo_004b":1} fulfilled=2
     expected fulfillments=2 perOrder={"order_demo_004a":1,"order_demo_004b":1} fulfilled=2
     order_demo_004a -> resolved ok=true action=fulfilled; order_demo_004b -> resolved ok=true action=fulfilled
PASS V5 Failed fulfillment is not marked complete; retry fulfills exactly once
     observed fulfillments=1 firstDeliveryAcknowledged=false retryAcknowledged=true redeliveryAcknowledged=true
     expected fulfillments=1 firstDeliveryAcknowledged=false retryAcknowledged=true redeliveryAcknowledged=true
     delivery 1 (fulfillOrder fails): rejected (Error: simulated transient failure in fulfillOrder) | retry: resolved ok=true action=fulfilled | redelivery: resolved ok=true action=duplicate; fulfillOrder calls=2, successes=1
PASS V6 Module exports handleWebhook and fulfills a valid event
     observed exportType=function result={"ok":true,"action":"fulfilled"} fulfillments=1
     expected exportType=function result={"ok":true,"action":"fulfilled"} fulfillments=1
     single valid delivery -> resolved ok=true action=fulfilled
RESULT PASS: 6/6 cases passed in 1046ms
{"schema":"runva.verdict.v1","pass":true,"cases":[{"id":"V1","title":"Same event delivered 20 times concurrently fulfills the order once","pass":true,"observed":{"fulfillments":1,"deliveries":20,"acknowledged":20},"expected":{"fulfillments":1,"deliveries":20,"acknowledged":20},"details":"20 overlapping deliveries of evt_demo_001 -> fulfillOrder(\"order_demo_001\") succeeded 1x; results: ok:fulfilled x1, ok:duplicate x19"},{"id":"V2","title":"Different event IDs for the same payment/order fulfill it once","pass":true,"observed":{"fulfillments":1,"deliveries":3,"acknowledged":3},"expected":{"fulfillments":1,"deliveries":3,"acknowledged":3},"details":"evt_demo_002_a + evt_demo_002_b (concurrent) then evt_demo_002_c, all for order_demo_002 -> fulfilled 1x; results: ok:fulfilled x1, ok:duplicate x2"},{"id":"V3","title":"Unknown event types are acknowledged and ignored","pass":true,"observed":{"fulfillments":0,"deliveries":2,"ignored":2},"expected":{"fulfillments":0,"deliveries":2,"ignored":2},"details":"customer.created -> resolved ok=true action=ignored; payment_intent.payment_failed -> resolved ok=true action=ignored; fulfillOrder calls: 0"},{"id":"V4","title":"Two different orders are each fulfilled exactly once","pass":true,"observed":{"fulfillments":2,"perOrder":{"order_demo_004a":1,"order_demo_004b":1},"fulfilled":2},"expected":{"fulfillments":2,"perOrder":{"order_demo_004a":1,"order_demo_004b":1},"fulfilled":2},"details":"order_demo_004a -> resolved ok=true action=fulfilled; order_demo_004b -> resolved ok=true action=fulfilled"},{"id":"V5","title":"Failed fulfillment is not marked complete; retry fulfills exactly once","pass":true,"observed":{"fulfillments":1,"firstDeliveryAcknowledged":false,"retryAcknowledged":true,"redeliveryAcknowledged":true},"expected":{"fulfillments":1,"firstDeliveryAcknowledged":false,"retryAcknowledged":true,"redeliveryAcknowledged":true},"details":"delivery 1 (fulfillOrder fails): rejected (Error: simulated transient failure in fulfillOrder) | retry: resolved ok=true action=fulfilled | redelivery: resolved ok=true action=duplicate; fulfillOrder calls=2, successes=1"},{"id":"V6","title":"Module exports handleWebhook and fulfills a valid event","pass":true,"observed":{"exportType":"function","result":{"ok":true,"action":"fulfilled"},"fulfillments":1},"expected":{"exportType":"function","result":{"ok":true,"action":"fulfilled"},"fulfillments":1},"details":"single valid delivery -> resolved ok=true action=fulfilled"}],"durationMs":1046}
```

## Code diff (baseline → final candidate)
```diff
===================================================================
--- a/handler.mjs	baseline
+++ b/handler.mjs	candidate 1
@@ -1,21 +1,43 @@
 // Payment webhook handler: fulfills an order when its payment succeeds.
+// Idempotency is at the ORDER level (business effect), not just the event id.
 
-// Stripe redelivers webhooks, so remember which events we've already handled.
-const processedEvents = new Set();
+// Orders whose fulfillment has succeeded.
+const completedOrders = new Set();
+// Orders currently being fulfilled: orderId -> shared in-flight promise.
+const inFlight = new Map();
 
 export async function handleWebhook(event, deps) {
   if (event.type !== "payment_intent.succeeded") {
     return { ok: true, action: "ignored" };
   }
 
-  if (processedEvents.has(event.id)) {
+  const orderId = event.data.object.metadata.order_id;
+
+  if (completedOrders.has(orderId)) {
     return { ok: true, action: "duplicate" };
   }
 
-  const orderId = event.data.object.metadata.order_id;
-  await deps.fulfillOrder(orderId);
+  const pending = inFlight.get(orderId);
+  if (pending) {
+    // Another delivery is fulfilling this order. Wait for its outcome; if it
+    // failed, this rejects too (no fake acknowledgement) and the sender retries.
+    await pending;
+    return { ok: true, action: "duplicate" };
+  }
 
-  // Only mark the event handled after fulfillment succeeds, so a failed attempt can be retried.
-  processedEvents.add(event.id);
+  // Register the in-flight work synchronously (before any await) so that
+  // overlapping deliveries cannot both reach fulfillOrder.
+  const work = Promise.resolve()
+    .then(() => deps.fulfillOrder(orderId))
+    .then(() => {
+      // Only record completion after fulfillment succeeded.
+      completedOrders.add(orderId);
+    })
+    .finally(() => {
+      inFlight.delete(orderId);
+    });
+  inFlight.set(orderId, work);
+
+  await work;
   return { ok: true, action: "fulfilled" };
 }
```

## Agent-generated test file (agent-tests.mjs)
Evidence only — the frozen verifier alone decides the verdict.
```js
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';

let counter = 0;
async function load() {
  counter++;
  const mod = await import(`./target/handler.mjs?t=${counter}_${Date.now()}`);
  return mod.handleWebhook;
}

function makeDeps(opts = {}) {
  const delay = opts.delay ?? 20;
  const remaining = { ...(opts.failFirst || {}) };
  const attempts = [];
  const successes = [];
  return {
    attempts,
    successes,
    fulfillOrder: async (orderId) => {
      attempts.push(orderId);
      await sleep(delay);
      if ((remaining[orderId] || 0) > 0) {
        remaining[orderId]--;
        throw new Error('transient failure');
      }
      successes.push(orderId);
    },
  };
}

function ev(id, orderId, type = 'payment_intent.succeeded') {
  return { id, type, data: { object: { id: 'pi_' + orderId, metadata: { order_id: orderId } } } };
}

async function settle(h, e, d) {
  try {
    const value = await h(e, d);
    return { rejected: false, value };
  } catch (err) {
    return { rejected: true, err };
  }
}

function isFailure(r) {
  return r.rejected || !r.value || r.value.ok === false;
}

function describe(results) {
  return JSON.stringify(results.map((r) => (r.rejected ? 'rejected' : r.value)));
}

const unhandled = [];
process.on('unhandledRejection', (reason) => {
  unhandled.push(String(reason));
});

const tests = [];
function test(name, fn) {
  tests.push([name, fn]);
}

test('sequential redelivery of same event fulfills once', async () => {
  const h = await load();
  const d = makeDeps();
  const e = ev('evt_seq1', 'order_seq1');
  const r1 = await settle(h, e, d);
  const r2 = await settle(h, e, d);
  const r3 = await settle(h, e, d);
  assert.equal(r1.rejected, false, 'first delivery rejected');
  assert.deepEqual(r1.value, { ok: true, action: 'fulfilled' });
  assert.deepEqual(r2.value, { ok: true, action: 'duplicate' });
  assert.deepEqual(r3.value, { ok: true, action: 'duplicate' });
  assert.equal(d.successes.length, 1, `fulfillments=${d.successes.length}, expected 1`);
});

test('10 concurrent deliveries of same event fulfill exactly once', async () => {
  const h = await load();
  const d = makeDeps();
  const e = ev('evt_conc1', 'order_conc1');
  const results = await Promise.all(Array.from({ length: 10 }, () => settle(h, e, d)));
  const fulfilled = results.filter((r) => !r.rejected && r.value.action === 'fulfilled').length;
  const dup = results.filter((r) => !r.rejected && r.value.ok === true && r.value.action === 'duplicate').length;
  assert.equal(d.attempts.length, 1, `fulfillOrder called ${d.attempts.length} times, expected 1; results=${describe(results)}`);
  assert.equal(d.successes.length, 1);
  assert.equal(fulfilled, 1, `fulfilled results=${fulfilled}, expected 1`);
  assert.equal(dup, 9, `duplicate results=${dup}, expected 9; results=${describe(results)}`);
});

test('different event ids, same order, sequential: fulfill once', async () => {
  const h = await load();
  const d = makeDeps();
  const r1 = await settle(h, ev('evt_diffseq_a', 'order_diffseq'), d);
  const r2 = await settle(h, ev('evt_diffseq_b', 'order_diffseq'), d);
  assert.deepEqual(r1.value, { ok: true, action: 'fulfilled' });
  assert.equal(d.successes.length, 1, `fulfillments=${d.successes.length}, expected 1 (order-level idempotency)`);
  assert.deepEqual(r2.value, { ok: true, action: 'duplicate' }, `second result=${describe([r2])}`);
});

test('different event ids, same order, concurrent: fulfill once', async () => {
  const h = await load();
  const d = makeDeps();
  const results = await Promise.all([
    settle(h, ev('evt_diffc_a', 'order_diffc'), d),
    settle(h, ev('evt_diffc_b', 'order_diffc'), d),
    settle(h, ev('evt_diffc_c', 'order_diffc'), d),
    settle(h, ev('evt_diffc_a', 'order_diffc'), d),
  ]);
  assert.equal(d.attempts.length, 1, `fulfillOrder called ${d.attempts.length} times, expected 1; results=${describe(results)}`);
  assert.equal(d.successes.length, 1);
  const fulfilled = results.filter((r) => !r.rejected && r.value.action === 'fulfilled').length;
  assert.equal(fulfilled, 1, `fulfilled results=${fulfilled}`);
  assert.ok(results.every((r) => !isFailure(r)), `some deliveries failed: ${describe(results)}`);
});

test('unknown event types are ignored and never fulfill', async () => {
  const h = await load();
  const d = makeDeps();
  const types = ['payment_intent.created', 'charge.refunded', 'payment_intent.payment_failed', 'foo'];
  const results = await Promise.all(types.map((t, i) => settle(h, ev('evt_ign_' + i, 'order_ign', t), d)));
  for (const r of results) {
    assert.equal(r.rejected, false, 'ignored event rejected');
    assert.deepEqual(r.value, { ok: true, action: 'ignored' });
  }
  assert.equal(d.attempts.length, 0, `fulfillOrder called ${d.attempts.length} times for ignored events`);
});

test('ignored event does not block later real payment for same order', async () => {
  const h = await load();
  const d = makeDeps();
  await settle(h, ev('evt_ignblock_a', 'order_ignblock', 'payment_intent.created'), d);
  const r = await settle(h, ev('evt_ignblock_b', 'order_ignblock'), d);
  assert.deepEqual(r.value, { ok: true, action: 'fulfilled' });
  assert.equal(d.successes.length, 1);
});

test('two different orders concurrently are both fulfilled', async () => {
  const h = await load();
  const d = makeDeps();
  const results = await Promise.all([
    settle(h, ev('evt_two_a', 'order_two_a'), d),
    settle(h, ev('evt_two_b', 'order_two_b'), d),
  ]);
  assert.ok(results.every((r) => !r.rejected && r.value.action === 'fulfilled'), `results=${describe(results)}`);
  assert.deepEqual([...d.successes].sort(), ['order_two_a', 'order_two_b']);
});

test('three orders each delivered twice concurrently: one fulfillment each', async () => {
  const h = await load();
  const d = makeDeps();
  const orders = ['order_m1', 'order_m2', 'order_m3'];
  const jobs = [];
  for (const o of orders) {
    jobs.push(settle(h, ev('evt_' + o + '_x', o), d));
    jobs.push(settle(h, ev('evt_' + o + '_y', o), d));
  }
  await Promise.all(jobs);
  assert.deepEqual([...d.successes].sort(), orders, `successes=${JSON.stringify(d.successes)}`);
  assert.equal(d.attempts.length, 3, `attempts=${d.attempts.length}, expected 3`);
});

test('failed fulfillment is not recorded; retry of same event fulfills once', async () => {
  const h = await load();
  const d = makeDeps({ failFirst: { order_fail1: 1 } });
  const e = ev('evt_fail1', 'order_fail1');
  const r1 = await settle(h, e, d);
  assert.ok(isFailure(r1), `failure was acknowledged as success: ${describe([r1])}`);
  assert.equal(d.successes.length, 0);
  const r2 = await settle(h, e, d);
  assert.equal(r2.rejected, false, 'retry rejected');
  assert.deepEqual(r2.value, { ok: true, action: 'fulfilled' }, `retry result=${describe([r2])}`);
  assert.equal(d.successes.length, 1, `successes=${d.successes.length}, expected 1`);
  const r3 = await settle(h, e, d);
  assert.deepEqual(r3.value, { ok: true, action: 'duplicate' });
  assert.equal(d.successes.length, 1);
});

test('failed fulfillment then retry under a new event id fulfills once', async () => {
  const h = await load();
  const d = makeDeps({ failFirst: { order_fail2: 1 } });
  const r1 = await settle(h, ev('evt_fail2_a', 'order_fail2'), d);
  assert.ok(isFailure(r1), `failure was acknowledged as success: ${describe([r1])}`);
  const r2 = await settle(h, ev('evt_fail2_b', 'order_fail2'), d);
  assert.deepEqual(r2.value, { ok: true, action: 'fulfilled' }, `retry result=${describe([r2])}`);
  assert.equal(d.successes.length, 1);
});

test('concurrent deliveries while first attempt fails: no fake ack, eventually exactly one fulfillment', async () => {
  const h = await load();
  const d = makeDeps({ failFirst: { order_fail3: 1 } });
  const results = await Promise.all([
    settle(h, ev('evt_fail3_a', 'order_fail3'), d),
    settle(h, ev('evt_fail3_b', 'order_fail3'), d),
    settle(h, ev('evt_fail3_c', 'order_fail3'), d),
    settle(h, ev('evt_fail3_a', 'order_fail3'), d),
  ]);
  const fulfilledClaims = results.filter((r) => !r.rejected && r.value.action === 'fulfilled' && r.value.ok).length;
  assert.ok(fulfilledClaims <= 1, `multiple fulfilled claims: ${describe(results)}`);
  if (d.successes.length === 0) {
    assert.ok(results.every(isFailure), `ok:true ack although nothing was fulfilled: ${describe(results)}`);
  }
  for (let i = 0; i < 3 && d.successes.length === 0; i++) {
    await settle(h, ev('evt_fail3_retry' + i, 'order_fail3'), d);
  }
  assert.equal(d.successes.length, 1, `successes=${d.successes.length}, expected exactly 1; attempts=${d.attempts.length}`);
  await settle(h, ev('evt_fail3_final', 'order_fail3'), d);
  assert.equal(d.successes.length, 1, 'extra fulfillment after completion');
});

test('concurrent retries after a failure fulfill exactly once', async () => {
  const h = await load();
  const d = makeDeps({ failFirst: { order_fail4: 1 } });
  const r1 = await settle(h, ev('evt_fail4_a', 'order_fail4'), d);
  assert.ok(isFailure(r1), `failure was acknowledged as success: ${describe([r1])}`);
  const results = await Promise.all(Array.from({ length: 5 }, (_, i) => settle(h, ev('evt_fail4_r' + (i % 2), 'order_fail4'), d)));
  assert.equal(d.successes.length, 1, `successes=${d.successes.length}, expected 1; results=${describe(results)}`);
  assert.equal(d.attempts.length, 2, `attempts=${d.attempts.length}, expected 2 (1 failed + 1 successful)`);
  assert.ok(results.every((r) => !isFailure(r)), `some retries failed: ${describe(results)}`);
});

let passed = 0;
let failed = 0;
for (const [name, fn] of tests) {
  try {
    await fn();
    console.log(`PASS ${name}`);
    passed++;
  } catch (err) {
    const msg = String(err && err.message ? err.message : err).split('\n').join(' | ');
    console.log(`FAIL ${name}: ${msg}`);
    failed++;
  }
}

await sleep(50);
if (unhandled.length > 0) {
  console.log(`FAIL no unhandled promise rejections: observed ${unhandled.length} (${unhandled.join('; ')}), expected 0`);
  failed++;
} else {
  console.log('PASS no unhandled promise rejections');
  passed++;
}

console.log(`SUMMARY ${passed} passed, ${failed} failed`);
process.exitCode = failed > 0 ? 1 : 0;
```

## Scope and limitations
- Verified for these synthetic conditions in this sandbox. Not a production guarantee.
- The fix may use in-memory state and in-flight coordination, which is valid only for this single-process fixture. Production durability requires a transactional/idempotent datastore; passing this fixture is not a guarantee across process crashes, restarts, or multiple service instances.
- Hashes identify the exact bytes that ran; they are not cryptographic proof of correct behavior. RUNVA claims only the observed assertions above — not formal verification or universal correctness.
- All model-generated code executed only inside CreateOS sandboxes; the RUNVA host never executed it.
