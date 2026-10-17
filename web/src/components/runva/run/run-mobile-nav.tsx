import type { RunSummary } from "@/lib/runva/types";
import { STEPS, TONE_STYLES, computeSteps, toneFor, type StepState } from "../run-model";
import { RUN_SECTIONS } from "./run-sidebar";
import { cx } from "./primitives";

function barClass(st: StepState, stopDot: string): string {
  switch (st) {
    case "verified":
      return "bg-green-500";
    case "done":
      return "bg-neutral-400";
    case "active":
      return "bg-[#FF5A36] animate-pulse";
    case "stopped":
      return stopDot;
    default:
      return "bg-white/10";
  }
}

/** Mobile (< lg) phase stepper + section pills, sticky. */
export function RunMobileNav({ summary }: { summary: RunSummary }) {
  const states = computeSteps(summary);
  const tone = TONE_STYLES[toneFor(summary.status)];
  let idx = states.findIndex((s) => s === "active" || s === "stopped");
  if (idx === -1) idx = Math.max(0, states.map((s) => s === "done" || s === "verified").lastIndexOf(true));
  const current = states[idx];
  const label = idx === 4 && summary.status === "REPAIRING" ? "Repair patch" : STEPS[idx].label;

  return (
    <div className="lg:hidden sticky top-0 z-30 flex flex-col gap-3 border-y border-white/5 bg-[#070707]/95 px-5 py-3 backdrop-blur-md">
      <div className="flex flex-col gap-2">
        <div className="flex gap-1">
          {states.map((st, i) => (
            <div key={i} className={cx("h-1 flex-1 rounded-full", barClass(st, tone.dot))} />
          ))}
        </div>
        <div className="flex items-center justify-between font-mono text-[11px]">
          <span className={current === "stopped" ? tone.text : "text-white"}>
            {String(idx + 1).padStart(2, "0")} · {label}
          </span>
          <span className="text-neutral-500">
            {current === "active" ? "in progress" : current === "stopped" ? "stopped here" : "done"}
          </span>
        </div>
      </div>
      <nav className="flex gap-2 overflow-x-auto no-scrollbar">
        {[...RUN_SECTIONS.evidence, ...RUN_SECTIONS.execution].map((item) => (
          <a
            key={item.href}
            href={item.href}
            className="shrink-0 rounded-full px-4 py-1.5 text-xs font-medium transition-colors bg-white/[0.04] text-neutral-400 hover:text-white"
          >
            {item.label}
          </a>
        ))}
      </nav>
    </div>
  );
}
