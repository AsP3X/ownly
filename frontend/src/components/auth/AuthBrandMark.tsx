// Human: Ownly logo lockup for the auth views — cloud glyph in a soft tile with a breathing halo.
// Agent: PURE presentational; size variants only; halo/float animation comes from auth-motion.css.

import { Cloud } from "lucide-react";
import { cn } from "@/lib/utils";

type AuthBrandMarkProps = {
  size?: "sm" | "md" | "lg";
  /** Human: Hide the wordmark when the surrounding layout already names the product. */
  withWordmark?: boolean;
  className?: string;
};

const TILE = {
  sm: "size-9 rounded-xl",
  md: "size-11 rounded-2xl",
  lg: "size-14 rounded-2xl",
} as const;

const GLYPH = {
  sm: "size-5",
  md: "size-6",
  lg: "size-7",
} as const;

const WORD = {
  sm: "text-lg",
  md: "text-xl",
  lg: "text-2xl",
} as const;

export function AuthBrandMark({
  size = "md",
  withWordmark = true,
  className,
}: AuthBrandMarkProps) {
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <span className="relative inline-flex shrink-0 items-center justify-center">
        {/* Human: Soft brand halo that breathes behind the tile. */}
        <span
          className="auth-logo-halo absolute inset-0 -z-10 rounded-[inherit] bg-brand/35 blur-lg"
          aria-hidden
        />
        <span
          className={cn(
            "auth-logo-float inline-flex items-center justify-center bg-gradient-to-br from-brand to-brand-hover text-brand-on shadow-lg shadow-brand/25 ring-1 ring-inset ring-white/25",
            TILE[size],
          )}
        >
          <Cloud className={GLYPH[size]} aria-hidden />
        </span>
      </span>
      {withWordmark ? (
        <span className={cn("font-bold tracking-tight text-ink", WORD[size])}>Ownly</span>
      ) : null}
    </div>
  );
}
