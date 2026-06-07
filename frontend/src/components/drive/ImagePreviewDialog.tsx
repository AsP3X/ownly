// Human: Image lightbox entry — desktop card viewer or Pencil mobile full-bleed overlay by viewport width.
// Agent: CALLS useImagePreviewController; RENDERS ImagePreviewSurfaceDesktop | ImagePreviewSurfaceMobile via useIsDesktopPlayer.

import { useIsDesktopPlayer } from "@/hooks/useVideoPlayerLayout";
import { ImagePreviewSurfaceDesktop } from "@/components/drive/image/ImagePreviewSurfaceDesktop";
import { ImagePreviewSurfaceMobile } from "@/components/drive/image/ImagePreviewSurfaceMobile";
import type { ImagePreviewDialogProps } from "@/components/drive/image/image-preview-types";
import { resolvePreviewDisplayMaxEdgePx } from "@/components/drive/image/image-preview-display-resize";
import { useImagePreviewController } from "@/components/drive/image/useImagePreviewController";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export type { ImagePreviewDialogProps } from "@/components/drive/image/image-preview-types";

export function ImagePreviewDialog({
  images,
  file,
  open,
  onOpenChange,
  onFileChange,
  shareToken,
  sharePassword,
  onDownload,
  onShare,
}: ImagePreviewDialogProps) {
  const isDesktop = useIsDesktopPlayer(open);
  const isNarrow = !isDesktop;

  const vm = useImagePreviewController({
    images,
    file,
    open,
    onOpenChange,
    onFileChange,
    shareToken,
    sharePassword,
    onDownload,
    onShare,
    previewDisplayMaxEdgePx: isNarrow ? resolvePreviewDisplayMaxEdgePx() : null,
  });

  const descriptionParts = [
    vm.photoInfoLabel,
    vm.positionLabel,
    isNarrow ? "Pinch to zoom; swipe left or right to change images." : "Use arrow keys or side buttons to browse.",
  ].filter(Boolean);

  return (
    <Dialog open={open} onOpenChange={vm.handleDialogOpenChange}>
      <DialogContent
        className={cn(
          "flex flex-col gap-0 overflow-hidden border-0 bg-transparent shadow-none ring-0",
          isNarrow
            ? "!fixed inset-0 top-0 left-0 flex h-[100svh] max-h-[100svh] w-full !max-w-none translate-none transform-none rounded-none p-0 min-h-0 supports-[height:100dvh]:h-dvh supports-[height:100dvh]:max-h-dvh data-open:animate-none data-closed:animate-none"
            : "w-full max-w-[calc(100%-1rem)] items-center justify-center overflow-visible p-4 sm:max-w-[1440px]",
        )}
        overlayClassName={cn(
          "bg-[#0A0A10]/80 backdrop-blur-2xl",
          isNarrow && "bg-[#0A0A10]/95 backdrop-blur-[24px]",
        )}
        showCloseButton={false}
        onKeyDown={vm.handleContentKeyDown}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>{file?.name ?? "Image preview"}</DialogTitle>
          <DialogDescription>{descriptionParts.join(" · ")}</DialogDescription>
        </DialogHeader>

        <div
          ref={vm.viewportRef}
          tabIndex={-1}
          className={cn(
            "flex w-full min-h-0 outline-none",
            isNarrow ? "min-h-0 flex-1 flex-col" : "items-center justify-center",
          )}
          aria-label="Image gallery"
        >
          {isDesktop ? (
            <ImagePreviewSurfaceDesktop vm={vm} onDownload={onDownload} onShare={onShare} />
          ) : (
            <ImagePreviewSurfaceMobile vm={vm} onDownload={onDownload} onShare={onShare} />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
