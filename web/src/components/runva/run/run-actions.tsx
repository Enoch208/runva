"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { HugeiconsIcon } from "@hugeicons/react";
import { Download01Icon, Link01Icon, Loading03Icon, RepeatIcon, StopIcon, Tick02Icon } from "@hugeicons/core-free-icons";
import type { RunSummary } from "@/lib/runva/types";
import { startRun } from "../client-api";
import { isTerminal } from "../run-model";
import { cx, dangerButton, primaryButton, secondaryButton } from "./primitives";

export type CancelState = "idle" | "pending" | "requested" | "error";

export function CancelButton({
  summary,
  onCancel,
  cancelState = "idle",
}: {
  summary: RunSummary;
  onCancel?: () => void;
  cancelState?: CancelState;
}) {
  if (isTerminal(summary.status)) return null;
  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        className={dangerButton}
        onClick={onCancel}
        disabled={!onCancel || cancelState === "pending" || cancelState === "requested"}
      >
        <HugeiconsIcon icon={cancelState === "pending" ? Loading03Icon : StopIcon} size={14} className={cancelState === "pending" ? "animate-spin" : ""} />
        {cancelState === "requested" ? "Cancelling…" : "Cancel run"}
      </button>
      {cancelState === "error" ? (
        <span role="alert" className="text-[11px] text-[#FF5A36]">
          Cancel failed — the run may already have finished.
        </span>
      ) : null}
    </div>
  );
}

export function CopyLinkButton() {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    const text = window.location.href;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
      } finally {
        document.body.removeChild(ta);
      }
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };
  return (
    <button
      type="button"
      onClick={copy}
      aria-label="Copy run link"
      className="relative flex items-center gap-1.5 p-2 text-xs text-neutral-400 hover:text-[#FF5A36] transition-colors"
    >
      <HugeiconsIcon icon={copied ? Tick02Icon : Link01Icon} size={18} className={copied ? "text-green-500" : ""} />
      <span className="hidden sm:inline">{copied ? "Copied" : "Copy link"}</span>
    </button>
  );
}

/** Downloads + run again. Every button performs a real request. */
export function RunActions({ summary, preview = false }: { summary: RunSummary; preview?: boolean }) {
  const router = useRouter();
  const terminal = isTerminal(summary.status);
  const [again, setAgain] = useState<{ pending: boolean; error?: string; activeRunId?: string }>({ pending: false });
  const hasPatch = (summary.attempts?.length ?? 0) > 0;
  const reportHref = summary.links?.report || `/api/runs/${encodeURIComponent(summary.runId)}/report`;
  const patchHref = summary.links?.patch || `/api/runs/${encodeURIComponent(summary.runId)}/patch`;

  const runAgain = async () => {
    if (preview) return;
    setAgain({ pending: true });
    const res = await startRun();
    if (res.ok) {
      router.push(`/runs/${encodeURIComponent(res.runId)}`);
      return;
    }
    if (res.kind === "auth") {
      router.push("/");
      return;
    }
    setAgain({
      pending: false,
      error: res.kind === "cooldown" && res.retryAfterSec ? `${res.message} Try again in about ${res.retryAfterSec}s.` : res.message,
      activeRunId: res.kind === "busy" ? res.activeRunId : undefined,
    });
  };

  return (
    <div className="flex flex-col items-start gap-2 md:items-end">
      <div className="flex flex-wrap items-center gap-2">
        <a
          href={terminal ? reportHref : undefined}
          download={terminal ? `runva-report-${summary.runId}.md` : undefined}
          aria-disabled={!terminal}
          title={terminal ? "Download the Markdown verification receipt" : "Available when the run finishes"}
          className={cx(primaryButton, !terminal && "pointer-events-none bg-white/10 text-neutral-500")}
        >
          <HugeiconsIcon icon={Download01Icon} size={14} />
          Report .md
        </a>
        <a
          href={hasPatch ? patchHref : undefined}
          download={hasPatch ? `runva-patch-${summary.runId}.diff` : undefined}
          aria-disabled={!hasPatch}
          title={hasPatch ? "Download the candidate patch" : "Available once the agent writes a patch"}
          className={cx(secondaryButton, !hasPatch && "pointer-events-none opacity-50")}
        >
          <HugeiconsIcon icon={Download01Icon} size={14} />
          Patch .diff
        </a>
        {terminal ? (
          <button type="button" className={secondaryButton} onClick={runAgain} disabled={again.pending || preview}>
            <HugeiconsIcon icon={again.pending ? Loading03Icon : RepeatIcon} size={14} className={again.pending ? "animate-spin" : ""} />
            Run again
          </button>
        ) : null}
      </div>
      {again.error ? (
        <p role="alert" className="text-[11px] text-amber-300">
          {again.error}{" "}
          {again.activeRunId ? (
            <Link className="text-white underline underline-offset-4" href={`/runs/${encodeURIComponent(again.activeRunId)}`}>
              View active run
            </Link>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}
