#!/usr/bin/env node
// RUNVA independent re-verification. Anyone with a CreateOS sandbox key can run this to check a
// patched handler against the repo's FROZEN verifier in a FRESH CreateOS VM, without trusting RUNVA's
// own run, its UI or the model.
//
//   node scripts/reverify.mjs <patched-handler.mjs | RUNVA patch.diff> [--expect-sha256 <hex>]
//
// env: CREATEOS_SANDBOX_API_KEY (required, never printed)
//      CREATEOS_SANDBOX_BASE_URL (default https://api-eu.sb.createos.sh)
//
// Exit codes: 0 = PASS (all V1-V6 pass and verifier exit 0), 1 = FAIL, 2 = usage / hash mismatch, 3 = infra error.
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@nodeops-createos/sandbox";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VERIFIER_PATH = path.join(HERE, "..", "fixtures", "webhook-idempotency", "verifier.mjs");
const CASE_IDS = ["V1", "V2", "V3", "V4", "V5", "V6"];
const SHAPE = "s-1vcpu-1gb";
const ROOTFS = "devbox:1";
// NON-EMPTY allowlist. An empty list means allow-all on CreateOS, so never send [].
const EGRESS = ["registry.npmjs.org:443"];

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const short = (id) => (id && id.length > 12 ? `${id.slice(0, 10)}…` : String(id));
const API_KEY = process.env.CREATEOS_SANDBOX_API_KEY || "";
const redact = (s) => {
  let out = String(s ?? "");
  if (API_KEY.length >= 8) out = out.split(API_KEY).join("[redacted]");
  return out.replace(/\b(sk-[A-Za-z0-9_-]{12,})/g, "[redacted]");
};
const errText = (e) => redact(e instanceof Error ? `${e.name}: ${e.message}` : String(e));

function usage(msg) {
  if (msg) console.error(`error: ${msg}`);
  console.error("usage: node scripts/reverify.mjs <patched-handler.mjs | patch.diff> [--expect-sha256 <hex>]");
  process.exit(2);
}

// ---------------------------------------------------------------- args + inputs

const argv = process.argv.slice(2);
let target;
let expectSha;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--expect-sha256") expectSha = (argv[++i] || "").toLowerCase();
  else if (a.startsWith("--expect-sha256=")) expectSha = a.slice("--expect-sha256=".length).toLowerCase();
  else if (a === "-h" || a === "--help") usage();
  else if (a.startsWith("-")) usage(`unknown flag ${a}`);
  else if (!target) target = a;
  else usage("only one handler path is accepted");
}
if (!target) usage("missing handler path");
if (expectSha !== undefined && !/^[0-9a-f]{64}$/.test(expectSha)) usage("--expect-sha256 must be 64 hex chars");
if (!API_KEY) usage("CREATEOS_SANDBOX_API_KEY is not set");

/** Accept a plain handler.mjs, or a RUNVA patch file whose tail carries the complete final source as "# " lines. */
function loadHandler(file) {
  const raw = readFileSync(file, "utf8");
  const marker = raw.split("\n").findIndex((l) => l.trim() === "# Final handler.mjs (complete source)");
  if (marker < 0) return { source: raw, from: "handler file" };
  const lines = raw.split("\n").slice(marker + 2); // skip the "# ----" separator after the marker
  while (lines.length && !lines[lines.length - 1].startsWith("#")) lines.pop();
  const source = lines.map((l) => (l.startsWith("# ") ? l.slice(2) : l === "#" ? "" : l)).join("\n");
  return { source, from: "RUNVA patch file (embedded final source)" };
}

const handler = loadHandler(path.resolve(target));
const verifierSource = readFileSync(VERIFIER_PATH, "utf8");
const handlerSha = sha256(Buffer.from(handler.source, "utf8"));
const verifierSha = sha256(Buffer.from(verifierSource, "utf8"));

console.log("RUNVA reverify: frozen verifier in a fresh CreateOS sandbox");
console.log(`  handler   ${path.relative(process.cwd(), path.resolve(target))} (${handler.from})`);
console.log(`  handler   sha256 ${handlerSha}`);
console.log(`  verifier  sha256 ${verifierSha}  (${path.relative(process.cwd(), VERIFIER_PATH)})`);
if (expectSha) {
  if (expectSha !== handlerSha) {
    console.error(`HASH MISMATCH: expected handler sha256 ${expectSha}, got ${handlerSha}`);
    process.exit(2);
  }
  console.log("  handler   sha256 matches --expect-sha256");
}

// ---------------------------------------------------------------- verdict (same rule as the host gate)

