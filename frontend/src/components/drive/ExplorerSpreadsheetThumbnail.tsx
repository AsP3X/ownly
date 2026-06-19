// Human: Grid tile spreadsheet preview — mini sheet grid from the first worksheet tab.
// Agent: LAZY-FETCHES xlsx bytes when visible; RENDERS truncated cell matrix; FALLBACK icon on error.

import { useEffect, useRef, useState } from "react";
import { FileSpreadsheet, Loader2 } from "lucide-react";
import type { FileItem } from "@/api/client";
import { fetchFileBlobForPreview } from "@/api/client";
import {
  thumbnailPriorityForPhase,
  useExplorerTileVisible,
} from "@/hooks/useExplorerTileVisible";
import { parseSpreadsheetThumbnailMatrix } from "@/lib/spreadsheet/spreadsheet-parse-client";
import { cn } from "@/lib/utils";

type ExplorerSpreadsheetThumbnailProps = {
  file: FileItem;
  className?: string;
  /** Human: Fill a parent preview slot instead of owning the square aspect box. */
  slotFill?: boolean;
};

/** Human: Lazy-loaded spreadsheet grid preview for explorer tiles. */
export function ExplorerSpreadsheetThumbnail({
  file,
  className,
  slotFill = false,
}: ExplorerSpreadsheetThumbnailProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const phase = useExplorerTileVisible(containerRef);
  const loadPriority = thumbnailPriorityForPhase(phase);
  const shouldLoad = loadPriority !== null;
  const [matrix, setMatrix] = useState<string[][] | null>(null);
  const [failed, setFailed] = useState(false);

  // Human: Parse the workbook when the tile is on-screen and drop data when scrolled away.
  // Agent: CALLS fetchFileBlobForPreview when shouldLoad; CLEARS matrix on off-phase cleanup.
  useEffect(() => {
    if (!shouldLoad) {
      setMatrix(null);
      setFailed(false);
      return;
    }

    let cancelled = false;
    setFailed(false);
    setMatrix(null);

    void fetchFileBlobForPreview(file)
      .then(async (blob) => {
        if (cancelled) return;
        const buffer = await blob.arrayBuffer();
        if (cancelled) return;
        const nextMatrix = await parseSpreadsheetThumbnailMatrix(buffer);
        if (cancelled) return;
        if (nextMatrix.length === 0) {
          setFailed(true);
          return;
        }
        setMatrix(nextMatrix);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, [shouldLoad, file.id]);

  return (
    <div
      ref={containerRef}
      className={cn(
        "overflow-hidden contain-[layout_paint]",
        slotFill
          ? "absolute inset-0 size-full rounded-none border-0 bg-transparent"
          : "relative aspect-square w-full rounded-lg border border-[#E5E7EB] bg-white",
        className,
      )}
    >
      {failed ? (
        <div className="flex size-full items-center justify-center bg-[#F3F4F6]">
          <FileSpreadsheet className="size-8 text-[#107C41]" aria-hidden />
        </div>
      ) : matrix ? (
        <div className="flex size-full flex-col overflow-hidden">
          {/* Human: Excel-green chrome strip — signals spreadsheet content at a glance. */}
          <div className="h-1.5 shrink-0 bg-[#107C41]" aria-hidden />
          <div className="min-h-0 flex-1 overflow-hidden p-1">
            <table className="w-full table-fixed border-collapse text-left">
              <tbody>
                {matrix.map((row, rowIndex) => (
                  <tr key={rowIndex}>
                    {row.map((cell, colIndex) => (
                      <td
                        key={colIndex}
                        className={cn(
                          "truncate border border-[#E5E7EB] px-0.5 py-px leading-none text-[#1A1A1A]",
                          rowIndex === 0 && "bg-[#FAFAFA] font-semibold text-[#666666]",
                        )}
                        style={{ fontSize: 7, maxWidth: 0 }}
                        title={cell}
                      >
                        {cell || "\u00a0"}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="flex size-full items-center justify-center bg-[#F3F4F6]">
          <Loader2 className="size-5 animate-spin text-[#888888]" aria-hidden />
        </div>
      )}
    </div>
  );
}
