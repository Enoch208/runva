import Link from "next/link";
import type { IconSvgElement } from "@hugeicons/react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowLeft01Icon,
  Cancel01Icon,
  CheckmarkBadge01Icon,
  CommandLineIcon,
  DashboardSquare01Icon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import type { RunSummary } from "@/lib/runva/types";
import { SiteLogo } from "../landing/site-logo";
import { STEPS, TONE_STYLES, computeSteps, toneFor, type StepState } from "../run-model";
import { cx } from "./primitives";

export const RUN_SECTIONS = {
  evidence: [
    { label: "Verdict", href: "#verdict" },
    { label: "Before / after", href: "#evidence" },
    { label: "Proof of execution", href: "#execution-proof" },
    { label: "Verifier V1–V6", href: "#verifier" },
    { label: "Fingerprints", href: "#fingerprints" },
  ],
  execution: [
    { label: "Timeline", href: "#timeline" },
    { label: "Tests · diff · commands", href: "#artifacts" },
    { label: "Scope of proof", href: "#scope" },
  ],
} as const;

/** Persistent phase stepper (lg+). Driven only by summary.status and the event log. */
export function RunSidebar({ summary }: { summary: RunSummary }) {
  const states = computeSteps(summary);
  const tone = TONE_STYLES[toneFor(summary.status)];
  const attempts = summary.attemptCount ?? summary.attempts?.length ?? 0;

  return (
    <aside className="hidden lg:flex flex-col w-72 shrink-0 h-full p-8 border-r border-white/5 bg-[#070707] overflow-y-auto no-scrollbar">
      <div className="mb-10 pl-2">
        <SiteLogo />
      </div>

      <nav className="space-y-1 flex-1" aria-label="Run phases and sections">
        <div className="pt-2">
          <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-white/[0.06] text-white">
            <HugeiconsIcon icon={DashboardSquare01Icon} size={16} className="text-[#FF5A36]" />
            <span className="text-sm font-medium">Run phases</span>
          </div>
          <div className="relative ml-5 pl-4 pt-1 space-y-1">
            <div className="absolute left-[3px] top-0 bottom-4 w-px bg-white/10" />
            {STEPS.map((step, index) => {
              const st = states[index];
              const label = index === 4 && summary.status === "REPAIRING" ? "Repair patch" : step.label;
              return (
                <div
                  key={step.key}
                  aria-current={st === "active" ? "step" : undefined}
                  className={cx(
                    "relative flex items-center gap-3 px-3 py-2 rounded-lg",
                    st === "active" || st === "stopped" ? "text-white" : st === "done" || st === "verified" ? "text-neutral-300" : "text-neutral-600",
                  )}
                >
                  <div
                    className={`w-4 border-white/10 rounded-bl-xl border-b border-l absolute left-[-13px] ${
                      index === 0 ? "h-[50%] top-0" : "h-[100%] top-[-50%]"
                    }`}
                  />
                  {st === "active" ? (
                    <span className="absolute left-0 flex h-1 w-1">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#FF5A36] opacity-75" />
                      <span className="relative inline-flex h-1 w-1 rounded-full bg-[#FF5A36]" />
                    </span>
                  ) : null}
                  {st === "stopped" ? <span className={cx("absolute left-0 h-1 w-1 rounded-full", tone.dot)} /> : null}
                  <span className={cx("text-xs font-medium", st === "stopped" && tone.text)}>{label}</span>
                  <span className="ml-auto flex items-center gap-1.5">
                    {(index === 4 || index === 5) && attempts > 0 && st !== "pending" && st !== "skipped" ? (
                      <span className="font-mono text-[10px] text-neutral-600">#{attempts}</span>
                    ) : null}
                    <StepGlyph state={st} stopClass={tone.text} />
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        <SectionLinks label="Evidence" icon={CheckmarkBadge01Icon} items={RUN_SECTIONS.evidence} />
        <SectionLinks label="Execution" icon={CommandLineIcon} items={RUN_SECTIONS.execution} />
      </nav>

      <div className="mt-auto pt-8 border-t border-white/5">
        <Link
          href="/"
          className="flex items-center gap-3 px-3 py-2 text-neutral-500 hover:text-white transition-colors w-full"
        >
          <HugeiconsIcon icon={ArrowLeft01Icon} size={16} />
          <span className="text-sm font-medium">Back to Mission Control</span>
        </Link>
      </div>
    </aside>
  );
}

function StepGlyph({ state, stopClass }: { state: StepState; stopClass: string }) {
  switch (state) {
    case "verified":
      return <HugeiconsIcon icon={Tick02Icon} size={12} className="text-green-500" />;
    case "done":
      return <HugeiconsIcon icon={Tick02Icon} size={12} className="text-neutral-500" />;
    case "active":
      return <span className="font-mono text-[10px] text-[#FF5A36]">live</span>;
    case "stopped":
      return <HugeiconsIcon icon={Cancel01Icon} size={12} className={stopClass} />;
    case "skipped":
      return <span className="font-mono text-[10px] text-neutral-700">—</span>;
    default:
      return null;
  }
}

function SectionLinks({
  label,
  icon,
  items,
}: {
  label: string;
  icon: IconSvgElement;
  items: readonly { label: string; href: string }[];
}) {
  return (
    <div className="pt-2">
      <div className="flex items-center gap-3 px-3 py-2 rounded-lg text-neutral-500">
        <HugeiconsIcon icon={icon} size={16} />
        <span className="text-sm font-medium">{label}</span>
      </div>
      <div className="relative ml-5 pl-4 pt-1 space-y-1">
        <div className="absolute left-[3px] top-0 bottom-4 w-px bg-white/10" />
        {items.map((item, index) => (
          <a
            key={item.href}
            href={item.href}
            className="relative flex items-center gap-3 px-3 py-2 transition-colors rounded-lg text-neutral-500 hover:text-white"
          >
            <div
              className={`w-4 border-white/10 rounded-bl-xl border-b border-l absolute left-[-13px] ${
                index === 0 ? "h-[50%] top-0" : "h-[100%] top-[-50%]"
              }`}
            />
            <span className="text-xs font-medium">{item.label}</span>
          </a>
        ))}
      </div>
    </div>
  );
}
