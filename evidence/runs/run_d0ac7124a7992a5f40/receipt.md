# RUNVA verification receipt — VERIFIED

> Verified for these synthetic conditions in this sandbox. Not a production guarantee.

## Run
- Run ID: `run_d0ac7124a7992a5f40`
- Started: 2026-10-17T22:17:31.715Z · Finished: 2026-10-17T22:18:17.838Z · Duration: 46.1 s
- Workflow: `webhook-idempotency` (synthetic Stripe-style events only; no live Stripe API calls)
- Safety contract: One paid order leads to exactly one fulfillment, even when the webhook is delivered more than once, concurrently, or under a different event ID; a failed fulfillment is never marked complete.
- Final status: **VERIFIED**

## Execution environment (CreateOS Sandbox)
- `sb-01m…wme1` — work VM (baseline + candidates) · shape `s-1vcpu-1gb` · region `eu` · created in 321 ms · destroyed
- `sb-01m…yy8z` — fresh independent-verifier VM · shape `s-1vcpu-1gb` · region `eu` · created in 367 ms · destroyed
- Egress allowlist: `registry.npmjs.org:443` · ingress disabled
- Egress proof: `curl -sS -m 4 https://example.com` exit 35 → blocked (as required)
- CreateOS credential supplied via env var `CREATEOS_SANDBOX_API_KEY` (value never logged)

## Hashes (reproducibility identifiers, not proof of correctness)
- Baseline handler.mjs: `a0932076a37e182ee69129b65ba8976e8916939062b862154dbb2f3835e896f0`
- Final candidate handler.mjs: `c6b0b603b7c912bbe7f4783c28f3a101a8abdefc64701cabf9dbc65b96bd7c41`
- Frozen verifier: `3222f1a24ac7179ee829b5b53ebe336f2ff23c9de39d8923850fae717d3791e1`
- Verifier sha256 measured inside the final VM: `3222f1a24ac7179ee829b5b53ebe336f2ff23c9de39d8923850fae717d3791e1` → matches
- Agent tests agent-tests.mjs: `486d4f8f73ad6288b10695f18519e1d8a8ad5af3c1629b71d2b7ffbcc58cd7a3`

## Model
- Model: `openrouter:anthropic/claude-sonnet-5.5` (key never logged)
- Patch attempts: 1 (1 initial + up to 2 repairs, each conditioned on real sandbox output)
- Test-generation summary: Probes whether the handler fulfills each paid order exactly once. It tests sequential and concurrent redelivery of the same event, different event IDs for the same order (sequential and concurrent), unknown event types, independent orders, and a failed fulfillment followed by retries. A handler keyed only on event.id, or one with a check-then-await-then-record race, should fail these.

## Baseline (vulnerable handler)
### Agent-generated tests vs baseline
- Command: `node /workspace/agent-tests.mjs` in sandbox `sb-01m…wme1`
- Exit code: **1** · 297.938 ms · at 2026-10-17T22:17:57.844Z

stdout (tail):
```
PASS sequential redelivery of same event is duplicate
FAIL concurrent delivery of same event fulfills once: fulfill calls=5 expected 1 5 !== 1 
FAIL different event ids, same order, sequential: Expected values to be strictly deep-equal: + actual - expected { + action: 'fulfilled', - action: 'duplicate', ok: true } 
FAIL different event ids, same order, concurrent: fulfill calls=3 expected 1 3 !== 1 
PASS unknown event type is ignored and never fulfills
PASS two different orders are each fulfilled once
FAIL failed fulfillment is not recorded; retry fulfills exactly once: third={"v":{"ok":true,"action":"fulfilled"}} expected duplicate
3/7 passed, 4 failed
```

### Frozen verifier vs baseline
Verdict: **FAIL** · process exit code **1** · 993 ms · handler sha256 `a0932076a37e182ee69129b65ba8976e8916939062b862154dbb2f3835e896f0`

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
- Diagnosis: The handler only deduplicated on event.id, and only recorded the event after `await deps.fulfillOrder` finished. Overlapping deliveries of the same event all passed the check before any of them recorded it, so all of them fulfilled. Different event IDs for the same order never matched the event-id cache, so each one fulfilled again.
- Change: Idempotency is now keyed on the order ID. A module-level `fulfilledOrders` Set holds completed orders. An `inFlight` Map holds one shared promise per order currently being fulfilled. A delivery for an order that is already fulfilled returns `duplicate`. A delivery for an order that is in flight awaits the same promise, so `fulfillOrder` is called once, and then returns `duplicate`. An order is added to `fulfilledOrders` only after `fulfillOrder` succeeds. The in-flight entry is always cleared when the attempt settles. If fulfillment fails, the error propagates to the owner and to any overlapping waiters. Nothing is recorded as complete, so a later retry can fulfill exactly once. The promise is created through `Promise.resolve().then(...)`, so a synchronous throw from `fulfillOrder` becomes a rejection and the in-flight entry is registered before cleanup runs. Unknown event types are still ignored.
- sha256: `c6b0b603b7c912bbe7f4783c28f3a101a8abdefc64701cabf9dbc65b96bd7c41`
- Syntax check exit: 0
- Agent tests exit: 0
- Frozen verifier: exit 0, PASS

