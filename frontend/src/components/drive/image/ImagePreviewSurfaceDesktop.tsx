// Human: Desktop image lightbox card — Pencil MV Desktop Image Viewer with flanking gallery chevrons.
// Agent: READS ImagePreviewControllerViewModel; RENDERS DialogClose, bottom metadata bar, optional actions.

import { ChevronLeft, ChevronRight, Download, Loader2, Share2, X } from "lucide-react";
import type { FileItem } from "@/api/client";
import { AnimatedGifCanvas } from "@/components/drive/image/AnimatedGifCanvas";
import {
  isGifPreviewFile,
  shouldUseGifCanvasPlayback,
} from "@/components/drive/image/image-preview-gif";
import { withAnimatedPreviewContainFit, resolveStableAnimatedPreviewStyle } from "@/components/drive/image/image-preview-layout";
import type { ImagePreviewControllerViewModel } from "@/components/drive/image/useImagePreviewController";
import { DialogClose } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

type ImagePreviewSurfaceDesktopProps = {
  vm: ImagePreviewControllerViewModel;
  onDownload?: (file: FileItem) => void;
  onShare?: (file: FileItem) => void;
};

export function ImagePreviewSurfaceDesktop({
  vm,
  onDownload,
  onShare,
}: ImagePreviewSurfaceDesktopProps) {
  const {
    file,
    displayUrl,
    error,
    loading,
    showInitialLoader,
    hasPrevious,
    hasNext,
    showGalleryNav,
    photoInfoLabel,
    showDownloadAction,
    showShareAction,
    goPrevious,
    goNext,
    getPreviewGifBlob,
    getPreviewDimensions,
  } = vm;

  const useIosGifPlayback =
    Boolean(file && displayUrl && isGifPreviewFile(file) && shouldUseGifCanvasPlayback());

  const gifNatural = file ? getPreviewDimensions(file.id) : null;
  const iosGifFitStyle =
    gifNatural && gifNatural.width > 0 && gifNatural.height > 0
      ? resolveStableAnimatedPreviewStyle(gifNatural.width, gifNatural.height, 900, 900)
      : withAnimatedPreviewContainFit(
          {
            maxHeight: "min(900px, 105dvh)",
            width: "100%",
            objectFit: "contain",
          },
          0,
          0,
        );

  return (
    <div className="flex w-full items-center justify-center gap-3 sm:gap-4">
      {showGalleryNav ? (
        <button
          type="button"
          disabled={!hasPrevious}
          onClick={goPrevious}
          aria-label="Previous image"
          className="flex size-[50px] shrink-0 items-center justify-center rounded-full border border-[#FFFFFF33] bg-[#FFFFFF1A] text-white transition-colors hover:bg-white/20 disabled:pointer-events-none disabled:opacity-30"
        >
          <ChevronLeft className="size-6" aria-hidden />
        </button>
      ) : null}

      <div className="relative min-w-0 flex-1 overflow-hidden rounded-2xl border border-white/10 bg-[#111118] shadow-[0_16px_48px_rgba(0,0,0,0.4)]">
        <div className="relative flex min-h-[min(900px,105dvh)] w-full items-center justify-center">
          {error ? (
            <p className="px-6 text-center text-sm text-red-400" role="alert">
              {error}
            </p>
          ) : null}

          {displayUrl ? (
            useIosGifPlayback ? (
              <AnimatedGifCanvas
                url={displayUrl}
                fileId={file?.id}
                byteSource={file ? getPreviewGifBlob(file.id) : null}
                alt={file?.name ?? "Image preview"}
                fitStyle={iosGifFitStyle}
                className="max-h-[min(900px,105dvh)] w-full object-contain"
              />
            ) : (
              <img
                src={displayUrl}
                alt={file?.name ?? "Image preview"}
                className="max-h-[min(900px,105dvh)] w-full object-contain"
                draggable={false}
              />
            )
          ) : null}

          {showInitialLoader ? (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#111118]">
              <Loader2 className="size-7 animate-spin text-white/80" aria-hidden />
              <span className="sr-only">Loading image…</span>
            </div>
          ) : null}

          {loading && displayUrl ? (
            <div
              className="absolute right-4 top-4 z-20 flex items-center gap-2 rounded-full border border-white/20 bg-black/60 px-3 py-1.5 text-xs text-white"
              aria-live="polite"
            >
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
              Loading…
            </div>
          ) : null}

          <DialogClose
            render={
              <button
                type="button"
                className="absolute right-4 top-4 z-30 flex size-11 items-center justify-center rounded-[22px] border border-white/20 bg-black/60 text-white transition-colors hover:bg-black/80"
                aria-label="Close image preview"
              />
            }
          >
            <X className="size-[18px]" aria-hidden />
          </DialogClose>

          {file ? (
            <div className="absolute inset-x-0 bottom-0 z-20 flex h-16 items-center justify-between bg-black/60 px-5">
              <p className="min-w-0 truncate text-sm font-bold text-white">{photoInfoLabel}</p>

              {(showDownloadAction || showShareAction) && (
                <div className="flex shrink-0 items-center gap-4">
                  {showDownloadAction ? (
                    <button
                      type="button"
                      onClick={() => onDownload?.(file)}
                      className="rounded-md p-1 text-white transition-colors hover:bg-white/10"
                      aria-label={`Download ${file.name}`}
                    >
                      <Download className="size-4" aria-hidden />
                    </button>
                  ) : null}

                  {showShareAction ? (
                    <button
                      type="button"
                      onClick={() => onShare?.(file)}
                      className={cn("rounded-md p-1 text-white transition-colors hover:bg-white/10")}
                      aria-label={`Share ${file.name}`}
                    >
                      <Share2 className="size-4" aria-hidden />
                    </button>
                  ) : null}
                </div>
              )}
            </div>
          ) : null}
        </div>
      </div>

      {showGalleryNav ? (
        <button
          type="button"
          disabled={!hasNext}
          onClick={goNext}
          aria-label="Next image"
          className="flex size-[50px] shrink-0 items-center justify-center rounded-full border border-[#FFFFFF33] bg-[#FFFFFF1A] text-white transition-colors hover:bg-white/20 disabled:pointer-events-none disabled:opacity-30"
        >
          <ChevronRight className="size-6" aria-hidden />
        </button>
      ) : null}
    </div>
  );
}
