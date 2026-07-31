// Human: File/folder details overlay — Pencil file-details-overlay.pen (header, tabs, property rows).
// Agent: READS FileItem/FolderItem; RENDERS ShareLinksPanel on Sharing tab; video stream rebuild actions.

import { useState } from "react";
import {
  Ban,
  FileIcon,
  FileSpreadsheet,
  FileText,
  Film,
  Folder,
  ImageIcon,
  Info,
  Link2,
  Music,
  RefreshCw,
  Star,
  X,
} from "lucide-react";
import type { FileItem, FolderItem } from "@/api/client";
import { getErrorMessage, reprocessAllHls, reprocessFileHls } from "@/api/client";
import { ConfirmCancelRebuildsDialog } from "@/components/drive/ConfirmCancelRebuildsDialog";
import { ConfirmRebuildAllVideosDialog } from "@/components/drive/ConfirmRebuildAllVideosDialog";
import { cancelAllPendingHlsReprocess } from "@/lib/upload-manager";
import { ShareLinksPanel } from "@/components/drive/ShareLinksPanel";
import { VideoThumbnailEditorDialog } from "@/components/drive/VideoThumbnailEditorDialog";
import type { ShareTarget } from "@/components/drive/ShareDialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { canRebuildVideoStream } from "@/lib/file-processing";
import { toastError, toastSuccess } from "@/lib/toast";
import {
  formatBytes,
  formatFileOpened,
  isAudioMime,
  isEpubMime,
  isPdfMime,
  isSpreadsheetPreviewMime,
  isRtfPreviewMime,
  isTextCodePreviewMime,
} from "@/lib/utils-app";
import { cn } from "@/lib/utils";

export type DetailsTarget =
  | { kind: "file"; file: FileItem }
  | { kind: "folder"; folder: FolderItem };

type ResourceDetailsDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: DetailsTarget | null;
  initialTab?: "details" | "sharing";
  onShareChanged?: () => void;
  /** Human: Whether the current file is in the user's favourites set. */
  isFavourited?: boolean;
  /** Human: Toggle favourite from Details only (not the context menu). */
  onToggleFavourite?: (fileId: string) => void;
  /** Human: Notifies parent when the user picks a different video poster frame. */
  onThumbnailSelected?: (file: FileItem, selectedIndex: number) => void;
  /** Human: Notifies parent when thumbnail job status changes (e.g. after regenerate). */
  onThumbnailUpdated?: (file: FileItem) => void;
  /** Human: Notifies parent when HLS reprocess is queued (file becomes processing). */
  onHlsReprocessQueued?: (file: FileItem) => void;
  /** Human: After bulk rebuild — parent should refresh the whole file list. */
  onHlsReprocessAllQueued?: (result: {
    queued: number;
    skipped: number;
    skipped_already_rebuilt?: number;
    concurrent_limit?: number;
  }) => void;
  /** Human: After cancelling unfinished rebuilds — parent refreshes list + transfer tray. */
  onHlsReprocessAllCancelled?: (result: {
    cancelled_files: number;
    cancelled_jobs: number;
  }) => void;
};

type DetailsTab = "details" | "sharing";

function toShareTarget(target: DetailsTarget): ShareTarget {
  if (target.kind === "file") {
    return {
      resource_type: "file",
      resource_id: target.file.id,
      name: target.file.name,
    };
  }
  return {
    resource_type: "folder",
    resource_id: target.folder.id,
    name: target.folder.name,
  };
}

// Human: Leading icon tile color by file kind — matches Pencil header icon chip.
// Agent: READS mime/name; RETURNS Lucide icon component + bg/text classes.
function resolveFileTypeIcon(file: FileItem) {
  if (file.mime_type?.startsWith("video/")) {
    return { Icon: Film, chip: "bg-brand-weak text-brand" };
  }
  if (file.mime_type?.startsWith("image/")) {
    return { Icon: ImageIcon, chip: "bg-proc-weak text-proc" };
  }
  if (isAudioMime(file.mime_type)) {
    return { Icon: Music, chip: "bg-ok-weak text-ok" };
  }
  if (isSpreadsheetPreviewMime(file.mime_type, file.name)) {
    return { Icon: FileSpreadsheet, chip: "bg-ok-weak text-ok" };
  }
  if (
    isTextCodePreviewMime(file.mime_type, file.name) ||
    isRtfPreviewMime(file.mime_type, file.name) ||
    isPdfMime(file.mime_type) ||
    isEpubMime(file.mime_type, file.name)
  ) {
    return { Icon: FileText, chip: "bg-sunken text-ink-muted" };
  }
  return { Icon: FileIcon, chip: "bg-brand-weak text-brand" };
}

