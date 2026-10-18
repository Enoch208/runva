# RUNVA verification receipt — VERIFIED

> Verified for these synthetic conditions in this sandbox. Not a production guarantee.

## Run
- Run ID: `run_8dafcc4d7b6739ea49`
- Started: 2026-10-18T01:17:21.214Z · Finished: 2026-10-18T01:18:16.267Z · Duration: 55.1 s
- Workflow: `webhook-idempotency` (synthetic Stripe-style events only; no live Stripe API calls)
- Safety contract: One paid order leads to exactly one fulfillment, even when the webhook is delivered more than once, concurrently, or under a different event ID; a failed fulfillment is never marked complete.
- Baseline: **user-supplied file** `examples/handlers/orders-db-handler.mjs` (2741 bytes, sha256 `43b4d5e30e66805248b38f88646d68d5d128b458b5f71457723ed244334c7c90`), passed via the CLI `--handler` flag; uploaded only into the sandbox, never executed on the host
- Final status: **VERIFIED**

## Execution environment (CreateOS Sandbox)
- `sb-01m…m6t8` — work VM (baseline + candidates) · shape `s-1vcpu-1gb` · region `eu` · created in 782 ms · destroyed
- `sb-01m…f28f` — fresh independent-verifier VM · shape `s-1vcpu-1gb` · region `eu` · created in 390 ms · destroyed
- Egress allowlist: `registry.npmjs.org:443` · ingress disabled
- Egress proof: `curl -sS -m 4 https://example.com` exit 35 → blocked (as required)
- CreateOS credential supplied via env var `CREATEOS_SANDBOX_API_KEY` (value never logged)

## Hashes (reproducibility identifiers, not proof of correctness)
- Baseline handler.mjs: `43b4d5e30e66805248b38f88646d68d5d128b458b5f71457723ed244334c7c90`
- Final candidate handler.mjs: `10ff21c01109783c128e2b4578334b00c6786d5675359b042bc7c4616047b063`
- Frozen verifier: `3222f1a24ac7179ee829b5b53ebe336f2ff23c9de39d8923850fae717d3791e1`
- Verifier sha256 measured inside the final VM: `3222f1a24ac7179ee829b5b53ebe336f2ff23c9de39d8923850fae717d3791e1` → matches
- Agent tests agent-tests.mjs: `5a375143b76c007d42c3ccdf88497e9a5a0472623529a05e56899618767512dc`

## Model
- Model: `openrouter:anthropic/claude-sonnet-5.5` (key never logged)
- Patch attempts: 1 (1 initial + up to 2 repairs, each conditioned on real sandbox output)
- Test-generation summary: Probes check-then-await-then-record races and per-order idempotency in the webhook handler. The tests cover sequential duplicates, concurrent deliveries of one event, concurrent deliveries under different event IDs for one order, unrelated orders, ignored event types, and a fulfillment failure followed by retry (including the failure under concurrency). The original handler awaits before it sets any in-flight marker and only sets 'fulfilled' after fulfillment, so concurrent deliveries should each call fulfillOrder.

## Baseline (vulnerable handler)
### Agent-generated tests vs baseline
- Command: `node /workspace/agent-tests.mjs` in sandbox `sb-01m…m6t8`
- Exit code: **1** · 299.318 ms · at 2026-10-18T01:17:53.629Z

stdout (tail):
```
PASS sequential redelivery of same event fulfills once
FAIL 10 concurrent deliveries of same event fulfill once: fulfillOrder calls=10 expected 1 10 !== 1 
FAIL concurrent different event ids for same order fulfill once: fulfillOrder calls=5 expected 1 5 !== 1 
PASS sequential different event ids for same order fulfill once
PASS unknown event type is ignored and never fulfills
FAIL two different orders concurrently are each fulfilled once: ord_two_a fulfillments=2 expected 1 2 !== 1 
PASS failed fulfillment is not marked complete; retry fulfills once
FAIL concurrent deliveries while first attempt fails still fulfill exactly once after retries: successful fulfillments=2 expected 1; [{"ok":false,"action":"rejected","err":"Error: transient failure"},{"ok":true,"action":"fulfilled"},{"ok":true,"action":"fulfilled"}] 2 !== 1 
4/8 tests passed
```

### Frozen verifier vs baseline
Verdict: **FAIL** · process exit code **1** · 380 ms · handler sha256 `43b4d5e30e66805248b38f88646d68d5d128b458b5f71457723ed244334c7c90`