## Final independent verifier result
Ran in a fresh VM that contained only the final handler and the frozen verifier.
Verdict: **PASS** · process exit code **0** · 383 ms · handler sha256 `c6b0b603b7c912bbe7f4783c28f3a101a8abdefc64701cabf9dbc65b96bd7c41`

| Case | Result | Scenario | Observed | Expected |
|---|---|---|---|---|
| V1 | PASS | Same event delivered 20 times concurrently fulfills the order once | `{"fulfillments":1,"deliveries":20,"acknowledged":20}` | `{"fulfillments":1,"deliveries":20,"acknowledged":20}` |
| V2 | PASS | Different event IDs for the same payment/order fulfill it once | `{"fulfillments":1,"deliveries":3,"acknowledged":3}` | `{"fulfillments":1,"deliveries":3,"acknowledged":3}` |
| V3 | PASS | Unknown event types are acknowledged and ignored | `{"fulfillments":0,"deliveries":2,"ignored":2}` | `{"fulfillments":0,"deliveries":2,"ignored":2}` |
| V4 | PASS | Two different orders are each fulfilled exactly once | `{"fulfillments":2,"perOrder":{"order_demo_004a":1,"order_demo_004b":1},"fulfilled":2}` | `{"fulfillments":2,"perOrder":{"order_demo_004a":1,"order_demo_004b":1},"fulfilled":2}` |
| V5 | PASS | Failed fulfillment is not marked complete; retry fulfills exactly once | `{"fulfillments":1,"firstDeliveryAcknowledged":false,"retryAcknowledged":true,"redeliveryAcknowledged":true}` | `{"fulfillments":1,"firstDeliveryAcknowledged":false,"retryAcknowledged":true,"redeliveryAcknowledged":true}` |
| V6 | PASS | Module exports handleWebhook and fulfills a valid event | `{"exportType":"function","result":{"ok":true,"action":"fulfilled"},"fulfillments":1}` | `{"exportType":"function","result":{"ok":true,"action":"fulfilled"},"fulfillments":1}` |

- Command: `node /workspace/verification.mjs` in sandbox `sb-01m…yy8z`
- Exit code: **0** · 566.026 ms · at 2026-10-17T22:18:16.861Z

