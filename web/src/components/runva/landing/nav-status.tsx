"use client";

import type { CSSProperties } from "react";
import { useEffect, useState } from "react";
import Link from "next/link";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowUpRight01Icon } from "@hugeicons/core-free-icons";
import type { HealthResponse } from "@/lib/runva/types";
import { fetchHealth } from "../client-api";

const bagBorder: CSSProperties & Record<"--border-gradient" | "--border-radius-before", string> = {
  "--border-gradient": "linear-gradient(to bottom, rgba(255,255,255,0.2), rgba(255,255,255,0.05))",
  "--border-radius-before": "9999px",
};

type State = { loading: true } | { loading: false; health: HealthResponse | null };

/** Readiness indicator + context button for the floating nav. Real data from GET /api/health. */
export function NavStatus() {
  const [state, setState] = useState<State>({ loading: true });

  useEffect(() => {
    const ctrl = new AbortController();
    let timer: number | undefined;
    const tick = async () => {
      const health = await fetchHealth(ctrl.signal);
      if (ctrl.signal.aborted) return;
      setState({ loading: false, health });
      timer = window.setTimeout(tick, 8000);
    };
    void tick();
    return () => {
      ctrl.abort();
      window.clearTimeout(timer);
    };
  }, []);

  const h = state.loading ? null : state.health;
  const ready = Boolean(h?.ok && h.sandboxConfigured && h.llmConfigured);
  const missing: string[] = [];
  if (h && !h.sandboxConfigured) missing.push("sandbox");
  if (h && !h.llmConfigured) missing.push("LLM");
  const label = state.loading
    ? "Checking…"
    : !h
      ? "Server unreachable"
      : ready
        ? "Ready"
        : missing.length
          ? `Missing ${missing.join(" + ")} key`
          : "Degraded";
  const dot = state.loading ? "bg-neutral-600" : !h ? "bg-red-500" : ready ? "bg-green-500" : "bg-amber-300";

  return (
    <div className="flex items-center gap-2">
      <span
        className="hidden sm:inline-flex items-center gap-2 px-3 text-[11px] font-medium text-neutral-400"
        title={h ? `sandbox ${h.sandboxConfigured ? "configured" : "missing"} · llm ${h.llmConfigured ? "configured" : "missing"}${h.model ? ` · ${h.model}` : ""}` : undefined}
      >
        <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
        {label}
      </span>
      {h?.activeRunId ? (
        <Link
          href={`/runs/${encodeURIComponent(h.activeRunId)}`}
          className="group relative flex items-center gap-2 rounded-full bg-neutral-900 px-4 py-2 text-xs font-medium text-white transition-all hover:bg-neutral-800"
          style={bagBorder}
        >
          <span>View active run</span>
          <HugeiconsIcon icon={ArrowUpRight01Icon} size={12} />
        </Link>
      ) : (
        <a
          href="#scenario"
          className="group relative flex items-center gap-2 rounded-full bg-neutral-900 px-4 py-2 text-xs font-medium text-white transition-all hover:bg-neutral-800"
          style={bagBorder}
        >
          <span>Start a run</span>
          <HugeiconsIcon icon={ArrowUpRight01Icon} size={12} />
        </a>
      )}
    </div>
  );
}
