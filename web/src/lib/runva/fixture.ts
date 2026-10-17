import { readFile } from "node:fs/promises";
import path from "node:path";
import { sha256 } from "./util";

export type Scenario = { id: string; title: string; contract: string; [k: string]: unknown };

export type Fixture = {
  scenario: Scenario;
  handlerSource: string;
  handlerSha256: string;
  verifierSource: string;
  verifierSha256: string;
  invariant: string;
};

// Statically scoped path (cwd = web/) so Next's file tracing only includes fixtures/webhook-idempotency.
const fixtureFile = (name: string) => path.join(process.cwd(), "fixtures", "webhook-idempotency", name);

/** Load the host-owned fixture from disk. The verifier is frozen here: its hash is taken before any LLM call. */
export async function loadFixture(scenarioId = "webhook-idempotency"): Promise<Fixture> {
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
    scenario,
    handlerSource,
    handlerSha256: sha256(handlerSource),
    verifierSource,
    verifierSha256: sha256(verifierSource),
    invariant,
  };
}
