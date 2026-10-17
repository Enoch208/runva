"use client";

import { useEffect, useRef, useState } from "react";
import type { EventKind, RunEvent } from "@/lib/runva/types";
import { asRecord, formatOffset, formatUtcClock, formatValue, sortedEvents } from "../run-model";
import { ExitChip, OutputBlock, Panel, PanelTitle, cx } from "./primitives";

const KIND_DOT: Record<EventKind, string> = {
  phase: "bg-neutral-500",
  llm: "bg-[#FF5A36]",
  sandbox: "bg-white",
  command: "bg-neutral-200",
  assertion: "bg-amber-300",
  artifact: "bg-neutral-400",
  error: "bg-red-500",
};
const KIND_LABEL: Record<EventKind, string> = {
  phase: "phase",
  llm: "agent",
  sandbox: "sandbox",
  command: "command",
  assertion: "assertion",
  artifact: "artifact",
  error: "error",
};
const OUTPUT_KEYS = ["stdout", "stderr", "output", "log", "tail"];

/** Execution timeline in Morrow's claim-timeline / activity treatment. Auto-follows while live. */
export function ActivityTimeline({ events, startedAt, live }: { events: RunEvent[]; startedAt: string; live: boolean }) {
  const list = sortedEvents(events);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const prevCount = useRef(0);
  const count = list.length;

  useEffect(() => {
    const el = scroller.current;
    const grew = prevCount.current > 0 && count > prevCount.current;
    prevCount.current = count;
    if (el && stick.current && (live || grew)) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [count, live]);

  return (
    <Panel id="timeline" className="min-w-0">
      <PanelTitle
        title="Execution timeline"
        description="Ordered server events: agent calls, sandbox lifecycle, commands with real exit codes."
        aside={
          <span className="flex items-center gap-2 font-mono text-[11px] text-neutral-500">
            {live ? <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#FF5A36]" /> : null}
            {count} event{count === 1 ? "" : "s"}
          </span>
        }
      />
      <div
        ref={scroller}
        onScroll={() => {
          const el = scroller.current;
          if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        className="max-h-[620px] overflow-y-auto no-scrollbar"
      >
        {count === 0 ? (
          <p className="text-xs text-neutral-400">Waiting for the first server event…</p>
        ) : (
          <ol className="relative flex flex-col gap-4 pl-5">
            <div className="absolute left-[3px] top-2 bottom-2 w-px bg-white/10" />
            {list.map((e, i) => (
              <EventItem key={`${e.seq}-${i}`} event={e} startedAt={startedAt} pulse={live && i === count - 1} />
            ))}
          </ol>
        )}
      </div>
    </Panel>
  );
}

function EventItem({ event, startedAt, pulse }: { event: RunEvent; startedAt: string; pulse: boolean }) {
  const details = asRecord(event.details);
  const entries = details ? Object.entries(details).filter(([, v]) => v !== undefined && v !== null && v !== "") : [];
  const [open, setOpen] = useState(event.kind === "error");
  const exit = details ? [details.exitCode, details.exit_code].find((v) => typeof v === "number") : undefined;

  return (
    <li className="relative flex flex-col gap-0.5">
      <span className={cx("absolute -left-5 top-1.5 flex h-[7px] w-[7px]")}>
        {pulse ? <span className={cx("animate-ping absolute inline-flex h-full w-full rounded-full opacity-75", KIND_DOT[event.kind])} /> : null}
        <span className={cx("relative inline-flex h-[7px] w-[7px] rounded-full ring-4 ring-[#0a0a0a]", KIND_DOT[event.kind] ?? "bg-neutral-500")} />
      </span>
      <div className="flex flex-wrap items-center gap-2">
        <span className={cx("text-sm", event.kind === "error" ? "text-[#FF5A36]" : "text-white")}>{event.title}</span>
        {typeof exit === "number" ? <ExitChip code={exit} /> : null}
      </div>
      <div className="flex flex-wrap items-center gap-x-2 font-mono text-[11px] text-neutral-500">
        <span>#{event.seq}</span>
        <span>{formatOffset(event.at, startedAt)}</span>
        <span className="text-neutral-700">/</span>
        <span title={event.at}>{formatUtcClock(event.at)}</span>
        <span className="text-neutral-700">/</span>
        <span>{KIND_LABEL[event.kind] ?? event.kind}</span>
        <span className="text-neutral-600">{event.status}</span>
        {entries.length > 0 ? (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            className="ml-1 text-neutral-500 transition-colors hover:text-white"
          >
            {open ? "Hide details" : "Details"}
          </button>
        ) : null}
      </div>
      {open && entries.length > 0 ? (
        <div className="mt-2 flex flex-col gap-2">
          <Details entries={entries} />
        </div>
      ) : null}
    </li>
  );
}

function Details({ entries }: { entries: [string, unknown][] }) {
  const scalars: [string, unknown][] = [];
  const outputs: [string, string][] = [];
  const objects: [string, unknown][] = [];
  for (const [key, v] of entries) {
    if (typeof v === "string" && (OUTPUT_KEYS.includes(key) || v.includes("\n") || v.length > 120)) outputs.push([key, v]);
    else if (v !== null && typeof v === "object") objects.push([key, v]);
    else scalars.push([key, v]);
  }
  return (
    <>
      {scalars.length > 0 ? (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-xl border border-white/5 bg-black px-4 py-3 font-mono text-[11px]">
          {scalars.map(([key, v]) => (
            <div key={key} className="contents">
              <dt className="text-neutral-600">{key}</dt>
              <dd className="min-w-0 break-all text-neutral-200">{formatValue(v)}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {outputs.map(([key, v]) => (
        <OutputBlock key={key} label={key} text={v} error={key === "stderr"} />
      ))}
      {objects.map(([key, v]) => (
        <OutputBlock key={key} label={key} text={safeJson(v)} />
      ))}
    </>
  );
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}