| Case | Result | Scenario | Observed | Expected |
|---|---|---|---|---|
| V1 | **FAIL** | Same event delivered 20 times concurrently fulfills the order once | `{"fulfillments":20,"deliveries":20,"acknowledged":20}` | `{"fulfillments":1,"deliveries":20,"acknowledged":20}` |
| V2 | **FAIL** | Different event IDs for the same payment/order fulfill it once | `{"fulfillments":2,"deliveries":3,"acknowledged":3}` | `{"fulfillments":1,"deliveries":3,"acknowledged":3}` |
| V3 | PASS | Unknown event types are acknowledged and ignored | `{"fulfillments":0,"deliveries":2,"ignored":2}` | `{"fulfillments":0,"deliveries":2,"ignored":2}` |
| V4 | PASS | Two different orders are each fulfilled exactly once | `{"fulfillments":2,"perOrder":{"order_demo_004a":1,"order_demo_004b":1},"fulfilled":2}` | `{"fulfillments":2,"perOrder":{"order_demo_004a":1,"order_demo_004b":1},"fulfilled":2}` |
| V5 | PASS | Failed fulfillment is not marked complete; retry fulfills exactly once | `{"fulfillments":1,"firstDeliveryAcknowledged":false,"retryAcknowledged":true,"redeliveryAcknowledged":true}` | `{"fulfillments":1,"firstDeliveryAcknowledged":false,"retryAcknowledged":true,"redeliveryAcknowledged":true}` |
| V6 | PASS | Module exports handleWebhook and fulfills a valid event | `{"exportType":"function","result":{"ok":true,"action":"fulfilled"},"fulfillments":1}` | `{"exportType":"function","result":{"ok":true,"action":"fulfilled"},"fulfillments":1}` |

## Patch attempts
### Attempt 1 (`openrouter:anthropic/claude-sonnet-5.5`)
- Diagnosis: The handler does a check-then-await-then-record sequence. It reads the order status, awaits several times, and only sets 'fulfilled' after fulfillOrder resolves. Overlapping deliveries therefore all see a non-fulfilled order and each call fulfillOrder. The same race lets different event IDs for one order fulfill it twice.
- Change: Added a per-order in-flight promise map. The check for a fulfilled order and the registration of the in-flight fulfillment happen synchronously, with no await between them. Overlapping deliveries wait for the in-flight attempt. If it succeeded they return 'duplicate'. If it failed they loop and one of them becomes the next single attempt, so fulfillment is never concurrent. The order is marked 'fulfilled' only after fulfillOrder succeeds. A failure is rethrown to the delivery that ran it, and the in-flight entry is cleared so a retry can fulfill exactly once. The order lookup is now synchronous so it cannot interleave.
- sha256: `10ff21c01109783c128e2b4578334b00c6786d5675359b042bc7c4616047b063`
- Syntax check exit: 0
- Agent tests exit: 0
- Frozen verifier: exit 0, PASS

## Final independent verifier result
Ran in a fresh VM that contained only the final handler and the frozen verifier.
Verdict: **PASS** · process exit code **0** · 396 ms · handler sha256 `10ff21c01109783c128e2b4578334b00c6786d5675359b042bc7c4616047b063`

| Case | Result | Scenario | Observed | Expected |
|---|---|---|---|---|
| V1 | PASS | Same event delivered 20 times concurrently fulfills the order once | `{"fulfillments":1,"deliveries":20,"acknowledged":20}` | `{"fulfillments":1,"deliveries":20,"acknowledged":20}` |
| V2 | PASS | Different event IDs for the same payment/order fulfill it once | `{"fulfillments":1,"deliveries":3,"acknowledged":3}` | `{"fulfillments":1,"deliveries":3,"acknowledged":3}` |
| V3 | PASS | Unknown event types are acknowledged and ignored | `{"fulfillments":0,"deliveries":2,"ignored":2}` | `{"fulfillments":0,"deliveries":2,"ignored":2}` |
| V4 | PASS | Two different orders are each fulfilled exactly once | `{"fulfillments":2,"perOrder":{"order_demo_004a":1,"order_demo_004b":1},"fulfilled":2}` | `{"fulfillments":2,"perOrder":{"order_demo_004a":1,"order_demo_004b":1},"fulfilled":2}` |
| V5 | PASS | Failed fulfillment is not marked complete; retry fulfills exactly once | `{"fulfillments":1,"firstDeliveryAcknowledged":false,"retryAcknowledged":true,"redeliveryAcknowledged":true}` | `{"fulfillments":1,"firstDeliveryAcknowledged":false,"retryAcknowledged":true,"redeliveryAcknowledged":true}` |
| V6 | PASS | Module exports handleWebhook and fulfills a valid event | `{"exportType":"function","result":{"ok":true,"action":"fulfilled"},"fulfillments":1}` | `{"exportType":"function","result":{"ok":true,"action":"fulfilled"},"fulfillments":1}` |

