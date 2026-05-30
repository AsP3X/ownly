// Human: Public marketing landing page — default home for all guests after setup is complete.
// Agent: RENDERED at `/` by HomeRoute when no JWT; uses MarketingPageShell for shared header/footer.

import { LandingCtaSection } from "@/components/landing/LandingCtaSection";
import { LandingFeaturesSection } from "@/components/landing/LandingFeaturesSection";
import { LandingHero } from "@/components/landing/LandingHero";
import { MarketingPageShell } from "@/components/marketing/MarketingPageShell";

export default function LandingPage() {
  return (
    <MarketingPageShell>
      <LandingHero />
      <LandingFeaturesSection />
      <LandingCtaSection />
    </MarketingPageShell>
  );
}
