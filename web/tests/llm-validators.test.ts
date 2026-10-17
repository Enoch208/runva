import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { extractJson, validatePatch, validateTests } from "@/lib/runva/llm";

const baseline = readFileSync(path.join(__dirname, "..", "fixtures", "webhook-idempotency", "handler.vulnerable.mjs"), "utf8");

// A syntactically plausible candidate. It is NOT a correct fix and is never executed here.
const candidate = `import { createHash } from "node:crypto";\nconst seen = new Set();\nexport async function handleWebhook(event, deps) {\n  void createHash;\n  return { ok: true, action: "ignored" };\n}\n`;

const patch = (over: Record<string, unknown> = {}) => ({
  diagnosis: "dedupe key is the event id",
  changeSummary: "key on order id",
  targetFilename: "handler.mjs",
  sourceCode: candidate,
  ...over,
});
const tests = (over: Record<string, unknown> = {}) => ({
  summary: "concurrency tests",
  testFilename: "agent-tests.mjs",
  testCode: `import assert from "node:assert/strict";\nimport { handleWebhook } from "./target/handler.mjs";\nassert.ok(handleWebhook);\n`,
  ...over,
});

describe("validatePatch (LLM patch output gate)", () => {
  it("accepts a well-formed candidate", () => {
    expect(validatePatch(patch(), baseline).targetFilename).toBe("handler.mjs");
  });

  it("rejects a wrong target filename", () => {
    expect(() => validatePatch(patch({ targetFilename: "verification.mjs" }), baseline)).toThrow();
    expect(() => validatePatch(patch({ targetFilename: "../handler.mjs" }), baseline)).toThrow();
  });

  it("rejects empty code and missing fields", () => {
    expect(() => validatePatch(patch({ sourceCode: "" }), baseline)).toThrow();
    expect(() => validatePatch(patch({ diagnosis: "" }), baseline)).toThrow();
    const { sourceCode: _omit, ...noCode } = patch();
    expect(() => validatePatch(noCode, baseline)).toThrow();
    expect(() => validatePatch(null, baseline)).toThrow();
  });

  it("rejects code identical to the baseline (including CRLF / whitespace-only differences)", () => {
    expect(() => validatePatch(patch({ sourceCode: baseline }), baseline)).toThrow(/identical to the baseline/);
    expect(() => validatePatch(patch({ sourceCode: "\n" + baseline.replace(/\n/g, "\r\n") + "\n\n" }), baseline)).toThrow(/identical to the baseline/);
  });

  it("rejects a repeat of the previous failed candidate", () => {
    expect(() => validatePatch(patch(), baseline, candidate)).toThrow(/previous failed candidate/);
  });

  it("rejects oversized code (> 40 KiB)", () => {
    const big = candidate + "// " + "x".repeat(41 * 1024) + "\n";
    expect(() => validatePatch(patch({ sourceCode: big }), baseline)).toThrow(/exceeds/);
  });

  it("rejects code that does not export handleWebhook", () => {
    expect(() => validatePatch(patch({ sourceCode: "export async function handle() {}\n" }), baseline)).toThrow(/handleWebhook/);
  });

  it("rejects imports of non-built-in packages (static, dynamic, require)", () => {
    for (const imp of [
      `import Redis from "ioredis";`,
      `import { v4 } from 'uuid';`,
      `const m = await import("left-pad");`,
      `const fs = require("fs-extra");`,
      `import "dotenv/config";`,
    ]) {
      expect(() => validatePatch(patch({ sourceCode: imp + "\n" + candidate }), baseline), imp).toThrow(/non-built-in/);
    }
  });

  it("allows node: built-ins", () => {
    const src = `import { setTimeout as sleep } from "node:timers/promises";\nimport { AsyncLocalStorage } from "node:async_hooks";\n` + candidate;
    expect(() => validatePatch(patch({ sourceCode: src }), baseline)).not.toThrow();
  });
});

describe("validateTests (LLM test output gate)", () => {
  it("accepts well-formed tests", () => {
    expect(validateTests(tests()).testFilename).toBe("agent-tests.mjs");
  });
  it("rejects a wrong filename", () => {
    expect(() => validateTests(tests({ testFilename: "verification.mjs" }))).toThrow();
  });
  it("rejects empty test code", () => {
    expect(() => validateTests(tests({ testCode: "" }))).toThrow();
  });
  it("rejects tests that never reference the target handler", () => {
    expect(() => validateTests(tests({ testCode: `console.log("ok")\n` }))).toThrow(/handler\.mjs/);
  });
  it("rejects oversized tests", () => {
    expect(() => validateTests(tests({ testCode: tests().testCode + "//" + "y".repeat(41 * 1024) }))).toThrow(/exceeds/);
  });
  it("rejects third-party test frameworks", () => {
    expect(() => validateTests(tests({ testCode: `import { test } from "vitest";\n` + tests().testCode }))).toThrow(/non-built-in/);
  });
});

describe("extractJson", () => {
  it("parses bare JSON, fenced JSON and JSON embedded in prose", () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
    expect(extractJson('Here you go:\n```json\n{"a":2}\n```')).toEqual({ a: 2 });
    expect(extractJson('Sure! {"a":3} hope that helps')).toEqual({ a: 3 });
  });
  it("throws when there is no JSON object", () => {
    expect(() => extractJson("no json here")).toThrow();
  });
});
