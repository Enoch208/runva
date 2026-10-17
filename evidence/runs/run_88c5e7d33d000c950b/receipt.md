# RUNVA verification receipt — VERIFIED

> Verified for these synthetic conditions in this sandbox. Not a production guarantee.

## Run
- Run ID: `run_88c5e7d33d000c950b`
- Started: 2026-10-17T22:16:24.910Z · Finished: 2026-10-17T22:17:16.705Z · Duration: 51.8 s
- Workflow: `webhook-idempotency` (synthetic Stripe-style events only; no live Stripe API calls)
- Safety contract: One paid order leads to exactly one fulfillment, even when the webhook is delivered more than once, concurrently, or under a different event ID; a failed fulfillment is never marked complete.
- Final status: **VERIFIED**

## Execution environment (CreateOS Sandbox)
- `sb-01m…2aha` — work VM (baseline + candidates) · shape `s-1vcpu-1gb` · region `eu` · created in 842 ms · destroyed
- `sb-01m…9zkh` — fresh independent-verifier VM · shape `s-1vcpu-1gb` · region `eu` · created in 334 ms · destroyed
- Egress allowlist: `registry.npmjs.org:443` · ingress disabled
- Egress proof: `curl -sS -m 4 https://example.com` exit 35 → blocked (as required)
- CreateOS credential supplied via env var `CREATEOS_SANDBOX_API_KEY` (value never logged)

## Hashes (reproducibility identifiers, not proof of correctness)
- Baseline handler.mjs: `a0932076a37e182ee69129b65ba8976e8916939062b862154dbb2f3835e896f0`
- Final candidate handler.mjs: `21364f4a958be68244ef912f9e2fd7a27a3bf8a60f1c4905d101e5d5f0a1bb36`
- Frozen verifier: `3222f1a24ac7179ee829b5b53ebe336f2ff23c9de39d8923850fae717d3791e1`
- Verifier sha256 measured inside the final VM: `3222f1a24ac7179ee829b5b53ebe336f2ff23c9de39d8923850fae717d3791e1` → matches
- Agent tests agent-tests.mjs: `525399be76c131a57258c96d3d4ca787cbe64cfc3309c473eae3c063d38bf267`

## Model
- Model: `openrouter:anthropic/claude-sonnet-5.5` (key never logged)
- Patch attempts: 1 (1 initial + up to 2 repairs, each conditioned on real sandbox output)
- Test-generation summary: Tests that the webhook handler fulfills each paid order exactly once. They cover sequential and concurrent redelivery of the same event, different event IDs for the same order (sequential and concurrent), ignored event types, independent orders, and a failed fulfillment that must not be recorded and must succeed exactly once on retry. They target the event-id-only cache and the check-then-await-then-record race in the original handler.

## Baseline (vulnerable handler)
### Agent-generated tests vs baseline
- Command: `node /workspace/agent-tests.mjs` in sandbox `sb-01m…2aha`
- Exit code: **1** · 244.818 ms · at 2026-10-17T22:16:50.950Z

stdout (tail):
```
PASS sequential redelivery of same event fulfills once
FAIL concurrent delivery of same event x6 fulfills once: fulfill attempts 6, expected 1 (results true:fulfilled,true:fulfilled,true:fulfilled,true:fulfilled,true:fulfilled,true:fulfilled)
FAIL different event ids, same order, sequential: fulfills once: Expected values to be strictly deep-equal:
FAIL different event ids, same order, concurrent: fulfills once: fulfill attempts 3, expected 1 (results true:fulfilled,true:fulfilled,true:fulfilled)
PASS unknown event type is ignored and never fulfills
FAIL two different orders concurrently are each fulfilled once: ord_two_a fulfilled 2x
FAIL failed fulfillment is not recorded; retry fulfills exactly once: post-success redelivery {"ok":true,"action":"fulfilled"}
2/7 passed, 5 failed
```

