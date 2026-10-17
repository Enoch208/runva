import { HugeiconsIcon } from "@hugeicons/react";
import { CloudServerIcon, SecurityCheckIcon, TestTube01Icon } from "@hugeicons/core-free-icons";
import { ShowcaseCard } from "./showcase-card";

const flow = [
  { title: "Agent writes tests", note: "adversarial replay module", actor: "agent" },
  { title: "CreateOS sandbox runs baseline", note: "isolated VM · real exit code", actor: "createos" },
  { title: "Failure reproduced", note: "observed, never assumed", actor: "createos" },
  { title: "Agent patches", note: "handler.mjs only · up to 2 repairs", actor: "agent" },
  { title: "Frozen verifier", note: "V1–V6 · hash-pinned", actor: "host" },
  { title: "Proof receipt", note: "diff · counts · sha256", actor: "host" },
] as const;

const actorDot = {
  agent: "bg-[#FF5A36]",
  createos: "bg-white",
  host: "bg-neutral-500",
} as const;

const SYNTHETIC_EVENT = `{
  "id": "evt_demo_001",
  "type": "payment_intent.succeeded",
  "data": { "object": {
    "id": "pi_demo_001",
    "metadata": {
      "order_id": "order_demo_001"
    }
  } }
}`;

const VERIFIER_CASES = `V1  same event ×20, overlapping
V2  two event ids, one order
V3  unknown event type
V4  two different orders
V5  fail once, then retry
V6  module interface`;

function FlowScreen() {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/70 p-5 shadow-2xl backdrop-blur-md md:p-6">
      <div className="mb-5 flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-neutral-500">Run pipeline</span>
        <span className="font-mono text-[10px] text-neutral-600">every step is a server event</span>
      </div>
      <ol className="relative flex flex-col gap-4 pl-5">
        <div className="absolute left-[3px] top-2 bottom-2 w-px bg-white/10" />
        {flow.map((step, index) => (
          <li key={step.title} className="relative flex flex-col gap-0.5">
            <span
              className={`absolute -left-5 top-1.5 h-[7px] w-[7px] rounded-full ${actorDot[step.actor]} ring-4 ring-black`}
            />
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-sm text-white">
                <span className="mr-2 font-mono text-[10px] text-neutral-600">{String(index + 1).padStart(2, "0")}</span>
                {step.title}
              </span>
              <span className="font-mono text-[10px] uppercase tracking-wider text-neutral-500">{step.actor}</span>
            </div>
            <span className="font-mono text-[11px] text-neutral-500">{step.note}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function HeroShowcase() {
  return (
    <div id="scenario" className="grid grid-cols-1 gap-6 lg:grid-cols-12 lg:gap-8 mb-32 relative gap-x-6 gap-y-6 scroll-mt-32">
      <div className="absolute -left-12 top-0 hidden text-[10px] font-mono text-neutral-800 xl:block">01</div>
      <div className="absolute -right-12 top-0 hidden text-[10px] font-mono text-neutral-800 xl:block">02</div>

      <div
        id="how-it-works"
        className="animate-on-scroll [animation:fadeInUp_0.8s_ease-out_0.5s_both] relative lg:col-span-8 md:h-[540px] group overflow-hidden rounded-3xl border border-white/5 bg-[#080808] animate hover:border-white/10 transition-all scroll-mt-32"
      >
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_70%_60%_at_80%_10%,rgba(204,0,0,0.10),transparent_70%)]" />
        <div className="hidden md:block bg-gradient-to-t from-black via-black/20 to-transparent absolute top-0 right-0 bottom-0 left-0 pointer-events-none" />
        <div className="relative z-10 p-6 md:absolute md:right-8 md:top-8 md:w-[52%] md:p-0 transition-transform duration-700 group-hover:scale-[1.02]">
          <FlowScreen />
        </div>

        <div className="relative p-6 md:absolute md:bottom-0 md:left-0 md:p-8 w-full md:w-[48%]">
          <div className="flex items-center gap-2 text-red-500 mb-2">
            <HugeiconsIcon icon={TestTube01Icon} size={16} />
            <span className="text-xs font-semibold uppercase tracking-widest">Scenario 01 · preset</span>
          </div>
          <h3 className="text-2xl md:text-3xl font-normal tracking-tight text-white mb-3">
            Webhook Reliability — Duplicate Fulfillment
          </h3>
          <p className="text-neutral-400 text-sm max-w-md mb-4">
            One paid order → one fulfillment, even under duplicate or concurrent delivery.
          </p>
          <div className="flex flex-wrap gap-2">
            {["handler.mjs", "Node.js", "synthetic events", "no live Stripe"].map((chip) => (
              <span
                key={chip}
                className="inline-flex rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 font-mono text-[10px] text-neutral-400"
              >
                {chip}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="animate-on-scroll [animation:fadeInUp_0.8s_ease-out_0.6s_both] lg:col-span-4 flex flex-col md:flex-row lg:flex-col z-10 animate gap-x-6 gap-y-6">
        <ShowcaseCard
          backdrop={
            <pre className="pl-20 pt-6 pr-6 font-mono text-[11px] leading-relaxed text-neutral-300 whitespace-pre">{VERIFIER_CASES}</pre>
          }
          icon={SecurityCheckIcon}
          title="Frozen verifier"
          caption="Host-owned · the patching model can't edit it"
          href="#proof"
        />
        <ShowcaseCard
          backdrop={
            <pre className="pl-20 pt-6 pr-6 font-mono text-[11px] leading-relaxed text-neutral-300 whitespace-pre">{SYNTHETIC_EVENT}</pre>
          }
          icon={CloudServerIcon}
          title="Real sandbox"
          caption="Model code runs only inside CreateOS"
          href="#proof"
        />
      </div>
    </div>
  );
}
