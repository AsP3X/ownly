// Human: Visual indicator that a file row is still being processed on the server.
// Agent: RENDERS violet badge + spinner; READS fileProcessingLabel for progress text.

import { Loader2 } from "lucide-react";
import type { FileItem } from "@/api/client";
import { fileProcessingLabel } from "@/lib/file-processing";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

type FileProcessingBadgeProps = {
  file: FileItem;
  className?: string;
};

// Human: Compact “Processing” chip shown beside file names in the drive browser.
// Agent: DISPLAYS animated spinner; LABEL from conversion_progress when available.
export function FileProcessingBadge({ file, className }: FileProcessingBadgeProps) {
  return (
    <Badge
      variant="secondary"
      className={cn("gap-1", className)}
      aria-label={fileProcessingLabel(file)}
    >
      <Loader2 className="size-3 animate-spin text-violet-700" aria-hidden />
      {fileProcessingLabel(file)}
    </Badge>
  );
}
