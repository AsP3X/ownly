// Human: Visual indicator that a file row is still being processed on the server.
// Agent: RENDERS violet badge + spinner; READS fileProcessingLabel for progress text.

import { Loader2 } from "lucide-react";
import type { FileItem } from "@/api/client";
import { fileProcessingLabel, isFileMovingToStorage } from "@/lib/file-processing";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

type FileProcessingBadgeProps = {
  file: FileItem;
  className?: string;
};

// Human: Compact status chip shown beside file names while server-side video ingest runs.
// Agent: DISPLAYS animated spinner; LABEL from encode vs storage progress when available.
export function FileProcessingBadge({ file, className }: FileProcessingBadgeProps) {
  const storing = isFileMovingToStorage(file);
  return (
    <Badge
      variant="secondary"
      className={cn("gap-1", className)}
      aria-label={fileProcessingLabel(file)}
    >
      <Loader2
        className={cn("size-3 animate-spin", storing ? "text-emerald-700" : "text-violet-700")}
        aria-hidden
      />
      {fileProcessingLabel(file)}
    </Badge>
  );
}
