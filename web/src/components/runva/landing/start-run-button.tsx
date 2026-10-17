"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowRight02Icon, Loading03Icon } from "@hugeicons/core-free-icons";
import { startRun, type StartResult } from "../client-api";

type Failure = Exclude<StartResult, { ok: true }>;

/** Primary CTA: POST /api/runs then navigate to the live run page. */
export function StartRunButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [needsCode, setNeedsCode] = useState(false);
  const [code, setCode] = useState("");

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (pending) return;
    setPending(true);
    setFailure(null);
    const res = await startRun(needsCode ? code : undefined);
    if (res.ok) {
      router.push(`/runs/${encodeURIComponent(res.runId)}`);
      return;
    }
    if (res.kind === "auth") setNeedsCode(true);
    setFailure(res);
    setPending(false);
  };

  return (
    <form onSubmit={submit} className="flex w-full flex-col items-center gap-4">
      {needsCode ? (
        <input
          type="password"
          autoComplete="off"
          autoFocus
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="Demo access code"
          aria-label="Demo access code"
          className="w-full max-w-xs rounded-full border border-white/10 bg-white/[0.03] px-5 py-2.5 text-center text-sm text-white placeholder:text-neutral-600 focus:border-white/20 focus:outline-none"
        />
      ) : null}

      <button
        type="submit"
        disabled={pending || (needsCode && !code.trim())}
        className="group relative flex items-center gap-2 rounded-full bg-white text-black px-8 py-3 text-sm font-medium transition-all hover:bg-gray-200 disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-neutral-500"
      >
        {pending ? <HugeiconsIcon icon={Loading03Icon} size={16} className="animate-spin" /> : null}
        <span>{pending ? "Starting run…" : "Run Autonomous Verification"}</span>
        {!pending ? (
          <HugeiconsIcon icon={ArrowRight02Icon} size={16} className="transition-transform group-hover:translate-x-0.5" />
        ) : null}
      </button>

      {failure ? <FailureNotice failure={failure} /> : null}
    </form>
  );
}

function FailureNotice({ failure }: { failure: Failure }) {
  const amber = failure.kind === "cooldown" || failure.kind === "busy";
  return (
    <div
      role="alert"
      className={`flex max-w-md flex-col gap-1 rounded-lg border px-3 py-2 font-mono text-xs ${
        amber ? "border-amber-300/20 bg-amber-300/5 text-amber-300" : "border-[#FF5A36]/20 bg-[#FF5A36]/5 text-[#FF5A36]"
      }`}
    >
      <span>{failure.message}</span>
      {failure.kind === "cooldown" ? (
        <span className="text-neutral-400">
          {failure.retryAfterSec ? `Try again in about ${failure.retryAfterSec}s.` : "Wait a few seconds, then try again."}
        </span>
      ) : null}
      {failure.kind === "busy" ? (
        failure.activeRunId ? (
          <Link href={`/runs/${encodeURIComponent(failure.activeRunId)}`} className="text-white underline-offset-4 hover:underline">
            Watch the active run →
          </Link>
        ) : (
          <span className="text-neutral-400">Wait for it to finish, then start a new verification.</span>
        )
      ) : null}
      {failure.kind === "auth" ? <span className="text-neutral-400">Enter the demo access code above and try again.</span> : null}
    </div>
  );
}
