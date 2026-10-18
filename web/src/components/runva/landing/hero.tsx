import { PulseDot } from "./pulse-dot";
import { StartRunButton } from "./start-run-button";

const figures = [
  { label: "Scenario", value: "Duplicate fulfillment", note: "webhook-idempotency preset" },
  { label: "Frozen replay cases", value: "V1–V6", note: "hash-pinned, not model-editable" },
  { label: "Patch budget", value: "1 + 2", note: "initial candidate + repairs" },
  { label: "Execution", value: "CreateOS", note: "isolated sandbox VM" },
] as const;

export function Hero() {
  return (
    <div className="mx-auto mb-24 max-w-4xl text-center">
      <div className="animate-on-scroll [animation:fadeInUp_0.8s_ease-out_0.1s_both] mb-8 inline-flex items-center gap-2 rounded-full border border-red-500/20 bg-red-950/10 px-3 py-1 text-[10px] font-medium uppercase tracking-wider text-red-200 shadow-[0_0_15px_rgba(204,0,0,0.15)] animate">
        <PulseDot />
        Autonomous reliability verification
      </div>

      <h1 className="animate-on-scroll [animation:fadeInUp_0.8s_ease-out_0.2s_both] mb-6 text-5xl font-medium leading-[0.95] tracking-tight text-white md:text-7xl md:leading-none animate">
        Prove it
        <br />
        <span className="text-neutral-500">before you ship.</span>
      </h1>

      <p className="animate-on-scroll [animation:fadeInUp_0.8s_ease-out_0.3s_both] mx-auto mb-10 max-w-xl text-lg font-light leading-relaxed text-neutral-400 tracking-tight animate">
        The AI reliability engineer that breaks your integration, repairs it, and proves the repair in a real
        sandbox.
      </p>

      <div className="animate-on-scroll [animation:fadeInUp_0.8s_ease-out_0.4s_both] flex flex-col items-center justify-center gap-4 animate">
        <StartRunButton />
        <span className="text-[11px] text-neutral-500">
          Preset: Webhook Reliability — Duplicate Fulfillment · synthetic events only
        </span>
        <StartRunButton
          scenarioId="durable-idempotency"
          variant="secondary"
          label="Harder: durable idempotency across processes + restarts (SQLite)"
        />
      </div>

      <div className="animate-on-scroll [animation:fadeInUp_0.8s_ease-out_0.5s_both] animate mx-auto mt-16 max-w-4xl">
        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-white/5 bg-white/5 md:grid-cols-4">
          {figures.map((figure) => (
            <div key={figure.label} className="flex flex-col items-center gap-2 bg-[#050505] px-4 py-6">
              <dt className="text-[10px] font-medium uppercase tracking-widest text-neutral-500">{figure.label}</dt>
              <dd className="font-mono text-xl text-white tabular-nums md:text-2xl">{figure.value}</dd>
              <dd className="text-[11px] text-neutral-500">{figure.note}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 text-[11px] text-neutral-500">
          Run configuration. Every count, exit code and hash on a run page comes from a real sandbox execution.
        </p>
      </div>
    </div>
  );
}