stdout (tail):
```
…[truncated 690 chars]
filled 1x; results: ok:fulfilled x1, ok:duplicate x2
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
RESULT PASS: 6/6 cases passed in 383ms
{"schema":"runva.verdict.v1","pass":true,"cases":[{"id":"V1","title":"Same event delivered 20 times concurrently fulfills the order once","pass":true,"observed":{"fulfillments":1,"deliveries":20,"acknowledged":20},"expected":{"fulfillments":1,"deliveries":20,"acknowledged":20},"details":"20 overlapping deliveries of evt_demo_001 -> fulfillOrder(\"order_demo_001\") succeeded 1x; results: ok:fulfilled x1, ok:duplicate x19"},{"id":"V2","title":"Different event IDs for the same payment/order fulfill it once","pass":true,"observed":{"fulfillments":1,"deliveries":3,"acknowledged":3},"expected":{"fulfillments":1,"deliveries":3,"acknowledged":3},"details":"evt_demo_002_a + evt_demo_002_b (concurrent) then evt_demo_002_c, all for order_demo_002 -> fulfilled 1x; results: ok:fulfilled x1, ok:duplicate x2"},{"id":"V3","title":"Unknown event types are acknowledged and ignored","pass":true,"observed":{"fulfillments":0,"deliveries":2,"ignored":2},"expected":{"fulfillments":0,"deliveries":2,"ignored":2},"details":"customer.created -> resolved ok=true action=ignored; payment_intent.payment_failed -> resolved ok=true action=ignored; fulfillOrder calls: 0"},{"id":"V4","title":"Two different orders are each fulfilled exactly once","pass":true,"observed":{"fulfillments":2,"perOrder":{"order_demo_004a":1,"order_demo_004b":1},"fulfilled":2},"expected":{"fulfillments":2,"perOrder":{"order_demo_004a":1,"order_demo_004b":1},"fulfilled":2},"details":"order_demo_004a -> resolved ok=true action=fulfilled; order_demo_004b -> resolved ok=true action=fulfilled"},{"id":"V5","title":"Failed fulfillment is not marked complete; retry fulfills exactly once","pass":true,"observed":{"fulfillments":1,"firstDeliveryAcknowledged":false,"retryAcknowledged":true,"redeliveryAcknowledged":true},"expected":{"fulfillments":1,"firstDeliveryAcknowledged":false,"retryAcknowledged":true,"redeliveryAcknowledged":true},"details":"delivery 1 (fulfillOrder fails): rejected (Error: simulated transient failure in fulfillOrder) | retry: resolved ok=true action=fulfilled | redelivery: resolved ok=true action=duplicate; fulfillOrder calls=2, successes=1"},{"id":"V6","title":"Module exports handleWebhook and fulfills a valid event","pass":true,"observed":{"exportType":"function","result":{"ok":true,"action":"fulfilled"},"fulfillments":1},"expected":{"exportType":"function","result":{"ok":true,"action":"fulfilled"},"fulfillments":1},"details":"single valid delivery -> resolved ok=true action=fulfilled"}],"durationMs":383}
```

## Code diff (baseline → final candidate)
```diff
===================================================================
--- a/handler.mjs	baseline
+++ b/handler.mjs	candidate 1
@@ -1,21 +1,41 @@
 // Payment webhook handler: fulfills an order when its payment succeeds.
+// Idempotency is at the ORDER level (business effect), not just the event id.
 
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
+  const orderId = event.data.object.metadata.order_id;
+
+  if (fulfilledOrders.has(orderId)) {
     return { ok: true, action: "duplicate" };
   }
 
-  const orderId = event.data.object.metadata.order_id;
-  await deps.fulfillOrder(orderId);
+  const pending = inFlight.get(orderId);
+  if (pending) {
+    // Another delivery is fulfilling this order right now; wait for its outcome.
+    // If it fails, this rejects too (the error is not swallowed).
+    await pending;
+    return { ok: true, action: "duplicate" };
+  }
 
-  // Only mark the event handled after fulfillment succeeds, so a failed attempt can be retried.
-  processedEvents.add(event.id);
+  const attempt = Promise.resolve()
+    .then(() => deps.fulfillOrder(orderId))
+    .then(() => {
+      // Record completion only after fulfillment succeeded.
+      fulfilledOrders.add(orderId);
+    })
+    .finally(() => {
+      inFlight.delete(orderId);
+    });
+  inFlight.set(orderId, attempt);
+
+  await attempt;
   return { ok: true, action: "fulfilled" };
 }
```

