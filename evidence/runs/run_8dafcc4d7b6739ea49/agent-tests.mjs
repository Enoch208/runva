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
