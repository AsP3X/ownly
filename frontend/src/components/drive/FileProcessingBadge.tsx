// Human: Visual indicator that a file row is still being processed on the server.
// Agent: RENDERS violet badge + spinner; READS fileProcessingLabel for progress text.

import { Loader2 } from "lucide-react";
import type { FileItem } from "@/api/client";
import {
  fileProcessingCompactLabel,
  fileProcessingLabel,
  isFileMovingToStorage,
} from "@/lib/file-processing";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

type FileProcessingBadgeProps = {
  file: FileItem;
  className?: string;
  /** Human: Use shorter label text in auto-fill grid tiles. */
  compact?: boolean;
};

// Human: Compact status chip shown beside file names while server-side video ingest runs.
// Agent: DISPLAYS animated spinner; LABEL from encode vs storage progress when available.
export function FileProcessingBadge({ file, className, compact }: FileProcessingBadgeProps) {
  const storing = isFileMovingToStorage(file);
  const fullLabel = fileProcessingLabel(file);
  const displayLabel = compact ? fileProcessingCompactLabel(file) : fullLabel;

  return (
    <Badge
      variant="secondary"
      className={cn("max-w-full min-w-0 gap-1", className)}
      aria-label={fullLabel}
      title={fullLabel}
    >
      <Loader2
        className={cn("size-3 shrink-0 animate-spin", storing ? "text-emerald-700" : "text-violet-700")}
        aria-hidden
      />
      <span className="min-w-0 truncate">{displayLabel}</span>
    </Badge>
  );
}
