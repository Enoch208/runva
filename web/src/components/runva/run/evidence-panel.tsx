import type { RunSummary } from "@/lib/runva/types";
import {
  formatObservation,
  isTerminal,
  latestVerifiedAttempt,
  shortHash,
  sideEvidence,
  type SideEvidence,
} from "../run-model";
import { Panel, PanelTitle, cx } from "./primitives";

type SideTone = "fail" | "pass" | "warn" | "neutral" | "pending";

const HEAD: Record<SideTone, string> = {
  fail: "text-red-500",
  pass: "text-green-500",
  warn: "text-amber-300",
  neutral: "text-neutral-200",
  pending: "text-neutral-500",
};
const FRAME: Record<SideTone, string> = {
  fail: "border-red-500/20",
  pass: "border-green-500/25",
  warn: "border-amber-300/20",
  neutral: "border-white/10",
  pending: "border-white/5 border-dashed",
};

/** Signature BEFORE / AFTER panel, Morrow "same bytes, two verdicts" treatment. */
export function EvidencePanel({ summary }: { summary: RunSummary }) {
  const before = sideEvidence(summary.baselineResult);
  const latest = latestVerifiedAttempt(summary);
  const final = sideEvidence(summary.finalResult);
  const after = final ?? sideEvidence(latest?.verifier);
  const afterIsFinal = Boolean(final);
  const terminal = isTerminal(summary.status);
  const verified = summary.status === "VERIFIED";

  let beforeTone: SideTone = "pending";
  let beforeTitle = "Before — baseline";
  if (before) {
    const reproduced = before.allPass === false || before.result.exitCode !== 0;
    beforeTone = reproduced ? "fail" : "warn";
    beforeTitle = reproduced ? "Before — failure reproduced" : "Before — no failure reproduced";
  }

  const attemptTag = latest ? ` ${latest.attempt}` : "";
  let afterTone: SideTone = "pending";
  let afterTitle = "After — repair";
  if (after) {
    const passed = after.allPass === true && after.result.exitCode === 0;
    if (afterIsFinal && verified) {
      afterTone = "pass";
      afterTitle = "After — repair verified";
    } else if (!passed) {
      afterTone = "fail";
      afterTitle = afterIsFinal ? "After — repair not verified" : `After — candidate${attemptTag} failed`;
    } else {
      afterTone = "neutral";
      afterTitle = afterIsFinal ? "After — candidate result" : `After — candidate${attemptTag}`;
    }
  }

  const bothVerifier = before && after ? before.result.verifierSha256 === after.result.verifierSha256 : null;

  return (
    <Panel id="evidence">
      <PanelTitle
        title="Same verifier, two handlers"
        description="The frozen verifier replays identical synthetic deliveries against the original handler and the agent's patch. Every value below is parsed from a real sandbox execution."
      />

      <div className="flex flex-col gap-1 rounded-xl border border-white/5 px-4 py-3 font-mono text-[11px] text-neutral-500">
        {bothVerifier === null ? (
          <span className="text-neutral-500">Verifier fingerprint comparison appears once both runs exist.</span>
        ) : (
          <span className={bothVerifier ? "text-neutral-200" : "text-[#FF5A36]"}>
            {bothVerifier
              ? "Verifier bytes are identical in both executions"
              : "Verifier hash differs between executions — treat this comparison as unverified"}
          </span>
        )}
        <span>
          sha256(verifier) · pinned {shortHash(summary.verifierSha256, 16)}
          {before ? ` · baseline ${shortHash(before.result.verifierSha256, 10)}` : ""}
          {after ? ` · ${afterIsFinal ? "final" : "latest"} ${shortHash(after.result.verifierSha256, 10)}` : ""}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Side
          tone={beforeTone}
          title={beforeTitle}
          target={`original handler.mjs · ${shortHash(summary.baselineSha256, 10)}`}
          ev={before}
          verified={false}
          empty={terminal ? "No baseline verifier result was recorded for this run." : "Waiting for the baseline to execute in the sandbox…"}
        />
        <Side
          tone={afterTone}
          title={afterTitle}
          target={
            after
              ? `patched handler.mjs · ${shortHash(after.result.handlerSha256, 10)}${!afterIsFinal ? " · not final" : ""}`
              : "patched handler.mjs"
          }
          ev={after}
          verified={verified && afterIsFinal}
          empty={
            terminal
              ? "No candidate patch reached independent verification in this run."
              : "Waiting for a candidate patch to run against the frozen verifier…"
          }
        />
      </div>

      <span className="font-mono text-[10px] text-neutral-600">
        sandbox-execution · counts read from verifier stdout (runva.verdict.v1) on the host, never from the model
      </span>
    </Panel>
  );
}

