import { connection } from "next/server";
import { llmEnv, sandboxEnv } from "../../../lib/runva/env";
import { activeRunId } from "../../../lib/runva/run-store";
import { json } from "../../../lib/runva/http";
import type { HealthResponse } from "../../../lib/runva/types";

/** GET /api/health → readiness booleans only. Never exposes key values or account data. */
export async function GET(): Promise<Response> {
  await connection();
  const sb = sandboxEnv();
  const llm = llmEnv();
  const res: HealthResponse & { provider: string; credentialSource: string | null; accessCodeRequired: boolean } = {
    ok: !!sb.apiKey && llm.provider !== "none",
    sandboxConfigured: !!sb.apiKey,
    llmConfigured: llm.provider !== "none",
    model: llm.model,
    activeRunId: activeRunId(),
    provider: llm.provider,
    credentialSource: sb.apiKeySource,
    accessCodeRequired: !!process.env.RUNVA_ACCESS_CODE,
  };
  return json(res);
}
