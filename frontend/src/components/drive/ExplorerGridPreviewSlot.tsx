// Human: Fixed-aspect preview frame for explorer grid tiles — keeps icon and thumbnail tiles aligned.
// Agent: RENDERS square slot; CHILDREN centered (icon) or absolute-fill (thumbnail components).

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Human: Fixed grid column width — tiles must not grow with `1fr` on partial rows. */
export const EXPLORER_GRID_TILE_WIDTH_PX = 168;

/** Human: CSS grid for explorer tiles — fixed 168px tracks, no stretch on partial rows. */
export const EXPLORER_GRID_LAYOUT_CLASS =
  "grid grid-cols-[repeat(auto-fill,168px)] justify-start gap-3 sm:gap-4 lg:gap-5";

/** Human: Shared preview dimensions for explorer grid file and folder tiles. */
export const EXPLORER_GRID_PREVIEW_SLOT_CLASS =
  "relative w-full shrink-0 overflow-hidden rounded-lg bg-[#F3F4F6] aspect-square contain-[layout_paint]";

type ExplorerGridPreviewSlotProps = {
  children: ReactNode;
  /** Human: Thumbnail components fill the slot; icons stay centered in the frame. */
  centerContent?: boolean;
  className?: string;
};

/** Human: Uniform preview area so tiles with and without thumbnails share the same footprint. */
export function ExplorerGridPreviewSlot({
  children,
  centerContent = true,
  className,
}: ExplorerGridPreviewSlotProps) {
  return (
    <div
      className={cn(
        EXPLORER_GRID_PREVIEW_SLOT_CLASS,
        centerContent ? "flex items-center justify-center" : "relative",
        className,
      )}
    >
      {children}
    </div>
  );
}
