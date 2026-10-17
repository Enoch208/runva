"use client";

import { useState } from "react";
import type { CommandEvidence, PatchAttempt, RunSummary } from "@/lib/runva/types";
import { collectCommands, formatMs, shortHash } from "../run-model";
import { DiffView, diffStats } from "./diff-view";
import { CodeBlock, ExitChip, MonoChip, OutputBlock, Panel, PanelTitle, cx } from "./primitives";

type Tab = "tests" | "diff" | "commands";

/** Generated tests, patch diff and raw sandbox commands behind a Morrow segmented pill. */
export function ArtifactsPanel({ summary }: { summary: RunSummary }) {
  const [tab, setTab] = useState<Tab>("diff");
  const commands = collectCommands(summary);
  const attempts = [...(summary.attempts ?? [])].sort((a, b) => a.attempt - b.attempt);
  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: "tests", label: "Generated tests", count: summary.generatedTests ? 1 : 0 },
    { key: "diff", label: "Patch diff", count: attempts.length },
    { key: "commands", label: "Raw commands", count: commands.length },
  ];

  return (
    <Panel id="artifacts" className="min-w-0">
      <PanelTitle title="What the agent wrote and what ran" description="Model output is rendered as plain text. Commands are the exact sandbox executions." />
      <div role="tablist" aria-label="Run artifacts" className="bg-white/[0.04] p-1 rounded-full flex w-fit max-w-full items-center overflow-x-auto no-scrollbar border border-white/5">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={cx(
              "shrink-0 px-4 py-1.5 rounded-full text-xs font-medium transition-colors",
              tab === t.key ? "bg-white/10 text-white" : "text-neutral-500 hover:text-white",
            )}
          >
            {t.label}
            {t.count ? <span className="ml-1.5 font-mono text-[10px] text-neutral-500">{t.count}</span> : null}
          </button>
        ))}
      </div>
      <div role="tabpanel" className="min-w-0">
        {tab === "tests" ? <TestsTab summary={summary} /> : null}
        {tab === "diff" ? <DiffTab attempts={attempts} /> : null}
        {tab === "commands" ? <CommandsTab commands={commands} /> : null}
      </div>
    </Panel>
  );
}

function Empty({ children }: { children: string }) {
  return <p className="rounded-xl border border-dashed border-white/10 px-4 py-8 text-center text-xs text-neutral-500">{children}</p>;
}

function TestsTab({ summary }: { summary: RunSummary }) {
  const t = summary.generatedTests;
  if (!t) return <Empty>The agent writes an adversarial replay module from the contract. It appears here once the model returns valid code.</Empty>;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <MonoChip>{t.testFilename}</MonoChip>
        <MonoChip>sha256 {shortHash(t.sha256)}</MonoChip>
        <MonoChip>{t.model}</MonoChip>
        {summary.baselineAgentTests ? (
          <span className="flex items-center gap-1.5 font-mono text-[11px] text-neutral-500">
            vs baseline <ExitChip code={summary.baselineAgentTests.exitCode} />
          </span>
        ) : null}
      </div>
      {t.summary ? (
        <div className="rounded-lg border border-white/5 bg-white/[0.02] p-3">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-neutral-500">Agent summary</span>
          <p className="mt-1 whitespace-pre-wrap text-xs text-neutral-300">{t.summary}</p>
        </div>
      ) : null}
      <CodeBlock code={t.testCode} />
    </div>
  );
}

