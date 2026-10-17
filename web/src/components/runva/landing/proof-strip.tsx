const coverage = [
  "Baseline failure must be reproduced by a real sandbox exit code",
  "The patch is written by the agent from real stdout, stderr and failing assertions",
  "The frozen verifier's sha256 is pinned before any model call",
  "Pass/fail is parsed on the host from structured verifier output, never from the model",
] as const;

const verdicts = [
  { code: "VERIFIED", meaning: "frozen verifier passed V1–V6 on the patched handler", tone: "text-green-500" },
  { code: "FAILED", meaning: "no candidate passed within the attempt budget", tone: "text-red-500" },
  { code: "INCONCLUSIVE", meaning: "failure not reproduced, so no repair can be proven", tone: "text-amber-300" },
  { code: "INFRA_ERROR", meaning: "the environment failed; no verdict is shown", tone: "text-orange-400" },
] as const;

export function ProofStrip() {
  return (
    <div
      id="proof"
      className="animate-on-scroll [animation:fadeInUp_0.8s_ease-out_0.7s_both] mb-24 scroll-mt-32 flex flex-col gap-5 rounded-2xl border border-[#FF5A36]/20 bg-[#0a0a0a] p-5 lg:p-6"
    >
      <div className="flex max-w-2xl flex-col gap-1">
        <h3 className="text-base font-medium text-white">Evidence, not confidence</h3>
        <p className="text-xs text-neutral-500">
          RUNVA never asks the model whether it fixed the code. A run is verified only when the unmodified, hash-pinned
          verifier passes in a real CreateOS execution.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <ul className="flex flex-col gap-1.5">
          {coverage.map((line) => (
            <li key={line} className="text-xs text-neutral-400">
              {line}
            </li>
          ))}
        </ul>
        <dl className="flex flex-col gap-1.5">
          {verdicts.map(({ code, meaning, tone }) => (
            <div key={code} className="flex gap-3 font-mono text-xs">
              <dt className={`w-28 shrink-0 ${tone}`}>{code}</dt>
              <dd className="text-neutral-300">{meaning}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
