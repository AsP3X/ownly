// Human: Sticky promo strip on mobile public shares — Pencil blue banner with claim + dismiss.
// Agent: READS sessionStorage dismiss flag; WRITES dismiss on X; LINKS to /register for claim.

import { useEffect, useState } from "react";
import { Gift, X } from "lucide-react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";

const DISMISS_KEY = "ownly-public-share-promo-dismissed";

type PublicSharePromoBannerProps = {
  className?: string;
};

export function PublicSharePromoBanner({ className }: PublicSharePromoBannerProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      setVisible(sessionStorage.getItem(DISMISS_KEY) !== "1");
    } catch {
      setVisible(true);
    }
  }, []);

  function dismiss() {
    try {
      sessionStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* sessionStorage may be unavailable */
    }
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div
      className={cn(
        "flex h-11 shrink-0 items-center justify-between gap-3 bg-[#2563EB] px-4 lg:hidden",
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        <Gift className="size-4 shrink-0 text-white" aria-hidden />
        <p className="truncate text-[11.5px] font-bold text-white">
          Get 10 GB Free Secure Storage
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2.5">
        <Link
          to="/register"
          className="rounded-full bg-white px-2.5 py-1 text-[10.5px] font-bold text-[#2563EB] transition-colors hover:bg-[#EFF6FF]"
        >
          Claim
        </Link>
        <button
          type="button"
          onClick={dismiss}
          className="inline-flex size-7 items-center justify-center rounded-full text-white transition-colors hover:bg-white/15"
          aria-label="Dismiss promotion"
        >
          <X className="size-3.5" aria-hidden />
        </button>
      </div>
    </div>
  );
}
