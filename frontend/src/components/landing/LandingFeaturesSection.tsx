// Human: Features grid and testimonial card from Pencil Features and Trust Section.
// Agent: RENDERS static marketing copy; id=features for header anchor navigation.

import { Check, Cloud, Database, Share2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";

const features: { title: string; description: string; icon: LucideIcon }[] = [
  {
    title: "Nebular-OS Object Storage",
    description:
      "Files are converted into binary blobs, heavily compressed, and encrypted using Nebular-OS standards for blazing-fast, secure access.",
    icon: Database,
  },
  {
    title: "Instant Smart Sync",
    description:
      "Instant automatic syncing across your phone, tablet, and desktop. Access your latest secure files anywhere, anytime.",
    icon: Cloud,
  },
  {
    title: "Advanced Sharing",
    description:
      "Share securely with password-protected, trackable, and self-destructing links. Full control over who accesses your data.",
    icon: Share2,
  },
];

export function LandingFeaturesSection() {
  return (
    <section
      id="features"
      className="flex w-full flex-col items-center gap-10 rounded-2xl bg-[#F7F8FA] px-6 py-16 sm:px-12 lg:px-16"
    >
      <div className="flex max-w-3xl flex-col items-center gap-2 text-center">
        <h2 className="text-3xl font-bold text-[#1A1A1A]">Built for ultimate file security and ease</h2>
        <p className="text-base text-[#666666]">
          Everything you need to store, share, and protect your digital life.
        </p>
      </div>

      <div className="grid w-full gap-6 lg:grid-cols-3">
        {features.map((feature) => {
          const Icon = feature.icon;
          return (
            <article
              key={feature.title}
              className="flex min-h-[280px] flex-col gap-4 rounded-xl border border-[#E5E7EB] bg-white p-8 shadow-[0_4px_12px_#00000008]"
            >
              <div className="flex size-11 items-center justify-center rounded-lg bg-[#EFF6FF]">
                <Icon className="size-[22px] text-[#2563EB]" aria-hidden />
              </div>
              <h3 className="text-lg font-bold text-[#1A1A1A]">{feature.title}</h3>
              <p className="text-sm leading-relaxed text-[#666666]">{feature.description}</p>
            </article>
          );
        })}
      </div>

      {/* Human: Testimonial card — verified badge, quote, and author row from Pencil Testimonial Card */}
      <figure className="flex w-full max-w-[680px] flex-col items-center gap-4 rounded-xl border border-[#E5E7EB] bg-white p-6 shadow-[0_4px_12px_#00000008]">
        <figcaption className="flex items-center gap-1.5 rounded-full bg-[#ECFDF5] px-2.5 py-1">
          <Check className="size-3.5 text-[#10B981]" aria-hidden />
          <span className="text-[11px] font-bold text-[#047857]">VERIFIED SECURE REVIEW</span>
        </figcaption>
        <blockquote className="text-center text-base italic leading-relaxed text-[#1A1A1A]">
          “Ownly&apos;s transition to Nebular-OS is incredible. The upload speed is blazing fast and the
          compressed storage is extremely secure.”
        </blockquote>
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-full bg-[#2563EB] text-xs font-bold text-white">
            SC
          </div>
          <div className="flex flex-col gap-0.5 text-left">
            <span className="text-sm font-bold text-[#1A1A1A]">Sarah Chen</span>
            <span className="text-xs text-[#666666]">Security Lead</span>
          </div>
        </div>
      </figure>
    </section>
  );
}
