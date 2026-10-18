#!/usr/bin/env node
// RUNVA real-Stripe-event replay. A SEPARATE proof from the main RUNVA loop (which uses synthetic events):
//
//   1. On the host, create a REAL Stripe TEST-MODE PaymentIntent (pm_card_visa, confirmed) and fetch the
//      real `payment_intent.succeeded` event that Stripe generated for it.
//   2. In ONE fresh CreateOS VM, deliver that same real event 20x concurrently (the way Stripe retries
//      redeliver the same event id) to the original vulnerable handler and to the agent-patched handler from
//      evidence/runs/run_9ce5ab644beb2546eb, counting fulfillments in a host-owned harness.
//
//   set -a; . ./.env; set +a
//   node web/scripts/stripe-replay.mjs
//
// env: STRIPE_TEST_SECRET_KEY (required, must start with sk_test_, never printed or written)
//      CREATEOS_SANDBOX_API_KEY (required, never printed or written)
//      CREATEOS_SANDBOX_BASE_URL (default https://api-eu.sb.createos.sh)
//
// Handlers are only ever executed inside the VM. The host reads them as text, hashes and uploads them.
// Exit codes: 0 = replay ran and patched handler fulfilled exactly once, 1 = replay ran but the result differs,
//             2 = usage / key / hash refusal, 3 = infra error (Stripe or CreateOS).
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@nodeops-createos/sandbox";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, "..", "..");
const BASELINE_PATH = path.join(HERE, "..", "fixtures", "webhook-idempotency", "handler.vulnerable.mjs");
const RUN_ID = "run_9ce5ab644beb2546eb";
const RUN_DIR = path.join(REPO, "evidence", "runs", RUN_ID);
const PATCH_PATH = path.join(RUN_DIR, "patch.diff");
const SHAPE = "s-1vcpu-1gb";
const ROOTFS = "devbox:1";
// NON-EMPTY allowlist. An empty list means allow-all on CreateOS, so never send [].
const EGRESS = ["registry.npmjs.org:443"];
const DELIVERIES = 20;
const FULFILL_DELAY_MS = 25;
const STRIPE_API = "https://api.stripe.com/v1";

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const short = (id) => (id && id.length > 12 ? `${id.slice(0, 10)}…` : String(id));
const rel = (p) => path.relative(REPO, p);

const STRIPE_KEY = process.env.STRIPE_TEST_SECRET_KEY || "";
const CREATEOS_KEY = process.env.CREATEOS_SANDBOX_API_KEY || "";
const SECRETS = [STRIPE_KEY, CREATEOS_KEY, process.env.OPENROUTER_API_KEY || ""].filter((s) => s.length >= 8);
const KEYLIKE = /\b(?:sk|rk|pk)_(?:test|live)_[A-Za-z0-9]{8,}|\bwhsec_[A-Za-z0-9]{8,}|\bsk-[A-Za-z0-9_-]{12,}/g;
const redact = (s) => {
  let out = String(s ?? "");
  for (const k of SECRETS) out = out.split(k).join("[redacted]");
  return out.replace(KEYLIKE, "[redacted]");
};
const errText = (e) => redact(e instanceof Error ? `${e.name}: ${e.message}` : String(e));

const logLines = [];
const log = (...a) => {
  const line = redact(a.join(" "));
  logLines.push(line);
  console.log(line);
};
const logErr = (...a) => {
  const line = redact(a.join(" "));
  logLines.push(line);
  console.error(line);
};

function refuse(msg) {
  console.error(`refusing to run: ${msg}`);
  process.exit(2);
}
if (!STRIPE_KEY) refuse("STRIPE_TEST_SECRET_KEY is not set");
if (!STRIPE_KEY.startsWith("sk_test_")) refuse("STRIPE_TEST_SECRET_KEY must be a TEST-MODE secret key (sk_test_...)");
if (!CREATEOS_KEY) refuse("CREATEOS_SANDBOX_API_KEY is not set");

// ---------------------------------------------------------------- handlers (read as text only, never imported on the host)