### Frozen verifier vs baseline
Verdict: **FAIL** · process exit code **1** · 379 ms · handler sha256 `a0932076a37e182ee69129b65ba8976e8916939062b862154dbb2f3835e896f0`

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
- Diagnosis: The handler only deduplicated on event.id, and only recorded the event after `await fulfillOrder`. Overlapping deliveries all passed the check before any of them recorded, so each one fulfilled. Events with different IDs for the same order were never deduplicated. Each delivery fulfilled the order again, including redeliveries after success.
- Change: Idempotency is now keyed on order_id instead of event.id. A `fulfilledOrders` set records only orders whose fulfillment has succeeded. An `inFlight` map holds one shared promise per order, so concurrent deliveries wait on a single fulfillOrder call and the others report 'duplicate'. If fulfillOrder throws, the order is not recorded and the in-flight entry is cleared. The error propagates to the owner and to any waiters, so a later retry can fulfill exactly once. A missing order_id throws instead of being acknowledged.
- sha256: `21364f4a958be68244ef912f9e2fd7a27a3bf8a60f1c4905d101e5d5f0a1bb36`
- Syntax check exit: 0
- Agent tests exit: 0
- Frozen verifier: exit 0, PASS

## Final independent verifier result
Ran in a fresh VM that contained only the final handler and the frozen verifier.
Verdict: **PASS** · process exit code **0** · 1010 ms · handler sha256 `21364f4a958be68244ef912f9e2fd7a27a3bf8a60f1c4905d101e5d5f0a1bb36`

| Case | Result | Scenario | Observed | Expected |
|---|---|---|---|---|
| V1 | PASS | Same event delivered 20 times concurrently fulfills the order once | `{"fulfillments":1,"deliveries":20,"acknowledged":20}` | `{"fulfillments":1,"deliveries":20,"acknowledged":20}` |
| V2 | PASS | Different event IDs for the same payment/order fulfill it once | `{"fulfillments":1,"deliveries":3,"acknowledged":3}` | `{"fulfillments":1,"deliveries":3,"acknowledged":3}` |
| V3 | PASS | Unknown event types are acknowledged and ignored | `{"fulfillments":0,"deliveries":2,"ignored":2}` | `{"fulfillments":0,"deliveries":2,"ignored":2}` |
| V4 | PASS | Two different orders are each fulfilled exactly once | `{"fulfillments":2,"perOrder":{"order_demo_004a":1,"order_demo_004b":1},"fulfilled":2}` | `{"fulfillments":2,"perOrder":{"order_demo_004a":1,"order_demo_004b":1},"fulfilled":2}` |
| V5 | PASS | Failed fulfillment is not marked complete; retry fulfills exactly once | `{"fulfillments":1,"firstDeliveryAcknowledged":false,"retryAcknowledged":true,"redeliveryAcknowledged":true}` | `{"fulfillments":1,"firstDeliveryAcknowledged":false,"retryAcknowledged":true,"redeliveryAcknowledged":true}` |
| V6 | PASS | Module exports handleWebhook and fulfills a valid event | `{"exportType":"function","result":{"ok":true,"action":"fulfilled"},"fulfillments":1}` | `{"exportType":"function","result":{"ok":true,"action":"fulfilled"},"fulfillments":1}` |

