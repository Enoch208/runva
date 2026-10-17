// RUNVA frozen verifier: webhook-idempotency (output schema runva.verdict.v1).
// Host-owned and never edited by the patching agent. In the sandbox it runs as
//   node /workspace/verification.mjs   against   /workspace/target/handler.mjs
//
// Every case runs in its own worker thread: fresh handler module state, a soft timeout that
// reports partial observations, and a hard kill for busy-loops. Fulfillments are counted in a
// closure the handler cannot reach, and pass/fail is decided in the main thread by comparing those
// observations with the frozen expectations below. The handler's return values never set pass.
// The last stdout line is the JSON verdict; exit code 0 only when all cases pass.
import { Worker, isMainThread, workerData, MessageChannel } from "node:worker_threads";
import { isDeepStrictEqual } from "node:util";

const SCHEMA = "runva.verdict.v1";
const SOFT_TIMEOUT_MS = 2500; // case gives up and reports what it saw
const HARD_TIMEOUT_MS = 4000; // worker is terminated (e.g. synchronous busy-loop)
const FULFILL_DELAY_MS = 25; // simulated fulfillment latency, makes overlap real
const QUIET_MS = 75; // wait after deliveries settle to catch late background fulfillments

const CASES = [
  {
    id: "V1",
    title: "Same event delivered 20 times concurrently fulfills the order once",
    expected: { fulfillments: 1, deliveries: 20, acknowledged: 20 },
  },
  {
    id: "V2",
    title: "Different event IDs for the same payment/order fulfill it once",
    expected: { fulfillments: 1, deliveries: 3, acknowledged: 3 },
  },
  {
    id: "V3",
    title: "Unknown event types are acknowledged and ignored",
    expected: { fulfillments: 0, deliveries: 2, ignored: 2 },
  },
  {
    id: "V4",
    title: "Two different orders are each fulfilled exactly once",
    expected: { fulfillments: 2, perOrder: { order_demo_004a: 1, order_demo_004b: 1 }, fulfilled: 2 },
  },
  {
    id: "V5",
    title: "Failed fulfillment is not marked complete; retry fulfills exactly once",
    expected: { fulfillments: 1, firstDeliveryAcknowledged: false, retryAcknowledged: true, redeliveryAcknowledged: true },
  },
  {
    id: "V6",
    title: "Module exports handleWebhook and fulfills a valid event",
    expected: { exportType: "function", result: { ok: true, action: "fulfilled" }, fulfillments: 1 },
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

// ---------------------------------------------------------------- worker side (one case)

async function runCaseInWorker() {
  // Capture everything we rely on before any candidate code is loaded.
  const caseId = workerData.caseId;
  const port = workerData.port;
  delete workerData.port;
  const post = port.postMessage.bind(port);
  const _setTimeout = globalThis.setTimeout;
  const _clone = globalThis.structuredClone;
  const sleep = (ms) => new Promise((r) => _setTimeout(r, ms));
  const TIMEOUT = Symbol("timeout");

  const ctx = { started: 0, settled: 0, unhandled: 0, uncaught: 0, firstAsyncError: "" };
  process.on("unhandledRejection", (e) => {
    ctx.unhandled++;
    ctx.firstAsyncError ||= errText(e);
  });
  process.on("uncaughtException", (e) => {
    ctx.uncaught++;
    ctx.firstAsyncError ||= errText(e);
  });

  // Counting fulfillment dependency. The ledger lives only in this closure.
  const ledger = Object.create(null); // orderId -> { calls, successes }
  let failuresLeft = caseId === "V5" ? 1 : 0;
  async function fulfillOrder(orderId) {
    const key = typeof orderId === "string" ? orderId : `<${typeof orderId}>`;
    const row = ledger[key] ?? (ledger[key] = { calls: 0, successes: 0 });
    row.calls++;
    const fail = failuresLeft > 0;
    if (fail) failuresLeft--;
    await sleep(FULFILL_DELAY_MS);
    if (fail) throw new Error("simulated transient failure in fulfillOrder");
    row.successes++;
  }
  const deps = Object.freeze({ fulfillOrder });
  const successes = (id) => ledger[id]?.successes ?? 0;
  const totalSuccesses = () => Object.keys(ledger).reduce((n, k) => n + ledger[k].successes, 0);
  const totalCalls = () => Object.keys(ledger).reduce((n, k) => n + ledger[k].calls, 0);
  const perOrder = () => {
    const o = {};
    for (const k of Object.keys(ledger).sort()) if (ledger[k].successes > 0) o[k] = ledger[k].successes;
    return o;
  };

  const paid = (id, pi, orderId) => ({
    id,
    type: "payment_intent.succeeded",
    data: { object: { id: pi, metadata: { order_id: orderId } } },
  });

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
    } catch (e) {
      return { ok: "<throwing getter>", action: undefined };
    }
  }

  // Each delivery gets its own copy of the event and is settled into a plain record.
  function settle(p) {
    ctx.started++;
    return p.then(
      (v) => {
        ctx.settled++;
        return { status: "resolved", ...readResult(v) };
      },
      (e) => {
        ctx.settled++;
        return { status: "rejected", error: errText(e) };
      },
    );
  }
  const single = (handle, ev) => settle(Promise.resolve().then(() => handle(_clone(ev), deps)));
  function concurrent(handle, events) {
    let release;
    const gate = new Promise((r) => (release = r));
    const runs = events.map((ev) => settle(gate.then(() => handle(_clone(ev), deps))));
    release(); // all deliveries start in the same tick, before any fulfillment can finish
    return Promise.all(runs);
  }
  const isAck = (r) => r.status === "resolved" && r.ok === true;
  const describe = (r) => (r.status === "rejected" ? `rejected (${r.error})` : `resolved ok=${r.ok} action=${r.action}`);
  function histogram(rs) {
    const h = {};
    for (const r of rs) {
      const k = r.status === "rejected" ? "rejected" : `${r.ok === true ? "ok" : "ok=" + r.ok}:${r.action}`;
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

  const IMPL = {
    async V1(handle) {
      const order = "order_demo_001";
      const ev = paid("evt_demo_001", "pi_demo_001", order);
      const rs = await concurrent(handle, Array.from({ length: 20 }, () => ev));
      await sleep(QUIET_MS);
      return {
        orders: [order],
        observed: { fulfillments: successes(order), deliveries: rs.length, acknowledged: rs.filter(isAck).length },
        details: `20 overlapping deliveries of evt_demo_001 -> fulfillOrder("${order}") succeeded ${successes(order)}x; results: ${histogram(rs)}${firstRejection(rs)}`,
      };
    },

    async V2(handle) {
      const order = "order_demo_002";
      const a = paid("evt_demo_002_a", "pi_demo_002", order);
      const b = paid("evt_demo_002_b", "pi_demo_002", order);
      const c = paid("evt_demo_002_c", "pi_demo_002", order);
      const rs = await concurrent(handle, [a, b]);
      rs.push(await single(handle, c));
      await sleep(QUIET_MS);
      return {
        orders: [order],
        observed: { fulfillments: successes(order), deliveries: rs.length, acknowledged: rs.filter(isAck).length },
        details: `evt_demo_002_a + evt_demo_002_b (concurrent) then evt_demo_002_c, all for ${order} -> fulfilled ${successes(order)}x; results: ${histogram(rs)}${firstRejection(rs)}`,
      };
    },

    async V3(handle) {
      const events = [
        { id: "evt_demo_003_a", type: "customer.created", data: { object: { id: "cus_demo_003", metadata: { order_id: "order_demo_003" } } } },
        { id: "evt_demo_003_b", type: "payment_intent.payment_failed", data: { object: { id: "pi_demo_003", metadata: { order_id: "order_demo_003" } } } },
      ];
      const rs = [];
      for (const ev of events) rs.push(await single(handle, ev));
      await sleep(QUIET_MS);
      const ignored = rs.filter((r) => isAck(r) && r.action === "ignored").length;
      return {
        observed: { fulfillments: totalSuccesses(), deliveries: rs.length, ignored },
        details: `customer.created -> ${describe(rs[0])}; payment_intent.payment_failed -> ${describe(rs[1])}; fulfillOrder calls: ${totalCalls()}`,
      };
    },

    async V4(handle) {
      const a = paid("evt_demo_004_a", "pi_demo_004a", "order_demo_004a");
      const b = paid("evt_demo_004_b", "pi_demo_004b", "order_demo_004b");
      const rs = await concurrent(handle, [a, b]);
      await sleep(QUIET_MS);
      const fulfilled = rs.filter((r) => isAck(r) && r.action === "fulfilled").length;
      return {
        observed: { fulfillments: totalSuccesses(), perOrder: perOrder(), fulfilled },
        details: `order_demo_004a -> ${describe(rs[0])}; order_demo_004b -> ${describe(rs[1])}`,
      };
    },

    async V5(handle) {
      const order = "order_demo_005";
      const ev = paid("evt_demo_005", "pi_demo_005", order);
      const r1 = await single(handle, ev); // fulfillOrder throws on this attempt
      const r2 = await single(handle, ev); // retry: must fulfill
      const r3 = await single(handle, ev); // redelivery after success: must not fulfill again
      await sleep(QUIET_MS);
      return {
        orders: [order],
        observed: {
          fulfillments: successes(order),
          firstDeliveryAcknowledged: isAck(r1),
          retryAcknowledged: isAck(r2),
          redeliveryAcknowledged: isAck(r3),
        },
        details: `delivery 1 (fulfillOrder fails): ${describe(r1)} | retry: ${describe(r2)} | redelivery: ${describe(r3)}; fulfillOrder calls=${ledger[order]?.calls ?? 0}, successes=${successes(order)}`,
      };
    },

    async V6(handle, exportType) {
      if (exportType !== "function") {
        return {
          observed: { exportType, result: null, fulfillments: 0 },
          details: `handler.mjs must export an async function handleWebhook(event, deps); found ${exportType}`,
        };
      }
      const order = "order_demo_006";
      const r = await single(handle, paid("evt_demo_006", "pi_demo_006", order));
      await sleep(QUIET_MS);
      const result = r.status === "rejected" ? { rejected: r.error } : { ok: r.ok, action: r.action };
      return {
        orders: [order],
        observed: { exportType, result, fulfillments: successes(order) },
        details: `single valid delivery -> ${describe(r)}`,
      };
    },
  };

  async function body() {
    const url = new URL(`./target/handler.mjs?t=${Date.now()}`, import.meta.url);
    let mod;
    try {
      mod = await import(url.href);
    } catch (e) {
      const loc = /handler\.mjs(?:\?[^:\s]*)?:(\d+)/.exec(String(e?.stack ?? ""));
      return {
        observed: { loadError: String(e?.name ?? "Error") },
        details: `handler.mjs failed to load: ${errText(e)}${loc ? ` (line ${loc[1]})` : ""}`,
      };
    }
    let handle, exportType;
    try {
      handle = mod.handleWebhook;
      exportType = typeof handle;
    } catch (e) {
      exportType = "<throwing export>";
    }
    if (caseId !== "V6" && exportType !== "function") {
      return { observed: { exportType }, details: `handleWebhook is not an exported function (found ${exportType})` };
    }
    return IMPL[caseId](handle, exportType);
  }

  let out;
  try {
    out = await Promise.race([body(), sleep(SOFT_TIMEOUT_MS).then(() => TIMEOUT)]);
  } catch (e) {
    out = { observed: { verifierError: true }, details: `case aborted: ${errText(e)}` };
  }
  if (out === TIMEOUT) {
    out = {
      observed: { timedOut: true, fulfillments: totalSuccesses(), settledDeliveries: ctx.settled, deliveries: ctx.started },
      details: `timed out after ${SOFT_TIMEOUT_MS}ms: ${ctx.settled}/${ctx.started} deliveries settled, ${totalSuccesses()} fulfillment(s) so far`,
    };
  }

  const observed = { ...out.observed };
  let details = out.details ?? "";
  if (out.orders) {
    const extra = {};
    for (const k of Object.keys(ledger)) if (!out.orders.includes(k) && ledger[k].successes > 0) extra[k] = ledger[k].successes;
    if (Object.keys(extra).length) {
      observed.unexpectedFulfillments = extra;
      details += `; fulfilled unexpected order id(s): ${Object.keys(extra).join(", ")}`;
    }
  }
  if (ctx.unhandled) observed.unhandledRejections = ctx.unhandled;
  if (ctx.uncaught) observed.uncaughtExceptions = ctx.uncaught;
  if (ctx.unhandled || ctx.uncaught) details += `; async error escaped the handler (would crash a Node process): ${ctx.firstAsyncError}`;

  try {
    post({ observed, details: clip(details) });
  } catch (e) {
    post({ observed: { verifierError: true }, details: `could not report observations: ${errText(e)}` });
  }
  _setTimeout(() => {}, 60_000); // stay alive until the main thread terminates us
}

// ---------------------------------------------------------------- main side (orchestration + verdict)

function runCase(def) {
  return new Promise((resolve) => {
    const { port1, port2 } = new MessageChannel();
    let done = false;
    let worker;
    const finish = (observed, details) => {
      if (done) return;
      done = true;
      clearTimeout(hardTimer);
      port1.close();
      worker?.terminate().catch(() => {});
      resolve({
        id: def.id,
        title: def.title,
        pass: isDeepStrictEqual(observed, def.expected),
        observed,
        expected: def.expected,
        details,
      });
    };
    const hardTimer = setTimeout(
      () => finish({ timedOut: true, terminated: true }, `no result within ${HARD_TIMEOUT_MS}ms (handler blocked the event loop?); case worker terminated`),
      HARD_TIMEOUT_MS,
    );
    port1.once("message", (m) => {
      const observed = m && typeof m.observed === "object" && m.observed !== null ? m.observed : { verifierError: true };
      finish(observed, typeof m?.details === "string" ? m.details : "");
    });
    try {
      worker = new Worker(new URL(import.meta.url), {
        workerData: { caseId: def.id, port: port2 },
        transferList: [port2],
        stdout: true,
        stderr: true,
        env: {},
        resourceLimits: { maxOldGenerationSizeMb: 256 },
      });
    } catch (e) {
      finish({ verifierError: true }, `could not start case worker: ${errText(e)}`);
      return;
    }
    // Candidate output goes to stderr so it can never become the verdict line on stdout.
    const toStderr = (chunk) => process.stderr.write(chunk);
    worker.stdout.on("data", toStderr);
    worker.stderr.on("data", toStderr);
    worker.once("error", (e) => finish({ crashed: true }, `case worker crashed: ${errText(e)}`));
    worker.once("exit", (code) => setTimeout(() => finish({ crashed: true }, `case worker exited (code ${code}) before reporting a result`), 50));
  });
}

const fmt = (o) =>
  o && typeof o === "object"
    ? Object.entries(o)
        .map(([k, v]) => `${k}=${v !== null && typeof v === "object" ? JSON.stringify(v) : v}`)
        .join(" ")
    : String(o);

async function main() {
  const t0 = performance.now();
  let cases;
  try {
    cases = await Promise.all(CASES.map(runCase));
  } catch (e) {
    cases = CASES.map((d) => ({ id: d.id, title: d.title, pass: false, observed: { verifierError: true }, expected: d.expected, details: errText(e) }));
  }
  const pass = cases.length === CASES.length && cases.every((c) => c.pass === true);
  const durationMs = Math.round(performance.now() - t0);

  console.log("RUNVA frozen verifier: webhook-idempotency (target: ./target/handler.mjs)");
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

if (isMainThread) main();
else runCaseInWorker();
