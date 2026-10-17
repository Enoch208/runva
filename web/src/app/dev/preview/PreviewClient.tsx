"use client";

// DEV-ONLY. Sample data lives here and is never imported by real pages. Delete before shipping.
import { useEffect, useState } from "react";
import type {
  CommandEvidence,
  PatchAttempt,
  RunEvent,
  RunStatus,
  RunSummary,
  VerdictCase,
  VerifierResult,
} from "@/lib/runva/types";
import { RunDashboard } from "@/components/runva/RunDashboard";

const T0 = Date.parse("2026-10-17T14:00:00.000Z");
const at = (s: number) => new Date(T0 + s * 1000).toISOString();
const RUN = "run_sample_8f3c2a91";
const SB = "sb_3f9a…";

const BASE_SRC = `export async function handleWebhook(event, deps) {
  if (event.type !== "payment_intent.succeeded") return { status: 200, ignored: true };
  const orderId = event.data.object.metadata.order_id;
  await deps.fulfillOrder(orderId);
  return { status: 200 };
}
`;

const TESTS = `import assert from "node:assert/strict";
import { handleWebhook } from "./handler.mjs";

function makeDeps() {
  const calls = [];
  return {
    calls,
    async fulfillOrder(orderId) {
      await new Promise((r) => setTimeout(r, 15));
      calls.push(orderId);
    },
  };
}

const evt = { id: "evt_demo_001", type: "payment_intent.succeeded",
  data: { object: { id: "pi_demo_001", metadata: { order_id: "order_demo_001" } } } };

// SAMPLE: 20 concurrent duplicate deliveries must fulfill exactly once
const deps = makeDeps();
await Promise.all(Array.from({ length: 20 }, () => handleWebhook(evt, deps)));
assert.equal(deps.calls.length, 1, \`expected 1 fulfillment, got \${deps.calls.length}\`);
`;

const DIFF = `--- a/handler.mjs
+++ b/handler.mjs
@@ -1,6 +1,22 @@
+const completed = new Set();
+const inFlight = new Map();
+
 export async function handleWebhook(event, deps) {
   if (event.type !== "payment_intent.succeeded") return { status: 200, ignored: true };
   const orderId = event.data.object.metadata.order_id;
-  await deps.fulfillOrder(orderId);
+  if (!orderId) return { status: 400 };
+  if (completed.has(orderId)) return { status: 200, duplicate: true };
+  if (inFlight.has(orderId)) {
+    await inFlight.get(orderId);
+    return { status: 200, duplicate: true };
+  }
+  const work = (async () => {
+    await deps.fulfillOrder(orderId);
+    completed.add(orderId);
+  })();
+  inFlight.set(orderId, work);
+  try { await work; } finally { inFlight.delete(orderId); }
   return { status: 200 };
 }
`;

function cases(mode: "baseline" | "final" | "partial"): VerdictCase[] {
  const fulfil = mode === "baseline" ? 20 : 1;
  return [
    {
      id: "V1",
      title: "Same event delivered 20× with overlapping requests",
      pass: mode !== "baseline",
      observed: { deliveries: 20, fulfillments: fulfil },
      expected: { deliveries: 20, fulfillments: 1 },
      details: mode === "baseline" ? "SAMPLE: fulfillOrder called 20 times for order_demo_001" : undefined,
    },
    {
      id: "V2",
      title: "Two event ids for the same payment/order",
      pass: mode === "final",
      observed: { fulfillments: mode === "final" ? 1 : 2 },
      expected: { fulfillments: 1 },
    },
    { id: "V3", title: "Unknown event type is ignored", pass: true, observed: { fulfillments: 0 }, expected: { fulfillments: 0 } },
    { id: "V4", title: "Two different valid orders", pass: true, observed: { fulfillments: 2 }, expected: { fulfillments: 2 } },
    {
      id: "V5",
      title: "Fulfillment fails once, retry succeeds exactly once",
      pass: true,
      observed: { fulfillments: 1, firstAttemptAcked: false },
      expected: { fulfillments: 1, firstAttemptAcked: false },
    },
    { id: "V6", title: "Module interface: handleWebhook export", pass: true, observed: { export: "function" }, expected: { export: "function" } },
  ];
}

