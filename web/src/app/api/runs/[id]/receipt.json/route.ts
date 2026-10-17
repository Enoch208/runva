import { connection } from "next/server";
import { getRun } from "../../../../../lib/runva/run-store";
import { buildReceiptJson } from "../../../../../lib/runva/receipt";
import { json, notFound } from "../../../../../lib/runva/http";

/** GET /api/runs/:id/receipt.json → machine-readable receipt (schema runva.receipt.v1). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  await connection();
  const { id } = await params;
  const rec = getRun(id);
  if (!rec) return notFound();
  return json(buildReceiptJson(rec.summary));
}
