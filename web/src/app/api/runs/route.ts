import { connection } from "next/server";
import { z } from "zod";
import { startRun } from "../../../lib/runva/orchestrator";
import { DEFAULT_SCENARIO_ID, SCENARIO_IDS } from "../../../lib/runva/fixture";
import { checkCanStart, listRuns } from "../../../lib/runva/run-store";
import { json } from "../../../lib/runva/http";
import type { StartRunResponse } from "../../../lib/runva/types";

const MAX_BODY = 2048;
// scenarioId selects a host-owned PRESET fixture from an explicit allowlist. The API never accepts code.
const Body = z.object({ scenarioId: z.enum(SCENARIO_IDS).default(DEFAULT_SCENARIO_ID), accessCode: z.string().max(200).optional() });
const BODY_HINT = `body must be {"scenarioId": ${SCENARIO_IDS.map((id) => `"${id}"`).join(" | ")}}`;

/** POST /api/runs → 201 StartRunResponse | 400 | 401 | 409 busy | 413 | 429 cooldown */
export async function POST(req: Request): Promise<Response> {
  const len = Number(req.headers.get("content-length") ?? "0");
  if (len > MAX_BODY) return json({ error: "request body too large" }, 413);
  const text = await req.text();
  if (text.length > MAX_BODY) return json({ error: "request body too large" }, 413);
  let raw: unknown = {};
  try {
    raw = text ? JSON.parse(text) : {};
  } catch {
    return json({ error: "invalid JSON body" }, 400);
  }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) return json({ error: BODY_HINT }, 400);

  const gate = checkCanStart(parsed.data.accessCode);
  if (!gate.ok) {
    const headers: Record<string, string> = gate.retryAfterSec ? { "Retry-After": String(gate.retryAfterSec) } : {};
    return json({ error: gate.error, ...(gate.activeRunId ? { activeRunId: gate.activeRunId } : {}), ...(gate.retryAfterSec ? { retryAfterSec: gate.retryAfterSec } : {}) }, gate.status, headers);
  }
  // Fire and forget: orchestration continues in this persistent Node process.
  const { record } = startRun({ scenarioId: parsed.data.scenarioId });
  const res: StartRunResponse = { runId: record.summary.runId, status: record.summary.status };
  return json(res, 201);
}

/** GET /api/runs → latest runs (newest first) + the last VERIFIED run id for a UI fallback. */
export async function GET(): Promise<Response> {
  await connection();
  const runs = listRuns();
  const lastVerified = runs.find((r) => r.status === "VERIFIED");
  return json({ runs, activeRunId: runs.find((r) => !r.finishedAt)?.runId ?? null, lastVerifiedRunId: lastVerified?.runId ?? null });
}