function cmd(label: string, c: string, exitCode: number, s: number, stdout: string, stderr = ""): CommandEvidence {
  return { label, cmd: c, exitCode, stdout, stderr, execMs: 1840, sandboxId: SB, at: at(s) };
}

function verifier(mode: "baseline" | "final" | "partial", s: number, handlerSha: string): VerifierResult {
  const cs = cases(mode);
  const pass = cs.every((c) => c.pass);
  return {
    verdict: { schema: "runva.verdict.v1", pass, cases: cs, durationMs: 912 },
    exitCode: pass ? 0 : 1,
    handlerSha256: handlerSha,
    verifierSha256: "9c1e7b44d0a3f5e2b8c6a1d9e4f7b3c2a5d8e1f4b7c0a3d6e9f2b5c8a1d4e7f0",
    command: cmd(
      `${mode === "baseline" ? "baseline" : "attempt"}: verifier`,
      "node /workspace/verification.mjs",
      pass ? 0 : 1,
      s,
      `SAMPLE OUTPUT\n${cs.map((c) => `${c.id} ${c.pass ? "PASS" : "FAIL"} ${c.title}`).join("\n")}\n{"schema":"runva.verdict.v1","pass":${pass}}`,
      pass ? "" : "SAMPLE: AssertionError [ERR_ASSERTION]: expected 1 fulfillment, got 20",
    ),
  };
}

function ev(seq: number, s: number, status: RunStatus, kind: RunEvent["kind"], title: string, details?: Record<string, unknown>): RunEvent {
  return { seq, runId: RUN, at: at(s), status, kind, title, details };
}

const ALL_EVENTS: RunEvent[] = [
  ev(1, 0, "CREATED", "phase", "Run created · fixture loaded, verifier hash frozen", { verifierSha256: "9c1e7b44d0a3…" }),
  ev(2, 1, "INSPECTING", "llm", "Agent inspecting handler.mjs and contract", { model: "sample-model" }),
  ev(3, 14, "TESTS_GENERATED", "artifact", "Generated agent-tests.mjs (SAMPLE)", { file: "agent-tests.mjs", bytes: 1240 }),
  ev(4, 16, "BASELINE_RUNNING", "sandbox", "CreateOS sandbox created", { sandboxId: SB, shape: "s-1vcpu-1gb", region: "nyc" }),
  ev(5, 22, "BASELINE_RUNNING", "command", "Agent tests vs baseline", { cmd: "node agent-tests.mjs", exitCode: 1, stderr: "SAMPLE: AssertionError: expected 1 fulfillment, got 20\n    at agent-tests.mjs:24:8" }),
  ev(6, 25, "BASELINE_RUNNING", "command", "Frozen verifier vs baseline", { cmd: "node /workspace/verification.mjs", exitCode: 1, stdout: "V1 FAIL\nV2 FAIL\nV3 PASS\nV4 PASS\nV5 PASS\nV6 PASS" }),
  ev(7, 26, "FAILURE_REPRODUCED", "assertion", "Failure reproduced: V1, V2 failing", { failing: ["V1", "V2"] }),
  ev(8, 27, "PATCH_GENERATING", "llm", "Agent writing patch (attempt 1)"),
  ev(9, 41, "PATCH_TESTING", "command", "Attempt 1 · frozen verifier", { exitCode: 1, failing: ["V2"] }),
  ev(10, 42, "REPAIRING", "llm", "Repairing from real failure evidence (attempt 2)"),
  ev(11, 58, "PATCH_TESTING", "command", "Attempt 2 · agent tests", { exitCode: 0 }),
  ev(12, 60, "INDEPENDENT_VERIFYING", "command", "Independent verification · frozen verifier", { exitCode: 0, stdout: "V1 PASS\nV2 PASS\nV3 PASS\nV4 PASS\nV5 PASS\nV6 PASS" }),
  ev(13, 61, "VERIFIED", "phase", "Verified · sandbox destroyed"),
];