- Command: `node /workspace/verification.mjs` in sandbox `sb-01m…f28f`
- Exit code: **0** · 554.886 ms · at 2026-10-18T01:18:15.266Z

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
RESULT PASS: 6/6 cases passed in 396ms
{"schema":"runva.verdict.v1","pass":true,"cases":[{"id":"V1","title":"Same event delivered 20 times concurrently fulfills the order once","pass":true,"observed":{"fulfillments":1,"deliveries":20,"acknowledged":20},"expected":{"fulfillments":1,"deliveries":20,"acknowledged":20},"details":"20 overlapping deliveries of evt_demo_001 -> fulfillOrder(\"order_demo_001\") succeeded 1x; results: ok:fulfilled x1, ok:duplicate x19"},{"id":"V2","title":"Different event IDs for the same payment/order fulfill it once","pass":true,"observed":{"fulfillments":1,"deliveries":3,"acknowledged":3},"expected":{"fulfillments":1,"deliveries":3,"acknowledged":3},"details":"evt_demo_002_a + evt_demo_002_b (concurrent) then evt_demo_002_c, all for order_demo_002 -> fulfilled 1x; results: ok:fulfilled x1, ok:duplicate x2"},{"id":"V3","title":"Unknown event types are acknowledged and ignored","pass":true,"observed":{"fulfillments":0,"deliveries":2,"ignored":2},"expected":{"fulfillments":0,"deliveries":2,"ignored":2},"details":"customer.created -> resolved ok=true action=ignored; payment_intent.payment_failed -> resolved ok=true action=ignored; fulfillOrder calls: 0"},{"id":"V4","title":"Two different orders are each fulfilled exactly once","pass":true,"observed":{"fulfillments":2,"perOrder":{"order_demo_004a":1,"order_demo_004b":1},"fulfilled":2},"expected":{"fulfillments":2,"perOrder":{"order_demo_004a":1,"order_demo_004b":1},"fulfilled":2},"details":"order_demo_004a -> resolved ok=true action=fulfilled; order_demo_004b -> resolved ok=true action=fulfilled"},{"id":"V5","title":"Failed fulfillment is not marked complete; retry fulfills exactly once","pass":true,"observed":{"fulfillments":1,"firstDeliveryAcknowledged":false,"retryAcknowledged":true,"redeliveryAcknowledged":true},"expected":{"fulfillments":1,"firstDeliveryAcknowledged":false,"retryAcknowledged":true,"redeliveryAcknowledged":true},"details":"delivery 1 (fulfillOrder fails): rejected (Error: simulated transient failure in fulfillOrder) | retry: resolved ok=true action=fulfilled | redelivery: resolved ok=true action=duplicate; fulfillOrder calls=2, successes=1"},{"id":"V6","title":"Module exports handleWebhook and fulfills a valid event","pass":true,"observed":{"exportType":"function","result":{"ok":true,"action":"fulfilled"},"fulfillments":1},"expected":{"exportType":"function","result":{"ok":true,"action":"fulfilled"},"fulfillments":1},"details":"single valid delivery -> resolved ok=true action=fulfilled"}],"durationMs":396}
```

## Code diff (baseline → final candidate)
```diff
===================================================================
--- a/handler.mjs	baseline
+++ b/handler.mjs	candidate 1
@@ -1,39 +1,39 @@
 // Orders service: Stripe-style webhook endpoint backed by a (tiny, in-memory) orders table.
 //
-// Example input for `scripts/e2e-run.ts --handler`. It follows the RUNVA contract:
+// Contract:
 //   export async function handleWebhook(event, deps) -> { ok, action: "fulfilled" | "duplicate" | "ignored" }
 //   deps.fulfillOrder(orderId) is async and may throw.
 //
