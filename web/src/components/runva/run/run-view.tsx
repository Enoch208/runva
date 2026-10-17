"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { RunSummary } from "@/lib/runva/types";
import { SiteLogo } from "../landing/site-logo";
import { isTerminal } from "../run-model";
import { secondaryButton } from "./primitives";
import type { CancelState } from "./run-actions";
import { RunDashboard } from "./run-dashboard";
import type { Connection } from "./run-header";

type Load = { kind: "loading"; failures: number } | { kind: "missing" } | { kind: "ready"; summary: RunSummary; at: number };

function normalize(raw: unknown): RunSummary | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<RunSummary>;
  if (typeof r.runId !== "string" || typeof r.status !== "string") return null;
  return {
    ...(r as RunSummary),
    attempts: Array.isArray(r.attempts) ? r.attempts : [],
    caseResults: Array.isArray(r.caseResults) ? r.caseResults : [],
    events: Array.isArray(r.events) ? r.events : [],
    links: r.links ?? { report: `/api/runs/${r.runId}/report`, patch: `/api/runs/${r.runId}/patch` },
  };
}

/** Polls GET /api/runs/[id] about every second until the run reaches a terminal status. */
export function RunView({ runId }: { runId: string }) {
  const [load, setLoad] = useState<Load>({ kind: "loading", failures: 0 });
  const [connection, setConnection] = useState<Connection>("live");
  const [cancelState, setCancelState] = useState<CancelState>("idle");

  useEffect(() => {
    const ctrl = new AbortController();
    let timer: number | undefined;
    let failures = 0;

    const poll = async () => {
      try {
        const res = await fetch(`/api/runs/${encodeURIComponent(runId)}`, { cache: "no-store", signal: ctrl.signal });
        if (res.status === 404) {
          setLoad({ kind: "missing" });
          return;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const summary = normalize(await res.json());
        if (!summary) throw new Error("Malformed run summary");
        failures = 0;
        setLoad({ kind: "ready", summary, at: Date.now() });
        if (isTerminal(summary.status)) {
          setConnection("done");
          return; // terminal state is final — stop polling
        }
        setConnection("live");
      } catch {
        if (ctrl.signal.aborted) return;
        failures += 1;
        setConnection("reconnecting");
        setLoad((prev) => (prev.kind === "loading" ? { kind: "loading", failures } : prev));
      }
      timer = window.setTimeout(poll, failures === 0 ? 1000 : Math.min(5000, 1000 * 2 ** (failures - 1)));
    };

    void poll();
    return () => {
      ctrl.abort();
      window.clearTimeout(timer);
    };
  }, [runId]);

  const onCancel = useCallback(async () => {
    setCancelState("pending");
    try {
      const res = await fetch(`/api/runs/${encodeURIComponent(runId)}/cancel`, { method: "POST" });
      setCancelState(res.ok ? "requested" : "error");
    } catch {
      setCancelState("error");
    }
  }, [runId]);

  if (load.kind === "ready") {
    return (
      <RunDashboard
        summary={load.summary}
        connection={connection}
        onCancel={onCancel}
        cancelState={cancelState}
        updatedAt={load.at}
      />
    );
  }
  if (load.kind === "missing") return <RunMissing runId={runId} />;
  return <RunLoading reconnecting={load.failures > 0} />;
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#020202] p-6 text-center">
      <div className="flex max-w-md flex-col items-center gap-3">{children}</div>
    </div>
  );
}

export function RunLoading({ reconnecting = false }: { reconnecting?: boolean }) {
  return (
    <Frame>
      <SiteLogo />
      <span className="text-xl text-white">{reconnecting ? "Server unreachable" : "Loading run…"}</span>
      <span className="text-sm text-neutral-500">
        {reconnecting ? "Retrying with backoff. Nothing is shown until real data arrives." : "Reading the run summary from the server."}
      </span>
    </Frame>
  );
}

function RunMissing({ runId }: { runId: string }) {
  return (
    <Frame>
      <SiteLogo />
      <span className="text-xl text-white">Run not found</span>
      <span className="text-sm text-neutral-500">
        No run with id <code className="font-mono text-neutral-300">{runId}</code> exists on this server. If the server
        restarted, the run may no longer be available.
      </span>
      <Link href="/" className={secondaryButton}>
        Back to Mission Control
      </Link>
    </Frame>
  );
}
