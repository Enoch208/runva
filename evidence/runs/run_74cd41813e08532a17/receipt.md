# RUNVA verification receipt — VERIFIED

> Verified for these synthetic conditions in this sandbox. Not a production guarantee.

## Run
- Run ID: `run_74cd41813e08532a17`
- Started: 2026-10-18T01:55:26.295Z · Finished: 2026-10-18T01:56:53.633Z · Duration: 87.3 s
- Workflow: `durable-idempotency` — Multi-process payment webhook on SQLite: fulfill each paid order exactly once, across restarts (synthetic Stripe-style events only; no live Stripe API calls)
- Safety contract: One paid order leads to exactly one fulfillment, even when the webhook is delivered concurrently to several worker processes sharing one SQLite database, redelivered after a process restart, or sent under a different event ID; a failed fulfillment is never marked complete and can be retried by another process.
- Final status: **VERIFIED**

## Execution environment (CreateOS Sandbox)
- `sb-01m…erq2` — work VM (baseline + candidates) · shape `s-1vcpu-1gb` · region `eu` · created in 671 ms · destroyed
- `sb-01m…x91w` — fresh independent-verifier VM · shape `s-1vcpu-1gb` · region `eu` · created in 313 ms · destroyed
- Egress allowlist: `registry.npmjs.org:443` · ingress disabled
- Egress proof: `curl -sS -m 4 https://example.com` exit 35 → blocked (as required)
- CreateOS credential supplied via env var `CREATEOS_SANDBOX_API_KEY` (value never logged)

## Hashes (reproducibility identifiers, not proof of correctness)
- Baseline handler.mjs: `1fcf0ba5e6cab045d341a1809de77216f74e96605c8b18d65e59deebc83ec898`
- Final candidate handler.mjs: `f7e6e3f5e1ed33755673c30f0e52b588636c6d1aba0facf92430c44a23f2f734`
- Frozen verifier: `d4ddb799ceb1e9a64b50489f662d5fe1867c3dac83030ee854ea8f73436e785f`
- Verifier sha256 measured inside the final VM: `d4ddb799ceb1e9a64b50489f662d5fe1867c3dac83030ee854ea8f73436e785f` → matches
- Agent tests agent-tests.mjs: `2ff854f7fd22b6028a7a3ffc1e3a2f4698da7be7b684031957c125696ac78179`

## Model
- Model: `openrouter:anthropic/claude-sonnet-5.5` (key never logged)
- Patch attempts: 1 (1 initial + up to 2 repairs, each conditioned on real sandbox output)
- Test-generation summary: Multi-process probes (separate OS processes sharing one SQLite WAL file) for the check-then-await-then-write race in the webhook handler. They cover: the same event delivered concurrently to several processes and repeatedly within one process; different event ids for the same order; a restart duplicate after fulfillment; failure followed by retry from a new process, with no fake acknowledgement and no completed record on failure; a concurrent failure plus success followed by a retry; ignored event types; and independent orders (to catch over-blocking). The original handler should fail the concurrent tests with more than one fulfillment, because the SELECT happens before the awaited fulfillOrder and nothing is claimed.

## Baseline (vulnerable handler)
### Agent-generated tests vs baseline
- Command: `node /workspace/agent-tests.mjs` in sandbox `sb-01m…erq2`
- Exit code: **1** · 5154.389 ms · at 2026-10-18T01:56:24.324Z

stdout (tail):
```
FAIL same event to 4 concurrent processes (x2 each) fulfills once: total fulfillments 8 expected 1
FAIL different event ids, same order, 3 processes fulfills once: total fulfillments 6 expected 1
PASS restart: duplicate in a new process after fulfillment is a duplicate
PASS failure is reported, not recorded, retry in new process fulfills once
PASS concurrent failing + healthy process, then retry: exactly one fulfillment
PASS unknown event type is ignored and never fulfills
FAIL independent orders each fulfilled once across processes: per-order fulfillments {"o7a":3,"o7b":3} expected one each
SUMMARY 4/7 passed
```

### Frozen verifier vs baseline
Verdict: **FAIL** · process exit code **1** · 783 ms · handler sha256 `1fcf0ba5e6cab045d341a1809de77216f74e96605c8b18d65e59deebc83ec898`

