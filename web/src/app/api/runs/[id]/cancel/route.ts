import { cancelRun } from "../../../../../lib/runva/orchestrator";
import { getRun } from "../../../../../lib/runva/run-store";
import { json, notFound } from "../../../../../lib/runva/http";

/** POST /api/runs/:id/cancel → { cancelled: true } (or false if already finished). */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  const rec = getRun(id);
  if (!rec) return notFound();
  const cancelled = cancelRun(rec);
  return json({ cancelled, status: rec.summary.status }, cancelled ? 200 : 409);
}