function streamStatusLabel(file: FileItem): string {
  if (file.hls_ready) return "Ready to stream";
  if (
    file.hls_encode_status === "reprocessing" ||
    file.hls_encode_status === "queued" ||
    file.hls_encode_status === "processing"
  ) {
    return "Rebuilding stream";
  }
  if (file.hls_encode_status === "failed") return "Stream failed";
  return "Processing";
}

function fileKindLabel(file: FileItem): string {
  if (file.mime_type?.startsWith("video/")) return "Video";
  if (file.mime_type?.startsWith("image/")) return "Image";
  if (isAudioMime(file.mime_type)) return "Audio";
  if (isPdfMime(file.mime_type)) return "PDF";
  if (isEpubMime(file.mime_type, file.name)) return "EPUB";
  if (isSpreadsheetPreviewMime(file.mime_type, file.name)) return "Spreadsheet";
  if (isRtfPreviewMime(file.mime_type, file.name)) return "Rich text";
  if (isTextCodePreviewMime(file.mime_type, file.name)) return "Text";
  return file.mime_type?.split("/")[0] ?? "File";
}

function PropertyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-hairline py-3.5 last:border-b-0">
      <dt className="shrink-0 text-xs font-medium text-ink-muted">{label}</dt>
      <dd className="min-w-0 break-all text-right text-[13px] font-medium text-ink">
        {value}
      </dd>
    </div>
  );
}

