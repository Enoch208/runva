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
