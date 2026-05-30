// Human: Top navigation bar — logo, section links, Sign In, and Get Started CTA from Pencil.
// Agent: READS react-router Link targets; highlights active route via useLocation pathname match.

import { Link, useLocation } from "react-router-dom";
import { LandingBrandLogo } from "@/components/landing/LandingBrandLogo";
import { cn } from "@/lib/utils";

const navLinks = [
  { label: "Features", to: "/features" },
  { label: "Security", to: "/security" },
  { label: "Pricing", to: "/pricing" },
  { label: "FAQ", to: "/faq" },
] as const;

export function LandingHeader() {
  const { pathname } = useLocation();

  return (
    <header className="flex h-16 w-full items-center justify-between">
      <Link to="/" className="shrink-0" aria-label="Ownly home">
        <LandingBrandLogo />
      </Link>

      {/* Human: Desktop nav links — hidden on small screens per responsive landing layout */}
      <nav className="hidden items-center gap-8 md:flex" aria-label="Primary">
        {navLinks.map((link) => {
          const isActive = pathname === link.to;
          return (
            <Link
              key={link.label}
              to={link.to}
              className={cn(
                "text-sm font-semibold transition-colors",
                isActive ? "text-[#2563EB]" : "text-[#666666] hover:text-[#1A1A1A]",
              )}
            >
              {link.label}
            </Link>
          );
        })}
      </nav>

      <div className="flex items-center gap-5">
        <Link
          to="/login"
          className="text-sm font-semibold text-[#1A1A1A] transition-colors hover:text-[#2563EB]"
        >
          Sign In
        </Link>
        <Link
          to="/register"
          className="rounded-lg bg-[#2563EB] px-[18px] py-2.5 text-sm font-bold text-white transition-colors hover:bg-[#1d4ed8]"
        >
          Get Started
        </Link>
      </div>
    </header>
  );
}
