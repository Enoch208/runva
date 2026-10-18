"use client";

import type { HealthResponse, RunStatus, StartRunResponse } from "@/lib/runva/types";

const ACCESS_CODE_KEY = "runva.accessCode";

export function readStoredAccessCode(): string | undefined {
  try {
    return window.sessionStorage.getItem(ACCESS_CODE_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

function storeAccessCode(code: string | undefined) {
  try {
    if (code) window.sessionStorage.setItem(ACCESS_CODE_KEY, code);
  } catch {
    /* storage unavailable — fine */
  }
}

export type StartResult =
  | { ok: true; runId: string; status: RunStatus }
  | { ok: false; kind: "busy"; message: string; activeRunId?: string }
  | { ok: false; kind: "cooldown"; message: string; retryAfterSec?: number }
  | { ok: false; kind: "auth"; message: string }
  | { ok: false; kind: "error"; message: string };

function errorText(body: unknown): string | undefined {
  if (body && typeof body === "object") {
    const b = body as Record<string, unknown>;
    if (typeof b.error === "string") return b.error;
    if (b.error && typeof b.error === "object" && typeof (b.error as Record<string, unknown>).message === "string") {
      return (b.error as Record<string, unknown>).message as string;
    }
    if (typeof b.message === "string") return b.message;
  }
  return undefined;
}

export type PresetScenario = "webhook-idempotency" | "durable-idempotency";

export async function startRun(accessCode?: string, scenarioId: PresetScenario = "webhook-idempotency"): Promise<StartResult> {
  const code = accessCode?.trim() || readStoredAccessCode();
  let res: Response;
  try {
    res = await fetch("/api/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scenarioId, ...(code ? { accessCode: code } : {}) }),
    });
  } catch {
    return { ok: false, kind: "error", message: "Could not reach the RUNVA server. Check your connection and try again." };
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  const msg = errorText(body);

  if (res.ok) {
    const b = body as Partial<StartRunResponse> | null;
    if (b && typeof b.runId === "string") {
      storeAccessCode(code);
      return { ok: true, runId: b.runId, status: (b.status as RunStatus) ?? "CREATED" };
    }
    return { ok: false, kind: "error", message: "The server accepted the request but returned no run id." };
  }
  if (res.status === 409) {
    const b = (body ?? {}) as Record<string, unknown>;
    const active =
      typeof b.activeRunId === "string" ? b.activeRunId : typeof b.runId === "string" ? b.runId : undefined;
    return {
      ok: false,
      kind: "busy",
      activeRunId: active,
      message: msg ?? "Another verification is already running. RUNVA runs one sandbox at a time.",
    };
  }
  if (res.status === 429) {
    const header = Number(res.headers.get("retry-after"));
    const b = (body ?? {}) as Record<string, unknown>;
    const fromBody =
      typeof b.retryAfterSec === "number"
        ? b.retryAfterSec
        : typeof b.retryAfterMs === "number"
          ? Math.ceil(b.retryAfterMs / 1000)
          : undefined;
    const retryAfterSec = Number.isFinite(header) && header > 0 ? header : fromBody;
    return {
      ok: false,
      kind: "cooldown",
      retryAfterSec,
      message: msg ?? "RUNVA is cooling down between runs.",
    };
  }
  if (res.status === 401 || res.status === 403) {
    return {
      ok: false,
      kind: "auth",
      message: code ? "That access code was not accepted." : "This demo requires an access code to start a run.",
    };
  }
  return {
    ok: false,
    kind: "error",
    message: msg ? `Could not start the run: ${msg}` : `Could not start the run (HTTP ${res.status}).`,
  };
}

export async function fetchHealth(signal?: AbortSignal): Promise<HealthResponse | null> {
  try {
    const res = await fetch("/api/health", { cache: "no-store", signal });
    if (!res.ok) return null;
    const b = (await res.json()) as Partial<HealthResponse>;
    return {
      ok: Boolean(b.ok),
      sandboxConfigured: Boolean(b.sandboxConfigured),
      llmConfigured: Boolean(b.llmConfigured),
      model: typeof b.model === "string" ? b.model : "",
      activeRunId: typeof b.activeRunId === "string" && b.activeRunId ? b.activeRunId : null,
    };
  } catch {
    return null;
  }
}

export type RecentRun = { runId: string; status: RunStatus | string; startedAt?: string };

export async function fetchRecentRuns(signal?: AbortSignal): Promise<RecentRun[] | null> {
  try {
    const res = await fetch("/api/runs", { cache: "no-store", signal });
    if (!res.ok) return null;
    const b: unknown = await res.json();
    const list: unknown[] = Array.isArray(b)
      ? b
      : b && typeof b === "object" && Array.isArray((b as Record<string, unknown>).runs)
        ? ((b as Record<string, unknown>).runs as unknown[])
        : [];
    return list
      .map((r): RecentRun | null => {
        if (!r || typeof r !== "object") return null;
        const o = r as Record<string, unknown>;
        const runId = typeof o.runId === "string" ? o.runId : typeof o.id === "string" ? o.id : null;
        if (!runId) return null;
        return {
          runId,
          status: typeof o.status === "string" ? o.status : "CREATED",
          startedAt: typeof o.startedAt === "string" ? o.startedAt : undefined,
        };
      })
      .filter((x): x is RecentRun => x !== null);
  } catch {
    return null;
  }
}
