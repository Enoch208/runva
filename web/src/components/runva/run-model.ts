// Pure helpers that turn a RunSummary into what the UI shows.
// Everything here is derived from backend data only — no timers, no fabricated values.
import {
  TERMINAL_STATUSES,
  type CommandEvidence,
  type RunEvent,
  type RunStatus,
  type RunSummary,
  type VerdictCase,
  type VerifierResult,
} from "@/lib/runva/types";

export const STEPS = [
  { key: "inspect", label: "Inspect" },
  { key: "tests", label: "Write tests" },
  { key: "baseline", label: "Execute baseline" },
  { key: "reproduce", label: "Reproduce failure" },
  { key: "patch", label: "Write patch" },
  { key: "patch-exec", label: "Execute patch" },
  { key: "verify", label: "Independent verification" },
  { key: "receipt", label: "Receipt" },
] as const;

export type StepState = "done" | "active" | "pending" | "stopped" | "skipped" | "verified";

export const STATUS_LABEL: Record<RunStatus, string> = {
  CREATED: "Queued",
  INSPECTING: "Inspecting & writing tests",
  TESTS_GENERATED: "Tests generated",
  BASELINE_RUNNING: "Running baseline in sandbox",
  FAILURE_REPRODUCED: "Failure reproduced",
  PATCH_GENERATING: "Writing patch",
  PATCH_TESTING: "Testing patch in sandbox",
  REPAIRING: "Repairing patch",
  INDEPENDENT_VERIFYING: "Independent verification",
  VERIFIED: "Verified",
  FAILED: "Not verified",
  INCONCLUSIVE: "Inconclusive",
  CANCELLED: "Cancelled",
  INFRA_ERROR: "Infrastructure error",
};

