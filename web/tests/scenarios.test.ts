// Preset scenario allowlist: fixture loading, per-scenario limits, API body validation. Nothing here runs fixture code.
import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_SCENARIO_ID, SCENARIO_IDS, isScenarioId, loadFixture, scenarioLimits } from "@/lib/runva/fixture";
import { validateTests } from "@/lib/runva/llm";
import { newSummary, runBudgetMs } from "@/lib/runva/orchestrator";
import { DURABILITY, DURABILITY_DB, buildReceiptJson, renderReceipt } from "@/lib/runva/receipt";
import { runEnv } from "@/lib/runva/env";
import { activeRunId } from "@/lib/runva/run-store";
import type { ScenarioId } from "@/lib/runva/types";

const DURABLE_DIR = path.join(__dirname, "..", "fixtures", "durable-idempotency");
const durablePresent = ["handler.vulnerable.mjs", "verifier.mjs", "invariant.md", "scenario.json"].every((f) => existsSync(path.join(DURABLE_DIR, f)));

describe("scenario allowlist", () => {
  it("knows exactly the two presets and defaults to webhook-idempotency", () => {
    expect([...SCENARIO_IDS]).toEqual(["webhook-idempotency", "durable-idempotency"]);
    expect(DEFAULT_SCENARIO_ID).toBe("webhook-idempotency");
  });

  it("rejects anything that is not an exact preset id", () => {
    for (const bad of ["", "../webhook-idempotency", "webhook-idempotency/", "WEBHOOK-IDEMPOTENCY", "durable", "fixtures/durable-idempotency", null, undefined, 1, {}]) {
      expect(isScenarioId(bad), String(bad)).toBe(false);
    }
    expect(isScenarioId("durable-idempotency")).toBe(true);
  });

  it("loadFixture refuses an unknown id before touching the filesystem", async () => {
    await expect(loadFixture("../../etc" as ScenarioId)).rejects.toThrow(/unknown scenario id/);
  });
});

describe("fixture loading by scenario", () => {
  it("webhook-idempotency (default) loads and is tagged with its id", async () => {
    const fx = await loadFixture();
    expect(fx.scenarioId).toBe("webhook-idempotency");
    expect(fx.scenario.id).toBe("webhook-idempotency");
    expect(fx.handlerSource).toMatch(/handleWebhook/);
  });

  it.skipIf(!durablePresent)("durable-idempotency loads from fixtures/durable-idempotency with the same scenario.json shape", async () => {
    const fx = await loadFixture("durable-idempotency");
    const web = await loadFixture("webhook-idempotency");
    expect(fx.scenarioId).toBe("durable-idempotency");
    expect(fx.scenario.id).toBe("durable-idempotency");
    expect(fx.scenario.title.length).toBeGreaterThan(0);
    expect(fx.scenario.contract.length).toBeGreaterThan(0);
    expect(fx.handlerSource).toMatch(/handleWebhook/);
    expect(fx.verifierSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(fx.verifierSha256).not.toBe(web.verifierSha256);
    const cases = (fx.scenario.cases as { id: string }[] | undefined)?.map((c) => c.id);
    expect(cases).toEqual(["V1", "V2", "V3", "V4", "V5", "V6"]);
  });
});

describe("per-scenario limits", () => {
  it("webhook-idempotency keeps the global defaults; durable gets >= 90s for the verifier", () => {
    expect(scenarioLimits("webhook-idempotency")).toEqual({});
    expect(scenarioLimits("durable-idempotency").verifierTimeoutMs).toBeGreaterThanOrEqual(90_000);
    expect(runBudgetMs("webhook-idempotency")).toBe(runEnv().maxRunMs);
    if (!process.env.RUNVA_MAX_RUN_MS) expect(runBudgetMs("durable-idempotency")).toBeGreaterThan(runEnv().maxRunMs);
  });

  it("a new summary carries its scenario id", () => {
    expect(newSummary("run_x").scenarioId).toBe("webhook-idempotency");
    expect(newSummary("run_y", "durable-idempotency").scenarioId).toBe("durable-idempotency");
  });
});

describe("receipt carries the scenario", () => {
  it("durable receipts name the scenario and use the database durability note", () => {
    const S = { ...newSummary("run_z", "durable-idempotency"), scenarioTitle: "Durable title" };
    const md = renderReceipt(S);
    expect(md).toContain("`durable-idempotency` — Durable title");
    expect(md).toContain(DURABILITY_DB);
    const j = buildReceiptJson(S);
    expect(j.scenarioId).toBe("durable-idempotency");
    expect(j.scenarioTitle).toBe("Durable title");
    expect(j.durability).toBe(DURABILITY_DB);
    expect(buildReceiptJson(newSummary("run_w")).durability).toBe(DURABILITY);
  });
});

describe("agent tests for the durable scenario", () => {
  it("node:sqlite and other node: built-ins pass the import gate; a sqlite npm package does not", () => {
    const testCode = `import { DatabaseSync } from "node:sqlite";\nimport { spawn } from "node:child_process";\nimport { handleWebhook } from "./target/handler.mjs";\nvoid DatabaseSync; void spawn; void handleWebhook;\n`;
    expect(() => validateTests({ summary: "s", testFilename: "agent-tests.mjs", testCode })).not.toThrow();
    expect(() => validateTests({ summary: "s", testFilename: "agent-tests.mjs", testCode: `import sqlite3 from "sqlite3";\n` + testCode })).toThrow(/non-built-in/);
  });
});

describe("POST /api/runs scenario validation", () => {
  const post = async (body: unknown) => {
    const { POST } = await import("@/app/api/runs/route");
    const text = JSON.stringify(body);
    return POST(new Request("http://localhost/api/runs", { method: "POST", headers: { "content-type": "application/json", "content-length": String(text.length) }, body: text }));
  };

  it("rejects unknown or malformed scenario ids with 400 and starts nothing", async () => {
    for (const scenarioId of ["evil", "../durable-idempotency", "", 42, null]) {
      const res = await post({ scenarioId });
      expect(res.status, String(scenarioId)).toBe(400);
      expect(((await res.json()) as { error: string }).error).toMatch(/durable-idempotency/);
    }
    expect(activeRunId()).toBeNull();
  });
});