| Case | Result | Scenario | Observed | Expected |
|---|---|---|---|---|
| V1 | **FAIL** | 20 deliveries across 4 concurrent worker processes fulfill the order once | `{"fulfillments":20,"deliveries":20,"processes":4,"acknowledged":20}` | `{"fulfillments":1,"deliveries":20,"processes":4,"acknowledged":20}` |
| V2 | PASS | Redelivery after a process restart (same and different event ID) does not fulfill again | `{"fulfillments":1,"deliveries":3,"processes":2,"acknowledged":3}` | `{"fulfillments":1,"deliveries":3,"processes":2,"acknowledged":3}` |
| V3 | PASS | Unknown and non-paid event types are acknowledged and ignored | `{"fulfillments":0,"deliveries":2,"ignored":2}` | `{"fulfillments":0,"deliveries":2,"ignored":2}` |
| V4 | PASS | Two different orders delivered from 2 processes are each fulfilled exactly once | `{"fulfillments":2,"perOrder":{"order_demo_004a":1,"order_demo_004b":1},"fulfilled":2,"processes":2}` | `{"fulfillments":2,"perOrder":{"order_demo_004a":1,"order_demo_004b":1},"fulfilled":2,"processes":2}` |
| V5 | PASS | Failed fulfillment is not marked complete; a new process retries it exactly once | `{"fulfillments":1,"firstDeliveryAcknowledged":false,"retryAcknowledged":true,"redeliveryAcknowledged":true,"processes":2}` | `{"fulfillments":1,"firstDeliveryAcknowledged":false,"retryAcknowledged":true,"redeliveryAcknowledged":true,"processes":2}` |
| V6 | PASS | Module exports handleWebhook, fulfills a valid event and persists state in deps.db | `{"exportType":"function","result":{"ok":true,"action":"fulfilled"},"fulfillments":1,"persisted":true,"tables":{"orders":1}}` | `{"exportType":"function","result":{"ok":true,"action":"fulfilled"},"fulfillments":1,"persisted":true}` |

## Patch attempts
### Attempt 1 (`openrouter:anthropic/claude-sonnet-5.5`)
- Diagnosis: The handler does SELECT, then awaits fulfillOrder, then writes 'fulfilled'. Nothing is claimed before the await, so every concurrent or overlapping delivery sees no 'fulfilled' row and calls fulfillOrder. Different event IDs for the same order race in the same way.
- Change: Before calling fulfillOrder, the handler now claims the order atomically with INSERT ... ON CONFLICT(order_id) DO NOTHING, writing a 'processing' row. Only the delivery with changes === 1 may fulfill; any other delivery returns 'duplicate'. After fulfillOrder succeeds, the row is updated to 'fulfilled'. If fulfillOrder throws, the 'processing' claim is deleted so any process can retry, and the original error is rethrown. No transaction is held across an await. Unknown event types return before any write.
- sha256: `f7e6e3f5e1ed33755673c30f0e52b588636c6d1aba0facf92430c44a23f2f734`
- Syntax check exit: 0
- Agent tests exit: 0
- Frozen verifier: exit 0, PASS

## Final independent verifier result
Ran in a fresh VM that contained only the final handler and the frozen verifier.
Verdict: **PASS** · process exit code **0** · 1699 ms · handler sha256 `f7e6e3f5e1ed33755673c30f0e52b588636c6d1aba0facf92430c44a23f2f734`

| Case | Result | Scenario | Observed | Expected |
|---|---|---|---|---|
| V1 | PASS | 20 deliveries across 4 concurrent worker processes fulfill the order once | `{"fulfillments":1,"deliveries":20,"processes":4,"acknowledged":20}` | `{"fulfillments":1,"deliveries":20,"processes":4,"acknowledged":20}` |
| V2 | PASS | Redelivery after a process restart (same and different event ID) does not fulfill again | `{"fulfillments":1,"deliveries":3,"processes":2,"acknowledged":3}` | `{"fulfillments":1,"deliveries":3,"processes":2,"acknowledged":3}` |
| V3 | PASS | Unknown and non-paid event types are acknowledged and ignored | `{"fulfillments":0,"deliveries":2,"ignored":2}` | `{"fulfillments":0,"deliveries":2,"ignored":2}` |
| V4 | PASS | Two different orders delivered from 2 processes are each fulfilled exactly once | `{"fulfillments":2,"perOrder":{"order_demo_004a":1,"order_demo_004b":1},"fulfilled":2,"processes":2}` | `{"fulfillments":2,"perOrder":{"order_demo_004a":1,"order_demo_004b":1},"fulfilled":2,"processes":2}` |
| V5 | PASS | Failed fulfillment is not marked complete; a new process retries it exactly once | `{"fulfillments":1,"firstDeliveryAcknowledged":false,"retryAcknowledged":true,"redeliveryAcknowledged":true,"processes":2}` | `{"fulfillments":1,"firstDeliveryAcknowledged":false,"retryAcknowledged":true,"redeliveryAcknowledged":true,"processes":2}` |
| V6 | PASS | Module exports handleWebhook, fulfills a valid event and persists state in deps.db | `{"exportType":"function","result":{"ok":true,"action":"fulfilled"},"fulfillments":1,"persisted":true,"tables":{"orders":1}}` | `{"exportType":"function","result":{"ok":true,"action":"fulfilled"},"fulfillments":1,"persisted":true}` |

