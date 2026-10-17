import { connection } from "next/server";
import { getRun } from "../../../../lib/runva/run-store";
import { json, notFound } from "../../../../lib/runva/http";

/** GET /api/runs/:id → RunSummary */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  await connection();
  const { id } = await params;
  const rec = getRun(id);
  if (!rec) return notFound();
  return json(rec.summary);
}
