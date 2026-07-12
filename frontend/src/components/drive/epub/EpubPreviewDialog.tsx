// Human: EPUB preview dialog — code-split entry; desktop overlay or mobile fullscreen via useIsDesktopPlayer.
// Agent: CALLS useEpubPreviewController; RENDERS EpubPreviewSurfaceDesktop | EpubPreviewSurfaceMobile.

import { useIsDesktopPlayer } from "@/hooks/useVideoPlayerLayout";
import { EpubPreviewSurfaceDesktop } from "@/components/drive/epub/EpubPreviewSurfaceDesktop";
import { EpubPreviewSurfaceMobile } from "@/components/drive/epub/EpubPreviewSurfaceMobile";
import type { EpubPreviewDialogProps } from "@/components/drive/epub/epub-preview-types";
import { useEpubPreviewController } from "@/components/drive/epub/useEpubPreviewController";
import {
  EPUB_READER_DIALOG_CONTENT_DESKTOP_CLASS,
  EPUB_READER_DIALOG_CONTENT_MOBILE_CLASS,
  EPUB_READER_DIALOG_OVERLAY_CLASS,
  EPUB_READER_DIALOG_OVERLAY_CLASS_MOBILE,
} from "@/components/drive/epub/epub-reader-tokens";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type { EpubPreviewDialogProps } from "@/components/drive/epub/epub-preview-types";

export function EpubPreviewDialog({
  file,
  open,
  onOpenChange,
  shareToken,
  sharePassword,
  onDownload,
}: EpubPreviewDialogProps) {
  const isDesktop = useIsDesktopPlayer(open);
  const vm = useEpubPreviewController({ file, open, shareToken, sharePassword });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        motionlessPopup
        showCloseButton={false}
        overlayClassName={isDesktop ? EPUB_READER_DIALOG_OVERLAY_CLASS : EPUB_READER_DIALOG_OVERLAY_CLASS_MOBILE}
        className={isDesktop ? EPUB_READER_DIALOG_CONTENT_DESKTOP_CLASS : EPUB_READER_DIALOG_CONTENT_MOBILE_CLASS}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>{file?.name ?? "EPUB reader"}</DialogTitle>
          <DialogDescription>Read EPUB books in Ownly.</DialogDescription>
        </DialogHeader>

        {isDesktop ? (
          <div className="flex min-h-0 w-full flex-1 items-center justify-center">
            <EpubPreviewSurfaceDesktop onOpenChange={onOpenChange} onDownload={onDownload} vm={vm} />
          </div>
        ) : (
          <EpubPreviewSurfaceMobile onOpenChange={onOpenChange} vm={vm} />
        )}
      </DialogContent>
    </Dialog>
  );
}
