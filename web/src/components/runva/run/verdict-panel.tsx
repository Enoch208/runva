"use client";

import { useEffect, useState } from "react";
import type { RunSummary } from "@/lib/runva/types";
import { PulseDot } from "../landing/pulse-dot";
import { STATUS_LABEL, TONE_STYLES, isTerminal, shortHash, shortId, sideEvidence, toneFor } from "../run-model";
import { cx } from "./primitives";

function UpdatedAgo({ at }: { at: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const seconds = Math.max(0, Math.floor((now - at) / 1000));
  return <span>Updated {seconds.toString()}s ago</span>;
}

type Copy = { kicker: string; headline: string; body: string };

function verdictCopy(summary: RunSummary): Copy {
  const err = summary.error;
  switch (summary.status) {
    case "VERIFIED":
      return {
        kicker: "Verdict · verified",
        headline: "Repair verified by the frozen independent verifier.",
        body: "The unmodified, hash-pinned verifier passed against the patched handler in a real CreateOS execution.",
      };
    case "FAILED":
      return {
        kicker: "Verdict · not verified",
        headline: "The repair did not pass independent verification.",
        body: err?.message ?? "No candidate patch satisfied every frozen verifier case within the attempt budget.",
      };
    case "INCONCLUSIVE":
      return {
        kicker: "Verdict · inconclusive",
        headline: "No verified claim can be made from this run.",
        body: err?.message ?? "The baseline failure could not be reproduced, so a repair cannot be proven.",
      };
    case "CANCELLED":
      return {
        kicker: "Run cancelled",
        headline: "Cancelled before a verdict.",
        body: err?.message ?? "No verification claim is made for a cancelled run. The sandbox is torn down on cancel.",
      };
    case "INFRA_ERROR":
      return {
        kicker: "Infrastructure error · no verdict",
        headline: "The run stopped on an infrastructure failure.",
        body: err?.message ?? "The execution environment failed before a verdict was reached.",
      };
    default:
      return {
        kicker: "Live run · no verdict yet",
        headline: `${STATUS_LABEL[summary.status] ?? summary.status}…`,
        body: "Progress is reported by the server as each real step completes. Nothing on this page is simulated.",
      };
  }
}

/** Action-status / live-health style verdict banner. Green only when status === "VERIFIED". */
export function VerdictPanel({ summary, updatedAt }: { summary: RunSummary; updatedAt?: number }) {
  const tone = toneFor(summary.status);
  const s = TONE_STYLES[tone];
  const live = !isTerminal(summary.status);
  const copy = verdictCopy(summary);
  const final = sideEvidence(summary.finalResult);
  const err = summary.error;

  return (
    <section
      id="verdict"
      role="status"
      aria-live="polite"
      aria-busy={live}
      className={cx("flex flex-col gap-4 rounded-2xl border bg-[#0a0a0a] p-5 lg:p-6 scroll-mt-6", s.border, s.glow)}
    >
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
        <div className="max-w-2xl">
          <p className={cx("mb-2 flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest", live ? "text-[#FF5A36]" : s.text)}>
            {live ? <PulseDot /> : <span className={cx("h-1.5 w-1.5 rounded-full", s.dot)} />}
            {copy.kicker}
          </p>
          <h2 className="text-xl font-medium text-white">{copy.headline}</h2>
          <p className="mt-2 text-xs leading-relaxed text-neutral-400">{copy.body}</p>
        </div>
        {updatedAt ? (
          <span className="shrink-0 font-mono text-[11px] text-neutral-500">
            <UpdatedAgo at={updatedAt} />
          </span>
        ) : null}
      </div>

      {final && final.cases.length > 0 ? (
        <div className="flex flex-wrap items-center gap-3 font-mono text-xs">
          <span className={summary.status === "VERIFIED" ? "text-green-500" : "text-neutral-200"}>{final.passing} PASS</span>
          <span className={final.failing > 0 ? "text-red-500" : "text-neutral-500"}>{final.failing} FAIL</span>
          <span className="text-neutral-500">
            exit {final.result.exitCode} · handler {shortHash(final.result.handlerSha256, 10)} · verifier{" "}
            {shortHash(final.result.verifierSha256, 10)}
          </span>
        </div>
      ) : null}

      {summary.status !== "VERIFIED" && err?.hint ? (
        <div className={cx("rounded-lg border px-3 py-2 font-mono text-xs", s.border, s.bg, s.text)}>
          What to do · <span className="text-neutral-200">{err.hint}</span>
        </div>
      ) : null}

      {summary.status !== "VERIFIED" && err?.category ? (
        <span className="font-mono text-[10px] text-neutral-600">error category · {err.category}</span>
      ) : null}
    </section>
  );
}

/** Figures strip for run facts. */
export function RunFigures({ summary, elapsed }: { summary: RunSummary; elapsed: string }) {
  const attempts = summary.attemptCount ?? summary.attempts?.length ?? 0;
  const cells = [
    { label: isTerminal(summary.status) ? "Duration" : "Elapsed", value: elapsed, note: "from server timestamps" },
    { label: "Patch attempts", value: String(attempts), note: "max 3 · 1 + 2 repairs" },
    {
      label: "Sandbox",
      value: summary.sandbox ? shortId(summary.sandbox.id, 12) : "—",
      note: summary.sandbox ? [summary.sandbox.shape, summary.sandbox.region].filter(Boolean).join(" · ") : "not provisioned",
      title: summary.sandbox?.egress?.length ? `egress allowlist: ${summary.sandbox.egress.join(", ")}` : undefined,
    },
    { label: "Model", value: summary.model ? shortId(summary.model, 18) : "—", note: "test + patch author", title: summary.model },
  ];
  return (
    <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-white/5 bg-white/5 md:grid-cols-4">
      {cells.map((c) => (
        <div key={c.label} className="flex min-w-0 flex-col items-center gap-2 bg-[#050505] px-4 py-6" title={c.title}>
          <dt className="text-[10px] font-medium uppercase tracking-widest text-neutral-500">{c.label}</dt>
          <dd className="max-w-full truncate font-mono text-xl text-white tabular-nums md:text-2xl">{c.value}</dd>
          <dd className="max-w-full truncate text-[11px] text-neutral-500">{c.note}</dd>
        </div>
      ))}
    </dl>
  );
}
