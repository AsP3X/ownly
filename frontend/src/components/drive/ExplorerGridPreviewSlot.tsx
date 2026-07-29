// Human: Fixed-aspect preview frame for explorer grid tiles — keeps icon and thumbnail tiles aligned.
// Agent: RENDERS square slot; CHILDREN centered (icon) or absolute-fill (thumbnail components).

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Human: Fixed grid column width — tiles must not grow with `1fr` on partial rows. */
export const EXPLORER_GRID_TILE_WIDTH_PX = 168;

/** Human: CSS grid for explorer tiles — equal halves on phones, fixed 168px tracks on lg+. */
// Human: Mobile uses two fluid columns (Pencil 171px cards + 12px gap); desktop keeps auto-fill 168px.
// Agent: USED by DriveCloudExplorer + ExplorerGridSkeleton; MUST stay aligned with tile width constant.
export const EXPLORER_GRID_LAYOUT_CLASS =
  "grid w-full grid-cols-2 gap-3 lg:grid-cols-[repeat(auto-fill,168px)] lg:justify-start lg:gap-5";

/** Human: Shared preview dimensions for explorer grid file and folder tiles. */
export const EXPLORER_GRID_PREVIEW_SLOT_CLASS =
  "relative w-full min-w-0 shrink-0 overflow-hidden rounded-md bg-sunken aspect-[171/120] lg:aspect-square contain-[layout_paint]";

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