- Command: `node /workspace/verification.mjs` in sandbox `sb-01m…x91w`
- Exit code: **0** · 2116.291 ms · at 2026-10-18T01:56:51.148Z

stdout (tail):
```
…[truncated 1876 chars]
ew process retries it exactly once
     observed fulfillments=1 firstDeliveryAcknowledged=false retryAcknowledged=true redeliveryAcknowledged=true processes=2
     expected fulfillments=1 firstDeliveryAcknowledged=false retryAcknowledged=true redeliveryAcknowledged=true processes=2
     P1 delivery (fulfillOrder fails): rejected (Error: simulated transient failure in fulfillOrder), P1 exited | P2 retry: resolved ok=true action=fulfilled | P2 redelivery: resolved ok=true action=duplicate; fulfillOrder calls P1=1 P2=1, successes=1
PASS V6 Module exports handleWebhook, fulfills a valid event and persists state in deps.db
     observed exportType=function result={"ok":true,"action":"fulfilled"} fulfillments=1 persisted=true tables={"orders":1}
     expected exportType=function result={"ok":true,"action":"fulfilled"} fulfillments=1 persisted=true
     single valid delivery in a fresh process -> resolved ok=true action=fulfilled; deps.db user tables (rows): orders(1)
RESULT PASS: 6/6 cases passed in 1699ms
{"schema":"runva.verdict.v1","pass":true,"cases":[{"id":"V1","title":"20 deliveries across 4 concurrent worker processes fulfill the order once","pass":true,"observed":{"fulfillments":1,"deliveries":20,"processes":4,"acknowledged":20},"expected":{"fulfillments":1,"deliveries":20,"processes":4,"acknowledged":20},"details":"4 processes x 5 overlapping deliveries of evt_demo_001 -> fulfillOrder(\"order_demo_001\") succeeded 1x (per process P1:0 P2:0 P3:1 P4:0); results: ok:duplicate x19, ok:fulfilled x1"},{"id":"V2","title":"Redelivery after a process restart (same and different event ID) does not fulfill again","pass":true,"observed":{"fulfillments":1,"deliveries":3,"processes":2,"acknowledged":3},"expected":{"fulfillments":1,"deliveries":3,"processes":2,"acknowledged":3},"details":"P1: evt_demo_002_a -> resolved ok=true action=fulfilled (fulfilled 1x), P1 exited | P2 (restarted, fresh import, same db): evt_demo_002_a redelivery -> resolved ok=true action=duplicate, evt_demo_002_b (same order) -> resolved ok=true action=duplicate | total fulfillments for order_demo_002: 1"},{"id":"V3","title":"Unknown and non-paid event types are acknowledged and ignored","pass":true,"observed":{"fulfillments":0,"deliveries":2,"ignored":2},"expected":{"fulfillments":0,"deliveries":2,"ignored":2},"details":"customer.created -> resolved ok=true action=ignored; payment_intent.payment_failed -> resolved ok=true action=ignored; fulfillOrder calls: 0"},{"id":"V4","title":"Two different orders delivered from 2 processes are each fulfilled exactly once","pass":true,"observed":{"fulfillments":2,"perOrder":{"order_demo_004a":1,"order_demo_004b":1},"fulfilled":2,"processes":2},"expected":{"fulfillments":2,"perOrder":{"order_demo_004a":1,"order_demo_004b":1},"fulfilled":2,"processes":2},"details":"P1 order_demo_004a -> resolved ok=true action=fulfilled; P2 order_demo_004b -> resolved ok=true action=fulfilled (concurrent)"},{"id":"V5","title":"Failed fulfillment is not marked complete; a new process retries it exactly once","pass":true,"observed":{"fulfillments":1,"firstDeliveryAcknowledged":false,"retryAcknowledged":true,"redeliveryAcknowledged":true,"processes":2},"expected":{"fulfillments":1,"firstDeliveryAcknowledged":false,"retryAcknowledged":true,"redeliveryAcknowledged":true,"processes":2},"details":"P1 delivery (fulfillOrder fails): rejected (Error: simulated transient failure in fulfillOrder), P1 exited | P2 retry: resolved ok=true action=fulfilled | P2 redelivery: resolved ok=true action=duplicate; fulfillOrder calls P1=1 P2=1, successes=1"},{"id":"V6","title":"Module exports handleWebhook, fulfills a valid event and persists state in deps.db","pass":true,"observed":{"exportType":"function","result":{"ok":true,"action":"fulfilled"},"fulfillments":1,"persisted":true,"tables":{"orders":1}},"expected":{"exportType":"function","result":{"ok":true,"action":"fulfilled"},"fulfillments":1,"persisted":true},"details":"single valid delivery in a fresh process -> resolved ok=true action=fulfilled; deps.db user tables (rows): orders(1)"}],"durationMs":1699}
```