function parseVerdict(stdout) {
  const lines = (stdout || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const last = lines[lines.length - 1];
  if (!last) return { verdict: null, error: "verifier produced no stdout" };
  let v;
  try {
    v = JSON.parse(last);
  } catch {
    return { verdict: null, error: "last stdout line is not JSON" };
  }
  if (!v || v.schema !== "runva.verdict.v1" || typeof v.pass !== "boolean" || !Array.isArray(v.cases))
    return { verdict: null, error: "last stdout line is not a runva.verdict.v1 object" };
  if (!v.cases.every((c) => c && CASE_IDS.includes(c.id) && typeof c.pass === "boolean"))
    return { verdict: null, error: "verdict cases do not match the schema" };
  return { verdict: v };
}
const verdictPasses = (v, exitCode) =>
  !!v && exitCode === 0 && v.pass === true && CASE_IDS.every((id) => v.cases.some((c) => c.id === id)) && v.cases.every((c) => c.pass === true);

// ---------------------------------------------------------------- sandbox run

const client = createClient({
  apiKey: API_KEY,
  baseUrl: (process.env.CREATEOS_SANDBOX_BASE_URL || "https://api-eu.sb.createos.sh").replace(/\/+$/, ""),
});

async function createFresh() {
  const name = `runva-rv-${randomBytes(4).toString("hex")}`; // CreateOS caps names at 22 chars
  const spec = { shape: SHAPE, rootfs: ROOTFS, ingress_enabled: false, egress: EGRESS, name };
  for (let attempt = 1; ; attempt++) {
    try {
      return await client.createSandbox(spec, { timeoutMs: 120_000, retry: false });
    } catch (e) {
      const status = e?.status ?? e?.statusCode;
      const busy = status === 429 || status === 403 || /rate|limit|quota|concurren|one sandbox/i.test(String(e?.message));
      if (attempt === 1 && busy) {
        console.log(`  createSandbox refused (${errText(e)}); waiting 20s and retrying once`);
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

let exitCode = 3;
let sb;
const t0 = Date.now();
try {
  sb = await createFresh();
  const createMs = Date.now() - t0;
  const egress = sb.data?.egress?.length ? sb.data.egress : EGRESS;
  console.log(`  sandbox   ${short(sb.id)} created in ${createMs}ms · shape ${SHAPE} · rootfs ${ROOTFS} · ingress off · egress ${egress.join(",")}`);

  const mk = await run(sb, "mkdir", ["-p", "/workspace/target"], 30_000);
  if (mk.exitCode !== 0) throw new Error(`mkdir failed (exit ${mk.exitCode}): ${mk.stderr.trim()}`);
  await sb.files.upload("/workspace/verification.mjs", verifierSource);
  await sb.files.upload("/workspace/target/handler.mjs", handler.source);

  // Re-measure the bytes that actually landed in the VM.
  const sums = await run(sb, "sha256sum", ["/workspace/verification.mjs", "/workspace/target/handler.mjs"], 30_000);
  const inVm = Object.fromEntries(
    sums.stdout
      .trim()
      .split("\n")
      .map((l) => l.trim().split(/\s+/))
      .filter((p) => p.length === 2)
      .map(([h, f]) => [f, h]),
  );
  const vOk = inVm["/workspace/verification.mjs"] === verifierSha;
  const hOk = inVm["/workspace/target/handler.mjs"] === handlerSha;
  console.log(`  in-VM     verification.mjs ${inVm["/workspace/verification.mjs"] ?? "unavailable"} ${vOk ? "(matches)" : "(MISMATCH)"}`);
  console.log(`  in-VM     target/handler.mjs ${inVm["/workspace/target/handler.mjs"] ?? "unavailable"} ${hOk ? "(matches)" : "(MISMATCH)"}`);
  if (!vOk || !hOk) throw new Error("uploaded bytes do not match the host hashes");

  const node = await run(sb, "node", ["--version"], 30_000);
  console.log(`  node      ${node.stdout.trim()} (inside the VM)`);

  console.log("\n$ node /workspace/verification.mjs");
  const ver = await run(sb, "node", ["/workspace/verification.mjs"], 90_000);
  const outLines = ver.stdout.trimEnd().split("\n");
  // Human-readable per-case lines (everything except the final JSON verdict line).
  for (const l of outLines.slice(0, -1)) console.log(`  ${redact(l)}`);
  if (ver.stderr.trim()) console.log(`  [stderr, ${ver.stderr.length} chars; candidate output is routed here]\n  ${redact(ver.stderr.trim().split("\n").slice(-6).join("\n  "))}`);
  console.log(`  verifier exit code: ${ver.exitCode}${ver.execMs !== undefined ? ` · exec ${ver.execMs}ms` : ""}`);

  const { verdict, error } = parseVerdict(ver.stdout);
  if (!verdict) {
    console.log(`\nFAIL: verdict could not be parsed (${error}); treated as NOT verified`);
    exitCode = 1;
  } else {
    const cases = verdict.cases.map((c) => `${c.id}:${c.pass ? "pass" : "FAIL"}`).join(" ");
    const ok = verdictPasses(verdict, ver.exitCode);
    console.log(`\nverdict (last stdout line): schema=${verdict.schema} pass=${verdict.pass} ${cases} durationMs=${verdict.durationMs}`);
    console.log(ok ? "PASS: all V1-V6 passed with exit code 0 in a fresh CreateOS VM" : `FAIL: ${verdict.cases.filter((c) => !c.pass).map((c) => c.id).join(", ") || "verdict/exit code"} failed`);
    exitCode = ok ? 0 : 1;
  }
  console.log("Scope: verified for these synthetic conditions in this sandbox. Not a production guarantee.");
} catch (e) {
  console.error(`INFRA ERROR: ${errText(e)}`);
  exitCode = 3;
} finally {
  if (sb) {
    const d0 = Date.now();
    try {
      await sb.destroy({ timeoutMs: 30_000 });
      console.log(`  sandbox   ${short(sb.id)} destroyed in ${Date.now() - d0}ms · total ${Date.now() - t0}ms`);
    } catch (e) {
      console.error(`  sandbox   ${short(sb.id)} destroy FAILED: ${errText(e)} (destroy it manually in the CreateOS console)`);
    }
  }
}
// The SDK keeps a handle open after destroy, so exit explicitly.
process.exit(exitCode);
