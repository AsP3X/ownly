// Human: Reusable marketing hero — badge pill, headline, and subcopy from Pencil public page heroes.
// Agent: RENDERS static props only; icon optional via Lucide component type.

import type { LucideIcon } from "lucide-react";

type MarketingHeroSectionProps = {
  badgeIcon?: LucideIcon;
  badgeLabel: string;
  title: string;
  subtitle: string;
};

export function MarketingHeroSection({
  badgeIcon: BadgeIcon,
  badgeLabel,
  title,
  subtitle,
}: MarketingHeroSectionProps) {
  return (
    <section className="flex w-full flex-col items-center gap-6 py-16 pt-8">
      <div className="flex items-center gap-1.5 rounded-full border border-[#E5E7EB] bg-[#F7F8FA] px-3.5 py-1.5">
        {BadgeIcon ? <BadgeIcon className="size-3.5 text-[#2563EB]" aria-hidden /> : null}
        <span className="text-xs font-bold tracking-wide text-[#2563EB]">{badgeLabel}</span>
      </div>

      <h1 className="max-w-[900px] text-center text-4xl font-bold leading-[1.15] text-[#1A1A1A] sm:text-5xl lg:text-[52px]">
        {title}
      </h1>

      <p className="max-w-[720px] text-center text-lg leading-relaxed text-[#666666]">{subtitle}</p>
    </section>
  );
}
