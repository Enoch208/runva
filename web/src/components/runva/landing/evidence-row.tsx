import type { IconSvgElement } from "@hugeicons/react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  CloudServerIcon,
  CommandLineIcon,
  FingerPrintIcon,
  Invoice01Icon,
  LockIcon,
} from "@hugeicons/core-free-icons";

// What each run is designed to prove. Claims about the method only — no numbers, no results.
const items: readonly { title: string; caption: string; icon: IconSvgElement }[] = [
  { title: "Real VM exit codes", caption: "Every pass or fail is a CreateOS process exit code", icon: CommandLineIcon },
  { title: "Frozen verifier hash", caption: "sha256 pinned on the host, re-measured inside the VM", icon: FingerPrintIcon },
  { title: "Fresh-VM verdict", caption: "Final check runs in a new VM: patched handler + verifier only", icon: CloudServerIcon },
  { title: "Egress blocked", caption: "A request to a non-allowlisted host must fail from inside", icon: LockIcon },
  { title: "Downloadable receipt", caption: "Report .md, patch .diff and receipt.json per run", icon: Invoice01Icon },
];

export function EvidenceRow() {
  return (
    <div className="animate-on-scroll [animation:fadeInUp_0.8s_ease-out_0.2s_both] animate mb-24 flex flex-col gap-6">
      <div className="flex flex-col items-center gap-2 text-center">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-neutral-500">Evidence, not vibes</span>
        <h2 className="text-2xl font-medium tracking-tight text-white">What every run proves</h2>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {items.map(({ title, caption, icon }) => (
          <div
            key={title}
            className="group flex flex-col gap-3 rounded-2xl border border-white/5 bg-white/[0.02] p-5 transition-colors hover:bg-white/[0.04]"
          >
            <div className="p-2 bg-white/5 w-fit rounded-lg border border-white/10">
              <HugeiconsIcon icon={icon} size={18} className="text-neutral-300 transition-colors group-hover:text-[#FF5A36]" />
            </div>
            <div className="flex flex-col gap-1">
              <h3 className="text-sm font-medium text-white">{title}</h3>
              <p className="text-[11px] leading-relaxed text-neutral-500">{caption}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