export function isTerminal(status: RunStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/**
 * Where a non-terminal status sits on the 8-step stepper.
 * `complete` marks milestone statuses (the step has finished, the next one has not begun).
 */
const STATUS_STEP: Partial<Record<RunStatus, { index: number; complete: boolean }>> = {
  CREATED: { index: 0, complete: false },
  INSPECTING: { index: 1, complete: false },
  TESTS_GENERATED: { index: 1, complete: true },
  BASELINE_RUNNING: { index: 2, complete: false },
  FAILURE_REPRODUCED: { index: 3, complete: true },
  PATCH_GENERATING: { index: 4, complete: false },
  REPAIRING: { index: 4, complete: false },
  PATCH_TESTING: { index: 5, complete: false },
  INDEPENDENT_VERIFYING: { index: 6, complete: false },
};

/** Last non-terminal status the run actually reached, from the event log. */
export function lastProgressStatus(summary: RunSummary): RunStatus {
  if (!isTerminal(summary.status)) return summary.status;
  const events = summary.events ?? [];
  for (let i = events.length - 1; i >= 0; i--) {
    const s = events[i]?.status;
    if (s && !isTerminal(s)) return s;
  }
  return "CREATED";
}

export function computeSteps(summary: RunSummary): StepState[] {
  const status = summary.status;
  const n = STEPS.length;

  if (status === "VERIFIED") return Array.from({ length: n }, () => "verified");

  if (!isTerminal(status)) {
    const pos = STATUS_STEP[status] ?? { index: 0, complete: false };
    return Array.from({ length: n }, (_, i) => {
      if (i < pos.index) return "done";
      if (i === pos.index) return pos.complete ? "done" : "active";
      return "pending";
    });
  }

  // Terminal but not verified: find where it stopped.
  const reached = STATUS_STEP[lastProgressStatus(summary)] ?? { index: 0, complete: false };
  let stopAt = reached.complete ? reached.index + 1 : reached.index;
  // Evidence beats inference: a recorded baseline verifier result means the baseline step finished.
  if (summary.baselineResult && stopAt <= 2) stopAt = 3;
  if (summary.finalResult && stopAt <= 5) stopAt = 6;
  stopAt = Math.min(stopAt, n - 2);

  const receiptIssued = status === "FAILED" || status === "INCONCLUSIVE";
  return Array.from({ length: n }, (_, i) => {
    if (i === n - 1) return receiptIssued ? "done" : "skipped";
    if (i < stopAt) return "done";
    if (i === stopAt) return "stopped";
    return "skipped";
  });
}

export type Tone = "running" | "verified" | "failed" | "inconclusive" | "cancelled" | "infra";

export function toneFor(status: RunStatus): Tone {
  switch (status) {
    case "VERIFIED":
      return "verified";
    case "FAILED":
      return "failed";
    case "INCONCLUSIVE":
      return "inconclusive";
    case "CANCELLED":
      return "cancelled";
    case "INFRA_ERROR":
      return "infra";
    default:
      return "running";
  }
}

/** Tailwind classes per tone. Success (green) styling is only reachable via status === "VERIFIED". */
export const TONE_STYLES: Record<Tone, { text: string; border: string; bg: string; dot: string; glow: string }> = {
  running: {
    text: "text-neutral-200",
    border: "border-white/10",
    bg: "bg-white/[0.03]",
    dot: "bg-[#FF5A36]",
    glow: "shadow-[0_0_15px_rgba(204,0,0,0.15)]",
  },
  verified: {
    text: "text-green-500",
    border: "border-green-500/25",
    bg: "bg-green-500/[0.04]",
    dot: "bg-green-500",
    glow: "shadow-[0_0_24px_rgba(34,197,94,0.12)]",
  },
  failed: {
    text: "text-red-500",
    border: "border-red-500/25",
    bg: "bg-red-500/[0.04]",
    dot: "bg-red-500",
    glow: "shadow-[0_0_24px_rgba(239,68,68,0.12)]",
  },
  inconclusive: {
    text: "text-amber-300",
    border: "border-amber-300/20",
    bg: "bg-amber-300/[0.04]",
    dot: "bg-amber-300",
    glow: "shadow-[0_0_24px_rgba(252,211,77,0.08)]",
  },
  cancelled: {
    text: "text-neutral-400",
    border: "border-white/10",
    bg: "bg-white/[0.02]",
    dot: "bg-neutral-500",
    glow: "",
  },
  infra: {
    text: "text-orange-400",
    border: "border-orange-400/25",
    bg: "bg-orange-400/[0.04]",
    dot: "bg-orange-400",
    glow: "shadow-[0_0_24px_rgba(251,146,60,0.1)]",
  },
};

// ---------- formatting ----------

export function shortHash(hash: string | undefined | null, len = 12): string {
  if (!hash) return "—";
  const h = hash.replace(/^sha256:/, "");
  return h.length > len ? `${h.slice(0, len)}…` : h;
}

export function shortId(id: string | undefined | null, len = 10): string {
  if (!id) return "—";
  return id.length > len ? `${id.slice(0, len)}…` : id;
}

function pad(n: number, w = 2): string {
  return String(Math.floor(n)).padStart(w, "0");
}

export function formatDuration(ms: number | undefined | null): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return "—";
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

export function formatMs(ms: number | undefined | null): string {
  if (ms == null || !Number.isFinite(ms)) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`;
}

/** "+01:23.4" offset of an event from the run start (deterministic, timezone-free). */
export function formatOffset(at: string, startedAt: string): string {
  const d = Date.parse(at) - Date.parse(startedAt);
  if (!Number.isFinite(d)) return "";
  const sign = d < 0 ? "-" : "+";
  const abs = Math.abs(d);
  const m = Math.floor(abs / 60000);
  const s = Math.floor((abs % 60000) / 1000);
  const t = Math.floor((abs % 1000) / 100);
  return `${sign}${pad(m)}:${pad(s)}.${t}`;
}

/** "14:03:22Z" — UTC clock time, identical on server and client. */
export function formatUtcClock(at: string): string {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return "";
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}Z`;
}

export function formatRelative(at: string, now: number): string {
  const t = Date.parse(at);
  if (!Number.isFinite(t)) return "";
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

// ---------- evidence extraction (defensive: observed/expected are `unknown`) ----------

export function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

export function pickNumber(v: unknown, keys: string[]): number | undefined {
  const r = asRecord(v);
  if (!r) return undefined;
  for (const k of keys) {
    const x = r[k];
    if (typeof x === "number" && Number.isFinite(x)) return x;
  }
  return undefined;
}

export function formatValue(v: unknown): string {
  if (v === undefined) return "—";
  if (v === null) return "null";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

/** Compact "k: v · k: v" for observed/expected objects. */
export function formatObservation(v: unknown): string {
  const r = asRecord(v);
  if (!r) return formatValue(v);
  const parts = Object.entries(r).map(([k, x]) => `${k}: ${formatValue(x)}`);
  return parts.length ? parts.join(" · ") : "{}";
}

export const DELIVERY_KEYS = ["deliveries", "deliveryCount", "delivered", "events", "sent", "attempts"];
export const FULFILLMENT_KEYS = ["fulfillments", "fulfillmentCount", "fulfilled", "fulfillOrderCalls", "calls"];

export type SideEvidence = {
  result: VerifierResult;
  cases: VerdictCase[];
  v1?: VerdictCase;
  deliveries?: number;
  fulfillments?: number;
  expectedFulfillments?: number;
  passing: number;
  failing: number;
  allPass: boolean | null; // null when verdict could not be parsed
};

export function sideEvidence(result: VerifierResult | undefined): SideEvidence | null {
  if (!result) return null;
  const cases = result.verdict?.cases ?? [];
  const v1 = cases.find((c) => c.id === "V1");
  const deliveries = v1
    ? (pickNumber(v1.observed, DELIVERY_KEYS) ?? pickNumber(v1.expected, DELIVERY_KEYS))
    : undefined;
  const fulfillments = v1 ? pickNumber(v1.observed, FULFILLMENT_KEYS) : undefined;
  const expectedFulfillments = v1 ? pickNumber(v1.expected, FULFILLMENT_KEYS) : undefined;
  const passing = cases.filter((c) => c.pass).length;
  return {
    result,
    cases,
    v1,
    deliveries,
    fulfillments,
    expectedFulfillments,
    passing,
    failing: cases.length - passing,
    allPass: result.verdict ? result.verdict.pass : null,
  };
}

/** Latest attempt that has a verifier result (used while finalResult is not yet set). */
export function latestVerifiedAttempt(summary: RunSummary) {
  const attempts = [...(summary.attempts ?? [])].sort((a, b) => a.attempt - b.attempt);
  for (let i = attempts.length - 1; i >= 0; i--) {
    if (attempts[i].verifier) return attempts[i];
  }
  return undefined;
}

/** Every real sandbox command execution recorded on the summary, in time order, de-duplicated. */
export function collectCommands(summary: RunSummary): CommandEvidence[] {
  const out: CommandEvidence[] = [];
  const seen = new Set<string>();
  const push = (c: CommandEvidence | undefined) => {
    if (!c) return;
    const key = `${c.label}|${c.cmd}|${c.at}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(c);
  };
  push(summary.baselineAgentTests);
  push(summary.baselineResult?.command);
  for (const a of summary.attempts ?? []) {
    push(a.agentTests);
    push(a.verifier?.command);
  }
  push(summary.finalResult?.command);
  return out.sort((a, b) => (Date.parse(a.at) || 0) - (Date.parse(b.at) || 0));
}

export function elapsedMs(summary: RunSummary, now: number | null): number | null {
  const start = Date.parse(summary.startedAt);
  if (!Number.isFinite(start)) return null;
  if (isTerminal(summary.status)) {
    if (typeof summary.durationMs === "number") return summary.durationMs;
    const end = summary.finishedAt ? Date.parse(summary.finishedAt) : NaN;
    if (Number.isFinite(end)) return end - start;
    const last = summary.events?.[summary.events.length - 1];
    const lastAt = last ? Date.parse(last.at) : NaN;
    return Number.isFinite(lastAt) ? lastAt - start : null;
  }
  if (now == null) return null;
  return Math.max(0, now - start);
}

export function sortedEvents(events: RunEvent[] | undefined): RunEvent[] {
  return [...(events ?? [])].sort((a, b) => a.seq - b.seq);
}
