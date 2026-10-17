import { SiteLogo } from "./site-logo";
import { NavStatus } from "./nav-status";

const navLinks = [
  { label: "How it works", href: "#how-it-works" },
  { label: "Scenario", href: "#scenario" },
  { label: "Proof", href: "#proof" },
  { label: "Recent runs", href: "#recent" },
] as const;

export function SiteNav() {
  return (
    <div className="fixed top-6 left-0 right-0 z-50 flex justify-center px-6 animate-on-scroll [animation:fadeInUp_0.8s_ease-out_0s_both] animate">
      <nav className="flex w-full max-w-5xl items-center justify-between rounded-full border border-white/5 bg-[#050505]/80 p-2 pl-6 shadow-2xl backdrop-blur-xl ring-1 ring-white/5">
        <SiteLogo />

        <div className="hidden md:flex items-center gap-6 text-xs font-medium text-neutral-400">
          {navLinks.map(({ label, href }) => (
            <a key={label} href={href} className="hover:text-white transition-colors">
              {label}
            </a>
          ))}
        </div>

        <NavStatus />
      </nav>
    </div>
  );
}
