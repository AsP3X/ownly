// Human: Full-page marketing layout — header, main content slot, and footer from login-signup.pencil public pages.
// Agent: RENDERS children between LandingHeader and LandingFooter; no API calls; white canvas background.

import { LandingFooter } from "@/components/landing/LandingFooter";
import { LandingHeader } from "@/components/landing/LandingHeader";

type MarketingPageShellProps = {
  children: React.ReactNode;
};

export function MarketingPageShell({ children }: MarketingPageShellProps) {
  return (
    <div className="min-h-screen bg-white">
      <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-20 px-6 py-10 sm:px-12 lg:px-20 lg:pb-20">
        <LandingHeader />
        <main className="flex w-full flex-col gap-20">{children}</main>
        <LandingFooter />
      </div>
    </div>
  );
}
