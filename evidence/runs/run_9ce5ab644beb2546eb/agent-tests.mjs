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