const attempt1: PatchAttempt = {
  attempt: 1,
  diagnosis: "SAMPLE: fulfillOrder runs on every delivery; there is no idempotency key at the order level.",
  changeSummary: "SAMPLE: dedupe by event id.",
  sourceCode: BASE_SRC,
  sourceSha256: "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90",
  diff: DIFF.replace("order_id;", "order_id; // attempt 1"),
  agentTests: cmd("attempt 1: agent tests", "node agent-tests.mjs", 0, 39, "SAMPLE ok"),
  verifier: verifier("partial", 41, "a1b2c3d4e5f6…"),
  model: "sample-model",
};

const attempt2: PatchAttempt = {
  attempt: 2,
  diagnosis: "SAMPLE: attempt 1 keyed on event id, so two event ids for one order still fulfilled twice (V2).",
  changeSummary: "SAMPLE: key idempotency on order_id with an in-flight map so concurrent duplicates await one fulfillment.",
  sourceCode: BASE_SRC,
  sourceSha256: "f00dfeedbeef0123456789abcdef0123456789abcdef0123456789abcdef0123",
  diff: DIFF,
  agentTests: cmd("attempt 2: agent tests", "node agent-tests.mjs", 0, 58, "SAMPLE ok"),
  verifier: verifier("final", 60, "f00dfeedbeef0123456789abcdef0123456789abcdef0123456789abcdef0123"),
  model: "sample-model",
};

function base(status: RunStatus, upToSeq: number): RunSummary {
  return {
    runId: RUN,
    scenarioId: "webhook-idempotency",
    status,
    startedAt: at(0),
    contract: "One paid order → one fulfillment, even under duplicate or concurrent delivery.",
    baselineSource: BASE_SRC,
    baselineSha256: "7d4e1f0a9b8c7d6e5f4a3b2c1d0e9f8a7b6c5d4e3f2a1b0c9d8e7f6a5b4c3d2e",
    verifierSha256: "9c1e7b44d0a3f5e2b8c6a1d9e4f7b3c2a5d8e1f4b7c0a3d6e9f2b5c8a1d4e7f0",
    model: "sample-model",
    attempts: [],
    attemptCount: 0,
    caseResults: [],
    events: ALL_EVENTS.filter((e) => e.seq <= upToSeq).map((e) => ({ ...e })),
    links: { report: `/api/runs/${RUN}/report`, patch: `/api/runs/${RUN}/patch` },
  };
}

function withBaseline(s: RunSummary): RunSummary {
  return {
    ...s,
    sandbox: { id: SB, shape: "s-1vcpu-1gb", region: "nyc", egress: ["registry.npmjs.org"] },
    generatedTests: {
      summary: "SAMPLE: fires 20 concurrent duplicate deliveries and two distinct event ids for one order; asserts exactly one fulfillment.",
      testFilename: "agent-tests.mjs",
      testCode: TESTS,
      sha256: "3e5f7a9b1c3d5e7f9a1b3c5d7e9f1a3b5c7d9e1f3a5b7c9d1e3f5a7b9c1d3e5f",
      model: "sample-model",
    },
    baselineAgentTests: cmd("baseline: agent tests", "node agent-tests.mjs", 1, 22, "", "SAMPLE: AssertionError: expected 1 fulfillment, got 20"),
    baselineResult: verifier("baseline", 25, "7d4e1f0a9b8c7d6e5f4a3b2c1d0e9f8a7b6c5d4e3f2a1b0c9d8e7f6a5b4c3d2e"),
  };
}

