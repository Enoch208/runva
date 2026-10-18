"use client";

import Link from "next/link";
import type { RunSummary } from "@/lib/runva/types";
import { useNow } from "../hooks";
import { STATUS_LABEL, elapsedMs, formatDuration, isTerminal, shortId } from "../run-model";
import { CancelButton, CopyLinkButton, type CancelState } from "./run-actions";

export type Connection = "live" | "reconnecting" | "done";

export function RunHeader({
  summary,
  connection,
  onCancel,
  cancelState,
}: {
  summary: RunSummary;
  connection: Connection;
  onCancel?: () => void;
  cancelState?: CancelState;
}) {
  const terminal = isTerminal(summary.status);
  const now = useNow(!terminal);
  const elapsed = elapsedMs(summary, now);
  const attempts = summary.attemptCount ?? summary.attempts?.length ?? 0;

  return (
    <header className="flex flex-col md:flex-row md:items-center gap-4 px-5 pt-6 pb-6 lg:px-8 lg:pt-8 justify-between">
      <div className="flex items-center gap-4 min-w-0">
        <span className="text-3xl lg:text-4xl font-medium text-white tracking-tight">Run</span>
        <div className="h-8 w-px bg-white/10 mx-2" />
        <div className="flex flex-col min-w-0">
          <span className="text-sm font-medium text-white">{STATUS_LABEL[summary.status] ?? summary.status}</span>
          <span className="truncate text-xs text-neutral-500" title={summary.runId}>
            {shortId(summary.runId, 22)} · {summary.scenarioId}
          </span>
        </div>
      </div>

      <div className="bg-white/[0.04] p-1 rounded-full flex items-center self-start md:self-center border border-white/5">
        <span className="px-4 py-1.5 bg-white/10 rounded-full text-xs font-medium text-white tabular-nums">
          {terminal ? "Duration" : "Elapsed"} <span className="font-mono">{formatDuration(elapsed)}</span>
        </span>
        <span className="px-4 py-1.5 text-xs font-medium text-neutral-400 tabular-nums">
          Attempt <span className="font-mono">{attempts}</span>
          <span className="text-neutral-600"> / 3</span>
        </span>
        <span className="hidden sm:inline px-4 py-1.5 text-xs font-medium text-neutral-500">
          {connection === "reconnecting" ? (
            <span className="text-amber-300">Reconnecting…</span>
          ) : connection === "live" ? (
            "Polling · 1s"
          ) : (
            <Link href="/" className="hover:text-white transition-colors">
              Mission Control
            </Link>
          )}
        </span>
      </div>

      <div className="flex items-center gap-3 self-end md:self-center">
        <CopyLinkButton />
        <CancelButton summary={summary} onCancel={onCancel} cancelState={cancelState} />
      </div>
    </header>
  );
}
