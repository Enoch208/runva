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