## Code diff (baseline → final candidate)
```diff
===================================================================
--- a/handler.mjs	baseline
+++ b/handler.mjs	candidate 1
@@ -15,22 +15,33 @@
   )`);
 
   const orderId = event.data.object.metadata.order_id;
 
-  // Stripe redelivers webhooks, so skip orders we've already fulfilled.
-  const row = db.prepare("SELECT status FROM orders WHERE order_id = ?").get(orderId);
-  if (row?.status === "fulfilled") {
+  // Atomically claim the order. Only the delivery that inserts the row may fulfill.
+  const claim = db
+    .prepare(
+      `INSERT INTO orders (order_id, status, last_event_id, updated_at)
+       VALUES (?, 'processing', ?, ?)
+       ON CONFLICT(order_id) DO NOTHING`,
+    )
+    .run(orderId, event.id, new Date().toISOString());
+
+  if (Number(claim.changes) !== 1) {
     return { ok: true, action: "duplicate" };
   }
 
-  await fulfillOrder(orderId);
+  try {
+    await fulfillOrder(orderId);
+  } catch (err) {
+    // Release the claim so a later retry (any process) can fulfill the order.
+    db.prepare("DELETE FROM orders WHERE order_id = ? AND status = 'processing'").run(orderId);
+    throw err;
+  }
 
-  // Record the fulfillment only after it succeeds, so a failed attempt can be retried.
+  // Record completion only after fulfillment succeeded.
   db.prepare(
-    `INSERT INTO orders (order_id, status, last_event_id, updated_at)
-     VALUES (?, 'fulfilled', ?, ?)
-     ON CONFLICT(order_id) DO UPDATE SET
-       status = 'fulfilled', last_event_id = excluded.last_event_id, updated_at = excluded.updated_at`,
-  ).run(orderId, event.id, new Date().toISOString());
+    `UPDATE orders SET status = 'fulfilled', last_event_id = ?, updated_at = ?
+     WHERE order_id = ?`,
+  ).run(event.id, new Date().toISOString(), orderId);
 
   return { ok: true, action: "fulfilled" };
 }
```

## Agent-generated test file (agent-tests.mjs)
Evidence only — the frozen verifier alone decides the verdict.
```js
// Adversarial multi-process idempotency tests for handler.mjs
import { DatabaseSync } from 'node:sqlite';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import assert from 'node:assert';

const PRAGMAS = 'PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;';
const ev = (id, o, type = 'payment_intent.succeeded') => ({ id, type, data: { object: { id: 'pi_' + id, metadata: { order_id: o } } } });

