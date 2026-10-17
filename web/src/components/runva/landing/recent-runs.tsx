"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { RunStatus } from "@/lib/runva/types";
import { fetchRecentRuns, type RecentRun } from "../client-api";
import { useNow } from "../hooks";
import { STATUS_LABEL, TONE_STYLES, formatRelative, shortId, toneFor } from "../run-model";

const KNOWN = new Set(Object.keys(STATUS_LABEL));

export function RecentRuns() {
  const [runs, setRuns] = useState<RecentRun[] | null>(null);
  const now = useNow(true, 15000);

  useEffect(() => {
    const ctrl = new AbortController();
    void fetchRecentRuns(ctrl.signal).then((r) => {
      if (!ctrl.signal.aborted) setRuns(r ?? []);
    });
    return () => ctrl.abort();
  }, []);

  if (!runs || runs.length === 0) return null;

  const sorted = [...runs]
    .sort((a, b) => (Date.parse(b.startedAt ?? "") || 0) - (Date.parse(a.startedAt ?? "") || 0))
    .slice(0, 8);

  return (
    <div id="recent" className="mb-24 scroll-mt-32 flex flex-col items-center gap-6">
      <span className="text-[10px] font-semibold uppercase tracking-widest text-neutral-500">Recent runs</span>
      <div className="flex flex-wrap gap-3 md:gap-4 justify-center">
        {sorted.map((r) => {
          const status = (KNOWN.has(r.status) ? r.status : "CREATED") as RunStatus;
          const s = TONE_STYLES[toneFor(status)];
          return (
            <Link
              key={r.runId}
              href={`/runs/${encodeURIComponent(r.runId)}`}
              className="group flex items-center gap-2 md:gap-3 rounded-full border border-white/5 bg-white/[0.02] px-4 py-2.5 md:px-6 md:py-3 hover:bg-white/[0.05] transition-colors"
            >
              <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
              <span className="font-mono text-xs text-neutral-300">{shortId(r.runId, 14)}</span>
              <span className={`text-[10px] uppercase tracking-wider ${s.text}`}>
                {KNOWN.has(r.status) ? STATUS_LABEL[status] : r.status}
              </span>
              {r.startedAt && now ? (
                <span className="hidden font-mono text-[10px] text-neutral-600 md:inline">{formatRelative(r.startedAt, now)}</span>
              ) : null}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
