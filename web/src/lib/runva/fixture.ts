import { readFile } from "node:fs/promises";
import path from "node:path";
import { sha256 } from "./util";
import type { ScenarioId } from "./types";

export type Scenario = { id: string; title: string; contract: string; [k: string]: unknown };

// ---------------------------------------------------------------- preset scenarios (allowlist)

/** The ONLY scenario ids the host will load. Anything else is rejected before touching the filesystem. */
export const SCENARIO_IDS = ["webhook-idempotency", "durable-idempotency"] as const satisfies readonly ScenarioId[];
export const DEFAULT_SCENARIO_ID: ScenarioId = "webhook-idempotency";

export function isScenarioId(x: unknown): x is ScenarioId {
  return typeof x === "string" && (SCENARIO_IDS as readonly string[]).includes(x);
}

/**
 * Host-owned per-scenario execution limits. `undefined` means "use the global runEnv() default",
 * which keeps webhook-idempotency exactly as before. The durable verifier spawns several node
 * processes inside the VM (up to ~45s), so it gets a much larger in-VM wall clock.
 */
export type ScenarioLimits = { verifierTimeoutMs?: number; agentTestsTimeoutMs?: number; defaultMaxRunMs?: number };

const SCENARIO_LIMITS: Record<ScenarioId, ScenarioLimits> = {
  "webhook-idempotency": {},
  "durable-idempotency": { verifierTimeoutMs: 120_000, agentTestsTimeoutMs: 90_000, defaultMaxRunMs: 720_000 },
};

export function scenarioLimits(id: ScenarioId): ScenarioLimits {
  return SCENARIO_LIMITS[id];
}

// Statically scoped paths (cwd = web/), one literal per preset, so Next's file tracing stays inside fixtures/.
const FIXTURE_DIRS: Record<ScenarioId, () => string> = {
  "webhook-idempotency": () => path.join(process.cwd(), "fixtures", "webhook-idempotency"),
  "durable-idempotency": () => path.join(process.cwd(), "fixtures", "durable-idempotency"),
};

export type Fixture = {
  /** The preset this fixture was loaded for (always one of SCENARIO_IDS). */
  scenarioId: ScenarioId;
  scenario: Scenario;
  handlerSource: string;
  handlerSha256: string;
  verifierSource: string;
  verifierSha256: string;
  invariant: string;
};

/** Load the host-owned fixture from disk. The verifier is frozen here: its hash is taken before any LLM call. */
export async function loadFixture(scenarioId: ScenarioId = DEFAULT_SCENARIO_ID): Promise<Fixture> {
  if (!isScenarioId(scenarioId)) throw new Error(`unknown scenario id: ${JSON.stringify(String(scenarioId)).slice(0, 80)}`);
  const dir = FIXTURE_DIRS[scenarioId]();
  const fixtureFile = (name: string) => path.join(dir, name);
  const [handlerSource, verifierSource, invariant, scenarioRaw] = await Promise.all([
    readFile(fixtureFile("handler.vulnerable.mjs"), "utf8"),
    readFile(fixtureFile("verifier.mjs"), "utf8"),
    readFile(fixtureFile("invariant.md"), "utf8"),
    readFile(fixtureFile("scenario.json"), "utf8"),
  ]);
  const parsed = JSON.parse(scenarioRaw) as Partial<Scenario>;
  const scenario: Scenario = {
    ...parsed,
    id: String(parsed.id ?? scenarioId),
    title: String(parsed.title ?? "Webhook idempotency"),
    contract: String(
      parsed.contract ?? "A payment webhook must fulfill each order exactly once, even under duplicate, concurrent or retried deliveries.",
    ),
  };
  return {
    scenarioId,
    scenario,
    handlerSource,
    handlerSha256: sha256(handlerSource),
    verifierSource,
    verifierSha256: sha256(verifierSource),
    invariant,
  };
}

// ---------------------------------------------------------------- bring-your-own-handler (CLI only)

export const MAX_BASELINE_BYTES = 40 * 1024;

/** A user-supplied baseline handler. Text only: the host hashes it and uploads it to the sandbox; it never imports or runs it. */
export type BaselineOverride = { source: string; label: string };

/**
 * Validate a user-supplied baseline. Only the CLI (scripts/e2e-run.ts --handler) sets this;
 * the web API never accepts client code. Throws with a human-readable reason.
 */
export function validateBaselineOverride(source: string, label: string): BaselineOverride {
  if (typeof source !== "string" || !source.trim()) throw new Error("handler file is empty");
  const bytes = Buffer.byteLength(source, "utf8");
  if (bytes > MAX_BASELINE_BYTES) throw new Error(`handler file is ${bytes} bytes; the limit is ${MAX_BASELINE_BYTES} bytes`);
  if (!/handleWebhook/.test(source)) throw new Error("handler file must define `export async function handleWebhook(event, deps)`");
  const clean = String(label ?? "").replace(/[^\w.\-/ ]/g, "_").slice(0, 200) || "handler.mjs";
  return { source, label: clean };
}

/** Swap the fixture's baseline for a validated user-supplied one. The frozen verifier, invariant and scenario are untouched. */
export function applyBaselineOverride(fx: Fixture, override: BaselineOverride): Fixture {
  return { ...fx, handlerSource: override.source, handlerSha256: sha256(override.source) };
}
