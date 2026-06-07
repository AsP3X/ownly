// Human: Mobile image lightbox — Pencil MV Mobile Portrait Image Vertical / Letterbox full-bleed overlay.
// Agent: READS ImagePreviewControllerViewModel; SWITCHES vertical vs letterbox from loaded image aspect ratio.

import { useCallback, useEffect, useState } from "react";
import { Download, Loader2, Share2, X } from "lucide-react";
import type { FileItem } from "@/api/client";
import { resolveImageFitMode } from "@/components/drive/image/image-preview-layout";
import type { ImageFitMode } from "@/components/drive/image/image-preview-types";
import type { ImagePreviewControllerViewModel } from "@/components/drive/image/useImagePreviewController";
import { DialogClose } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

type ImagePreviewSurfaceMobileProps = {
  vm: ImagePreviewControllerViewModel;
  onDownload?: (file: FileItem) => void;
  onShare?: (file: FileItem) => void;
};

export function ImagePreviewSurfaceMobile({
  vm,
  onDownload,
  onShare,
}: ImagePreviewSurfaceMobileProps) {
  const {
    file,
    displayUrl,
    error,
    loading,
    showInitialLoader,
    hasPrevious,
    hasNext,
    showGalleryNav,
    positionLabel,
    sizeLabel,
    showDownloadAction,
    showShareAction,
    goPrevious,
    goNext,
  } = vm;

  const [imageFit, setImageFit] = useState<ImageFitMode>("vertical");

  useEffect(() => {
    setImageFit("vertical");
  }, [file?.id]);

  const handleImageLoad = useCallback((event: React.SyntheticEvent<HTMLImageElement>) => {
    const img = event.currentTarget;
    setImageFit(resolveImageFitMode(img.naturalWidth, img.naturalHeight));
  }, []);

  const isLetterbox = imageFit === "letterbox";

  return (
    <div className="relative flex min-h-0 flex-1 items-center justify-center bg-black">
      {/* Human: Image stage — full-bleed vertical or viewport-centered letterbox band per Pencil. */}
      {/* Agent: OUTER flex centers letterbox; vertical branch uses absolute inset-0 for full bleed. */}
      <div
        className={cn(
          "relative flex w-full items-center justify-center bg-black",
          isLetterbox
            ? "aspect-[390/220] w-full max-h-[min(220px,42dvh)] min-h-[180px] max-w-[min(100%,390px)] shrink-0"
            : "absolute inset-0",
        )}
      >
        {displayUrl ? (
          <img
            key={displayUrl}
            src={displayUrl}
            alt={file?.name ?? "Image preview"}
            onLoad={handleImageLoad}
            className={cn(
              "size-full",
              isLetterbox ? "object-contain" : "object-cover",
            )}
            draggable={false}
          />
        ) : null}

        {error ? (
          <p
            className="absolute inset-x-0 top-1/2 z-20 -translate-y-1/2 px-4 text-center text-sm text-red-400"
            role="alert"
          >
            {error}
          </p>
        ) : null}

        {showInitialLoader ? (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/80">
            <Loader2 className="size-7 animate-spin text-white/80" aria-hidden />
            <span className="sr-only">Loading image…</span>
          </div>
        ) : null}

        {loading && displayUrl ? (
          <div
            className="absolute right-3 top-3 z-20 flex items-center gap-2 rounded-full border border-[#FFFFFF1A] bg-[#00000099] px-3 py-1.5 text-xs text-white"
            aria-live="polite"
          >
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
            Loading…
          </div>
        ) : null}

        <div
          className={cn(
            "pointer-events-none absolute inset-x-0 top-0 z-10 bg-gradient-to-b from-[#000000CC] to-transparent",
            isLetterbox ? "h-14" : "h-[120px]",
          )}
          aria-hidden
        />
        <div
          className={cn(
            "pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-[#000000CC] to-transparent",
            isLetterbox ? "h-[72px]" : "h-[120px]",
          )}
          aria-hidden
        />
      </div>

      {/* Human: Top chrome — position badge + close (Pencil Top Chrome Row). */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-30 flex h-14 items-start justify-end px-4 pb-0 pt-[max(12px,env(safe-area-inset-top))]">
        <div className="pointer-events-auto flex items-center gap-2">
          {positionLabel ? (
            <span className="inline-flex h-8 items-center rounded-full border border-[#FFFFFF1A] bg-[#00000099] px-2.5 text-[11px] text-[#FFFFFFCC]">
              {positionLabel}
            </span>
          ) : null}

          <DialogClose
            render={
              <button
                type="button"
                className="flex size-9 items-center justify-center rounded-full border border-[#FFFFFF1A] bg-[#00000099] text-white transition-colors hover:bg-black/80"
                aria-label="Close image preview"
              />
            }
          >
            <X className="size-4" aria-hidden />
          </DialogClose>
        </div>
      </div>

      {/* Human: Invisible left/right tap zones — previous on the left half, next on the right half. */}
      {/* Agent: z-20 sits under top/bottom chrome (z-30); swipe still handled on the dialog viewport. */}
      {showGalleryNav ? (
        <>
          <button
            type="button"
            disabled={!hasPrevious}
            onClick={goPrevious}
            aria-label="Previous image"
            className="absolute inset-y-0 left-0 z-20 w-1/2 appearance-none border-0 bg-transparent p-0 disabled:pointer-events-none"
          />
          <button
            type="button"
            disabled={!hasNext}
            onClick={goNext}
            aria-label="Next image"
            className="absolute inset-y-0 right-0 z-20 w-1/2 appearance-none border-0 bg-transparent p-0 disabled:pointer-events-none"
          />
        </>
      ) : null}

      {/* Human: Bottom metadata bar — filename, size, download/share (Pencil Translucent Bottom Bar). */}
      {file ? (
        <div className="absolute inset-x-0 bottom-0 z-30 flex items-center justify-between px-5 pb-[max(28px,env(safe-area-inset-bottom))] pt-3">
          <div className="min-w-0 flex-1 pr-4">
            <p className="truncate text-[13px] font-bold text-white">{file.name}</p>
            <p className="text-[11px] text-[#FFFFFF99]">{sizeLabel}</p>
          </div>

          {(showDownloadAction || showShareAction) && (
            <div className="flex shrink-0 items-center gap-5">
              {showDownloadAction ? (
                <button
                  type="button"
                  onClick={() => onDownload?.(file)}
                  className="rounded-md p-1 text-white transition-colors hover:bg-white/10"
                  aria-label={`Download ${file.name}`}
                >
                  <Download className="size-[22px]" aria-hidden />
                </button>
              ) : null}

              {showShareAction ? (
                <button
                  type="button"
                  onClick={() => onShare?.(file)}
                  className="rounded-md p-1 text-white transition-colors hover:bg-white/10"
                  aria-label={`Share ${file.name}`}
                >
                  <Share2 className="size-[22px]" aria-hidden />
                </button>
              ) : null}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
