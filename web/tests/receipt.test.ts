import { describe, expect, it } from "vitest";
import { renderPatchFile, renderReceipt } from "@/lib/runva/receipt";
import type { CommandEvidence, RunSummary, VerifierResult } from "@/lib/runva/types";

const H_BASE = "a".repeat(64);
const H_FINAL = "b".repeat(64);
const H_VER = "c".repeat(64);
const H_TESTS = "d".repeat(64);

const cmd = (label: string, exitCode: number, stdout = "ok"): CommandEvidence => ({
  label,
  cmd: "node /workspace/verification.mjs",
  exitCode,
  stdout,
  stderr: "",
  execMs: 900,
  sandboxId: "sb_3f9a12…",
  at: "2026-10-17T12:00:00.000Z",
});
const ids = ["V1", "V2", "V3", "V4", "V5", "V6"] as const;
const result = (pass: boolean, handlerSha256: string): VerifierResult => ({
  verdict: {
    schema: "runva.verdict.v1",
    pass,
    durationMs: 700,
    cases: ids.map((id) => ({ id, title: `t ${id}`, pass: pass || !["V1", "V2"].includes(id), observed: { f: 1 }, expected: { f: 1 } })),
  },
  exitCode: pass ? 0 : 1,
  handlerSha256,
  verifierSha256: H_VER,
  command: cmd("verifier", pass ? 0 : 1),
});

function summary(): RunSummary {
  return {
    runId: "run_test123",
    scenarioId: "webhook-idempotency",
    status: "VERIFIED",
    startedAt: "2026-10-17T12:00:00.000Z",
    finishedAt: "2026-10-17T12:01:30.000Z",
    durationMs: 90_000,
    contract: "One paid order leads to exactly one fulfillment.",
    baselineSource: "export async function handleWebhook() {}",
    baselineSha256: H_BASE,
    verifierSha256: H_VER,
    model: "openrouter:anthropic/claude-sonnet-5.5",
    sandbox: { id: "sb_3f9a12…", shape: "s-1vcpu-1gb", region: "eu", egress: ["registry.npmjs.org:443"] },
    generatedTests: { summary: "tests", testFilename: "agent-tests.mjs", testCode: "import './target/handler.mjs'", sha256: H_TESTS, model: "m" },
    baselineAgentTests: cmd("baseline tests", 1),
    baselineResult: result(false, H_BASE),
    attempts: [
      {
        attempt: 1,
        diagnosis: "dedupe on event id",
        changeSummary: "dedupe on order id",
        sourceCode: "export async function handleWebhook() { return 1 }\n",
        sourceSha256: H_FINAL,
        diff: "--- a/handler.mjs\n+++ b/handler.mjs\n@@\n-old\n+new\n",
        verifier: result(true, H_FINAL),
        model: "m",
      },
    ],
    attemptCount: 1,
    finalResult: result(true, H_FINAL),
    caseResults: [],
    events: [],
    links: { report: "/r", patch: "/p" },
    credentialSource: "CREATEOS_SANDBOX_API_KEY",
    sandboxes: [{ id: "sb_3f9a12…", purpose: "fresh-verifier", shape: "s-1vcpu-1gb", region: "eu", createMs: 2100, destroyed: true }],
    freshVerifierVm: true,
    verifierIntegrity: { expectedSha256: H_VER, observedSha256: H_VER, match: true },
  };
}

const SECRETISH = [/sk-[A-Za-z0-9_-]{12,}/, /sk-or-v1-/, /Bearer\s+\S{12,}/i, /CREATEOS_SANDBOX_API_KEY\s*=/, /api[_-]?key\s*[:=]\s*\S{8,}/i];

describe("renderReceipt", () => {
  const md = renderReceipt(summary());

  it("states the scope limitation", () => {
    expect(md).toContain("Verified for these synthetic conditions in this sandbox. Not a production guarantee.");
    expect(md).toMatch(/not formal verification/i);
  });

  it("includes baseline, final handler and frozen verifier hashes", () => {
    expect(md).toContain(H_BASE);
    expect(md).toContain(H_FINAL);
    expect(md).toContain(H_VER);
    expect(md).toContain(H_TESTS);
    expect(md).toMatch(/Verifier sha256 measured inside the final VM: `c{64}` → matches/);
  });

  it("shows final status, exit codes and failing baseline cases", () => {
    expect(md).toContain("# RUNVA verification receipt — VERIFIED");
    expect(md).toMatch(/\| V1 \| \*\*FAIL\*\* \|/);
    expect(md).toContain("process exit code **0**");
  });

  it("names the credential env var but contains nothing secret-looking", () => {
    expect(md).toContain("`CREATEOS_SANDBOX_API_KEY` (value never logged)");
    for (const re of SECRETISH) expect(md, String(re)).not.toMatch(re);
  });

  it("neutralizes triple backticks from model output so it cannot break out of fences", () => {
    const s = summary();
    s.generatedTests!.testCode = "```\n# injected heading\n```";
    const out = renderReceipt(s);
    expect(out).not.toContain("```\n# injected heading");
  });

  it("an unparseable final verdict is reported as NOT verified", () => {
    const s = summary();
    s.status = "FAILED";
    s.finalResult = { ...s.finalResult!, verdict: null, exitCode: 1 };
    expect(renderReceipt(s)).toMatch(/could not be parsed \(exit code 1\) — treated as NOT verified/);
  });
});

describe("renderPatchFile", () => {
  it("contains the final attempt sha256, the scope line and the diff", () => {
    const p = renderPatchFile(summary())!;
    expect(p).toContain(H_FINAL);
    expect(p).toContain("Not a production guarantee.");
    expect(p).toContain("+new");
  });
  it("returns null when there are no attempts", () => {
    expect(renderPatchFile({ ...summary(), attempts: [] })).toBeNull();
  });
});