function Side({
  tone,
  title,
  target,
  ev,
  verified,
  empty,
}: {
  tone: SideTone;
  title: string;
  target: string;
  ev: SideEvidence | null;
  verified: boolean;
  empty: string;
}) {
  const firstFailing = ev?.cases.find((c) => !c.pass);
  const matches =
    ev?.fulfillments !== undefined && ev?.expectedFulfillments !== undefined ? ev.fulfillments === ev.expectedFulfillments : undefined;
  const fulfilTone = matches === undefined ? "text-white" : matches ? (verified ? "text-green-500" : "text-white") : "text-red-500";

  return (
    <div className={cx("flex flex-col gap-4 rounded-xl border bg-white/[0.02] p-4 lg:p-5", FRAME[tone])}>
      <div className="flex flex-col gap-1">
        <span className={cx("text-[10px] font-semibold uppercase tracking-widest", HEAD[tone])}>{title}</span>
        <span className="font-mono text-[11px] text-neutral-500">{target}</span>
      </div>

      {!ev ? (
        <p className="flex min-h-[140px] items-center justify-center rounded-lg border border-white/5 px-4 text-center font-mono text-xs text-neutral-600">
          {empty}
        </p>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-white/5 bg-white/5">
            <div className="flex flex-col gap-1 bg-[#050505] px-4 py-4">
              <dt className="text-[10px] font-medium uppercase tracking-widest text-neutral-500">V1 deliveries</dt>
              <dd className="font-mono text-4xl text-white tabular-nums md:text-5xl">{ev.deliveries ?? "—"}</dd>
              <dd className="text-[11px] text-neutral-600">{ev.v1 ? "duplicate deliveries replayed" : "V1 not in verdict"}</dd>
            </div>
            <div className="flex flex-col gap-1 bg-[#050505] px-4 py-4">
              <dt className="text-[10px] font-medium uppercase tracking-widest text-neutral-500">Fulfillments observed</dt>
              <dd className={cx("font-mono text-4xl tabular-nums md:text-5xl", ev.fulfillments === undefined ? "text-neutral-600" : fulfilTone)}>
                {ev.fulfillments ?? "—"}
              </dd>
              <dd className="text-[11px] text-neutral-600">
                {ev.expectedFulfillments !== undefined ? `expected ${ev.expectedFulfillments}` : "expected —"}
              </dd>
            </div>
          </dl>

          <dl className="grid grid-cols-2 gap-3 font-mono text-[11px]">
            <div>
              <dt className="text-neutral-600">Verifier cases</dt>
              <dd className={ev.cases.length === 0 ? "text-amber-300" : ev.failing > 0 ? "text-red-500" : verified ? "text-green-500" : "text-white"}>
                {ev.cases.length === 0 ? "verdict unparsed" : ev.failing > 0 ? `${ev.failing} of ${ev.cases.length} failing` : `${ev.passing} of ${ev.cases.length} passing`}
              </dd>
            </div>
            <div>
              <dt className="text-neutral-600">Real exit code</dt>
              <dd className={ev.result.exitCode === 0 ? "text-white" : "text-[#FF5A36]"}>{ev.result.exitCode}</dd>
            </div>
            <div>
              <dt className="text-neutral-600">Handler sha256</dt>
              <dd className="text-white" title={ev.result.handlerSha256}>
                {shortHash(ev.result.handlerSha256, 14)}
              </dd>
            </div>
            <div>
              <dt className="text-neutral-600">Verifier sha256</dt>
              <dd className="text-white" title={ev.result.verifierSha256}>
                {shortHash(ev.result.verifierSha256, 14)}
              </dd>
            </div>
          </dl>

          {ev.cases.length > 0 ? (
            <ul className="flex flex-wrap gap-1.5">
              {ev.cases.map((c) => (
                <li
                  key={c.id}
                  title={`${c.id} · ${c.title}`}
                  className={cx(
                    "rounded-md border px-2 py-0.5 font-mono text-[11px]",
                    !c.pass
                      ? "border-red-500/25 bg-red-500/5 text-red-500"
                      : verified
                        ? "border-green-500/25 text-green-500"
                        : "border-white/10 text-neutral-200",
                  )}
                >
                  {c.id} {c.pass ? "pass" : "fail"}
                </li>
              ))}
            </ul>
          ) : null}

          {firstFailing ? (
            <div className="rounded-lg border border-[#FF5A36]/20 bg-[#FF5A36]/5 px-3 py-2 font-mono text-xs text-[#FF5A36]">
              <div>
                {firstFailing.id} failed · {firstFailing.title}
              </div>
              <div className="mt-1 text-[11px] text-neutral-400">
                expected {formatObservation(firstFailing.expected)} · observed{" "}
                <span className="text-[#FF5A36]">{formatObservation(firstFailing.observed)}</span>
              </div>
              {firstFailing.details ? <div className="mt-1 text-[11px] text-neutral-500">{firstFailing.details}</div> : null}
            </div>
          ) : ev.v1 ? (
            <div
              className={cx(
                "rounded-lg border px-3 py-2 font-mono text-xs",
                verified ? "border-green-500/20 bg-green-500/5 text-green-500" : "border-white/10 text-neutral-200",
              )}
            >
              <div>
                {ev.v1.id} {ev.v1.pass ? "passed" : "failed"} · {ev.v1.title}
              </div>
              <div className="mt-1 text-[11px] text-neutral-400">observed {formatObservation(ev.v1.observed)}</div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
