import { connection, type NextRequest } from "next/server";
import { eventsAfter, getRun } from "../../../../../lib/runva/run-store";
import { json, notFound } from "../../../../../lib/runva/http";

/** GET /api/runs/:id/events?after=seq → { events, status, finished } (ordered; reconnect with the last seq). */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  await connection();
  const { id } = await params;
  const rec = getRun(id);
  if (!rec) return notFound();
  const after = Number(req.nextUrl.searchParams.get("after") ?? "0");
  const events = eventsAfter(rec, Number.isFinite(after) ? after : 0);
  return json({ events, status: rec.summary.status, finished: !!rec.summary.finishedAt });
}
