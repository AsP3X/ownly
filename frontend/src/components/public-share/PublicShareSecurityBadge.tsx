// Human: Zero-knowledge trust badge — Pencil pill on mobile lists and plain row on audio preview.
// Agent: RENDERS ShieldCheck + label; variant controls pill vs minimal row styling.

import { ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";

type PublicShareSecurityBadgeProps = {
  /** Human: pill = green rounded chip; row = centered text row under actions. */
  variant?: "pill" | "row";
  className?: string;
};

export function PublicShareSecurityBadge({
  variant = "pill",
  className,
}: PublicShareSecurityBadgeProps) {
  if (variant === "row") {
    return (
      <div className={cn("flex items-center justify-center gap-1.5 py-2", className)}>
        <ShieldCheck className="size-3.5 shrink-0 text-[#16A34A]" aria-hidden />
        <span className="text-xs font-semibold text-[#16A34A]">
          Zero-Knowledge Verified Encryption
        </span>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-full bg-[#F0FDF4] px-3 py-1.5",
        className,
      )}
    >
      <ShieldCheck className="size-3.5 shrink-0 text-[#166534]" aria-hidden />
      <span className="text-xs font-semibold text-[#166534]">
        Zero-Knowledge Verified Encryption
      </span>
    </div>
  );
}
