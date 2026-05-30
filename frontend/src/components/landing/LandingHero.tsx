// Human: Hero block — badge, headline, subcopy, primary CTA, and product mockup from Pencil Hero Section.
// Agent: LINKS Start Free Trial to /register; RENDERS LandingProductMockup below fold content.

import { Link } from "react-router-dom";
import { LandingProductMockup } from "@/components/landing/LandingProductMockup";

export function LandingHero() {
  return (
    <section className="flex w-full flex-col items-center gap-8 py-16">
      <div className="rounded-full border border-[#E5E7EB] bg-[#F7F8FA] px-3.5 py-1.5">
        <span className="text-xs font-bold tracking-wide text-[#2563EB]">
          INTRODUCING SECURE CLOUD 2.0
        </span>
      </div>

      <h1 className="max-w-[800px] text-center text-4xl font-bold leading-[1.15] text-[#1A1A1A] sm:text-5xl lg:text-[56px]">
        Take complete ownership of your digital life.
      </h1>

      <p className="max-w-[640px] text-center text-lg leading-relaxed text-[#666666]">
        Simple, seamless, and blazingly fast. Ownly converts your files into heavily compressed binary
        blobs, secured by robust enterprise encryption and powered by Nebular-OS high-performance object
        storage.
      </p>

      <div className="flex flex-col items-center gap-4">
        <Link
          to="/register"
          className="rounded-xl bg-[#2563EB] px-7 py-3.5 text-base font-bold text-white transition-colors hover:bg-[#1d4ed8]"
        >
          Start Free Trial
        </Link>
        <p className="text-sm text-[#888888]">No credit card required • 10GB free</p>
      </div>

      <LandingProductMockup />
    </section>
  );
}
