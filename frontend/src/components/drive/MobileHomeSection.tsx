// Human: Mobile home section — compact list rows instead of cramped grid tiles.
// Agent: lg:hidden; CALLS same handlers as FileGrid; OPENS action sheet via onOpenActions.

import {
  FileIcon,
  FileSpreadsheet,
  FileText,
  Film,
  ImageIcon,
  MoreVertical,
  Music,
  Presentation,
} from "lucide-react";
import type { FileItem, ShareFlags } from "@/api/client";
import { FileProcessingBadge } from "@/components/drive/FileProcessingBadge";
import { SharedIndicator } from "@/components/drive/SharedIndicator";
import type { MobileActionTarget } from "@/components/drive/MobileFileActionsSheet";
import { isFileProcessing } from "@/lib/file-processing";
import { formatBytes, formatFileOpened, isAudioMime, isImageMime, isPdfMime } from "@/lib/utils-app";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type MobileHomeSectionProps = {
  title: string;
  files: FileItem[];
  locationLabel: string;
  emptyMessage: string;
  fileShareFlags?: Record<string, ShareFlags>;
  onPreviewVideo?: (file: FileItem) => void;
  onPreviewImage?: (file: FileItem) => void;
  onPreviewPdf?: (file: FileItem) => void;
  onPreviewAudio?: (file: FileItem) => void;
  onOpenActions: (target: MobileActionTarget) => void;
};

// Human: Mime icon inside a soft rounded tile for mobile home rows.
// Agent: READS mime_type; RETURNS colored icon wrapper for list density.
function HomeFileIcon({ mimeType }: { mimeType: string | null }) {
  const mime = (mimeType ?? "").toLowerCase();
  let icon = <FileIcon className="size-5 text-blue-700" aria-hidden />;
  let tone = "bg-blue-50";

  if (mime.startsWith("image/")) {
    icon = <ImageIcon className="size-5 text-sky-700" aria-hidden />;
    tone = "bg-sky-50";
  } else if (mime.startsWith("video/")) {
    icon = <Film className="size-5 text-violet-700" aria-hidden />;
    tone = "bg-violet-50";
  } else if (mime.startsWith("audio/")) {
    icon = <Music className="size-5 text-emerald-700" aria-hidden />;
    tone = "bg-emerald-50";
  } else if (mime.includes("sheet") || mime.includes("excel") || mime.includes("csv")) {
    icon = <FileSpreadsheet className="size-5 text-green-700" aria-hidden />;
    tone = "bg-green-50";
  } else if (mime.includes("presentation") || mime.includes("powerpoint")) {
    icon = <Presentation className="size-5 text-orange-700" aria-hidden />;
    tone = "bg-orange-50";
  } else if (
    mime.startsWith("text/") ||
    mime.includes("pdf") ||
    mime.includes("word") ||
    mime.includes("document")
  ) {
    icon = <FileText className="size-5 text-blue-700" aria-hidden />;
    tone = "bg-blue-50";
  }

  return (
    <span className={cn("flex size-11 shrink-0 items-center justify-center rounded-2xl", tone)}>
      {icon}
    </span>
  );
}

// Human: One home bucket rendered as a grouped iOS-style list on mobile.
// Agent: RENDERS section header + white card list; hidden on lg+ where FileGrid is used.
export function MobileHomeSection({
  title,
  files,
  locationLabel,
  emptyMessage,
  fileShareFlags = {},
  onPreviewVideo,
  onPreviewImage,
  onPreviewPdf,
  onPreviewAudio,
  onOpenActions,
}: MobileHomeSectionProps) {
  if (files.length === 0) {
    return (
      <section className="lg:hidden">
        <h2 className="mb-2 px-1 text-sm font-semibold text-neutral-900">{title}</h2>
        <p className="rounded-2xl bg-white px-4 py-6 text-center text-sm text-neutral-500 shadow-sm ring-1 ring-neutral-200/70">
          {emptyMessage}
        </p>
      </section>
    );
  }

  return (
    <section className="lg:hidden">
      <h2 className="mb-2 px-1 text-sm font-semibold text-neutral-900">{title}</h2>
      <ul className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-neutral-200/70">
        {files.map((file, index) => {
          const isVideo = file.mime_type?.startsWith("video/") ?? false;
          const isImage = isImageMime(file.mime_type);
          const isPdf = isPdfMime(file.mime_type);
          const isAudio = isAudioMime(file.mime_type);
          const processing = isFileProcessing(file);
          const canPreviewVideo = isVideo && onPreviewVideo !== undefined && !processing;
          const canPreviewImage = isImage && onPreviewImage !== undefined && !processing;
          const canPreviewPdf = isPdf && onPreviewPdf !== undefined && !processing;
          const canPreviewAudio = isAudio && onPreviewAudio !== undefined && !processing;
          const canPreview =
            canPreviewVideo || canPreviewImage || canPreviewPdf || canPreviewAudio;

          return (
            <li
              key={file.id}
              className={cn(index > 0 && "border-t border-neutral-100")}
              data-file-id={file.id}
            >
              <div className="flex items-center gap-1 pr-1">
                <button
                  type="button"
                  onClick={() => {
                    if (canPreviewVideo) onPreviewVideo!(file);
                    else if (canPreviewImage) onPreviewImage!(file);
                    else if (canPreviewPdf) onPreviewPdf!(file);
                    else if (canPreviewAudio) onPreviewAudio!(file);
                  }}
                  className={cn(
                    "flex min-w-0 flex-1 items-center gap-3 px-3 py-3 text-left active:bg-neutral-50",
                    !canPreview && "cursor-default",
                  )}
                >
                  <HomeFileIcon mimeType={file.mime_type} />
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate font-medium text-neutral-900">{file.name}</span>
                      <SharedIndicator flags={fileShareFlags[file.id]} />
                    </div>
                    <p className="truncate text-xs text-neutral-500">
                      {locationLabel} · {formatFileOpened(file.updated_at)} · {formatBytes(file.size_bytes)}
                    </p>
                    {processing ? (
                      <div className="mt-1.5">
                        <FileProcessingBadge file={file} className="bg-violet-100 text-violet-900" />
                      </div>
                    ) : null}
                  </div>
                </button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="shrink-0 text-neutral-400"
                  aria-label={`Actions for ${file.name}`}
                  onClick={() => onOpenActions({ kind: "file", file })}
                >
                  <MoreVertical className="size-4" />
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
