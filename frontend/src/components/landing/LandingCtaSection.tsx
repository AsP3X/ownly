// Human: Bottom call-to-action band from Pencil CTA Section — heading, subcopy, primary button.
// Agent: LINKS Create Free Account to /register; id=cta for nav anchor targets.

import { Link } from "react-router-dom";

export function LandingCtaSection() {
  return (
    <section
      id="cta"
      className="flex w-full flex-col items-center gap-6 rounded-2xl bg-[#F7F8FA] px-6 py-20 text-center sm:px-12"
    >
      <h2 className="text-3xl font-bold text-[#1A1A1A] sm:text-4xl">Ready to secure your digital files?</h2>
      <p className="max-w-2xl text-base text-[#666666]">
        Join thousands of individuals and teams who trust Ownly&apos;s secure, high-performance Nebular-OS
        object storage.
      </p>
      <Link
        to="/register"
        className="rounded-xl bg-[#2563EB] px-7 py-3.5 text-base font-bold text-white transition-colors hover:bg-[#1d4ed8]"
      >
        Create Free Account
      </Link>
    </section>
  );
}
