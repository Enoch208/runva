import { connection } from "next/server";
import { getRun } from "../../../../../lib/runva/run-store";
import { renderReceipt } from "../../../../../lib/runva/receipt";
import { NO_STORE, notFound } from "../../../../../lib/runva/http";

/** GET /api/runs/:id/report → Markdown verification receipt (download). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  await connection();
  const { id } = await params;
  const rec = getRun(id);
  if (!rec) return notFound();
  return new Response(renderReceipt(rec.summary), {
    headers: {
      ...NO_STORE,
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="runva-receipt-${rec.summary.runId}.md"`,
    },
  });
}
