// Human: Public Pricing page — three plan cards and guarantee banner from Pencil Ownly Public Pricing Page.
// Agent: RENDERED at `/pricing`; static marketing tiers; LINKS CTAs to /register.

import { Check, CreditCard, ShieldAlert } from "lucide-react";
import { Link } from "react-router-dom";
import { MarketingCtaSection } from "@/components/marketing/MarketingCtaSection";
import { MarketingHeroSection } from "@/components/marketing/MarketingHeroSection";
import { MarketingPageShell } from "@/components/marketing/MarketingPageShell";
import { cn } from "@/lib/utils";

type PricingPlan = {
  name: string;
  price: string;
  period: string;
  description: string;
  ctaLabel: string;
  features: string[];
  highlighted?: boolean;
  popular?: boolean;
};

const plans: PricingPlan[] = [
  {
    name: "Personal Free",
    price: "$0",
    period: "/ month",
    description: "Take control of your essential files with local zero-knowledge privacy.",
    ctaLabel: "Get Started Free",
    features: [
      "5 GB Nebular blob storage",
      "Automated blob compression",
      "Secure link sharing",
      "Secure transit encryption",
    ],
  },
  {
    name: "Personal Pro",
    price: "$8",
    period: "/ month",
    description: "Generous high-capacity storage for creative professionals and active power users.",
    ctaLabel: "Upgrade to Pro",
    highlighted: true,
    popular: true,
    features: [
      "500 GB Nebular blob storage",
      "Priority Nebular-OS sync",
      "Blob sharing password control",
      "Automatic offline file sync",
      "Secure file viewer integration",
    ],
  },
  {
    name: "Team Custody",
    price: "$20",
    period: "/ mo (billed per user)",
    description: "Collaborative folders, administrative tools, and compliance-grade privacy engines.",
    ctaLabel: "Try Team for Free",
    features: [
      "2 TB Team Nebular-OS storage",
      "Shared blob storage spaces",
      "Granular blob access logs",
      "Granular access auditor panel",
      "24/7 dedicated support priority",
    ],
  },
];

export default function PricingPage() {
  return (
    <MarketingPageShell>
      <MarketingHeroSection
        badgeIcon={CreditCard}
        badgeLabel="TRANSPARENT PLANS"
        title="Secure storage for every scale"
        subtitle="Start free with robust Nebular-OS blob compression and storage, and upgrade as your space and speed requirements scale."
      />

      {/* Human: Three-tier pricing cards from Pencil Pricing Cards Row */}
      <section className="grid w-full gap-6 lg:grid-cols-3">
        {plans.map((plan) => (
          <article
            key={plan.name}
            className={cn(
              "flex flex-col gap-5 rounded-xl border bg-white p-8",
              plan.highlighted
                ? "border-2 border-[#2563EB] shadow-[0_8px_24px_#0000000D]"
                : "border-[#E5E7EB]",
            )}
          >
            <div className="flex items-center justify-between">
              <span className={cn("text-sm font-bold", plan.highlighted ? "text-[#2563EB]" : "text-[#666666]")}>
                {plan.name}
              </span>
              {plan.popular ? (
                <span className="rounded-full bg-[#EFF6FF] px-2.5 py-1 text-[10px] font-bold text-[#2563EB]">
                  POPULAR
                </span>
              ) : null}
            </div>

            <div className="flex items-end gap-1">
              <span className="text-4xl font-bold text-[#1A1A1A]">{plan.price}</span>
              <span className="pb-1 text-sm text-[#888888]">{plan.period}</span>
            </div>

            <p className="text-[13px] text-[#666666]">{plan.description}</p>

            <Link
              to="/register"
              className={cn(
                "flex items-center justify-center rounded-lg py-3 text-sm font-bold transition-colors",
                plan.highlighted
                  ? "bg-[#2563EB] text-white hover:bg-[#1d4ed8]"
                  : "border border-[#E5E7EB] bg-[#F7F8FA] text-[#1A1A1A] hover:bg-[#EFF6FF]",
              )}
            >
              {plan.ctaLabel}
            </Link>

            <ul className="flex flex-col gap-3">
              {plan.features.map((feature) => (
                <li key={feature} className="flex items-start gap-2.5 text-[13px] text-[#666666]">
                  <Check className="mt-0.5 size-3.5 shrink-0 text-[#2563EB]" aria-hidden />
                  {feature}
                </li>
              ))}
            </ul>
          </article>
        ))}
      </section>

      {/* Human: All-plans guarantee banner from Pencil Included in all plans section */}
      <section className="flex w-full items-start gap-6 rounded-xl bg-[#F7F8FA] p-8">
        <ShieldAlert className="size-8 shrink-0 text-[#2563EB]" aria-hidden />
        <div className="flex flex-col gap-1.5">
          <h2 className="text-base font-bold text-[#1A1A1A]">Our Nebular-OS High Performance Guarantee</h2>
          <p className="text-[13px] leading-relaxed text-[#666666]">
            Drive files are zstd-compressed in Nebular OS; HLS streams use segment encryption with keys wrapped in
            Postgres. Tune compression and ingest via Compose — see docs/storage-disk-tuning.md.
          </p>
        </div>
      </section>

      <MarketingCtaSection
        title="Uncompromising privacy is waiting."
        subtitle="Join thousands of individuals, creators, and secure teams who trust Ownly with their digital lives."
      />
    </MarketingPageShell>
  );
}
