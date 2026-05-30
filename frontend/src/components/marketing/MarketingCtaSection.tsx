// Human: Bottom CTA band shared across marketing pages — heading, subcopy, and primary button from Pencil.
// Agent: LINKS button to /register by default; accepts custom copy for page-specific CTAs.

import { Link } from "react-router-dom";

type MarketingCtaSectionProps = {
  title: string;
  subtitle: string;
  buttonLabel?: string;
  buttonTo?: string;
};

export function MarketingCtaSection({
  title,
  subtitle,
  buttonLabel = "Create Free Account",
  buttonTo = "/register",
}: MarketingCtaSectionProps) {
  return (
    <section className="flex w-full flex-col items-center gap-6 rounded-2xl bg-[#F7F8FA] px-6 py-20 text-center sm:px-12">
      <h2 className="text-3xl font-bold text-[#1A1A1A] sm:text-4xl">{title}</h2>
      <p className="max-w-2xl text-base text-[#666666]">{subtitle}</p>
      <Link
        to={buttonTo}
        className="rounded-xl bg-[#2563EB] px-7 py-3.5 text-base font-bold text-white transition-colors hover:bg-[#1d4ed8]"
      >
        {buttonLabel}
      </Link>
    </section>
  );
}