-// It looks idempotent: it checks the order's status before shipping and only marks it fulfilled
-// after fulfillOrder succeeds. Whether that holds up under real webhook delivery is for RUNVA to find out.
+// Idempotency is per order: at most one fulfillOrder call is in flight per order,
+// and an order is only marked fulfilled after fulfillOrder succeeds.
 
 const PAYMENT_EVENTS = new Set(["payment_intent.succeeded"]);
 
 // orders table: orderId -> { id, status: "pending" | "paid" | "fulfilled", paymentIntentId, attempts, lastError, updatedAt }
 const orders = new Map();
+// orderId -> promise of the single in-flight fulfillment attempt
+const inFlight = new Map();
 // append-only audit trail (kept in memory instead of console noise)
 const auditLog = [];
 
 function audit(orderId, entry) {
   auditLog.push({ at: new Date().toISOString(), orderId, ...entry });
   if (auditLog.length > 500) auditLog.shift();
 }
 
-// Simulates `SELECT ... FROM orders WHERE id = $1`, inserting a pending row on first sight.
-async function findOrCreateOrder(orderId) {
-  await Promise.resolve();
+// Synchronous find-or-create so there is no interleaving point.
+function findOrCreateOrder(orderId) {
   let row = orders.get(orderId);
   if (!row) {
     row = { id: orderId, status: "pending", paymentIntentId: null, attempts: 0, lastError: null, updatedAt: Date.now() };
     orders.set(orderId, row);
   }
   return row;
 }
 
-async function saveOrder(row) {
+function touch(row) {
   row.updatedAt = Date.now();
-  orders.set(row.id, row);
 }
 
 export async function handleWebhook(event, deps) {
   if (!PAYMENT_EVENTS.has(event?.type)) {
@@ -46,30 +46,55 @@
     audit(null, { eventId: event.id, note: "payment event without order_id, skipped" });
     return { ok: true, action: "ignored" };
   }
 
-  const order = await findOrCreateOrder(orderId);
-  if (order.status === "fulfilled") {
-    audit(orderId, { eventId: event.id, note: "already fulfilled" });
-    return { ok: true, action: "duplicate" };
-  }
+  const order = findOrCreateOrder(orderId);
 
-  order.status = "paid";
-  order.paymentIntentId = payment.id ?? order.paymentIntentId;
-  order.attempts += 1;
-  await saveOrder(order);
+  for (;;) {
+    if (order.status === "fulfilled") {
+      audit(orderId, { eventId: event.id, note: "already fulfilled" });
+      return { ok: true, action: "duplicate" };
+    }
 
-  try {
-    await deps.fulfillOrder(orderId);
-  } catch (err) {
-    order.lastError = err instanceof Error ? err.message : String(err);
-    await saveOrder(order);
-    audit(orderId, { eventId: event.id, note: "fulfillment failed", error: order.lastError });
-    throw err; // let the webhook return 5xx so Stripe retries
-  }
+    const pending = inFlight.get(orderId);
+    if (pending) {
+      // Someone else is fulfilling this order right now; wait for the outcome, then re-evaluate.
+      try {
+        await pending;
+      } catch {
+        // The leader reports its own failure; loop to see whether we must retry.
+      }
+      continue;
+    }
 
-  order.status = "fulfilled";
-  order.lastError = null;
-  await saveOrder(order);
-  audit(orderId, { eventId: event.id, note: "fulfilled" });
-  return { ok: true, action: "fulfilled" };
+    // We are the leader. No await between the check above and registering the promise.
+    order.status = "paid";
+    order.paymentIntentId = payment.id ?? order.paymentIntentId;
+    order.attempts += 1;
+    touch(order);
+
+    const attempt = (async () => {
+      try {
+        await deps.fulfillOrder(orderId);
+        order.status = "fulfilled";
+        order.lastError = null;
+        touch(order);
+      } catch (err) {
+        order.lastError = err instanceof Error ? err.message : String(err);
+        touch(order);
+        throw err;
+      } finally {
+        inFlight.delete(orderId);
+      }
+    })();
+    inFlight.set(orderId, attempt);
+
+    try {
+      await attempt;
+    } catch (err) {
+      audit(orderId, { eventId: event.id, note: "fulfillment failed", error: order.lastError });
+      throw err; // let the webhook return 5xx so Stripe retries
+    }
+    audit(orderId, { eventId: event.id, note: "fulfilled" });
+    return { ok: true, action: "fulfilled" };
+  }
 }
```

## Agent-generated test file (agent-tests.mjs)
Evidence only — the frozen verifier alone decides the verdict.
```js
// adversarial idempotency tests for handler.mjs
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';

let n = 0;
let failed = 0;
let total = 0;
const load = async () => (await import(`./target/handler.mjs?t=${++n}`)).handleWebhook;
const ev = (id, orderId, type = 'payment_intent.succeeded', pi = 'pi_' + id) => ({ id, type, data: { object: { id: pi, metadata: { order_id: orderId } } } });
function makeDeps(failures = {}) {
  const calls = [];
  const successes = [];
  const fails = { ...failures };
  return {
    calls,
    successes,
    async fulfillOrder(id) {
      calls.push(id);
      await sleep(20);
      if (fails[id] > 0) {
        fails[id] -= 1;
        throw new Error('transient failure');
      }
      successes.push(id);
    },
  };
}
const settle = async (promises) => (await Promise.allSettled(promises)).map((r) => (r.status === 'fulfilled' ? r.value : { ok: false, action: 'rejected', err: String(r.reason) }));
const count = (results, action) => results.filter((r) => r.ok && r.action === action).length;
const fmt = (x) => JSON.stringify(x);

async function test(name, fn) {
  total += 1;
  try {
    await fn();
    console.log('PASS ' + name);
  } catch (e) {
    failed += 1;
    console.log('FAIL ' + name + ': ' + (e && e.message ? e.message : String(e)).replace(/\s+/g, ' '));
  }
}

await test('sequential redelivery of same event fulfills once', async () => {
  const handle = await load();
  const deps = makeDeps();
  const e = ev('evt_seq_1', 'ord_seq_1');
  const results = [];
  for (let i = 0; i < 3; i++) results.push(await handle(e, deps));
  assert.equal(deps.successes.length, 1, 'fulfillments=' + deps.successes.length + ' expected 1');
  assert.deepEqual(results.map((r) => r.action), ['fulfilled', 'duplicate', 'duplicate'], 'actions=' + fmt(results));
  assert.ok(results.every((r) => r.ok === true), 'all ok expected: ' + fmt(results));
});

await test('10 concurrent deliveries of same event fulfill once', async () => {
  const handle = await load();
  const deps = makeDeps();
  const e = ev('evt_conc_1', 'ord_conc_1');
  const results = await settle(Array.from({ length: 10 }, () => handle(e, deps)));
  assert.equal(deps.calls.length, 1, 'fulfillOrder calls=' + deps.calls.length + ' expected 1');
  assert.equal(count(results, 'fulfilled'), 1, 'fulfilled results=' + count(results, 'fulfilled') + ' expected 1; ' + fmt(results));
  assert.equal(count(results, 'duplicate'), 9, 'duplicate results=' + count(results, 'duplicate') + ' expected 9');
});

await test('concurrent different event ids for same order fulfill once', async () => {
  const handle = await load();
  const deps = makeDeps();
  const results = await settle([1, 2, 3, 4, 5].map((i) => handle(ev('evt_diff_' + i, 'ord_diff_1', 'payment_intent.succeeded', 'pi_diff_1'), deps)));
  assert.equal(deps.calls.length, 1, 'fulfillOrder calls=' + deps.calls.length + ' expected 1');
  assert.equal(count(results, 'fulfilled'), 1, 'fulfilled results=' + count(results, 'fulfilled') + ' expected 1');
  assert.equal(count(results, 'duplicate'), 4, 'duplicate results=' + count(results, 'duplicate') + ' expected 4');
});

await test('sequential different event ids for same order fulfill once', async () => {
  const handle = await load();
  const deps = makeDeps();
  const r1 = await handle(ev('evt_sd_1', 'ord_sd_1'), deps);
  const r2 = await handle(ev('evt_sd_2', 'ord_sd_1'), deps);
  assert.equal(r1.action, 'fulfilled', 'first=' + fmt(r1));
  assert.deepEqual({ ok: r2.ok, action: r2.action }, { ok: true, action: 'duplicate' }, 'second=' + fmt(r2));
  assert.equal(deps.successes.length, 1, 'fulfillments=' + deps.successes.length + ' expected 1');
});

await test('unknown event type is ignored and never fulfills', async () => {
  const handle = await load();
  const deps = makeDeps();
  const r = await handle(ev('evt_ign_1', 'ord_ign_1', 'charge.refunded'), deps);
  assert.deepEqual({ ok: r.ok, action: r.action }, { ok: true, action: 'ignored' }, 'result=' + fmt(r));
  assert.equal(deps.calls.length, 0, 'fulfillOrder calls=' + deps.calls.length + ' expected 0');
  const r2 = await handle(ev('evt_ign_2', 'ord_ign_1'), deps);
  assert.equal(r2.action, 'fulfilled', 'order must still be fulfillable after ignored event: ' + fmt(r2));
});

await test('two different orders concurrently are each fulfilled once', async () => {
  const handle = await load();
  const deps = makeDeps();
  const results = await settle([handle(ev('evt_two_a', 'ord_two_a'), deps), handle(ev('evt_two_b', 'ord_two_b'), deps), handle(ev('evt_two_a', 'ord_two_a'), deps)]);
  const a = deps.successes.filter((x) => x === 'ord_two_a').length;
  const b = deps.successes.filter((x) => x === 'ord_two_b').length;
  assert.equal(a, 1, 'ord_two_a fulfillments=' + a + ' expected 1');
  assert.equal(b, 1, 'ord_two_b fulfillments=' + b + ' expected 1');
  assert.equal(count(results, 'fulfilled'), 2, 'fulfilled results=' + count(results, 'fulfilled') + ' expected 2; ' + fmt(results));
});

await test('failed fulfillment is not marked complete; retry fulfills once', async () => {
  const handle = await load();
  const deps = makeDeps({ ord_fail_1: 1 });
  const e = ev('evt_fail_1', 'ord_fail_1');
  const [first] = await settle([handle(e, deps)]);
  assert.ok(first.ok === false, 'first delivery should reject or ok:false, got ' + fmt(first));
  assert.equal(deps.successes.length, 0, 'no successful fulfillment yet, got ' + deps.successes.length);
  const retry = await handle(e, deps);
  assert.deepEqual({ ok: retry.ok, action: retry.action }, { ok: true, action: 'fulfilled' }, 'retry result=' + fmt(retry) + ' (order wrongly marked complete?)');
  assert.equal(deps.successes.length, 1, 'successful fulfillments=' + deps.successes.length + ' expected 1');
  const again = await handle(e, deps);
  assert.equal(again.action, 'duplicate', 'after success expected duplicate, got ' + fmt(again));
  assert.equal(deps.successes.length, 1, 'successful fulfillments after redelivery=' + deps.successes.length + ' expected 1');
});

await test('concurrent deliveries while first attempt fails still fulfill exactly once after retries', async () => {
  const handle = await load();
  const deps = makeDeps({ ord_cf_1: 1 });
  const results = await settle([1, 2, 3].map((i) => handle(ev('evt_cf_' + i, 'ord_cf_1'), deps)));
  for (let i = 0; i < 3 && deps.successes.length === 0; i++) {
    results.push(...(await settle([handle(ev('evt_cf_retry_' + i, 'ord_cf_1'), deps)])));
  }
  assert.equal(deps.successes.length, 1, 'successful fulfillments=' + deps.successes.length + ' expected 1; ' + fmt(results));
  assert.ok(count(results, 'fulfilled') <= 1, 'fulfilled acks=' + count(results, 'fulfilled') + ' expected at most 1');
  await handle(ev('evt_cf_last', 'ord_cf_1'), deps);
  assert.equal(deps.successes.length, 1, 'successful fulfillments after redelivery=' + deps.successes.length + ' expected 1');
});

console.log(`${total - failed}/${total} tests passed`);
process.exitCode = failed ? 1 : 0;
```

## Scope and limitations
- Verified for these synthetic conditions in this sandbox. Not a production guarantee.
- The fix may use in-memory state and in-flight coordination, which is valid only for this single-process fixture. Production durability requires a transactional/idempotent datastore; passing this fixture is not a guarantee across process crashes, restarts, or multiple service instances.
- Hashes identify the exact bytes that ran; they are not cryptographic proof of correct behavior. RUNVA claims only the observed assertions above — not formal verification or universal correctness.
- All model-generated code executed only inside CreateOS sandboxes; the RUNVA host never executed it.
