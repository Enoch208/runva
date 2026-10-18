// Bring-your-own-handler (CLI --handler): validation + swap are pure text operations; nothing is executed here.
import { describe, expect, it } from "vitest";
import { MAX_BASELINE_BYTES, applyBaselineOverride, loadFixture, validateBaselineOverride } from "@/lib/runva/fixture";
import { sha256 } from "@/lib/runva/util";

const SRC = "export async function handleWebhook(event, deps) { return { ok: true, action: \"ignored\" }; }\n";

describe("validateBaselineOverride", () => {
  it("rejects empty, oversized, and files without handleWebhook", () => {
    expect(() => validateBaselineOverride("   \n", "a.mjs")).toThrow(/empty/);
    expect(() => validateBaselineOverride("export async function other() {}", "a.mjs")).toThrow(/handleWebhook/);
    const big = SRC + "//" + "x".repeat(MAX_BASELINE_BYTES);
    expect(() => validateBaselineOverride(big, "a.mjs")).toThrow(/limit is 40960 bytes/);
  });

  it("accepts a valid handler and sanitizes the label", () => {
    const o = validateBaselineOverride(SRC, "examples/handlers/my handler`$(x).mjs");
    expect(o.source).toBe(SRC);
    expect(o.label).toBe("examples/handlers/my handler___x_.mjs");
  });
});

describe("applyBaselineOverride", () => {
  it("swaps only the baseline; the frozen verifier and its hash are untouched", async () => {
    const fx = await loadFixture();
    const out = applyBaselineOverride(fx, validateBaselineOverride(SRC, "mine.mjs"));
    expect(out.handlerSource).toBe(SRC);
    expect(out.handlerSha256).toBe(sha256(SRC));
    expect(out.verifierSource).toBe(fx.verifierSource);
    expect(out.verifierSha256).toBe(fx.verifierSha256);
    expect(out.invariant).toBe(fx.invariant);
    expect(fx.handlerSha256).not.toBe(out.handlerSha256); // original fixture object not mutated
  });
});
