import { SiteLogo } from "./site-logo";

const footerColumns: readonly { heading: string; links: readonly { label: string; href: string }[] }[] = [
  {
    heading: "Product",
    links: [
      { label: "How it works", href: "/#how-it-works" },
      { label: "Scenario", href: "/#scenario" },
      { label: "Recent runs", href: "/#recent" },
    ],
  },
  {
    heading: "Proof",
    links: [
      { label: "Frozen verifier V1–V6", href: "/#proof" },
      { label: "Verdict meanings", href: "/#proof" },
    ],
  },
  {
    heading: "Built with",
    links: [
      { label: "CreateOS Sandbox", href: "/#how-it-works" },
      { label: "Stripe Projects", href: "/#how-it-works" },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="relative border-t border-white/5 bg-[#020202] pb-12 pt-24">
      <div className="mx-auto max-w-7xl px-6">
        <div className="mb-16 flex flex-col justify-between gap-12 md:flex-row">
          <div className="max-w-xs">
            <div className="flex items-center gap-2 mb-4">
              <SiteLogo />
            </div>
            <p className="text-xs leading-relaxed text-neutral-500">
              RUNVA writes adversarial tests for your integration, reproduces the failure in a real sandbox, repairs the
              code, and proves the repair with a verifier the model cannot touch.
            </p>
          </div>

          <div className="flex flex-wrap gap-x-16 gap-y-10 text-xs text-neutral-500">
            {footerColumns.map(({ heading, links }) => (
              <div key={heading} className="flex flex-col gap-4">
                <span className="font-semibold text-white">{heading}</span>
                {links.map(({ label, href }) => (
                  <a key={label} href={href} className="hover:text-white">
                    {label}
                  </a>
                ))}
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between border-t border-white/5 pt-8">
          <p className="text-[10px] text-neutral-600">© 2026 RUNVA</p>
          <div className="flex gap-4 items-center">
            <div className="h-1.5 w-1.5 rounded-full bg-green-500" />
            <span className="text-[10px] text-neutral-500">
              Sandboxed by CreateOS · Provisioned with Stripe Projects · Synthetic events only
            </span>
          </div>
        </div>
      </div>
    </footer>
  );
}