export function ResourceDetailsDialog({
  open,
  onOpenChange,
  target,
  initialTab = "details",
  onShareChanged,
  isFavourited = false,
  onToggleFavourite,
  onThumbnailSelected,
  onThumbnailUpdated,
  onHlsReprocessQueued,
  onHlsReprocessAllQueued,
  onHlsReprocessAllCancelled,
}: ResourceDetailsDialogProps) {
  const [tab, setTab] = useState<DetailsTab>(initialTab);
  const [thumbnailEditorOpen, setThumbnailEditorOpen] = useState(false);
  const [reprocessingHls, setReprocessingHls] = useState(false);
  const [reprocessingAllHls, setReprocessingAllHls] = useState(false);
  const [cancellingRebuilds, setCancellingRebuilds] = useState(false);
  const [rebuildAllConfirmOpen, setRebuildAllConfirmOpen] = useState(false);
  const [cancelRebuildsConfirmOpen, setCancelRebuildsConfirmOpen] = useState(false);

  function handleOpenChange(next: boolean) {
    if (next) {
      setTab(initialTab);
    } else {
      setThumbnailEditorOpen(false);
      setReprocessingHls(false);
      setReprocessingAllHls(false);
      setCancellingRebuilds(false);
      setRebuildAllConfirmOpen(false);
      setCancelRebuildsConfirmOpen(false);
    }
    onOpenChange(next);
  }

  const name = target?.kind === "file" ? target.file.name : target?.folder.name;

  const videoFile =
    target?.kind === "file" && target.file.mime_type?.startsWith("video/") ? target.file : null;

  const canReprocessHls = videoFile !== null && canRebuildVideoStream(videoFile);

  async function handleReprocessHls() {
    if (!videoFile || reprocessingHls) return;
    setReprocessingHls(true);
    try {
      const { file: updated } = await reprocessFileHls(videoFile.id);
      toastSuccess("Video stream rebuild started — play again when processing finishes.");
      onHlsReprocessQueued?.(updated);
    } catch (error) {
      toastError(getErrorMessage(error));
    } finally {
      setReprocessingHls(false);
    }
  }

  async function handleConfirmRebuildAll() {
    if (reprocessingAllHls) return;
    setReprocessingAllHls(true);
    try {
      const result = await reprocessAllHls();
      const limitHint =
        result.concurrent_limit != null
          ? ` Up to ${result.concurrent_limit} rebuild${result.concurrent_limit === 1 ? "" : "s"} run at once.`
          : "";
      const already =
        result.skipped_already_rebuilt != null && result.skipped_already_rebuilt > 0
          ? ` ${result.skipped_already_rebuilt} already rebuilt skipped.`
          : "";
      const activeSkip = result.skipped
        ? ` ${result.skipped} already processing skipped.`
        : "";
      toastSuccess(
        result.queued > 0
          ? `Queued ${result.queued} video${result.queued === 1 ? "" : "s"} for rebuild.${already}${activeSkip}${limitHint}`
          : already || activeSkip
            ? `No new rebuilds queued.${already}${activeSkip}`
            : "No videos need a rebuild — all ready streams are already rebuilt, or none are ready.",
      );
      onHlsReprocessAllQueued?.(result);
      setRebuildAllConfirmOpen(false);
    } catch (error) {
      toastError(getErrorMessage(error));
    } finally {
      setReprocessingAllHls(false);
    }
  }

  async function handleConfirmCancelRebuilds() {
    if (cancellingRebuilds) return;
    setCancellingRebuilds(true);
    try {
      // Human: One call cancels server jobs and marks transfer-tray rebuild rows cancelled.
      // Agent: CALLS cancelAllPendingHlsReprocess; NOTIFIES parent to refresh explorer badges.
      const result = await cancelAllPendingHlsReprocess();
      toastSuccess(
        result.cancelled_files > 0 || result.cancelled_jobs > 0
          ? `Cancelled ${result.cancelled_files} unfinished rebuild${
              result.cancelled_files === 1 ? "" : "s"
            }.`
          : "No unfinished rebuilds to cancel.",
      );
      onHlsReprocessAllCancelled?.(result);
      setCancelRebuildsConfirmOpen(false);
    } catch (error) {
      toastError(getErrorMessage(error));
    } finally {
      setCancellingRebuilds(false);
    }
  }

  const typeIcon =
    target?.kind === "file"
      ? resolveFileTypeIcon(target.file)
      : { Icon: Folder, chip: "bg-warn-weak text-warn" };
  const TypeIcon = typeIcon.Icon;

  const subtitle =
    target?.kind === "file"
      ? [
          fileKindLabel(target.file),
          formatBytes(target.file.size_bytes),
          target.file.mime_type?.startsWith("video/")
            ? streamStatusLabel(target.file)
            : null,
        ]
          .filter(Boolean)
          .join(" · ")
      : "Folder";

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent
          showCloseButton={false}
          className="gap-0 overflow-hidden border border-edge bg-panel p-0 shadow-[0_16px_48px_rgba(0,0,0,0.16)] sm:max-w-[600px] sm:rounded-2xl"
          overlayClassName="bg-[#0A0A10]/50 backdrop-blur-[8px]"
        >
          <DialogHeader className="min-w-0 space-y-0 border-b border-hairline px-7 py-6 pr-6 text-left">
            <div className="flex min-w-0 items-center gap-4">
              <div
                className={cn(
                  "flex size-12 shrink-0 items-center justify-center rounded-xl",
                  typeIcon.chip,
                )}
              >
                <TypeIcon className="size-6" aria-hidden />
              </div>
              <div className="min-w-0 flex-1">
                <DialogTitle className="truncate text-lg font-semibold text-ink">
                  {name ?? "Details"}
                </DialogTitle>
                <DialogDescription className="truncate text-[13px] text-ink-muted">
                  {subtitle}
                </DialogDescription>
              </div>
              <button
                type="button"
                onClick={() => handleOpenChange(false)}
                className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-sunken text-ink-muted transition hover:bg-edge"
                aria-label="Close"
              >
                <X className="size-4" aria-hidden />
              </button>
            </div>
          </DialogHeader>

          <div className="flex gap-1 border-b border-hairline px-5">
            <button
              type="button"
              className={cn(
                "inline-flex items-center gap-2 border-b-2 px-4 py-3 text-[13px] transition",
                tab === "details"
                  ? "border-brand font-semibold text-brand"
                  : "border-transparent font-medium text-ink-muted hover:text-ink",
              )}
              onClick={() => setTab("details")}
            >
              <Info className="size-3.5" aria-hidden />
              Details
            </button>
            <button
              type="button"
              className={cn(
                "inline-flex items-center gap-2 border-b-2 px-4 py-3 text-[13px] transition",
                tab === "sharing"
                  ? "border-brand font-semibold text-brand"
                  : "border-transparent font-medium text-ink-muted hover:text-ink",
              )}
              onClick={() => setTab("sharing")}
            >
              <Link2 className="size-3.5" aria-hidden />
              Sharing
            </button>
          </div>

          <div className="max-h-[min(52vh,28rem)] overflow-y-auto px-7 py-2">
            {!target ? null : tab === "details" ? (
              <dl className="flex flex-col">
                {target.kind === "file" ? (
                  <>
                    <PropertyRow label="Name" value={target.file.name} />
                    <PropertyRow label="Size" value={formatBytes(target.file.size_bytes)} />
                    <PropertyRow label="Type" value={target.file.mime_type ?? "Unknown"} />
                    <PropertyRow
                      label="Modified"
                      value={formatFileOpened(target.file.updated_at)}
                    />
                    <PropertyRow
                      label="Created"
                      value={formatFileOpened(target.file.created_at)}
                    />
                    {onToggleFavourite ? (
                      <div className="flex items-center justify-between gap-4 border-b border-hairline py-3.5">
                        <span className="shrink-0 text-xs font-medium text-ink-muted">
                          Favourites
                        </span>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="gap-2 border-edge bg-panel"
                          onClick={() => onToggleFavourite(target.file.id)}
                        >
                          <Star
                            className={cn(
                              "size-3.5",
                              isFavourited
                                ? "fill-amber-400 text-warn"
                                : "text-ink-muted",
                            )}
                            aria-hidden
                          />
                          {isFavourited ? "Remove from favourites" : "Add to favourites"}
                        </Button>
                      </div>
                    ) : null}
                    {target.file.mime_type?.startsWith("video/") ? (
                      <div className="mt-5 flex flex-col gap-3 border-t border-hairline pt-5">
                        <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
                          Stream
                        </span>
                        <div className="flex flex-col gap-3 rounded-xl border border-edge bg-surface p-4">
                          <Badge
                            variant="secondary"
                            className={cn(
                              "w-fit border-0 font-medium",
                              target.file.hls_ready
                                ? "bg-ok-weak text-ok"
                                : "bg-sunken text-ink-muted",
                            )}
                          >
                            {streamStatusLabel(target.file)}
                          </Badge>
                          <p className="text-xs leading-relaxed text-ink-muted">
                            If playback freezes or audio drifts, rebuild the stream package.
                          </p>
                          <div className="flex flex-wrap gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="gap-2 border-edge bg-panel"
                              disabled={
                                !canReprocessHls ||
                                reprocessingHls ||
                                reprocessingAllHls ||
                                cancellingRebuilds
                              }
                              onClick={() => void handleReprocessHls()}
                            >
                              <RefreshCw
                                className={cn("size-3.5", reprocessingHls && "animate-spin")}
                                aria-hidden
                              />
                              {reprocessingHls ? "Starting rebuild…" : "Rebuild this stream"}
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="gap-2 text-ink-muted"
                              disabled={
                                reprocessingAllHls || reprocessingHls || cancellingRebuilds
                              }
                              onClick={() => setRebuildAllConfirmOpen(true)}
                            >
                              <RefreshCw
                                className={cn(
                                  "size-3.5",
                                  reprocessingAllHls && "animate-spin",
                                )}
                                aria-hidden
                              />
                              {reprocessingAllHls ? "Queueing all…" : "Rebuild all my videos"}
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="gap-2 text-danger hover:bg-danger-weak hover:text-danger"
                              disabled={
                                cancellingRebuilds || reprocessingAllHls || reprocessingHls
                              }
                              onClick={() => setCancelRebuildsConfirmOpen(true)}
                            >
                              <Ban
                                className={cn(
                                  "size-3.5",
                                  cancellingRebuilds && "animate-pulse",
                                )}
                                aria-hidden
                              />
                              {cancellingRebuilds
                                ? "Cancelling rebuilds…"
                                : "Cancel unfinished rebuilds"}
                            </Button>
                          </div>
                        </div>
                        <div className="flex flex-col gap-2 pt-1">
                          <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
                            Thumbnail
                          </span>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="w-fit gap-2 border-edge bg-panel"
                            onClick={() => setThumbnailEditorOpen(true)}
                          >
                            <ImageIcon className="size-3.5" aria-hidden />
                            {videoFile?.video_thumbnail_ready
                              ? "Manage thumbnail"
                              : "Manage thumbnail"}
                          </Button>
                        </div>
                      </div>
                    ) : null}
                  </>
                ) : (
                  <>
                    <PropertyRow label="Name" value={target.folder.name} />
                    <PropertyRow
                      label="Modified"
                      value={formatFileOpened(target.folder.updated_at)}
                    />
                    <PropertyRow
                      label="Created"
                      value={formatFileOpened(target.folder.created_at)}
                    />
                    <PropertyRow label="Kind" value="Folder" />
                  </>
                )}
              </dl>
            ) : (
              <div className="py-3">
                <ShareLinksPanel target={toShareTarget(target)} onChanged={onShareChanged} />
              </div>
            )}
          </div>

          <div className="flex justify-end border-t border-hairline bg-surface px-7 py-4">
            <Button
              type="button"
              className="bg-brand px-5 font-semibold hover:bg-brand-hover"
              onClick={() => handleOpenChange(false)}
            >
              Close
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <VideoThumbnailEditorDialog
        file={videoFile}
        open={thumbnailEditorOpen}
        onOpenChange={setThumbnailEditorOpen}
        onSelected={onThumbnailSelected}
        onFileUpdated={onThumbnailUpdated}
      />
      <ConfirmRebuildAllVideosDialog
        open={rebuildAllConfirmOpen}
        onOpenChange={setRebuildAllConfirmOpen}
        confirming={reprocessingAllHls}
        onConfirm={() => void handleConfirmRebuildAll()}
      />
      <ConfirmCancelRebuildsDialog
        open={cancelRebuildsConfirmOpen}
        onOpenChange={setCancelRebuildsConfirmOpen}
        confirming={cancellingRebuilds}
        onConfirm={() => void handleConfirmCancelRebuilds()}
      />
    </>
  );
}
