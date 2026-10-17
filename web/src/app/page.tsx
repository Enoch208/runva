import { BackgroundEffects } from "@/components/runva/landing/background-effects";
import { EvidenceRow } from "@/components/runva/landing/evidence-row";
import { Hero } from "@/components/runva/landing/hero";
import { HeroShowcase } from "@/components/runva/landing/hero-showcase";
import { ProofStrip } from "@/components/runva/landing/proof-strip";
import { RecentRuns } from "@/components/runva/landing/recent-runs";
import { ScrollReveal } from "@/components/runva/landing/scroll-reveal";
import { SiteFooter } from "@/components/runva/landing/site-footer";
import { SiteNav } from "@/components/runva/landing/site-nav";

export default function MissionControl() {
  return (
    <div className="relative min-h-screen overflow-x-hidden pt-32">
      <BackgroundEffects />
      <SiteNav />
      <main id="top" className="max-w-7xl mr-auto ml-auto pt-12 pr-6 pb-32 pl-6 relative">
        <Hero />
        <HeroShowcase />
        <EvidenceRow />
        <ProofStrip />
        <RecentRuns />
      </main>
      <SiteFooter />
      <ScrollReveal />
    </div>
  );
}
