// RUNVA frozen verifier: durable-idempotency (output schema runva.verdict.v1).
// Host-owned and never edited by the patching agent. In the sandbox it runs as
//   node /workspace/verification.mjs   against   /workspace/target/handler.mjs
//
// The handler runs inside separate OS processes ("webhook workers"). Each worker imports it fresh
// and gets deps.db, a node:sqlite DatabaseSync on ONE database file per case that every worker of
// that case opens at the same time (WAL, busy_timeout=5000). Module memory is therefore not shared
// between workers and does not survive a restart (a new worker process).
// Successful fulfillOrder() calls are reported to this parent over the worker's IPC channel, tagged
// with a per-worker secret handed over before the handler is loaded, and counted here: outside the
// db and outside the worker, so the handler cannot fake or erase them. Worker stdout/stderr is routed
// to this process's stderr, so candidate output can never become the verdict line. Every worker has
// a startup timeout, a soft delivery timeout (reports what it saw) and a hard kill of its whole
// process group (busy-loops, hung locks). Pass/fail is decided here by comparing the ledger and the
// deliveries' settled results with the frozen expectations below; handler return values alone never
// set pass. The last stdout line is the JSON verdict; exit code 0 only when all cases pass.
import { execFileSync, fork } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

const SCHEMA = "runva.verdict.v1";
const SELF = fileURLToPath(import.meta.url);
const HERE = path.dirname(SELF);
const WORKER_FLAG = "--runva-webhook-worker";
const FULFILL_DELAY_MS = 25; // simulated fulfillment latency, makes overlap real
const QUIET_MS = 75; // wait after deliveries settle to catch late background fulfillments
const BUSY_TIMEOUT_MS = 5000;
const STARTUP_TIMEOUT_MS = 6000; // spawn + open db + import handler
const SOFT_TIMEOUT_MS = 2500; // worker gives up on its deliveries and reports what it saw
const HARD_TIMEOUT_MS = 4000; // worker process group is killed (event loop blocked)
const CASE_TIMEOUT_MS = 15000; // safety net for a whole case
const CASE_CONCURRENCY = 3;
const OUTPUT_CAP = 16 * 1024; // candidate output forwarded to stderr per worker

const CASES = [
  {
    id: "V1",
    title: "20 deliveries across 4 concurrent worker processes fulfill the order once",
    expected: { fulfillments: 1, deliveries: 20, processes: 4, acknowledged: 20 },
  },
  {
    id: "V2",
    title: "Redelivery after a process restart (same and different event ID) does not fulfill again",
    expected: { fulfillments: 1, deliveries: 3, processes: 2, acknowledged: 3 },
  },
  {
    id: "V3",
    title: "Unknown and non-paid event types are acknowledged and ignored",
    expected: { fulfillments: 0, deliveries: 2, ignored: 2 },
  },
  {
    id: "V4",
    title: "Two different orders delivered from 2 processes are each fulfilled exactly once",
    expected: { fulfillments: 2, perOrder: { order_demo_004a: 1, order_demo_004b: 1 }, fulfilled: 2, processes: 2 },
  },
  {
    id: "V5",
    title: "Failed fulfillment is not marked complete; a new process retries it exactly once",
    expected: { fulfillments: 1, firstDeliveryAcknowledged: false, retryAcknowledged: true, redeliveryAcknowledged: true, processes: 2 },
  },
  {
    id: "V6",
    title: "Module exports handleWebhook, fulfills a valid event and persists state in deps.db",
    expected: { exportType: "function", result: { ok: true, action: "fulfilled" }, fulfillments: 1, persisted: true },
    info: ["tables"], // reported, not compared
  },
];