if (process.argv[2] === 'child') {
  const a = JSON.parse(process.argv[3]);
  const db = new DatabaseSync(a.file);
  db.exec(PRAGMAS);
  const { handleWebhook } = await import('./target/handler.mjs');
  const byOrder = {};
  let calls = 0;
  const fulfillOrder = async (id) => {
    await sleep(a.delay ?? 100);
    if (a.failFirst && calls++ === 0) throw new Error('transient');
    byOrder[id] = (byOrder[id] || 0) + 1;
  };
  await sleep(Math.max(0, a.startAt - Date.now()));
  const settled = await Promise.allSettled(a.events.map((e) => handleWebhook(e, { db, fulfillOrder })));
  const results = settled.map((s) => (s.status === 'fulfilled' ? s.value : { error: String(s.reason?.message ?? s.reason) }));
  const fulfilled = Object.values(byOrder).reduce((n, v) => n + v, 0);
  db.close();
  console.log(JSON.stringify({ fulfilled, byOrder, results }));
} else {
  await main();
}

function run(args) {
  return new Promise((res) => {
    const c = spawn(process.execPath, ['--no-warnings', fileURLToPath(import.meta.url), 'child', JSON.stringify(args)]);
    let out = '';
    let err = '';
    let done = false;
    const fin = (v) => { if (!done) { done = true; clearTimeout(t); res(v); } };
    c.stdout.on('data', (d) => (out += d));
    c.stderr.on('data', (d) => (err += d));
    const t = setTimeout(() => c.kill('SIGKILL'), 15000);
    c.on('error', (e) => fin({ fulfilled: 0, byOrder: {}, results: [], crashed: String(e.message) }));
    c.on('close', () => {
      try {
        fin(JSON.parse(out.slice(out.lastIndexOf('{"fulfilled"'))));
      } catch {
        fin({ fulfilled: 0, byOrder: {}, results: [], crashed: err.slice(0, 300) || 'no output' });
      }
    });
  });
}

