// Human: Site footer — brand blurb, link columns, and copyright from Pencil Landing Footer.
// Agent: LINKS Product/Legal columns to marketing routes; Company links remain placeholders.

import { Link } from "react-router-dom";
import { LandingBrandLogo } from "@/components/landing/LandingBrandLogo";

const footerColumns = [
  {
    title: "Product",
    links: [
      { label: "Features", to: "/features" },
      { label: "Security", to: "/security" },
      { label: "Pricing", to: "/pricing" },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "About Us", to: "#" },
      { label: "Blog", to: "#" },
      { label: "Careers", to: "#" },
    ],
  },
  {
    title: "Legal",
    links: [
      { label: "Privacy", to: "#" },
      { label: "Terms", to: "#" },
      { label: "Nebular-OS Specs", to: "/specs/nebular-os" },
    ],
  },
] as const;

export function LandingFooter() {
  return (
    <footer className="flex w-full flex-col gap-12 pt-16 pb-8 lg:flex-row lg:justify-between">
      <div className="flex max-w-sm flex-col gap-4">
        <LandingBrandLogo size="sm" />
        <p className="text-sm text-[#888888]">The simplest, most secure home for your digital files.</p>
        <p className="text-xs text-[#888888]">© 2026 Ownly Inc. All rights reserved.</p>
      </div>

      <div className="grid gap-10 sm:grid-cols-3 sm:gap-16">
        {footerColumns.map((column) => (
          <div key={column.title} className="flex flex-col gap-3">
            <span className="text-sm font-bold text-[#1A1A1A]">{column.title}</span>
            {column.links.map((link) =>
              link.to.startsWith("/") ? (
                <Link
                  key={link.label}
                  to={link.to}
                  className="text-sm text-[#666666] transition-colors hover:text-[#1A1A1A]"
                >
                  {link.label}
                </Link>
              ) : (
                <a
                  key={link.label}
                  href={link.to}
                  className="text-sm text-[#666666] transition-colors hover:text-[#1A1A1A]"
                >
                  {link.label}
                </a>
              ),
            )}
          </div>
        ))}
      </div>
    </footer>
  );
}