function DiffTab({ attempts }: { attempts: PatchAttempt[] }) {
  const [selected, setSelected] = useState<number | null>(null);
  if (attempts.length === 0) {
    return <Empty>After the baseline failure is reproduced, the agent writes a minimal patch to handler.mjs. The real diff appears here.</Empty>;
  }
  const current = attempts.find((a) => a.attempt === selected) ?? attempts[attempts.length - 1];
  const stats = diffStats(current.diff ?? "");
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Patch attempts">
          {attempts.map((a) => {
            const ok = a.verifier ? a.verifier.verdict?.pass === true && a.verifier.exitCode === 0 : null;
            return (
              <button
                key={a.attempt}
                type="button"
                onClick={() => setSelected(a.attempt)}
                className={cx(
                  "flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-medium transition-colors",
                  a.attempt === current.attempt ? "border-white/20 bg-white/10 text-white" : "border-white/10 text-neutral-400 hover:text-white",
                )}
              >
                Attempt {a.attempt}
                <span className={cx("h-1.5 w-1.5 rounded-full", ok === null ? "bg-neutral-600" : ok ? "bg-neutral-200" : "bg-[#FF5A36]")} />
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-2 font-mono text-[11px]">
          <span className="text-green-500">+{stats.added}</span>
          <span className="text-red-500">−{stats.removed}</span>
          <MonoChip>sha256 {shortHash(current.sourceSha256)}</MonoChip>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="rounded-lg border border-white/5 bg-white/[0.02] p-3">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-neutral-500">Diagnosis</span>
          <p className="mt-1 whitespace-pre-wrap text-xs text-neutral-300">{current.diagnosis || "—"}</p>
        </div>
        <div className="rounded-lg border border-white/5 bg-white/[0.02] p-3">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-neutral-500">Change summary</span>
          <p className="mt-1 whitespace-pre-wrap text-xs text-neutral-300">{current.changeSummary || "—"}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 font-mono text-[11px] text-neutral-500">
        <span>{current.model}</span>
        {current.agentTests ? (
          <span className="flex items-center gap-1.5">
            agent tests <ExitChip code={current.agentTests.exitCode} />
          </span>
        ) : null}
        {current.verifier ? (
          <span className="flex items-center gap-1.5">
            frozen verifier <ExitChip code={current.verifier.exitCode} />
          </span>
        ) : (
          <span className="text-neutral-600">verifier not run yet</span>
        )}
      </div>

      {current.diff ? <DiffView diff={current.diff} /> : <Empty>This attempt produced no textual change against the baseline handler.</Empty>}
    </div>
  );
}

function CommandsTab({ commands }: { commands: CommandEvidence[] }) {
  if (commands.length === 0) {
    return <Empty>Every command executed inside the CreateOS sandbox is listed here with its real exit code, timing and output.</Empty>;
  }
  return (
    <ul className="divide-y divide-white/5 rounded-xl border border-white/10">
      {commands.map((c, i) => (
        <CommandRow key={`${c.at}-${i}`} c={c} defaultOpen={i === commands.length - 1} />
      ))}
    </ul>
  );
}

function CommandRow({ c, defaultOpen }: { c: CommandEvidence; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <li className="px-4 py-3">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full flex-col gap-1 text-left">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          <span className={cx("font-mono", c.exitCode === 0 ? "text-neutral-200" : "text-[#FF5A36]")}>exit {c.exitCode}</span>
          <span className="min-w-0 break-all text-neutral-200">{c.label}</span>
          <span className="ml-auto font-mono text-[10px] text-neutral-500">{formatMs(c.execMs)}</span>
        </div>
        <code className="block overflow-x-auto whitespace-pre font-mono text-[11px] text-neutral-400 no-scrollbar">$ {c.cmd}</code>
        <span className="font-mono text-[10px] text-neutral-600">
          sandbox {c.sandboxId} · <time dateTime={c.at}>{c.at}</time> · {open ? "hide output" : "show output"}
        </span>
      </button>
      {open ? (
        <div className="mt-3 flex flex-col gap-2">
          {c.stdout ? <OutputBlock label="stdout" text={c.stdout} /> : <span className="font-mono text-[10px] text-neutral-600">stdout · empty</span>}
          {c.stderr ? <OutputBlock label="stderr" text={c.stderr} error /> : <span className="font-mono text-[10px] text-neutral-600">stderr · empty</span>}
        </div>
      ) : null}
    </li>
  );
}
