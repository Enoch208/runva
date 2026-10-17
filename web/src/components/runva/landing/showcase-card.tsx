import type { ReactNode } from "react";
import type { IconSvgElement } from "@hugeicons/react";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowUpRight01Icon } from "@hugeicons/core-free-icons";

interface ShowcaseCardProps {
  /** Decorative backdrop rendered where Morrow places its cover photo. */
  backdrop: ReactNode;
  icon: IconSvgElement;
  title: string;
  caption: string;
  href: string;
}

export function ShowcaseCard({ backdrop, icon, title, caption, href }: ShowcaseCardProps) {
  return (
    <a
      href={href}
      className="flex-1 min-h-[220px] overflow-hidden hover:border-white/10 transition-all group bg-[#080808] border-white/5 border rounded-3xl pt-6 pr-6 pb-6 pl-6 relative"
    >
      <div className="absolute inset-0 z-0 overflow-hidden transition-transform duration-700 group-hover:scale-105">
        <div className="absolute inset-0 group-hover:opacity-80 transition-opacity duration-700 opacity-40">{backdrop}</div>
        <div className="absolute inset-0 bg-gradient-to-t from-[#080808] via-[#080808]/60 to-transparent" />
      </div>
      <div className="z-10 flex flex-col h-full relative justify-end">
        <div className="mb-auto p-2 bg-white/5 w-fit rounded-lg border border-white/10 backdrop-blur-md">
          <HugeiconsIcon icon={icon} size={20} className="text-white" />
        </div>
        <h3 className="text-xl font-normal text-white mt-4">{title}</h3>
        <div className="h-px w-full bg-white/10 my-3" />
        <div className="flex justify-between items-center">
          <span className="text-xs text-neutral-500">{caption}</span>
          <HugeiconsIcon
            icon={ArrowUpRight01Icon}
            size={16}
            className="text-neutral-500 group-hover:text-white transition-colors"
          />
        </div>
      </div>
    </a>
  );
}
