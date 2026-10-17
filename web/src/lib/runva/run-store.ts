import type { RunEvent, RunSummary } from "./types";
import { TERMINAL_STATUSES } from "./types";
import { runEnv } from "./env";

export type RunRecord = {
  summary: RunSummary;
  abort: AbortController;
  startedAtMs: number;
};

type Store = {
  runs: Map<string, RunRecord>;
  activeRunId: string | null;
  lastEndedAtMs: number;
};

const MAX_RUNS = 30;
const KEY = "__runva_store_v1__";

/** In-memory store stashed on globalThis so it survives Next dev HMR and is shared across route bundles. */
export function store(): Store {
  const g = globalThis as unknown as Record<string, Store | undefined>;
  if (!g[KEY]) g[KEY] = { runs: new Map(), activeRunId: null, lastEndedAtMs: 0 };
  return g[KEY]!;
}

export const isTerminal = (s: RunSummary["status"]) => TERMINAL_STATUSES.includes(s);

export function getRun(id: string): RunRecord | undefined {
  return store().runs.get(id);
}

export function activeRunId(): string | null {
  const s = store();
  if (s.activeRunId) {
    const r = s.runs.get(s.activeRunId);
    if (!r || isTerminal(r.summary.status)) s.activeRunId = null;
  }
  return s.activeRunId;
}

export type AcquireResult =
  | { ok: true }
  | { ok: false; status: 401 | 409 | 429; error: string; activeRunId?: string; retryAfterSec?: number };

/** Guard checks for starting a run: access code, one active run globally, cooldown. */
export function checkCanStart(accessCode: string | undefined): AcquireResult {
  const env = runEnv();
  if (env.accessCode && accessCode !== env.accessCode) return { ok: false, status: 401, error: "invalid or missing access code" };
  const active = activeRunId();
  if (active) return { ok: false, status: 409, error: "a run is already in progress", activeRunId: active };
  const since = Date.now() - store().lastEndedAtMs;
  if (store().lastEndedAtMs && since < env.cooldownMs) {
    const retryAfterSec = Math.ceil((env.cooldownMs - since) / 1000);
    return { ok: false, status: 429, error: `cooldown: try again in ${retryAfterSec}s`, retryAfterSec };
  }
  return { ok: true };
}

export function registerRun(rec: RunRecord): void {
  const s = store();
  s.runs.set(rec.summary.runId, rec);
  s.activeRunId = rec.summary.runId;
  // Evict oldest finished runs beyond the cap.
  if (s.runs.size > MAX_RUNS) {
    for (const [id, r] of s.runs) {
      if (s.runs.size <= MAX_RUNS) break;
      if (id !== s.activeRunId && isTerminal(r.summary.status)) s.runs.delete(id);
    }
  }
}

export function markEnded(runId: string): void {
  const s = store();
  if (s.activeRunId === runId) s.activeRunId = null;
  s.lastEndedAtMs = Date.now();
}

export function eventsAfter(rec: RunRecord, after: number): RunEvent[] {
  return rec.summary.events.filter((e) => e.seq > after);
}

export function listRuns(): { runId: string; status: RunSummary["status"]; startedAt: string; finishedAt?: string; attemptCount: number }[] {
  return [...store().runs.values()]
    .map((r) => ({
      runId: r.summary.runId,
      status: r.summary.status,
      startedAt: r.summary.startedAt,
      finishedAt: r.summary.finishedAt,
      attemptCount: r.summary.attemptCount,
    }))
    .sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
}