- Command: `node /workspace/verification.mjs` in sandbox `sb-01m…9zkh`
- Exit code: **0** · 1377.013 ms · at 2026-10-17T22:17:14.927Z

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
RESULT PASS: 6/6 cases passed in 1010ms
{"schema":"runva.verdict.v1","pass":true,"cases":[{"id":"V1","title":"Same event delivered 20 times concurrently fulfills the order once","pass":true,"observed":{"fulfillments":1,"deliveries":20,"acknowledged":20},"expected":{"fulfillments":1,"deliveries":20,"acknowledged":20},"details":"20 overlapping deliveries of evt_demo_001 -> fulfillOrder(\"order_demo_001\") succeeded 1x; results: ok:fulfilled x1, ok:duplicate x19"},{"id":"V2","title":"Different event IDs for the same payment/order fulfill it once","pass":true,"observed":{"fulfillments":1,"deliveries":3,"acknowledged":3},"expected":{"fulfillments":1,"deliveries":3,"acknowledged":3},"details":"evt_demo_002_a + evt_demo_002_b (concurrent) then evt_demo_002_c, all for order_demo_002 -> fulfilled 1x; results: ok:fulfilled x1, ok:duplicate x2"},{"id":"V3","title":"Unknown event types are acknowledged and ignored","pass":true,"observed":{"fulfillments":0,"deliveries":2,"ignored":2},"expected":{"fulfillments":0,"deliveries":2,"ignored":2},"details":"customer.created -> resolved ok=true action=ignored; payment_intent.payment_failed -> resolved ok=true action=ignored; fulfillOrder calls: 0"},{"id":"V4","title":"Two different orders are each fulfilled exactly once","pass":true,"observed":{"fulfillments":2,"perOrder":{"order_demo_004a":1,"order_demo_004b":1},"fulfilled":2},"expected":{"fulfillments":2,"perOrder":{"order_demo_004a":1,"order_demo_004b":1},"fulfilled":2},"details":"order_demo_004a -> resolved ok=true action=fulfilled; order_demo_004b -> resolved ok=true action=fulfilled"},{"id":"V5","title":"Failed fulfillment is not marked complete; retry fulfills exactly once","pass":true,"observed":{"fulfillments":1,"firstDeliveryAcknowledged":false,"retryAcknowledged":true,"redeliveryAcknowledged":true},"expected":{"fulfillments":1,"firstDeliveryAcknowledged":false,"retryAcknowledged":true,"redeliveryAcknowledged":true},"details":"delivery 1 (fulfillOrder fails): rejected (Error: simulated transient failure in fulfillOrder) | retry: resolved ok=true action=fulfilled | redelivery: resolved ok=true action=duplicate; fulfillOrder calls=2, successes=1"},{"id":"V6","title":"Module exports handleWebhook and fulfills a valid event","pass":true,"observed":{"exportType":"function","result":{"ok":true,"action":"fulfilled"},"fulfillments":1},"expected":{"exportType":"function","result":{"ok":true,"action":"fulfilled"},"fulfillments":1},"details":"single valid delivery -> resolved ok=true action=fulfilled"}],"durationMs":1010}
```

## Code diff (baseline → final candidate)
```diff
===================================================================
--- a/handler.mjs	baseline
+++ b/handler.mjs	candidate 1
@@ -1,21 +1,44 @@
 // Payment webhook handler: fulfills an order when its payment succeeds.
+// Idempotency is at the ORDER level (not the event id): one paid order -> one fulfillment.
 
