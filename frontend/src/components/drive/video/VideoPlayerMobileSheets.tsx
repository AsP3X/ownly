// Human: Bottom sheets for mobile video player — file info and overflow actions menu.
// Agent: RENDERS Sheet primitives; CALLS onDownload/onShare; OPENS info sheet from more menu.

import { Download, Info, Share2 } from "lucide-react";
import type { FileItem } from "@/api/client";
import { formatVideoTime } from "@/components/drive/video/video-time";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { formatBytes, formatFileOpened } from "@/lib/utils-app";
import { cn } from "@/lib/utils";

type VideoPlayerInfoSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  file: FileItem;
  folderLabel?: string | null;
  durationSeconds: number;
  videoWidth?: number | null;
  videoHeight?: number | null;
};

// Human: Detail row inside the mobile info sheet.
function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-white/10 py-3 last:border-0">
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-white/50">{label}</dt>
      <dd className="text-sm text-white">{value}</dd>
    </div>
  );
}

// Human: File metadata bottom sheet opened from Info rail button or more menu.
// Agent: READS FileItem + transport duration; NO network calls.
export function VideoPlayerInfoSheet({
  open,
  onOpenChange,
  file,
  folderLabel,
  durationSeconds,
  videoWidth,
  videoHeight,
}: VideoPlayerInfoSheetProps) {
  const dimensionLabel =
    videoWidth && videoHeight && videoWidth > 0 && videoHeight > 0
      ? `${videoWidth} × ${videoHeight}`
      : null;
  const durationLabel =
    durationSeconds > 0 ? formatVideoTime(durationSeconds) : null;
  const streamLabel = file.hls_ready ? "Ready to stream" : "Processing";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        overlayClassName="bg-black/60 backdrop-blur-sm"
        className="rounded-t-2xl border-white/10 bg-[#141414] text-white"
      >
        <SheetHeader className="px-1 pb-2">
          <SheetTitle className="truncate text-base text-white">{file.name}</SheetTitle>
          <SheetDescription className="text-white/60">File details</SheetDescription>
        </SheetHeader>
        <dl className="px-1">
          <InfoRow label="Size" value={formatBytes(file.size_bytes)} />
          {durationLabel ? <InfoRow label="Duration" value={durationLabel} /> : null}
          {folderLabel ? <InfoRow label="Location" value={folderLabel} /> : null}
          {dimensionLabel ? <InfoRow label="Dimensions" value={dimensionLabel} /> : null}
          <InfoRow label="Type" value={file.mime_type ?? "Unknown"} />
          <InfoRow label="Stream" value={streamLabel} />
          <InfoRow label="Modified" value={formatFileOpened(file.updated_at)} />
          <InfoRow label="Created" value={formatFileOpened(file.created_at)} />
        </dl>
      </SheetContent>
    </Sheet>
  );
}

type VideoPlayerMoreMenuSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  file: FileItem;
  showDownloadAction: boolean;
  showShareAction: boolean;
  onDownload?: (file: FileItem) => void;
  onShare?: (file: FileItem) => void;
  onShowInfo: () => void;
};

// Human: Overflow menu — download, share, and link to file details sheet.
// Agent: CALLS parent handlers; CLOSES self before opening info.
function MoreMenuButton({
  label,
  icon: Icon,
  onClick,
  disabled = false,
}: {
  label: string;
  icon: typeof Download;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-sm font-medium text-white transition hover:bg-white/10 disabled:opacity-40",
      )}
    >
      <Icon className="size-5 shrink-0 text-white/80" aria-hidden />
      {label}
    </button>
  );
}

// Human: More options sheet from top-right chrome button.
// Agent: MIRRORS action rail entries plus file details entry.
export function VideoPlayerMoreMenuSheet({
  open,
  onOpenChange,
  file,
  showDownloadAction,
  showShareAction,
  onDownload,
  onShare,
  onShowInfo,
}: VideoPlayerMoreMenuSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        overlayClassName="bg-black/60 backdrop-blur-sm"
        className="rounded-t-2xl border-white/10 bg-[#141414] text-white"
      >
        <SheetHeader className="px-1 pb-2">
          <SheetTitle className="text-base text-white">More options</SheetTitle>
          <SheetDescription className="truncate text-white/60">{file.name}</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-1 px-1">
          <MoreMenuButton
            label="Save"
            icon={Download}
            disabled={!showDownloadAction}
            onClick={
              showDownloadAction
                ? () => {
                    onOpenChange(false);
                    onDownload?.(file);
                  }
                : undefined
            }
          />
          <MoreMenuButton
            label="Share"
            icon={Share2}
            disabled={!showShareAction}
            onClick={
              showShareAction
                ? () => {
                    onOpenChange(false);
                    onShare?.(file);
                  }
                : undefined
            }
          />
          <MoreMenuButton
            label="File details"
            icon={Info}
            onClick={() => {
              onOpenChange(false);
              onShowInfo();
            }}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}
