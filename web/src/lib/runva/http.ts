// Small helpers shared by the API route handlers.
export const NO_STORE = { "Cache-Control": "no-store" } as const;

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return Response.json(data, { status, headers: { ...NO_STORE, ...headers } });
}

export function notFound(what = "run"): Response {
  return json({ error: `${what} not found` }, 404);
}