const SAMPLES: Record<string, () => RunSummary> = {
  running: () => ({
    ...withBaseline(base("PATCH_TESTING", 9)),
    startedAt: new Date(Date.now() - 44_000).toISOString(),
    events: base("PATCH_TESTING", 9).events.map((e) => ({ ...e, at: new Date(Date.now() - 44_000 + (Date.parse(e.at) - T0)).toISOString() })),
    attempts: [{ ...attempt1, verifier: undefined }],
    attemptCount: 1,
  }),
  baseline: () => ({ ...base("BASELINE_RUNNING", 5), startedAt: new Date(Date.now() - 20_000).toISOString(), sandbox: { id: SB, shape: "s-1vcpu-1gb", region: "nyc", egress: [] } }),
  verified: () => {
    const final = verifier("final", 60, "f00dfeedbeef0123456789abcdef0123456789abcdef0123456789abcdef0123");
    return {
      ...withBaseline(base("VERIFIED", 13)),
      finishedAt: at(61),
      durationMs: 61_400,
      attempts: [attempt1, attempt2],
      attemptCount: 2,
      finalResult: final,
      caseResults: final.verdict?.cases ?? [],
    };
  },
  failed: () => {
    const final = verifier("partial", 60, "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90");
    const evs = base("FAILED", 9).events;
    return {
      ...withBaseline(base("FAILED", 9)),
      events: [...evs, ev(14, 90, "FAILED", "error", "Attempt limit reached — V2 still failing")],
      finishedAt: at(90),
      attempts: [attempt1, { ...attempt2, verifier: final, attempt: 3 }],
      attemptCount: 3,
      finalResult: final,
      caseResults: final.verdict?.cases ?? [],
      error: { category: "code", message: "SAMPLE: 3 candidates exhausted; V2 still failing." },
    };
  },
  inconclusive: () => ({
    ...withBaseline(base("INCONCLUSIVE", 6)),
    baselineResult: verifier("final", 25, "7d4e1f0a9b8c7d6e5f4a3b2c1d0e9f8a7b6c5d4e3f2a1b0c9d8e7f6a5b4c3d2e"),
    finishedAt: at(27),
    error: { category: "code", message: "SAMPLE: the baseline passed every verifier case; no failure to repair." },
  }),
  infra: () => ({
    ...base("INFRA_ERROR", 4),
    events: [...base("INFRA_ERROR", 4).events, ev(5, 19, "INFRA_ERROR", "error", "Sandbox creation failed", { http: 402, message: "SAMPLE: quota exhausted" })],
    finishedAt: at(19),
    error: {
      category: "infra",
      message: "SAMPLE: CreateOS returned 402 — sandbox quota exhausted.",
      hint: "SAMPLE: Check CreateOS credits in the dashboard, then run again.",
    },
  }),
  cancelled: () => ({
    ...withBaseline(base("CANCELLED", 8)),
    events: [...base("CANCELLED", 8).events, ev(9, 33, "CANCELLED", "phase", "Cancelled by user · sandbox destroyed")],
    finishedAt: at(33),
    attempts: [],
    error: { category: "cancelled", message: "SAMPLE: cancelled by user." },
  }),
};

export function PreviewClient() {
  const [key, setKey] = useState<keyof typeof SAMPLES>("verified");
  useEffect(() => {
    const h = window.location.hash.slice(1);
    if (h && h in SAMPLES) setKey(h);
  }, []);
  const summary = SAMPLES[key]();
  return (
    <RunDashboard
      key={key}
      summary={summary}
      preview
      connection={["VERIFIED", "FAILED", "INCONCLUSIVE", "CANCELLED", "INFRA_ERROR"].includes(summary.status) ? "done" : "live"}
      topSlot={
        <div className="sticky top-0 z-40 flex flex-wrap items-center justify-center gap-2 border-b border-warn/40 bg-amber-950/90 px-4 py-2 font-mono text-[11px] text-amber-100">
          <strong className="tracking-[0.2em]">SAMPLE DATA — dev preview</strong>
          <span className="text-amber-200/70">not a real run ·</span>
          {Object.keys(SAMPLES).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setKey(k)}
              className={`rounded px-2 py-0.5 ${k === key ? "bg-amber-200 text-amber-950" : "bg-amber-200/10 hover:bg-amber-200/20"}`}
            >
              {k}
            </button>
          ))}
        </div>
      }
    />
  );
}