const clip = (s, n = 400) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
function errText(e) {
  try {
    return clip(e instanceof Error ? `${e.name}: ${e.message}` : String(e), 200);
  } catch {
    return "<unprintable error>";
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const paid = (id, pi, orderId) => ({
  id,
  type: "payment_intent.succeeded",
  data: { object: { id: pi, metadata: { order_id: orderId } } },
});

// ---------------------------------------------------------------- worker process (runs the candidate)

async function workerProcess() {
  // Capture everything we rely on before any candidate code is loaded.
  const send = typeof process.send === "function" ? process.send.bind(process) : null;
  const exit = process.exit.bind(process);
  if (!send) exit(70);
  const _setTimeout = globalThis.setTimeout;
  const _clone = globalThis.structuredClone;
  const wait = (ms) => new Promise((r) => _setTimeout(r, ms));
  const TIMEOUT = Symbol("timeout");

  const ctx = { unhandled: 0, uncaught: 0, firstAsyncError: "" };
  process.on("unhandledRejection", (e) => {
    ctx.unhandled++;
    ctx.firstAsyncError ||= errText(e);
  });
  process.on("uncaughtException", (e) => {
    ctx.uncaught++;
    ctx.firstAsyncError ||= errText(e);
  });
  process.on("disconnect", () => exit(0)); // parent went away

  let release;
  const gate = new Promise((r) => (release = r));
  let gotConfig;
  const configured = new Promise((r) => (gotConfig = r));
  process.on("message", (m) => {
    if (m && m.k === "config") gotConfig(m);
    else if (m && m.k === "go") release();
  });
  const cfg = await configured;
  const token = String(cfg.token);
  const post = (m, cb) => {
    try {
      send({ ...m, t: token }, cb);
    } catch {
      cb?.();
    }
  };

  let db;
  try {
    const { DatabaseSync } = await import("node:sqlite");
    db = new DatabaseSync(cfg.dbPath);
    db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
    db.exec("PRAGMA journal_mode = WAL");
  } catch (e) {
    post({ k: "ready", infraError: `worker could not open the case database with node:sqlite: ${errText(e)}` });
    return;
  }

  let failuresLeft = Number(cfg.failFirst) || 0;
  let calls = 0;
  async function fulfillOrder(orderId) {
    const key = typeof orderId === "string" ? orderId.slice(0, 64) : `<${typeof orderId}>`;
    calls++;
    const fail = failuresLeft > 0;
    if (fail) failuresLeft--;
    await wait(FULFILL_DELAY_MS);
    if (fail) throw new Error("simulated transient failure in fulfillOrder");
    post({ k: "fulfilled", orderId: key }); // counted by the parent, not here
  }
  const deps = Object.freeze({ db, fulfillOrder });

  let handle, exportType;
  try {
    const mod = await import(new URL("./target/handler.mjs", import.meta.url).href);
    try {
      handle = mod.handleWebhook;
      exportType = typeof handle;
    } catch {
      exportType = "<throwing export>";
    }
  } catch (e) {
    const loc = /handler\.mjs(?:\?[^:\s]*)?:(\d+)/.exec(String(e?.stack ?? ""));
    post({
      k: "ready",
      loadError: String(e?.name ?? "Error").slice(0, 40),
      details: `handler.mjs failed to load: ${errText(e)}${loc ? ` (line ${loc[1]})` : ""}`,
    });
    return;
  }
  post({ k: "ready", exportType });
  if (exportType !== "function") return;
  await gate;

  // Read a handler result once, defensively, into plain data.
  function readResult(v) {
    try {
      if (!v || typeof v !== "object") return { ok: `<${v === null ? "null" : typeof v}>`, action: undefined };
      const ok = v.ok;
      const action = v.action;
      return {
        ok: typeof ok === "boolean" ? ok : `<${typeof ok}>`,
        action: typeof action === "string" ? action.slice(0, 32) : action === undefined ? undefined : `<${typeof action}>`,
      };
    } catch {
      return { ok: "<throwing getter>", action: undefined };
    }
  }

  const plan = Array.isArray(cfg.plan) ? cfg.plan : [];
  const records = plan.map(() => ({ status: "pending" }));
  let started = 0;
  let settled = 0;
  const deliver = (i) => {
    started++;
    return Promise.resolve()
      .then(() => handle(_clone(plan[i].event), deps))
      .then(
        (v) => ({ status: "resolved", ...readResult(v) }),
        (e) => ({ status: "rejected", error: errText(e) }),
      )
      .then((rec) => {
        records[i] = rec;
        settled++;
      });
  };
  const run = (async () => {
    if (cfg.sequential) for (let i = 0; i < plan.length; i++) await deliver(i);
    else await Promise.all(plan.map((d, i) => (d.at > 0 ? wait(d.at).then(() => deliver(i)) : deliver(i))));
    await wait(QUIET_MS);
  })();
  const out = await Promise.race([run, wait(SOFT_TIMEOUT_MS).then(() => TIMEOUT)]);
  post(
    {
      k: "done",
      timedOut: out === TIMEOUT,
      records,
      started,
      settled,
      calls,
      unhandled: ctx.unhandled,
      uncaught: ctx.uncaught,
      firstAsyncError: ctx.firstAsyncError,
    },
    () => exit(0),
  );
}

// ---------------------------------------------------------------- parent side: workers

function spawnWorker(cr, label, spec) {
  const token = randomBytes(16).toString("hex");
  const w = { label, child: null, info: null };
  let readyDone = false;
  let runDone = false;
  let startupTimer = null;
  let hardTimer = null;
  let resolveReady, resolveDone, resolveExited;
  w.ready = new Promise((r) => (resolveReady = r));
  w.done = new Promise((r) => (resolveDone = r));
  w.exited = new Promise((r) => (resolveExited = r));

  w.kill = () => {
    const pid = w.child?.pid;
    if (!pid) return;
    try {
      process.kill(-pid, "SIGKILL"); // whole process group: the worker and anything it spawned
    } catch {}
    try {
      w.child.kill("SIGKILL");
    } catch {}
  };
  const settleReady = (info) => {
    if (readyDone) return;
    readyDone = true;
    clearTimeout(startupTimer);
    w.info = info;
    resolveReady(info);
    if (!info.ok) settleDone({ status: "not-started" });
  };
  const settleDone = (res) => {
    if (runDone) return;
    runDone = true;
    clearTimeout(hardTimer);
    settleReady({ ok: false, crashed: true, details: res.details ?? "worker stopped before it was ready" });
    if (res.unhandled || res.uncaught) {
      cr.unhandled += res.unhandled | 0;
      cr.uncaught += res.uncaught | 0;
      cr.firstAsyncError ||= res.firstAsyncError;
    }
    resolveDone(res);
    // A cooperative worker exits on its own right after reporting; remove the group regardless.
    setTimeout(w.kill, res.status === "done" ? 250 : 0);
  };

  w.go = () => {
    if (!w.info?.ok || runDone) return;
    try {
      w.child.send({ k: "go" });
    } catch (e) {
      settleDone({ status: "crashed", details: `could not signal ${label}: ${errText(e)}` });
      return;
    }
    hardTimer = setTimeout(() => settleDone({ status: "killed" }), HARD_TIMEOUT_MS);
  };

  try {
    w.child = fork(SELF, [WORKER_FLAG], {
      cwd: cr.dir,
      env: {},
      execArgv: ["--disable-warning=ExperimentalWarning", "--max-old-space-size=192"],
      silent: true, // stdout/stderr are pipes to us, never our stdout
      detached: true, // own process group, so it can be killed as a whole
      serialization: "json",
    });
  } catch (e) {
    settleReady({ ok: false, infraError: `could not start worker ${label}: ${errText(e)}` });
    resolveExited();
    return w;
  }

  let forwarded = 0;
  const toStderr = (chunk) => {
    if (forwarded >= OUTPUT_CAP) return; // keep draining, stop forwarding
    const s = String(chunk).slice(0, OUTPUT_CAP - forwarded);
    forwarded += s.length;
    process.stderr.write(s);
  };
  w.child.stdout?.on("data", toStderr);
  w.child.stderr?.on("data", toStderr);
  w.child.on("message", (m) => {
    if (!m || typeof m !== "object" || m.t !== token) return; // not from our harness code
    if (m.k === "fulfilled") cr.record(String(m.orderId).slice(0, 64), label);
    else if (m.k === "ready") {
      if (m.infraError) settleReady({ ok: false, infraError: String(m.infraError) });
      else if (m.loadError) settleReady({ ok: false, loadError: String(m.loadError), details: String(m.details ?? "") });
      else settleReady({ ok: m.exportType === "function", exportType: String(m.exportType) });
    } else if (m.k === "done") {
      settleDone({
        status: m.timedOut ? "timeout" : "done",
        records: Array.isArray(m.records) ? m.records : [],
        started: m.started | 0,
        settled: m.settled | 0,
        calls: m.calls | 0,
        unhandled: m.unhandled | 0,
        uncaught: m.uncaught | 0,
        firstAsyncError: String(m.firstAsyncError ?? ""),
      });
    }
  });
  w.child.once("error", (e) => {
    settleReady({ ok: false, crashed: true, details: `${label} failed: ${errText(e)}` });
    settleDone({ status: "crashed", details: `${label} failed: ${errText(e)}` });
  });
  w.child.once("exit", (code, signal) => {
    // Let IPC messages that are already in flight arrive first.
    setTimeout(() => {
      const how = `code ${code}${signal ? `, signal ${signal}` : ""}`;
      settleReady({ ok: false, crashed: true, details: `${label} exited (${how}) while loading handler.mjs` });
      settleDone({ status: "crashed", details: `${label} exited (${how}) before reporting its deliveries (process.exit or a fatal error in the handler?)` });
    }, 100);
  });
  w.child.once("close", () => resolveExited());
  startupTimer = setTimeout(() => settleReady({ ok: false, timedOut: true }), STARTUP_TIMEOUT_MS);

  try {
    w.child.send({ k: "config", token, dbPath: cr.dbPath, plan: spec.plan, failFirst: spec.failFirst ?? 0, sequential: !!spec.sequential });
  } catch (e) {
    settleReady({ ok: false, infraError: `could not configure ${label}: ${errText(e)}` });
  }
  return w;
}

const isAck = (r) => r.status === "resolved" && r.ok === true;
const describe = (r) =>
  !r ? "missing" : r.status === "rejected" ? `rejected (${r.error})` : r.status === "pending" ? "never settled" : `resolved ok=${r.ok} action=${r.action}`;
function histogram(rs) {
  const h = {};
  for (const r of rs) {
    const k = r.status === "rejected" ? "rejected" : r.status === "pending" ? "pending" : `${r.ok === true ? "ok" : "ok=" + r.ok}:${r.action}`;
    h[k] = (h[k] ?? 0) + 1;
  }
  return Object.entries(h)
    .map(([k, n]) => `${k} x${n}`)
    .join(", ");
}
const firstRejection = (rs) => {
  const r = rs.find((x) => x.status === "rejected");
  return r ? `; first rejection: ${r.error}` : "";
};

function startupProblem(cr, label, info) {
  if (info.infraError) return { observed: { verifierError: true }, details: info.infraError };
  if (info.loadError) return { observed: { loadError: info.loadError }, details: info.details };
  if (info.exportType) return { observed: { exportType: info.exportType }, details: `handleWebhook is not an exported function (found ${info.exportType})`, exportType: info.exportType };
  if (info.timedOut)
    return {
      observed: { timedOut: true, phase: "startup" },
      details: `${label} did not finish loading handler.mjs within ${STARTUP_TIMEOUT_MS}ms (top-level hang or busy-loop?); worker killed`,
    };
  return { observed: { crashed: true, phase: "startup" }, details: info.details ?? `${label} stopped while loading handler.mjs` };
}

function runProblem(cr, label, res) {
  if (res.status === "timeout")
    return {
      observed: { timedOut: true, fulfillments: cr.total(), settledDeliveries: res.settled, deliveries: res.started },
      details: `${label} timed out after ${SOFT_TIMEOUT_MS}ms: ${res.settled}/${res.started} of its deliveries settled, ${cr.total()} fulfillment(s) so far`,
    };
  if (res.status === "killed")
    return {
      observed: { timedOut: true, terminated: true, fulfillments: cr.total() },
      details: `${label} reported nothing within ${HARD_TIMEOUT_MS}ms of starting deliveries (handler blocked the event loop or a db lock?); worker process group killed`,
    };
  return { observed: { crashed: true, fulfillments: cr.total() }, details: res.details ?? `${label} stopped before reporting` };
}

// Start workers, wait until every one has loaded the handler, release them together, collect results.
async function together(cr, workers) {
  const infos = await Promise.all(workers.map((w) => w.ready));
  const bad = infos.findIndex((i) => !i.ok);
  if (bad >= 0) {
    workers.forEach((w) => w.kill());
    return { problem: startupProblem(cr, workers[bad].label, infos[bad]) };
  }
  for (const w of workers) w.go(); // barrier: all workers start delivering at the same moment
  const results = await Promise.all(workers.map((w) => w.done));
  await Promise.all(workers.map((w) => Promise.race([w.exited, sleep(1500)])));
  const badRun = results.findIndex((r) => r.status !== "done");
  if (badRun >= 0) return { problem: runProblem(cr, workers[badRun].label, results[badRun]) };
  return { results };
}

// ---------------------------------------------------------------- parent side: cases

let sqliteModule;
async function loadSqlite() {
  if (sqliteModule) return sqliteModule;
  const emit = process.emitWarning;
  process.emitWarning = function (warning, ...rest) {
    const type = typeof rest[0] === "string" ? rest[0] : rest[0]?.type;
    if (type === "ExperimentalWarning" && /sqlite/i.test(String(warning))) return;
    return emit.call(this, warning, ...rest);
  };
  try {
    sqliteModule = await import("node:sqlite");
  } finally {
    process.emitWarning = emit;
  }
  return sqliteModule;
}

function inspectDb(DatabaseSync, dbPath) {
  const db = new DatabaseSync(dbPath);
  try {
    db.exec("PRAGMA busy_timeout = 2000");
    const names = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\' ORDER BY name")
      .all()
      .map((r) => String(r.name));
    const tables = {};
    for (const n of names.slice(0, 20)) {
      try {
        tables[n.slice(0, 64)] = Number(db.prepare(`SELECT count(*) AS n FROM "${n.replaceAll('"', '""')}"`).get().n);
      } catch {
        tables[n.slice(0, 64)] = null;
      }
    }
    return tables;
  } finally {
    db.close();
  }
}

const IMPL = {
  async V1(cr) {
    const order = "order_demo_001";
    const ev = paid("evt_demo_001", "pi_demo_001", order);
    const plan = Array.from({ length: 5 }, (_, k) => ({ event: ev, at: k * 3 })); // overlapping, 0-12ms apart
    const workers = ["P1", "P2", "P3", "P4"].map((l) => cr.spawn(l, { plan }));
    const g = await together(cr, workers);
    if (g.problem) return g.problem;
    const rs = g.results.flatMap((r) => r.records);
    const per = workers.map((w) => `${w.label}:${cr.perWorker[w.label] ?? 0}`).join(" ");
    return {
      orders: [order],
      observed: { fulfillments: cr.count(order), deliveries: rs.length, processes: workers.length, acknowledged: rs.filter(isAck).length },
      details: `4 processes x 5 overlapping deliveries of evt_demo_001 -> fulfillOrder("${order}") succeeded ${cr.count(order)}x (per process ${per}); results: ${histogram(rs)}${firstRejection(rs)}`,
    };
  },

  async V2(cr) {
    const order = "order_demo_002";
    const a = paid("evt_demo_002_a", "pi_demo_002", order);
    const b = paid("evt_demo_002_b", "pi_demo_002", order);
    const g1 = await together(cr, [cr.spawn("P1", { plan: [{ event: a }] })]);
    if (g1.problem) return g1.problem;
    const afterP1 = cr.count(order);
    // P1 has exited. P2 is a restarted worker: fresh module, same db file.
    const g2 = await together(cr, [cr.spawn("P2", { plan: [{ event: a }, { event: b }] })]);
    if (g2.problem) return g2.problem;
    const rs = [...g1.results[0].records, ...g2.results[0].records];
    return {
      orders: [order],
      observed: { fulfillments: cr.count(order), deliveries: rs.length, processes: 2, acknowledged: rs.filter(isAck).length },
      details: `P1: evt_demo_002_a -> ${describe(rs[0])} (fulfilled ${afterP1}x), P1 exited | P2 (restarted, fresh import, same db): evt_demo_002_a redelivery -> ${describe(rs[1])}, evt_demo_002_b (same order) -> ${describe(rs[2])} | total fulfillments for ${order}: ${cr.count(order)}`,
    };
  },

  async V3(cr) {
    const events = [
      { id: "evt_demo_003_a", type: "customer.created", data: { object: { id: "cus_demo_003", metadata: { order_id: "order_demo_003" } } } },
      { id: "evt_demo_003_b", type: "payment_intent.payment_failed", data: { object: { id: "pi_demo_003", metadata: { order_id: "order_demo_003" } } } },
    ];
    const g = await together(cr, [cr.spawn("P1", { plan: events.map((event) => ({ event })), sequential: true })]);
    if (g.problem) return g.problem;
    const rs = g.results[0].records;
    return {
      observed: { fulfillments: cr.total(), deliveries: rs.length, ignored: rs.filter((r) => isAck(r) && r.action === "ignored").length },
      details: `customer.created -> ${describe(rs[0])}; payment_intent.payment_failed -> ${describe(rs[1])}; fulfillOrder calls: ${g.results[0].calls}`,
    };
  },

  async V4(cr) {
    const a = paid("evt_demo_004_a", "pi_demo_004a", "order_demo_004a");
    const b = paid("evt_demo_004_b", "pi_demo_004b", "order_demo_004b");
    const g = await together(cr, [cr.spawn("P1", { plan: [{ event: a }] }), cr.spawn("P2", { plan: [{ event: b }] })]);
    if (g.problem) return g.problem;
    const rs = g.results.flatMap((r) => r.records);
    const perOrder = {};
    for (const k of Object.keys(cr.ledger).sort()) perOrder[k] = cr.ledger[k];
    return {
      observed: { fulfillments: cr.total(), perOrder, fulfilled: rs.filter((r) => isAck(r) && r.action === "fulfilled").length, processes: 2 },
      details: `P1 order_demo_004a -> ${describe(rs[0])}; P2 order_demo_004b -> ${describe(rs[1])} (concurrent)`,
    };
  },

  async V5(cr) {
    const order = "order_demo_005";
    const ev = paid("evt_demo_005", "pi_demo_005", order);
    const g1 = await together(cr, [cr.spawn("P1", { plan: [{ event: ev }], failFirst: 1 })]); // fulfillOrder throws
    if (g1.problem) return g1.problem;
    const g2 = await together(cr, [cr.spawn("P2", { plan: [{ event: ev }, { event: ev }], sequential: true })]); // retry, then redelivery
    if (g2.problem) return g2.problem;
    const [r1] = g1.results[0].records;
    const [r2, r3] = g2.results[0].records;
    return {
      orders: [order],
      observed: {
        fulfillments: cr.count(order),
        firstDeliveryAcknowledged: isAck(r1),
        retryAcknowledged: isAck(r2),
        redeliveryAcknowledged: isAck(r3),
        processes: 2,
      },
      details: `P1 delivery (fulfillOrder fails): ${describe(r1)}, P1 exited | P2 retry: ${describe(r2)} | P2 redelivery: ${describe(r3)}; fulfillOrder calls P1=${g1.results[0].calls} P2=${g2.results[0].calls}, successes=${cr.count(order)}`,
    };
  },

  async V6(cr) {
    const order = "order_demo_006";
    const g = await together(cr, [cr.spawn("P1", { plan: [{ event: paid("evt_demo_006", "pi_demo_006", order) }] })]);
    if (g.problem?.exportType)
      return {
        observed: { exportType: g.problem.exportType, result: null, fulfillments: 0, persisted: false },
        details: `handler.mjs must export an async function handleWebhook(event, deps); found ${g.problem.exportType}`,
      };
    if (g.problem) return g.problem;
    const [r] = g.results[0].records;
    let tables;
    let inspectErr = "";
    try {
      tables = inspectDb((await loadSqlite()).DatabaseSync, cr.dbPath);
    } catch (e) {
      tables = {};
      inspectErr = `; could not inspect deps.db: ${errText(e)}`;
    }
    const names = Object.keys(tables);
    const persisted = names.length > 0 && names.some((n) => tables[n] > 0);
    return {
      orders: [order],
      observed: {
        exportType: "function",
        result: r.status === "rejected" ? { rejected: r.error } : r.status === "pending" ? { pending: true } : { ok: r.ok, action: r.action },
        fulfillments: cr.count(order),
        persisted,
        tables,
      },
      details: `single valid delivery in a fresh process -> ${describe(r)}; deps.db user tables (rows): ${names.length ? names.map((n) => `${n}(${tables[n]})`).join(", ") : "none"}${persisted ? "" : " -> nothing persisted in deps.db"}${inspectErr}`,
    };
  },
};

function newCaseRun(dir) {
  const cr = {
    dir,
    dbPath: path.join(dir, "webhooks.db"),
    ledger: Object.create(null), // orderId -> successful fulfillOrder calls (all workers)
    perWorker: Object.create(null),
    workers: [],
    unhandled: 0,
    uncaught: 0,
    firstAsyncError: "",
  };
  cr.record = (orderId, label) => {
    cr.ledger[orderId] = (cr.ledger[orderId] ?? 0) + 1;
    cr.perWorker[label] = (cr.perWorker[label] ?? 0) + 1;
  };
  cr.count = (orderId) => cr.ledger[orderId] ?? 0;
  cr.total = () => Object.keys(cr.ledger).reduce((n, k) => n + cr.ledger[k], 0);
  cr.spawn = (label, spec) => {
    const w = spawnWorker(cr, label, spec);
    cr.workers.push(w);
    return w;
  };
  return cr;
}

async function runCase(def, runDir) {
  let out;
  let cr;
  try {
    const dir = path.join(runDir, def.id);
    mkdirSync(dir, { recursive: true });
    cr = newCaseRun(dir);
    const { DatabaseSync } = await loadSqlite();
    const db = new DatabaseSync(cr.dbPath); // fresh, isolated database file for this case
    db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
    db.exec("PRAGMA journal_mode = WAL");
    db.close();
    let capTimer;
    out = await Promise.race([
      IMPL[def.id](cr),
      new Promise((r) => {
        capTimer = setTimeout(
          () => r({ observed: { timedOut: true, phase: "case", fulfillments: cr.total() }, details: `case did not finish within ${CASE_TIMEOUT_MS}ms; workers killed` }),
          CASE_TIMEOUT_MS,
        );
      }),
    ]);
    clearTimeout(capTimer);
  } catch (e) {
    out = { observed: { verifierError: true }, details: `case aborted: ${errText(e)}` };
  }
  if (cr) {
    for (const w of cr.workers) w.kill();
    await Promise.all(cr.workers.map((w) => Promise.race([w.exited, sleep(1500)])));
  }

  const observed = { ...out.observed };
  let details = out.details ?? "";
  if (cr && out.orders) {
    const extra = {};
    for (const k of Object.keys(cr.ledger)) if (!out.orders.includes(k)) extra[k] = cr.ledger[k];
    if (Object.keys(extra).length) {
      observed.unexpectedFulfillments = extra;
      details += `; fulfilled unexpected order id(s): ${Object.keys(extra).join(", ")}`;
    }
  }
  if (cr?.unhandled) observed.unhandledRejections = cr.unhandled;
  if (cr?.uncaught) observed.uncaughtExceptions = cr.uncaught;
  if (cr && (cr.unhandled || cr.uncaught)) details += `; async error escaped the handler (would crash a Node process): ${cr.firstAsyncError}`;

  const compared = { ...observed };
  for (const k of def.info ?? []) delete compared[k];
  return {
    id: def.id,
    title: def.title,
    pass: isDeepStrictEqual(compared, def.expected),
    observed,
    expected: def.expected,
    details: clip(details, 600),
  };
}

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

const fmt = (o) =>
  o && typeof o === "object"
    ? Object.entries(o)
        .map(([k, v]) => `${k}=${v !== null && typeof v === "object" ? JSON.stringify(v) : v}`)
        .join(" ")
    : String(o);

async function main() {
  const t0 = performance.now();
  const runDir = path.join(HERE, "state", `verify-${process.pid}-${Date.now().toString(36)}`);
  let cases;
  try {
    cases = await pool(CASES, CASE_CONCURRENCY, (def) => runCase(def, runDir));
  } catch (e) {
    cases = CASES.map((d) => ({ id: d.id, title: d.title, pass: false, observed: { verifierError: true }, expected: d.expected, details: errText(e) }));
  }
  try {
    rmSync(runDir, { recursive: true, force: true });
  } catch {}
  // ESM SyntaxErrors carry no location in e.stack; ask `node --check` for the line (no candidate code runs).
  if (cases.some((c) => c.observed?.loadError === "SyntaxError" && !/\(line \d+\)/.test(c.details))) {
    let line = null;
    try {
      execFileSync(process.execPath, ["--check", path.join(HERE, "target", "handler.mjs")], { stdio: "pipe", timeout: 5000, env: {} });
    } catch (e) {
      line = /handler\.mjs:(\d+)/.exec(String(e?.stderr ?? ""))?.[1] ?? null;
    }
    if (line) for (const c of cases) if (c.observed?.loadError === "SyntaxError") c.details += ` (line ${line})`;
  }
  const pass = cases.length === CASES.length && cases.every((c) => c.pass === true);
  const durationMs = Math.round(performance.now() - t0);

  console.log("RUNVA frozen verifier: durable-idempotency (target: ./target/handler.mjs, separate worker processes sharing one SQLite db per case)");
  for (const c of cases) {
    console.log(`${c.pass ? "PASS" : "FAIL"} ${c.id} ${c.title}`);
    console.log(`     observed ${fmt(c.observed)}`);
    console.log(`     expected ${fmt(c.expected)}`);
    if (c.details) console.log(`     ${c.details}`);
  }
  console.log(`RESULT ${pass ? "PASS" : "FAIL"}: ${cases.filter((c) => c.pass).length}/${CASES.length} cases passed in ${durationMs}ms`);

  const verdict = { schema: SCHEMA, pass, cases, durationMs };
  const code = pass ? 0 : 1;
  setTimeout(() => process.exit(code), 2000).unref();
  process.stdout.write(JSON.stringify(verdict) + "\n", () => process.exit(code));
}

if (process.argv[2] === WORKER_FLAG) workerProcess();
else main();
