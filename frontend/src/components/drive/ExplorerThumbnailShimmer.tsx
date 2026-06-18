// Human: Skeleton placeholder while explorer grid waits on thumbnail jobs or blob fetch.
// Agent: USES ownly-shimmer-sweep gradient band; FILLS preview slot when slotFill is true.

import { cn } from "@/lib/utils";

type ExplorerThumbnailShimmerProps = {
  className?: string;
  /** Human: Fill a parent preview slot instead of owning the square aspect box. */
  slotFill?: boolean;
  /** Human: Accessible label while the preview is not yet visible. */
  label?: string;
};

/** Human: Muted tile base with a diagonal highlight sweep — not a solid sliding block. */
export function ExplorerThumbnailShimmer({
  className,
  slotFill = false,
  label = "Generating preview",
}: ExplorerThumbnailShimmerProps) {
  return (
    <div
      className={cn(
        "overflow-hidden contain-[layout_paint]",
        slotFill
          ? "absolute inset-0 size-full rounded-none"
          : "relative aspect-square w-full rounded-lg",
        className,
      )}
      role="status"
      aria-busy="true"
      aria-label={label}
    >
      {/* Human: Static base gradient so the tile never reads as flat gray while idle between sweeps. */}
      <div
        className="absolute inset-0 bg-gradient-to-br from-[#ECEEF1] via-[#E5E7EB] to-[#DDE1E6]"
        aria-hidden
      />

      {/* Human: Secondary soft bands suggest image content loading beneath the shimmer. */}
      <div className="absolute inset-0 opacity-40" aria-hidden>
        <div className="absolute inset-x-[18%] top-[22%] h-[38%] rounded-md bg-[#D1D5DB]/35" />
        <div className="absolute inset-x-[28%] bottom-[18%] h-[14%] rounded-sm bg-[#D1D5DB]/25" />
      </div>

      {/* Human: Skewed highlight passes diagonally — matches common skeleton loaders, not progress bars. */}
      <div className="absolute inset-0 overflow-hidden" aria-hidden>
        <div
          className={cn(
            "absolute -inset-y-6 -left-1/2 w-[85%]",
            "animate-[ownly-shimmer-sweep_1.85s_ease-in-out_infinite]",
            "bg-gradient-to-r from-transparent via-white/75 to-transparent",
            "will-change-transform",
          )}
        />
        <div
          className={cn(
            "absolute -inset-y-8 -left-1/2 w-[55%]",
            "animate-[ownly-shimmer-sweep_1.85s_ease-in-out_infinite]",
            "[animation-delay:0.35s]",
            "bg-gradient-to-r from-transparent via-white/35 to-transparent",
            "will-change-transform",
          )}
        />
      </div>
    </div>
  );
}
