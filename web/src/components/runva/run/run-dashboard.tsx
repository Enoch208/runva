"use client";

import type { ReactNode } from "react";
import type { RunSummary } from "@/lib/runva/types";
import { useNow } from "../hooks";
import { elapsedMs, formatDuration, isTerminal } from "../run-model";
import { ActivityTimeline } from "./activity-timeline";
import { ArtifactsPanel } from "./artifacts-panel";
import { EvidencePanel } from "./evidence-panel";
import { ExecutionProofPanel } from "./execution-proof";
import { FingerprintsPanel } from "./fingerprints-panel";
import { PageHeading } from "./page-heading";
import { StatusChip } from "./primitives";
import { RunActions, type CancelState } from "./run-actions";
import { RunHeader, type Connection } from "./run-header";
import { RunMobileNav } from "./run-mobile-nav";
import { RunSidebar } from "./run-sidebar";
import { ScopeOfProof } from "./scope-of-proof";
import { RunFigures, VerdictPanel } from "./verdict-panel";
import { VerifierChecks } from "./verifier-checks";

/** Dashboard shell: framed canvas, sidebar stepper, header, scrollable evidence column. */
export function RunShell({ sidebar, header, mobileNav, children, topSlot }: {
  sidebar: ReactNode;
  header: ReactNode;
  mobileNav?: ReactNode;
  children: ReactNode;
  topSlot?: ReactNode;
}) {
  return (
    <div className="min-h-screen lg:h-screen bg-[#020202] p-3 lg:p-8 flex flex-col items-center gap-3">
      {topSlot}
      <div className="bg-[#070707] w-full max-w-[1500px] lg:flex-1 lg:min-h-0 rounded-[28px] lg:rounded-[40px] shadow-2xl shadow-black/50 overflow-hidden flex flex-col lg:flex-row relative border border-white/5">
        {sidebar}
        <main className="flex-1 flex flex-col min-w-0 lg:h-full bg-[#070707]">
          {header}
          {mobileNav}
          <div className="flex-1 min-h-0 px-5 pb-8 pt-6 lg:pt-0 lg:px-8 lg:overflow-y-auto no-scrollbar">{children}</div>
        </main>
      </div>
    </div>
  );
}

export function RunDashboard({
  summary,
  connection = "done",
  onCancel,
  cancelState,
  updatedAt,
  preview = false,
  topSlot,
}: {
  summary: RunSummary;
  connection?: Connection;
  onCancel?: () => void;
  cancelState?: CancelState;
  updatedAt?: number;
  preview?: boolean;
  topSlot?: ReactNode;
}) {
  const terminal = isTerminal(summary.status);
  const now = useNow(!terminal);

  return (
    <RunShell
      topSlot={topSlot}
      sidebar={<RunSidebar summary={summary} />}
      header={<RunHeader summary={summary} connection={connection} onCancel={onCancel} cancelState={cancelState} />}
      mobileNav={<RunMobileNav summary={summary} />}
    >
      <section className="pb-8">
        <PageHeading
          title={
            (summary.scenarioId as string) === "durable-idempotency"
              ? "Durable Idempotency — Across Processes & Restarts"
              : "Webhook Reliability — Duplicate Fulfillment"
          }
          description={summary.contract || "One paid order → one fulfillment, even under duplicate or concurrent delivery."}
          aside={
            <div className="flex flex-col items-start gap-3 md:items-end">
              <StatusChip status={summary.status} />
              <RunActions summary={summary} preview={preview} />
            </div>
          }
        />
        <div className="flex flex-col gap-6">
          <VerdictPanel summary={summary} updatedAt={updatedAt} />
          <div className="flex flex-col gap-4">
            <EvidencePanel summary={summary} />
            <RunFigures summary={summary} elapsed={formatDuration(elapsedMs(summary, now))} />
          </div>
          <ExecutionProofPanel summary={summary} />
          <VerifierChecks summary={summary} />
          <div className="grid grid-cols-1 gap-10 2xl:grid-cols-5">
            <div className="min-w-0 2xl:col-span-2">
              <ActivityTimeline events={summary.events ?? []} startedAt={summary.startedAt} live={!terminal} />
            </div>
            <div className="min-w-0 2xl:col-span-3">
              <ArtifactsPanel summary={summary} />
            </div>
          </div>
          <FingerprintsPanel summary={summary} />
          <ScopeOfProof />
        </div>
      </section>
    </RunShell>
  );
}
