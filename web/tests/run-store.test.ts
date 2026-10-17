import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { activeRunId, checkCanStart, markEnded, registerRun, store, type RunRecord } from "@/lib/runva/run-store";
import type { RunStatus, RunSummary } from "@/lib/runva/types";

function rec(runId: string, status: RunStatus = "INSPECTING"): RunRecord {
  const summary = {
    runId,
    scenarioId: "webhook-idempotency",
    status,
    startedAt: new Date().toISOString(),
    contract: "",
    baselineSource: "",
    baselineSha256: "",
    verifierSha256: "",
    model: "test",
    attempts: [],
    attemptCount: 0,
    caseResults: [],
    events: [],
    links: { report: "", patch: "" },
  } satisfies RunSummary;
  return { summary, abort: new AbortController(), startedAtMs: Date.now() };
}

function resetStore() {
  const s = store();
  s.runs.clear();
  s.activeRunId = null;
  s.lastEndedAtMs = 0;
}

describe("run-store guards", () => {
  beforeEach(() => {
    resetStore();
    vi.stubEnv("RUNVA_COOLDOWN_MS", "15000");
    vi.stubEnv("RUNVA_ACCESS_CODE", "");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it("allows a run when idle", () => {
    expect(checkCanStart(undefined)).toEqual({ ok: true });
  });

  it("allows only one active run (409 busy)", () => {
    registerRun(rec("run_a"));
    const r = checkCanStart(undefined);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(409);
      expect(r.activeRunId).toBe("run_a");
    }
  });

  it("frees the slot when the active run reaches a terminal status", () => {
    vi.stubEnv("RUNVA_COOLDOWN_MS", "0");
    const a = rec("run_a");
    registerRun(a);
    a.summary.status = "VERIFIED";
    expect(activeRunId()).toBeNull();
    expect(checkCanStart(undefined).ok).toBe(true);
  });

  it("enforces a cooldown after a run ends (429 with retryAfterSec), then allows", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-17T12:00:00Z"));
    registerRun(rec("run_a"));
    markEnded("run_a");
    vi.setSystemTime(new Date("2026-10-17T12:00:05Z"));
    const r = checkCanStart(undefined);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(429);
      expect(r.retryAfterSec).toBe(10);
    }
    vi.setSystemTime(new Date("2026-10-17T12:00:16Z"));
    expect(checkCanStart(undefined).ok).toBe(true);
  });

  it("requires the access code when RUNVA_ACCESS_CODE is set (401), checked before busy", () => {
    vi.stubEnv("RUNVA_ACCESS_CODE", "letmein");
    expect(checkCanStart(undefined)).toMatchObject({ ok: false, status: 401 });
    expect(checkCanStart("wrong")).toMatchObject({ ok: false, status: 401 });
    expect(checkCanStart("letmein")).toEqual({ ok: true });
    registerRun(rec("run_a"));
    expect(checkCanStart("nope")).toMatchObject({ ok: false, status: 401 });
    expect(checkCanStart("letmein")).toMatchObject({ ok: false, status: 409 });
  });

  it("markEnded for a non-active run does not clear the active slot", () => {
    registerRun(rec("run_a"));
    markEnded("run_other");
    expect(activeRunId()).toBe("run_a");
  });
});
