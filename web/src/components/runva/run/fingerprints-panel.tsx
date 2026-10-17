import type { RunSummary } from "@/lib/runva/types";
import { shortHash } from "../run-model";
import { Panel, PanelTitle, cx } from "./primitives";

function CheckLine({ passed, children }: { passed: boolean; children: string }) {
  return (
    <li className={cx("font-mono text-[11px]", passed ? "text-neutral-200" : "text-[#FF5A36]")}>
      {passed ? "Match" : "Mismatch"} · {children}
    </li>
  );
}

function FingerprintCard({
  name,
  meta,
  hash,
  checks,
}: {
  name: string;
  meta: string;
  hash: string | undefined;
  checks?: { passed: boolean; text: string }[];
}) {
  return (
    <article className="flex flex-col gap-3 rounded-xl border border-white/5 bg-white/[0.02] p-4">
      <div className="flex flex-col gap-0.5">
        <span className="text-sm text-white">{name}</span>
        <span className="font-mono text-[10px] text-neutral-500">{meta}</span>
      </div>
      <span className="break-all font-mono text-[11px] text-neutral-300" title={hash}>
        {hash ? hash : <span className="text-neutral-600">not produced yet</span>}
      </span>
      {checks?.length ? (
        <ul className="flex flex-col gap-1">
          {checks.map((c) => (
            <CheckLine key={c.text} passed={c.passed}>
              {c.text}
            </CheckLine>
          ))}
        </ul>
      ) : null}
    </article>
  );
}

/** Fingerprints: every artifact's sha256 with real consistency checks. */
export function FingerprintsPanel({ summary }: { summary: RunSummary }) {
  const base = summary.baselineResult;
  const final = summary.finalResult;
  const verifierChecks: { passed: boolean; text: string }[] = [];
  if (base) verifierChecks.push({ passed: base.verifierSha256 === summary.verifierSha256, text: "baseline run used the pinned verifier" });
  if (final) verifierChecks.push({ passed: final.verifierSha256 === summary.verifierSha256, text: "final run used the pinned verifier" });
  const baselineChecks: { passed: boolean; text: string }[] = [];
  if (base) baselineChecks.push({ passed: base.handlerSha256 === summary.baselineSha256, text: "baseline run executed the original handler" });
  const patchedChecks: { passed: boolean; text: string }[] = [];
  if (final) patchedChecks.push({ passed: final.handlerSha256 !== summary.baselineSha256, text: "candidate differs from the original handler" });

  return (
    <Panel id="fingerprints">
      <PanelTitle
        title="Artifact fingerprints"
        description="sha256 of every artifact this run produced or executed. Hashes identify artifacts; they are not proof of correctness."
      />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <FingerprintCard name="Frozen verifier" meta="verifier.mjs · pinned before any model call" hash={summary.verifierSha256} checks={verifierChecks} />
        <FingerprintCard name="Original handler" meta="handler.mjs · seeded baseline" hash={summary.baselineSha256} checks={baselineChecks} />
        <FingerprintCard
          name="Patched handler"
          meta={final ? "handler.mjs · final candidate" : "handler.mjs · final candidate (pending)"}
          hash={final?.handlerSha256}
          checks={patchedChecks}
        />
        <FingerprintCard
          name="Agent tests"
          meta={summary.generatedTests ? `${summary.generatedTests.testFilename} · model-written` : "agent-tests.mjs · model-written"}
          hash={summary.generatedTests?.sha256}
        />
      </div>
      <span className="font-mono text-[10px] text-neutral-600">
        short form shown elsewhere: verifier {shortHash(summary.verifierSha256)} · baseline {shortHash(summary.baselineSha256)}
      </span>
    </Panel>
  );
}