/** Same extraction as reverify.mjs: a RUNVA patch file carries the complete final source as "# " lines at its tail. */
function extractFinalHandler(file) {
  const raw = readFileSync(file, "utf8");
  const marker = raw.split("\n").findIndex((l) => l.trim() === "# Final handler.mjs (complete source)");
  if (marker < 0) throw new Error(`${rel(file)} has no "# Final handler.mjs (complete source)" section`);
  const lines = raw.split("\n").slice(marker + 2); // skip the "# ----" separator after the marker
  while (lines.length && !lines[lines.length - 1].startsWith("#")) lines.pop();
  return lines.map((l) => (l.startsWith("# ") ? l.slice(2) : l === "#" ? "" : l)).join("\n");
}

const baselineSource = readFileSync(BASELINE_PATH, "utf8");
const patchedSource = extractFinalHandler(PATCH_PATH);
const baselineSha = sha256(Buffer.from(baselineSource, "utf8"));
const patchedSha = sha256(Buffer.from(patchedSource, "utf8"));
const summary = JSON.parse(readFileSync(path.join(RUN_DIR, "summary.json"), "utf8"));
const receipt = JSON.parse(readFileSync(path.join(RUN_DIR, "receipt.json"), "utf8"));
const recorded = {
  baseline: [summary.baselineSha256, receipt.hashes?.baselineHandler],
  patched: [summary.finalResult?.handlerSha256, receipt.hashes?.candidateHandler],
};
if (!recorded.baseline.every((h) => h === baselineSha))
  refuse(`baseline sha256 ${baselineSha} does not match ${RUN_ID} summary/receipt (${recorded.baseline.join(", ")})`);
if (!recorded.patched.every((h) => h === patchedSha))
  refuse(`patched sha256 ${patchedSha} does not match ${RUN_ID} summary/receipt (${recorded.patched.join(", ")})`);

// ---------------------------------------------------------------- replay harness (host-owned, Node built-ins only, runs in the VM)

const HARNESS = `// RUNVA real-Stripe-event replay harness (host-owned; runs inside the CreateOS VM; Node built-ins only).
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const DELIVERIES = ${DELIVERIES};
const FULFILL_DELAY_MS = ${FULFILL_DELAY_MS};
const HANDLERS = [
  ["baseline", "/workspace/baseline/handler.mjs"],
  ["patched", "/workspace/patched/handler.mjs"],
];
const rawEvent = readFileSync("/workspace/stripe-event.json", "utf8");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Results go to the real stdout; anything a handler logs is routed to stderr so it can't forge a result line.
const emit = process.stdout.write.bind(process.stdout);
for (const m of ["log", "info", "debug"]) console[m] = (...a) => console.error(...a);

let failed = false;
for (const [name, file] of HANDLERS) {
  const mod = await import(pathToFileURL(file).href + "?fresh=" + Date.now());
  if (typeof mod.handleWebhook !== "function") throw new Error(name + ": handleWebhook export missing");
  const calls = new Map(); // orderId -> fulfillOrder call count, kept in the harness's own closure
  const deps = {
    async fulfillOrder(orderId) {
      calls.set(orderId, (calls.get(orderId) || 0) + 1);
      await sleep(FULFILL_DELAY_MS);
    },
  };
  const probe = JSON.parse(rawEvent);
  const orderId = probe.data.object.metadata.order_id;
  const t0 = Date.now();
  // Each delivery parses its own copy of the body, like separate HTTP redeliveries of the same event id.
  const settled = await Promise.race([
    Promise.allSettled(Array.from({ length: DELIVERIES }, () => mod.handleWebhook(JSON.parse(rawEvent), deps))),
    sleep(10_000).then(() => null),
  ]);
  if (!settled) {
    failed = true;
    emit(JSON.stringify({ handler: name, error: "timeout after 10s" }) + "\\n");
    continue;
  }
  const actions = {};
  let acknowledged = 0;
  let rejected = 0;
  for (const s of settled) {
    if (s.status === "fulfilled") {
      if (s.value && s.value.ok === true) acknowledged++;
      const a = String(s.value && s.value.action);
      actions[a] = (actions[a] || 0) + 1;
    } else rejected++;
  }
  emit(
    JSON.stringify({
      handler: name,
      deliveries: DELIVERIES,
      fulfillments: calls.get(orderId) || 0,
      acknowledged,
      orderId,
      eventId: probe.id,
      eventType: probe.type,
      totalFulfillOrderCalls: [...calls.values()].reduce((a, b) => a + b, 0),
      rejected,
      actions,
      durationMs: Date.now() - t0,
    }) + "\\n",
  );
}
process.exit(failed ? 1 : 0);
`;

