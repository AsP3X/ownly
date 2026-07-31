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

      <div className="flex flex-col gap-3 rounded-xl border border-ok/40 bg-ok-weak p-5">
        <div className="flex items-center gap-2">
          <ShieldCheck className="size-[18px] shrink-0 text-ok" aria-hidden />
          <p className="text-sm font-bold text-ok">Zero-Knowledge Verified</p>
        </div>
        <p className="text-xs leading-relaxed text-ok">
          These files are encrypted client-side. Ownly cannot view, access, or log your shared files. Only
          people with this link can decrypt and view them.
        </p>
      </div>

      <div className="flex flex-col gap-4 rounded-xl border border-edge bg-panel p-5">
        <p className="text-[15px] font-bold text-ink">Get Your Secure Cloud Storage</p>
        <p className="text-xs leading-relaxed text-ink-muted">
          Tired of big tech scanning your files? Ownly gives you 10 GB of free, zero-knowledge encrypted
          storage. Keep your private life private.
        </p>
        <Link
          to="/register"
          className="flex h-11 w-full items-center justify-center rounded-lg bg-brand text-[13px] font-bold text-brand-on transition-colors hover:bg-brand-hover"
        >
          <Cloud className="mr-2 size-4" aria-hidden />
          Get 10 GB Free Storage
        </Link>
      </div>
    </aside>
  );
}
