import { connection } from "next/server";
import { getRun } from "../../../../../lib/runva/run-store";
import { renderPatchFile } from "../../../../../lib/runva/receipt";
import { NO_STORE, json, notFound } from "../../../../../lib/runva/http";

/** GET /api/runs/:id/patch → unified diff + final handler source (download). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  await connection();
  const { id } = await params;
  const rec = getRun(id);
  if (!rec) return notFound();
  const body = renderPatchFile(rec.summary);
  if (!body) return json({ error: "no patch candidate exists for this run" }, 404);
  return new Response(body, {
    headers: {
      ...NO_STORE,
      "Content-Type": "text/x-diff; charset=utf-8",
      "Content-Disposition": `attachment; filename="runva-${rec.summary.runId}-handler.patch"`,
    },
  });
}