// ---------------------------------------------------------------- Stripe (test mode, host side)

const stripeAuth = `Basic ${Buffer.from(`${STRIPE_KEY}:`).toString("base64")}`;
async function stripe(method, pathname, form, idempotencyKey) {
  const headers = { Authorization: stripeAuth };
  let body;
  if (form) {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    body = new URLSearchParams(form).toString();
  }
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  const res = await fetch(`${STRIPE_API}${pathname}`, { method, headers, body });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Stripe ${method} ${pathname} -> HTTP ${res.status}: ${json?.error?.message ?? "no message"}`);
  return json;
}

// ---------------------------------------------------------------- CreateOS

const client = createClient({
  apiKey: CREATEOS_KEY,
  baseUrl: (process.env.CREATEOS_SANDBOX_BASE_URL || "https://api-eu.sb.createos.sh").replace(/\/+$/, ""),
});

async function createFresh() {
  const name = `runva-st-${randomBytes(4).toString("hex")}`; // CreateOS caps names at 22 chars
  const spec = { shape: SHAPE, rootfs: ROOTFS, ingress_enabled: false, egress: EGRESS, name };
  for (let attempt = 1; ; attempt++) {
    try {
      return { sb: await client.createSandbox(spec, { timeoutMs: 120_000, retry: false }), name };
    } catch (e) {
      const status = e?.status ?? e?.statusCode;
      const busy = status === 429 || status === 403 || /rate|limit|quota|concurren|one sandbox/i.test(String(e?.message));
      if (attempt === 1 && busy) {
        log(`  createSandbox refused (${errText(e)}); waiting 20s and retrying once`);
        await sleep(20_000);
        continue;
      }
      throw e;
    }
  }
}

async function run(sb, cmd, args, timeoutMs = 60_000) {
  const r = await sb.runCommand(cmd, args, { timeoutMs, retry: false });
  return {
    exitCode: typeof r.result.exit_code === "number" ? r.result.exit_code : -1,
    stdout: r.result.stdout || "",
    stderr: (r.result.stderr || "") + (r.result.error ? `\n[agent error] ${r.result.error}` : ""),
    execMs: r.exec_ms,
  };
}

// ---------------------------------------------------------------- main

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const OUT_DIR = path.join(REPO, "evidence", "stripe", stamp);
const result = {
  schema: "runva.stripe-replay.v1",
  createdAt: new Date().toISOString(),
  note: "Real Stripe TEST-MODE event replayed inside a CreateOS VM. Separate from the main RUNVA loop, which uses synthetic events. No real money moved.",
  stripe: null,
  inputs: {
    baseline: { path: rel(BASELINE_PATH), sha256: baselineSha, recordedIn: `${RUN_ID} summary.baselineSha256 + receipt.hashes.baselineHandler` },
    patched: { source: `${rel(PATCH_PATH)} (embedded final source)`, sha256: patchedSha, recordedIn: `${RUN_ID} summary.finalResult.handlerSha256 + receipt.hashes.candidateHandler` },
    harness: { path: "replay-harness.mjs", sha256: sha256(Buffer.from(HARNESS, "utf8")) },
    event: null,
  },
  sandbox: null,
  command: null,
  results: null,
  timings: {},
  outcome: null,
};

let exitCode = 3;
let sb;
const t0 = Date.now();
try {
  mkdirSync(OUT_DIR, { recursive: true });
  log("RUNVA real Stripe test-mode event replay");
  log(`  baseline  ${rel(BASELINE_PATH)} sha256 ${baselineSha} (matches ${RUN_ID})`);
  log(`  patched   ${rel(PATCH_PATH)} final source sha256 ${patchedSha} (matches ${RUN_ID})`);

  // 1. Real Stripe test-mode PaymentIntent -> real payment_intent.succeeded event.
  const orderId = `order_stripe_${randomBytes(3).toString("hex")}`;
  const s0 = Date.now();
  const pi = await stripe(
    "POST",
    "/payment_intents",
    {
      amount: "2900",
      currency: "usd",
      payment_method: "pm_card_visa",
      confirm: "true",
      "automatic_payment_methods[enabled]": "true",
      "automatic_payment_methods[allow_redirects]": "never",
      "metadata[order_id]": orderId,
    },
    `runva-replay-${orderId}`,
  );
  result.timings.paymentIntentMs = Date.now() - s0;
  if (pi.livemode !== false) throw new Error("PaymentIntent is not test mode; aborting");
  log(`  stripe    PaymentIntent ${pi.id} status=${pi.status} amount=${pi.amount} ${pi.currency} livemode=${pi.livemode} order_id=${orderId} (${result.timings.paymentIntentMs}ms)`);
  if (pi.status !== "succeeded") throw new Error(`PaymentIntent status is ${pi.status}, expected succeeded`);

  const e0 = Date.now();
  let event;
  let polls = 0;
  while (!event && Date.now() - e0 < 20_000) {
    polls++;
    const list = await stripe("GET", "/events?type=payment_intent.succeeded&limit=10");
    event = (list.data || []).find((ev) => ev?.data?.object?.id === pi.id);
    if (!event) await sleep(2_000);
  }
  result.timings.eventPollMs = Date.now() - e0;
  if (!event) throw new Error(`no payment_intent.succeeded event for ${pi.id} after ${polls} polls`);
  if (event.livemode !== false) throw new Error("event is not test mode; aborting");

  // Keep Stripe's event as-is except: drop `request`, and blank the PaymentIntent client_secret (a credential-like
  // string the handler never reads). Everything else (event id, type, created, data.object) is Stripe's own bytes.
  const sanitized = [];
  delete event.request;
  sanitized.push("dropped top-level `request`");
  if (event.data?.object && "client_secret" in event.data.object) {
    event.data.object.client_secret = "[redacted by RUNVA]";
    sanitized.push("redacted data.object.client_secret");
  }
  const eventJson = JSON.stringify(event, null, 2) + "\n";
  for (const k of SECRETS) if (eventJson.includes(k)) throw new Error("event JSON contains a secret value; refusing to save");
  const keyLike = eventJson.match(KEYLIKE) || [];
  const clientSecretLike = eventJson.match(/_secret_[A-Za-z0-9]+/g) || [];
  if (keyLike.length || clientSecretLike.length) throw new Error("event JSON contains key-like strings; refusing to save");
  writeFileSync(path.join(OUT_DIR, "stripe-event.json"), eventJson);
  writeFileSync(path.join(OUT_DIR, "replay-harness.mjs"), HARNESS);
  const eventSha = sha256(Buffer.from(eventJson, "utf8"));
  result.stripe = {
    mode: "test",
    livemode: false,
    paymentIntentId: pi.id,
    paymentIntentStatus: pi.status,
    amount: pi.amount,
    currency: pi.currency,
    paymentMethod: "pm_card_visa",
    orderId,
    eventId: event.id,
    eventType: event.type,
    eventCreated: event.created,
    eventApiVersion: event.api_version,
    eventPolls: polls,
  };
  result.inputs.event = { path: "stripe-event.json", sha256: eventSha, sanitized, keyLikeStringsFound: 0 };
  log(`  stripe    event ${event.id} type=${event.type} created=${new Date(event.created * 1000).toISOString()} livemode=${event.livemode} (found after ${polls} poll(s), ${result.timings.eventPollMs}ms)`);
  log(`  event     saved ${rel(path.join(OUT_DIR, "stripe-event.json"))} sha256 ${eventSha} (${sanitized.join("; ")}; 0 key-like strings)`);

  // 2. One fresh CreateOS VM: upload both handlers, the real event and the harness; run the harness with node.
  const c0 = Date.now();
  const created = await createFresh();
  sb = created.sb;
  result.timings.sandboxCreateMs = Date.now() - c0;
  const egress = sb.data?.egress?.length ? sb.data.egress : EGRESS;
  result.sandbox = {
    idShort: short(sb.id),
    name: created.name,
    shape: SHAPE,
    rootfs: ROOTFS,
    baseUrl: (process.env.CREATEOS_SANDBOX_BASE_URL || "https://api-eu.sb.createos.sh").replace(/\/+$/, ""),
    ingressEnabled: false,
    egress,
    destroyed: false,
  };
  log(`  sandbox   ${short(sb.id)} created in ${result.timings.sandboxCreateMs}ms · shape ${SHAPE} · rootfs ${ROOTFS} · ingress off · egress ${egress.join(",")}`);

  const mk = await run(sb, "mkdir", ["-p", "/workspace/baseline", "/workspace/patched"], 30_000);
  if (mk.exitCode !== 0) throw new Error(`mkdir failed (exit ${mk.exitCode}): ${mk.stderr.trim()}`);
  const uploads = {
    "/workspace/baseline/handler.mjs": baselineSource,
    "/workspace/patched/handler.mjs": patchedSource,
    "/workspace/stripe-event.json": eventJson,
    "/workspace/replay.mjs": HARNESS,
  };
  for (const [p, content] of Object.entries(uploads)) await sb.files.upload(p, content);

  const sums = await run(sb, "sha256sum", Object.keys(uploads), 30_000);
  const inVm = Object.fromEntries(
    sums.stdout
      .trim()
      .split("\n")
      .map((l) => l.trim().split(/\s+/))
      .filter((p) => p.length === 2)
      .map(([h, f]) => [f, h]),
  );
  const expected = {
    "/workspace/baseline/handler.mjs": baselineSha,
    "/workspace/patched/handler.mjs": patchedSha,
    "/workspace/stripe-event.json": eventSha,
    "/workspace/replay.mjs": result.inputs.harness.sha256,
  };
  let allMatch = true;
  for (const [p, h] of Object.entries(expected)) {
    const ok = inVm[p] === h;
    allMatch &&= ok;
    log(`  in-VM     ${p} ${inVm[p] ?? "unavailable"} ${ok ? "(matches)" : "(MISMATCH)"}`);
  }
  result.inputs.baseline.inVmSha256 = inVm["/workspace/baseline/handler.mjs"] ?? null;
  result.inputs.patched.inVmSha256 = inVm["/workspace/patched/handler.mjs"] ?? null;
  result.inputs.event.inVmSha256 = inVm["/workspace/stripe-event.json"] ?? null;
  result.inputs.harness.inVmSha256 = inVm["/workspace/replay.mjs"] ?? null;
  if (!allMatch) throw new Error("uploaded bytes do not match the host hashes");

  const node = await run(sb, "node", ["--version"], 30_000);
  result.sandbox.nodeVersion = node.stdout.trim();
  log(`  node      ${result.sandbox.nodeVersion} (inside the VM)`);

  log(`\n$ node /workspace/replay.mjs   # same real event x${DELIVERIES} concurrently, per handler`);
  const r0 = Date.now();
  const rep = await run(sb, "node", ["/workspace/replay.mjs"], 90_000);
  result.timings.replayWallMs = Date.now() - r0;
  result.command = {
    cmd: "node /workspace/replay.mjs",
    exitCode: rep.exitCode,
    execMs: rep.execMs ?? null,
    stdout: redact(rep.stdout),
    stderr: redact(rep.stderr),
  };
  for (const l of rep.stdout.trimEnd().split("\n").filter(Boolean)) log(`  ${l}`);
  if (rep.stderr.trim()) log(`  [stderr] ${rep.stderr.trim().split("\n").slice(-6).join("\n  ")}`);
  log(`  exit code: ${rep.exitCode}${rep.execMs !== undefined ? ` · exec ${rep.execMs}ms` : ""}`);

  const parsed = {};
  for (const l of rep.stdout.split(/\r?\n/)) {
    try {
      const o = JSON.parse(l);
      if (o && (o.handler === "baseline" || o.handler === "patched")) parsed[o.handler] = o;
    } catch {
      /* not a result line */
    }
  }
  result.results = parsed;
  const b = parsed.baseline;
  const p = parsed.patched;
  if (rep.exitCode !== 0 || !b || !p || typeof b.fulfillments !== "number" || typeof p.fulfillments !== "number") {
    result.outcome = "INCONCLUSIVE: harness did not produce both result lines with exit code 0";
    log(`\n${result.outcome}`);
    exitCode = 3;
  } else {
    const ok = p.fulfillments === 1 && p.acknowledged === DELIVERIES;
    result.outcome = ok
      ? `PASS: patched handler fulfilled order ${p.orderId} exactly once from ${DELIVERIES} concurrent deliveries of real Stripe event ${p.eventId}; baseline fulfilled it ${b.fulfillments} times`
      : `UNEXPECTED: baseline ${b.fulfillments} fulfillments, patched ${p.fulfillments} fulfillments (acknowledged ${p.acknowledged}/${DELIVERIES})`;
    log("\nResult (real Stripe test-mode event, replayed inside a CreateOS VM)");
    log(`  PaymentIntent ${result.stripe.paymentIntentId} · event ${result.stripe.eventId} (${result.stripe.eventType}) · order ${p.orderId}`);
    log(`  baseline  ${b.deliveries} deliveries -> ${b.fulfillments} fulfillments · acknowledged ${b.acknowledged} · actions ${JSON.stringify(b.actions)}`);
    log(`  patched   ${p.deliveries} deliveries -> ${p.fulfillments} fulfillment${p.fulfillments === 1 ? "" : "s"} · acknowledged ${p.acknowledged} · actions ${JSON.stringify(p.actions)}`);
    log(`  ${result.outcome}`);
    exitCode = ok ? 0 : 1;
  }
} catch (e) {
  result.outcome = `INFRA_ERROR: ${errText(e)}`;
  logErr(`INFRA ERROR: ${errText(e)}`);
  exitCode = 3;
} finally {
  if (sb) {
    const d0 = Date.now();
    try {
      await sb.destroy({ timeoutMs: 30_000 });
      result.timings.sandboxDestroyMs = Date.now() - d0;
      result.sandbox.destroyed = true;
      log(`  sandbox   ${short(sb.id)} destroyed in ${result.timings.sandboxDestroyMs}ms`);
    } catch (e) {
      logErr(`  sandbox   ${short(sb.id)} destroy FAILED: ${errText(e)} (destroy it manually in the CreateOS console)`);
    }
  }
  result.timings.totalMs = Date.now() - t0;
  log(`  total     ${result.timings.totalMs}ms`);
  log("Scope: one real Stripe test-mode event, replayed in this sandbox. No real money moved. Not a production guarantee.");
  try {
    mkdirSync(OUT_DIR, { recursive: true });
    const json = redact(JSON.stringify(result, null, 2)) + "\n";
    writeFileSync(path.join(OUT_DIR, "replay.json"), json);
    writeFileSync(path.join(OUT_DIR, "console.log"), logLines.join("\n") + "\n");
    console.log(`  evidence  ${rel(OUT_DIR)}/`);
  } catch (e) {
    console.error(`could not write evidence: ${errText(e)}`);
  }
}
// The SDK keeps a handle open after destroy, so exit explicitly.
process.exit(exitCode);