## Agent-generated test file (agent-tests.mjs)
Evidence only — the frozen verifier alone decides the verdict.
```js
// Adversarial tests: payment webhook exactly-once fulfillment
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';

let n = 0;
async function load() {
  return (await import(`./target/handler.mjs?t=${++n}`)).handleWebhook;
}
function mkDeps(failOnce = []) {
  const calls = [];
  const pending = new Set(failOnce);
  return {
    calls,
    fulfillOrder: async (id) => {
      calls.push(id);
      await sleep(20);
      if (pending.has(id)) {
        pending.delete(id);
        throw new Error('transient failure');
      }
    },
  };
}
const ev = (id, order, type = 'payment_intent.succeeded') => ({
  id,
  type,
  data: { object: { id: 'pi_' + id, metadata: { order_id: order } } },
});
const settle = (p) => p.then((v) => ({ v }), (err) => ({ err }));
const count = (calls, o) => calls.filter((c) => c === o).length;
const show = (x) => JSON.stringify(x, (k, v) => (v instanceof Error ? 'Error:' + v.message : v));

const tests = [
  ['sequential redelivery of same event is duplicate', async () => {
    const h = await load();
    const d = mkDeps();
    const r1 = await h(ev('e_seq', 'o_seq'), d);
    const r2 = await h(ev('e_seq', 'o_seq'), d);
    assert.deepEqual(r1, { ok: true, action: 'fulfilled' });
    assert.deepEqual(r2, { ok: true, action: 'duplicate' });
    assert.equal(count(d.calls, 'o_seq'), 1, `fulfill calls=${count(d.calls, 'o_seq')} expected 1`);
  }],
  ['concurrent delivery of same event fulfills once', async () => {
    const h = await load();
    const d = mkDeps();
    const rs = await Promise.all(Array.from({ length: 5 }, () => settle(h(ev('e_conc', 'o_conc'), d))));
    assert.ok(rs.every((r) => r.v && r.v.ok === true), `results=${show(rs)} expected all ok:true`);
    assert.equal(count(d.calls, 'o_conc'), 1, `fulfill calls=${count(d.calls, 'o_conc')} expected 1`);
    const f = rs.filter((r) => r.v.action === 'fulfilled').length;
    const dup = rs.filter((r) => r.v.action === 'duplicate').length;
    assert.ok(f === 1 && dup === 4, `fulfilled=${f} duplicate=${dup} expected 1 and 4`);
  }],
  ['different event ids, same order, sequential', async () => {
    const h = await load();
    const d = mkDeps();
    const r1 = await h(ev('e_a1', 'o_same'), d);
    const r2 = await h(ev('e_a2', 'o_same'), d);
    assert.equal(r1.action, 'fulfilled');
    assert.deepEqual(r2, { ok: true, action: 'duplicate' });
    assert.equal(count(d.calls, 'o_same'), 1, `fulfill calls=${count(d.calls, 'o_same')} expected 1`);
  }],
  ['different event ids, same order, concurrent', async () => {
    const h = await load();
    const d = mkDeps();
    const rs = await Promise.all(['e_b1', 'e_b2', 'e_b3'].map((id) => settle(h(ev(id, 'o_cc'), d))));
    assert.ok(rs.every((r) => r.v && r.v.ok === true), `results=${show(rs)} expected all ok:true`);
    assert.equal(count(d.calls, 'o_cc'), 1, `fulfill calls=${count(d.calls, 'o_cc')} expected 1`);
    const f = rs.filter((r) => r.v.action === 'fulfilled').length;
    assert.equal(f, 1, `fulfilled results=${f} expected 1`);
  }],
  ['unknown event type is ignored and never fulfills', async () => {
    const h = await load();
    const d = mkDeps();
    const r = await h(ev('e_unk', 'o_unk', 'charge.refunded'), d);
    assert.deepEqual(r, { ok: true, action: 'ignored' });
    assert.equal(d.calls.length, 0, `fulfill calls=${d.calls.length} expected 0`);
  }],
  ['two different orders are each fulfilled once', async () => {
    const h = await load();
    const d = mkDeps();
    const rs = await Promise.all([
      settle(h(ev('e_x1', 'o_x1'), d)),
      settle(h(ev('e_x2', 'o_x2'), d)),
    ]);
    assert.ok(rs.every((r) => r.v && r.v.ok && r.v.action === 'fulfilled'), `results=${show(rs)} expected both fulfilled`);
    assert.equal(count(d.calls, 'o_x1'), 1, 'o_x1 not fulfilled exactly once');
    assert.equal(count(d.calls, 'o_x2'), 1, 'o_x2 not fulfilled exactly once');
  }],
  ['failed fulfillment is not recorded; retry fulfills exactly once', async () => {
    const h = await load();
    const d = mkDeps(['o_fail']);
    const r1 = await settle(h(ev('e_fail', 'o_fail'), d));
    assert.ok(r1.err || (r1.v && r1.v.ok === false), `first attempt=${show(r1)} expected rejection or ok:false`);
    const r2 = await settle(h(ev('e_fail', 'o_fail'), d));
    assert.ok(r2.v && r2.v.ok === true && r2.v.action === 'fulfilled', `retry=${show(r2)} expected fulfilled`);
    assert.equal(count(d.calls, 'o_fail'), 2, `calls after retry=${count(d.calls, 'o_fail')} expected 2`);
    const r3 = await settle(h(ev('e_fail_other', 'o_fail'), d));
    assert.ok(r3.v && r3.v.ok === true && r3.v.action === 'duplicate', `third=${show(r3)} expected duplicate`);
    assert.equal(count(d.calls, 'o_fail'), 2, `final calls=${count(d.calls, 'o_fail')} expected 2`);
  }],
];

let failed = 0;
for (const [name, fn] of tests) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}: ${String(e && e.message).replace(/\s+/g, ' ')}`);
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
