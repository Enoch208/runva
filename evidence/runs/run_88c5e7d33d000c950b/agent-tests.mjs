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
