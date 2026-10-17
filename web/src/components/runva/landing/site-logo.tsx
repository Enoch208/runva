import Link from "next/link";

/** RUNVA text wordmark. */
export function SiteLogo({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} aria-label="RUNVA home" className="inline-flex items-center gap-2 h-[36px]">
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full rounded-full bg-[#FF5A36] opacity-30 blur-[3px]" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-[#FF5A36]" />
      </span>
      <span className="font-[family-name:var(--font-manrope)] text-[15px] font-bold tracking-[0.28em] text-white">
        RUNVA
      </span>
    </Link>
  );
}
