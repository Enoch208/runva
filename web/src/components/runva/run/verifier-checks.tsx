import { HugeiconsIcon } from "@hugeicons/react";
import { CancelCircleIcon, CheckmarkCircle02Icon, Clock01Icon } from "@hugeicons/core-free-icons";
import type { RunSummary, VerdictCase } from "@/lib/runva/types";
import { formatMs, formatObservation, isTerminal } from "../run-model";
import { ExitChip, Panel, PanelTitle, cx } from "./primitives";

const CASE_IDS: VerdictCase["id"][] = ["V1", "V2", "V3", "V4", "V5", "V6"];

function CheckHeader({ id, title, state, verified }: { id: string; title: string; state: "pass" | "fail" | "pending"; verified: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex flex-col gap-1">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-neutral-500">{id}</span>
        <h4 className="text-sm font-medium text-white">{title}</h4>
      </div>
      <HugeiconsIcon
        icon={state === "pending" ? Clock01Icon : state === "pass" ? CheckmarkCircle02Icon : CancelCircleIcon}
        size={20}
        className={cx(
          "shrink-0",
          state === "pending" ? "text-neutral-500" : state === "fail" ? "text-red-500" : verified ? "text-green-500" : "text-neutral-300",
        )}
      />
    </div>
  );
}

function ResultLine({ label, c, verified }: { label: string; c: VerdictCase | undefined; verified: boolean }) {
  if (!c) {
    return (
      <div className="rounded-lg border border-white/10 px-3 py-2 font-mono text-xs text-neutral-500">
        {label} · not run
      </div>
    );
  }
  return (
    <div
      className={cx(
        "rounded-lg border px-3 py-2 font-mono text-xs",
        !c.pass
          ? "border-[#FF5A36]/20 bg-[#FF5A36]/5 text-[#FF5A36]"
          : verified
            ? "border-green-500/20 bg-green-500/5 text-green-500"
            : "border-white/10 text-neutral-200",
      )}
    >
      {label} · {c.pass ? "PASS" : "FAIL"} · <span className="text-neutral-300">{formatObservation(c.observed)}</span>
    </div>
  );
}

/** V1–V6 frozen verifier cases as a card grid. */
export function VerifierChecks({ summary }: { summary: RunSummary }) {
  const base = summary.baselineResult?.verdict?.cases ?? [];
  const finalCases = summary.finalResult?.verdict?.cases ?? (summary.caseResults?.length ? summary.caseResults : []);
  const verified = summary.status === "VERIFIED";
  const terminal = isTerminal(summary.status);
  const known = new Set<string>(CASE_IDS);
  const extra = Array.from(new Set([...base, ...finalCases].map((c) => c.id).filter((id) => !known.has(id))));
  const ids = [...CASE_IDS.filter((id) => base.some((c) => c.id === id) || finalCases.some((c) => c.id === id)), ...extra];

  return (
    <Panel id="verifier">
      <PanelTitle
        title="Frozen verifier · V1–V6"
        description="Host-owned replay scenarios the patching model cannot edit. Each case runs with fresh simulated state against the baseline, then against the final candidate."
        aside={
          <>
            {summary.baselineResult ? (
              <span className="flex items-center gap-1.5 font-mono text-[11px] text-neutral-500">
                baseline <ExitChip code={summary.baselineResult.exitCode} />
                {summary.baselineResult.verdict ? formatMs(summary.baselineResult.verdict.durationMs) : ""}
              </span>
            ) : null}
            {summary.finalResult ? (
              <span className="flex items-center gap-1.5 font-mono text-[11px] text-neutral-500">
                final <ExitChip code={summary.finalResult.exitCode} />
                {summary.finalResult.verdict ? formatMs(summary.finalResult.verdict.durationMs) : ""}
              </span>
            ) : null}
          </>
        }
      />

      {ids.length === 0 ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {CASE_IDS.map((id) => (
            <article key={id} className="flex flex-col gap-4 rounded-2xl border border-dashed border-white/10 bg-[#0a0a0a] p-5">
              <CheckHeader id={id} title={terminal ? "Verifier did not run" : "Awaiting verifier output"} state="pending" verified={false} />
              <div className="rounded-lg border border-white/10 px-3 py-2 font-mono text-xs text-neutral-400">
                {terminal ? "Not produced in this run" : "Pending · not yet executed"}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {ids.map((id) => {
            const b = base.find((c) => c.id === id);
            const f = finalCases.find((c) => c.id === id);
            const ref = f ?? b;
            const state = f ? (f.pass ? "pass" : "fail") : "pending";
            return (
              <article
                key={id}
                className={cx(
                  "flex flex-col gap-4 rounded-2xl border bg-[#0a0a0a] p-5",
                  f ? "border-white/5" : "border-dashed border-white/10",
                )}
              >
                <CheckHeader id={id} title={ref?.title ?? id} state={state} verified={verified} />
                <p className="text-xs text-neutral-400">Expected · {ref ? formatObservation(ref.expected) : "—"}</p>
                <div className="flex flex-col gap-2">
                  <ResultLine label="Baseline" c={b} verified={false} />
                  <ResultLine label="Final" c={f} verified={verified} />
                </div>
                {b?.details || f?.details ? (
                  <div className="mt-auto flex flex-col gap-0.5 font-mono text-[11px] text-neutral-500">
                    {b?.details ? <span className="break-words">baseline · {b.details}</span> : null}
                    {f?.details ? <span className="break-words">final · {f.details}</span> : null}
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      )}
      {!summary.finalResult && summary.caseResults?.length ? (
        <span className="font-mono text-[10px] text-neutral-600">Final column shows the latest reported case results.</span>
      ) : null}
    </Panel>
  );
}