-// Stripe redelivers webhooks, so remember which events we've already handled.
-const processedEvents = new Set();
+// Orders whose fulfillment has completed successfully.
+const fulfilledOrders = new Set();
+// Orders currently being fulfilled: orderId -> shared in-flight promise.
+const inFlight = new Map();
 
 export async function handleWebhook(event, deps) {
   if (event.type !== "payment_intent.succeeded") {
     return { ok: true, action: "ignored" };
   }
 
-  if (processedEvents.has(event.id)) {
+  const orderId = event?.data?.object?.metadata?.order_id;
+  if (typeof orderId !== "string" || orderId === "") {
+    throw new Error("payment_intent.succeeded event is missing metadata.order_id");
+  }
+
+  if (fulfilledOrders.has(orderId)) {
     return { ok: true, action: "duplicate" };
   }
 
-  const orderId = event.data.object.metadata.order_id;
-  await deps.fulfillOrder(orderId);
+  // Another delivery is already fulfilling this order: wait for it, don't repeat it.
+  const pending = inFlight.get(orderId);
+  if (pending) {
+    await pending; // rethrows if the in-flight fulfillment failed
+    return { ok: true, action: "duplicate" };
+  }
 
-  // Only mark the event handled after fulfillment succeeds, so a failed attempt can be retried.
-  processedEvents.add(event.id);
+  // We own the fulfillment. Register the in-flight promise synchronously (before any await).
+  const work = (async () => {
+    await deps.fulfillOrder(orderId);
+    // Record completion only after fulfillment succeeded.
+    fulfilledOrders.add(orderId);
+  })();
+  inFlight.set(orderId, work);
+
+  try {
+    await work;
+  } finally {
+    inFlight.delete(orderId);
+  }
   return { ok: true, action: "fulfilled" };
 }
```

## Agent-generated test file (agent-tests.mjs)
Evidence only — the frozen verifier alone decides the verdict.
```js
// Adversarial tests for payment webhook idempotency
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';

let n = 0;
async function load() {
  const m = await import(`./target/handler.mjs?t=${++n}_${Date.now()}`);
  return m.handleWebhook;
}

function makeDeps(opts = {}) {
  const failFirst = new Set(opts.failFirst || []);
  const d = { attempts: [], successes: [] };
  d.fulfillOrder = async (orderId) => {
    d.attempts.push(orderId);
    await sleep(opts.delay ?? 20);
    if (failFirst.has(orderId)) {
      failFirst.delete(orderId);
      throw new Error('transient failure');
    }
    d.successes.push(orderId);
  };
  return d;
}

function evt(id, orderId, type = 'payment_intent.succeeded') {
  return { id, type, data: { object: { id: 'pi_' + orderId, metadata: { order_id: orderId } } } };
}

async function call(h, e, deps) {
  try {
    return await h(e, deps);
  } catch (err) {
    return { ok: false, action: undefined, threw: true, error: err };
  }
}

const count = (arr, v) => arr.filter((x) => x === v).length;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test('sequential redelivery of same event fulfills once', async () => {
  const h = await load();
  const deps = makeDeps();
  const e = evt('evt_seq_1', 'ord_seq_1');
  const r1 = await call(h, e, deps);
  const r2 = await call(h, e, deps);
  assert.deepEqual(r1, { ok: true, action: 'fulfilled' });
  assert.deepEqual(r2, { ok: true, action: 'duplicate' });
  assert.equal(deps.successes.length, 1, `fulfill count ${deps.successes.length}, expected 1`);
});

test('concurrent delivery of same event x6 fulfills once', async () => {
  const h = await load();
  const deps = makeDeps();
  const e = evt('evt_conc_1', 'ord_conc_1');
  const rs = await Promise.all(Array.from({ length: 6 }, () => call(h, e, deps)));
  const actions = rs.map((r) => `${r.ok}:${r.action}`);
  assert.equal(deps.attempts.length, 1, `fulfill attempts ${deps.attempts.length}, expected 1 (results ${actions})`);
  assert.ok(rs.every((r) => r.ok === true), `all acks should be ok:true, got ${actions}`);
  assert.equal(rs.filter((r) => r.action === 'fulfilled').length, 1, `fulfilled actions: ${actions}`);
  assert.equal(rs.filter((r) => r.action === 'duplicate').length, 5, `duplicate actions: ${actions}`);
});

test('different event ids, same order, sequential: fulfills once', async () => {
  const h = await load();
  const deps = makeDeps();
  const r1 = await call(h, evt('evt_diff_a', 'ord_diff_1'), deps);
  const r2 = await call(h, evt('evt_diff_b', 'ord_diff_1'), deps);
  assert.equal(r1.action, 'fulfilled');
  assert.deepEqual(r2, { ok: true, action: 'duplicate' });
  assert.equal(deps.successes.length, 1, `fulfill count ${deps.successes.length}, expected 1`);
});

test('different event ids, same order, concurrent: fulfills once', async () => {
  const h = await load();
  const deps = makeDeps();
  const rs = await Promise.all([
    call(h, evt('evt_dc_a', 'ord_dc_1'), deps),
    call(h, evt('evt_dc_b', 'ord_dc_1'), deps),
    call(h, evt('evt_dc_c', 'ord_dc_1'), deps),
  ]);
  const actions = rs.map((r) => `${r.ok}:${r.action}`);
  assert.equal(deps.attempts.length, 1, `fulfill attempts ${deps.attempts.length}, expected 1 (results ${actions})`);
  assert.ok(rs.every((r) => r.ok === true), `all acks should be ok:true, got ${actions}`);
});

test('unknown event type is ignored and never fulfills', async () => {
  const h = await load();
  const deps = makeDeps();
  const r = await call(h, evt('evt_unk_1', 'ord_unk_1', 'charge.refunded'), deps);
  assert.deepEqual(r, { ok: true, action: 'ignored' });
  assert.equal(deps.attempts.length, 0, `fulfill attempts ${deps.attempts.length}, expected 0`);
  const r2 = await call(h, evt('evt_unk_2', 'ord_unk_1'), deps);
  assert.equal(r2.action, 'fulfilled', `later real event for same order should fulfill, got ${r2.action}`);
  assert.equal(deps.successes.length, 1);
});

test('two different orders concurrently are each fulfilled once', async () => {
  const h = await load();
  const deps = makeDeps();
  const rs = await Promise.all([
    call(h, evt('evt_two_a', 'ord_two_a'), deps),
    call(h, evt('evt_two_b', 'ord_two_b'), deps),
    call(h, evt('evt_two_a', 'ord_two_a'), deps),
  ]);
  assert.equal(count(deps.successes, 'ord_two_a'), 1, `ord_two_a fulfilled ${count(deps.successes, 'ord_two_a')}x`);
  assert.equal(count(deps.successes, 'ord_two_b'), 1, `ord_two_b fulfilled ${count(deps.successes, 'ord_two_b')}x`);
  assert.ok(rs.every((r) => r.ok === true));
});

test('failed fulfillment is not recorded; retry fulfills exactly once', async () => {
  const h = await load();
  const deps = makeDeps({ failFirst: ['ord_fail_1'] });
  const e = evt('evt_fail_1', 'ord_fail_1');
  const r1 = await call(h, e, deps);
  assert.ok(r1.threw || r1.ok === false, `failure must surface, got ${JSON.stringify(r1)}`);
  assert.notEqual(r1.action, 'fulfilled');
  const r2 = await call(h, e, deps);
  assert.deepEqual(r2, { ok: true, action: 'fulfilled' }, `retry result ${JSON.stringify(r2)}`);
  const r3 = await call(h, evt('evt_fail_1b', 'ord_fail_1'), deps);
  assert.deepEqual(r3, { ok: true, action: 'duplicate' }, `post-success redelivery ${JSON.stringify(r3)}`);
  assert.equal(deps.successes.length, 1, `successful fulfillments ${deps.successes.length}, expected 1`);
  assert.equal(deps.attempts.length, 2, `attempts ${deps.attempts.length}, expected 2`);
});

let failed = 0;
for (const [name, fn] of tests) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (err) {
    failed++;
    console.log(`FAIL ${name}: ${String(err && err.message).split('\n')[0]}`);
  }
}
console.log(`${tests.length - failed}/${tests.length} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
```

## Scope and limitations
- Verified for these synthetic conditions in this sandbox. Not a production guarantee.
- The fix may use in-memory state and in-flight coordination, which is valid only for this single-process fixture. Production durability requires a transactional/idempotent datastore; passing this fixture is not a guarantee across process crashes, restarts, or multiple service instances.
- Hashes identify the exact bytes that ran; they are not cryptographic proof of correct behavior. RUNVA claims only the observed assertions above — not formal verification or universal correctness.
- All model-generated code executed only inside CreateOS sandboxes; the RUNVA host never executed it.
