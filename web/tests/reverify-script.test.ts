// Offline checks for scripts/reverify.mjs: argument handling, hash pinning and RUNVA patch-file extraction.
// A dummy key + an unreachable base URL guarantee no real CreateOS call is made.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { renderPatchFile } from "@/lib/runva/receipt";
import { sha256 } from "@/lib/runva/util";
import type { RunSummary } from "@/lib/runva/types";

const SCRIPT = path.join(__dirname, "..", "scripts", "reverify.mjs");
const BASELINE = path.join(__dirname, "..", "fixtures", "webhook-idempotency", "handler.vulnerable.mjs");
const DUMMY_KEY = "dummy-reverify-key-0123456789";
const dir = mkdtempSync(path.join(tmpdir(), "runva-reverify-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function reverify(args: string[], key = DUMMY_KEY) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], {
    env: { PATH: process.env.PATH ?? "", CREATEOS_SANDBOX_API_KEY: key, CREATEOS_SANDBOX_BASE_URL: "http://127.0.0.1:9" },
    encoding: "utf8",
    timeout: 15_000,
  });
  return { code: r.status, out: r.stdout + r.stderr };
}

describe("scripts/reverify.mjs (offline)", () => {
  it("refuses to run without CREATEOS_SANDBOX_API_KEY (exit 2)", () => {
    const r = reverify([BASELINE], "");
    expect(r.code).toBe(2);
    expect(r.out).toMatch(/CREATEOS_SANDBOX_API_KEY is not set/);
  });

  it("rejects a handler whose sha256 does not match --expect-sha256 (exit 2, before any VM is created)", () => {
    const r = reverify([BASELINE, "--expect-sha256", "0".repeat(64)]);
    expect(r.code).toBe(2);
    expect(r.out).toMatch(/HASH MISMATCH/);
    expect(r.out).not.toMatch(/sandbox .* created/);
  });

  it("extracts the exact final source from a RUNVA patch file and never prints the key", () => {
    const sourceCode = "// candidate\n\nexport async function handleWebhook(event, deps) {\n  return { ok: true, action: \"ignored\" };\n}\n";
    const S = {
      runId: "run_x",
      status: "VERIFIED",
      attempts: [{ attempt: 2, diagnosis: "d", changeSummary: "c", sourceCode, sourceSha256: sha256(sourceCode), diff: "--- a\n+++ b\n", model: "m" }],
    } as unknown as RunSummary;
    const file = path.join(dir, "patch.diff");
    writeFileSync(file, renderPatchFile(S)!);
    const r = reverify([file, "--expect-sha256", sha256(sourceCode)]);
    expect(r.out).toMatch(/RUNVA patch file/);
    expect(r.out).toMatch(/matches --expect-sha256/);
    expect(r.code).toBe(3); // unreachable CreateOS endpoint -> infra error, not a verdict
    expect(r.out).not.toContain(DUMMY_KEY);
  });
});
