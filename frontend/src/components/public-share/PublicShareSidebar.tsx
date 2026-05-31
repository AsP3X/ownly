// Human: Right column on public share pages — owner info, dates, stats, security, and signup CTA.
// Agent: READS PublicShareInfo from overview API; HIDDEN below lg (mobile uses info sheet instead).

import { Cloud, ShieldCheck } from "lucide-react";
import { Link } from "react-router-dom";
import type { PublicShareInfo } from "@/api/client";
import { PublicShareCreatorInfoCard } from "@/components/public-share/PublicShareCreatorInfoCard";

type PublicShareSidebarProps = {
  overview: PublicShareInfo;
};

export function PublicShareSidebar({ overview }: PublicShareSidebarProps) {
  return (
    <aside className="hidden w-full flex-col gap-6 lg:flex lg:w-[380px] lg:shrink-0">
      <PublicShareCreatorInfoCard overview={overview} />

      <div className="flex flex-col gap-3 rounded-xl border border-[#DCFCE7] bg-[#F0FDF4] p-5">
        <div className="flex items-center gap-2">
          <ShieldCheck className="size-[18px] shrink-0 text-[#166534]" aria-hidden />
          <p className="text-sm font-bold text-[#166534]">Zero-Knowledge Verified</p>
        </div>
        <p className="text-xs leading-relaxed text-[#15803D]">
          These files are encrypted client-side. Ownly cannot view, access, or log your shared files. Only
          people with this link can decrypt and view them.
        </p>
      </div>

      <div className="flex flex-col gap-4 rounded-xl border border-[#E5E7EB] bg-white p-5">
        <p className="text-[15px] font-bold text-[#1A1A1A]">Get Your Secure Cloud Storage</p>
        <p className="text-xs leading-relaxed text-[#666666]">
          Tired of big tech scanning your files? Ownly gives you 10 GB of free, zero-knowledge encrypted
          storage. Keep your private life private.
        </p>
        <Link
          to="/register"
          className="flex h-11 w-full items-center justify-center rounded-lg bg-[#2563EB] text-[13px] font-bold text-white transition-colors hover:bg-[#1d4ed8]"
        >
          <Cloud className="mr-2 size-4" aria-hidden />
          Get 10 GB Free Storage
        </Link>
      </div>
    </aside>
  );
}