async function main() {
  const dirs = [];
  const mk = () => {
    const d = mkdtempSync(join(tmpdir(), 'agent-'));
    dirs.push(d);
    const file = join(d, 't.db');
    const db = new DatabaseSync(file);
    db.exec(PRAGMAS);
    db.close();
    return file;
  };
  const g = async (file, specs, delay = 800) => {
    const startAt = Date.now() + delay;
    const rs = await Promise.all(specs.map((s) => run({ file, startAt, ...s })));
    for (const r of rs) assert.ok(!r.crashed, 'child crashed: ' + r.crashed);
    return rs;
  };
  const sum = (rs) => rs.reduce((n, r) => n + r.fulfilled, 0);
  const flat = (rs) => rs.flatMap((r) => r.results);
  const failed = (r) => r.error !== undefined || r.ok === false;

  const tests = [
    ['same event to 4 concurrent processes (x2 each) fulfills once', async () => {
      const f = mk();
      const e = ev('e1', 'o1');
      const rs = await g(f, [0, 1, 2, 3].map(() => ({ events: [e, e] })));
      assert.equal(sum(rs), 1, 'total fulfillments ' + sum(rs) + ' expected 1');
      const all = flat(rs);
      assert.ok(all.every((r) => r.ok === true && (r.action === 'fulfilled' || r.action === 'duplicate')), 'results ' + JSON.stringify(all));
      const nf = all.filter((r) => r.action === 'fulfilled').length;
      assert.equal(nf, 1, 6 + ' dup results expected, fulfilled-action count ' + nf + ' expected 1');
    }],
    ['different event ids, same order, 3 processes fulfills once', async () => {
      const f = mk();
      const rs = await g(f, [0, 1, 2].map((i) => ({ events: [ev('a' + i, 'o2'), ev('b' + i, 'o2')] })));
      assert.equal(sum(rs), 1, 'total fulfillments ' + sum(rs) + ' expected 1');
      const all = flat(rs);
      assert.ok(all.every((r) => r.ok === true), 'results ' + JSON.stringify(all));
    }],
    ['restart: duplicate in a new process after fulfillment is a duplicate', async () => {
      const f = mk();
      const e = ev('e3', 'o3');
      const [A] = await g(f, [{ events: [e] }], 0);
      assert.equal(A.fulfilled, 1, 'first process fulfilled ' + A.fulfilled + ' expected 1');
      const [B] = await g(f, [{ events: [e] }], 0);
      assert.equal(B.fulfilled, 0, 'restarted process fulfilled ' + B.fulfilled + ' expected 0');
      assert.ok(B.results[0].ok === true && B.results[0].action === 'duplicate', 'result ' + JSON.stringify(B.results[0]));
      const [C] = await g(f, [{ events: [ev('e3-other', 'o3')] }], 0);
      assert.equal(C.fulfilled, 0, 'new event id after restart fulfilled ' + C.fulfilled + ' expected 0');
    }],
    ['failure is reported, not recorded, retry in new process fulfills once', async () => {
      const f = mk();
      const e = ev('e4', 'o4');
      const [A] = await g(f, [{ events: [e], failFirst: true }], 0);
      assert.equal(A.fulfilled, 0, 'failing process fulfilled ' + A.fulfilled);
      assert.ok(failed(A.results[0]), 'failure not reported: ' + JSON.stringify(A.results[0]));
      const [B] = await g(f, [{ events: [e] }], 0);
      assert.equal(B.fulfilled, 1, 'retry fulfilled ' + B.fulfilled + ' expected 1');
      assert.equal(B.results[0].action, 'fulfilled', 'retry result ' + JSON.stringify(B.results[0]));
      const [C] = await g(f, [{ events: [e] }], 0);
      assert.equal(C.fulfilled, 0, 'third delivery fulfilled ' + C.fulfilled + ' expected 0');
      assert.equal(C.results[0].action, 'duplicate', 'third result ' + JSON.stringify(C.results[0]));
    }],
    ['concurrent failing + healthy process, then retry: exactly one fulfillment', async () => {
      const f = mk();
      const rs = await g(f, [
        { events: [ev('e5a', 'o5')], failFirst: true },
        { events: [ev('e5b', 'o5')] },
      ]);
      const [A] = rs;
      if (A.results[0].ok === true && A.results[0].action === 'fulfilled') {
        assert.equal(A.fulfilled, 1, 'process A acknowledged fulfilled but fulfilled ' + A.fulfilled);
      }
      assert.ok(sum(rs) <= 1, 'concurrent phase fulfillments ' + sum(rs) + ' expected <= 1');
      const [C] = await g(f, [{ events: [ev('e5c', 'o5')] }], 0);
      const total = sum(rs) + C.fulfilled;
      assert.equal(total, 1, 'total fulfillments ' + total + ' expected 1 (concurrent ' + sum(rs) + ', retry ' + C.fulfilled + ')');
    }],
    ['unknown event type is ignored and never fulfills', async () => {
      const f = mk();
      const rs = await g(f, [
        { events: [ev('e6a', 'o6', 'charge.refunded'), ev('e6b', 'o6', 'payment_intent.created')] },
        { events: [ev('e6c', 'o6', 'invoice.paid')] },
      ]);
      assert.equal(sum(rs), 0, 'fulfillments ' + sum(rs) + ' expected 0');
      const all = flat(rs);
      assert.ok(all.length === 3 && all.every((r) => r.ok === true && r.action === 'ignored'), 'results ' + JSON.stringify(all));
    }],
    ['independent orders each fulfilled once across processes', async () => {
      const f = mk();
      const rs = await g(f, [0, 1, 2].map((i) => ({ events: [ev('x' + i, 'o7a'), ev('y' + i, 'o7b')] })));
      const m = {};
      for (const r of rs) for (const [k, v] of Object.entries(r.byOrder)) m[k] = (m[k] || 0) + v;
      assert.deepEqual(m, { o7a: 1, o7b: 1 }, 'per-order fulfillments ' + JSON.stringify(m) + ' expected one each');
    }],
  ];

  let bad = 0;
  for (const [name, fn] of tests) {
    try {
      await fn();
      console.log('PASS ' + name);
    } catch (e) {
      bad++;
      console.log('FAIL ' + name + ': ' + String(e?.message ?? e).split(String.fromCharCode(10))[0]);
    }
  }
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  console.log('SUMMARY ' + (tests.length - bad) + '/' + tests.length + ' passed');
  process.exitCode = bad ? 1 : 0;
}
```

## Scope and limitations
- Verified for these synthetic conditions in this sandbox. Not a production guarantee.
- The fix keeps its idempotency state in a SQLite database file that the frozen verifier shares between several Node processes inside this sandbox, so it was exercised across separate processes and restarts. That is still one machine and one SQLite file: passing this fixture is not a guarantee for other datastores, network partitions, or production load.
- Hashes identify the exact bytes that ran; they are not cryptographic proof of correct behavior. RUNVA claims only the observed assertions above — not formal verification or universal correctness.
- All model-generated code executed only inside CreateOS sandboxes; the RUNVA host never executed it.
