// Human: In-browser PDF viewer — page navigation and zoom; structured for future annotation/editing layers.
// Agent: FETCHES fetchFileBlobForPreview; RENDERS react-pdf Document+Page; READS pdf-viewer worker setup.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2, ZoomIn, ZoomOut } from "lucide-react";
import { Document, Page } from "react-pdf";
import type { FileItem } from "@/api/client";
import { fetchFileBlobForPreview, getErrorMessage } from "@/api/client";
import "@/lib/pdf-viewer";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type PdfPreviewDialogProps = {
  file: FileItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3;
const ZOOM_STEP = 0.25;
// Human: Default opens at 75% — full page visible with readable margins in the wide dialog.
const DEFAULT_ZOOM = 0.75;
// Human: Fine wheel steps — small notch per scroll tick; scaled slightly by delta magnitude.
const WHEEL_ZOOM_MIN = 0.012;
const WHEEL_ZOOM_MAX = 0.055;
const WHEEL_ZOOM_SCALE = 0.00035;

function clampZoom(value: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number(value.toFixed(3))));
}

// Human: Scale wheel deltas from line/page modes into pixel-like steps for consistent zoom speed.
// Agent: READS WheelEvent.deltaMode; RETURNS normalized deltaY for clampZoom step sizing.
function normalizeWheelDelta(event: WheelEvent): number {
  if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) {
    return event.deltaY * 16;
  }
  if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
    return event.deltaY * 800;
  }
  return event.deltaY;
}

export function PdfPreviewDialog({ file, open, onOpenChange }: PdfPreviewDialogProps) {
  const [pdfData, setPdfData] = useState<ArrayBuffer | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [numPages, setNumPages] = useState(0);
  const [pageNumber, setPageNumber] = useState(1);
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const [pageWidth, setPageWidth] = useState<number | undefined>(undefined);
  const [viewportNode, setViewportNode] = useState<HTMLDivElement | null>(null);
  const activeFileIdRef = useRef<string | null>(null);

  // Human: Callback ref so wheel/resize listeners attach after the dialog portal mounts the pane.
  // Agent: WRITES viewportNode state when the scroll pane DOM node appears or unmounts.
  const viewportRef = useCallback((node: HTMLDivElement | null) => {
    setViewportNode(node);
  }, []);

  // Human: Reset viewer state when switching files or reopening the dialog.
  // Agent: CLEARS pdfData, page index, zoom; FETCH effect loads bytes for the active file id.
  useEffect(() => {
    setPdfData(null);
    setError("");
    setNumPages(0);
    setPageNumber(1);
    setZoom(DEFAULT_ZOOM);
  }, [file?.id]);

  // Human: Fit pages to the dialog width on resize — zoom multiplier applies on top of fit width.
  // Agent: READS viewportNode clientWidth via ResizeObserver; WRITES pageWidth for react-pdf Page.
  useLayoutEffect(() => {
    if (!open || !viewportNode) return;

    const updateWidth = () => {
      const nextWidth = Math.max(viewportNode.clientWidth - 32, 320);
      setPageWidth(nextWidth);
    };

    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(viewportNode);
    return () => observer.disconnect();
  }, [open, viewportNode]);

  // Human: Load PDF bytes through the authenticated download path used by image preview.
  // Agent: FETCHES fetchFileBlobForPreview; WRITES ArrayBuffer only when activeFileIdRef still matches.
  useEffect(() => {
    if (!open || !file?.id) return;

    activeFileIdRef.current = file.id;
    const requestFileId = file.id;

    let cancelled = false;
    setLoading(true);
    setError("");

    void fetchFileBlobForPreview(file)
      .then(async (blob) => {
        if (cancelled) return;
        const buffer = await blob.arrayBuffer();
        if (cancelled || activeFileIdRef.current !== requestFileId) return;
        setPdfData(buffer);
      })
      .catch((err) => {
        if (cancelled || activeFileIdRef.current !== requestFileId) return;
        setError(getErrorMessage(err));
      })
      .finally(() => {
        if (cancelled || activeFileIdRef.current !== requestFileId) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, file]);

  const hasPrevious = pageNumber > 1;
  const hasNext = numPages > 0 && pageNumber < numPages;

  const goPrevious = useCallback(() => {
    setPageNumber((current) => Math.max(1, current - 1));
  }, []);

  const goNext = useCallback(() => {
    setPageNumber((current) => (numPages > 0 ? Math.min(numPages, current + 1) : current));
  }, [numPages]);

  const zoomIn = useCallback(() => {
    setZoom((current) => clampZoom(current + ZOOM_STEP));
  }, []);

  const zoomOut = useCallback(() => {
    setZoom((current) => clampZoom(current - ZOOM_STEP));
  }, []);

  // Human: Ctrl+wheel zooms; plain wheel scrolls the page pane when content overflows.
  // Agent: LISTENS wheel on viewportNode; preventDefault ONLY when event.ctrlKey is set.
  const applyWheelZoom = useCallback((deltaY: number) => {
    const direction = deltaY < 0 ? 1 : -1;
    const step = Math.min(
      WHEEL_ZOOM_MAX,
      Math.max(WHEEL_ZOOM_MIN, Math.abs(deltaY) * WHEEL_ZOOM_SCALE),
    );
    setZoom((current) => clampZoom(current + direction * step));
  }, []);

  const goPreviousRef = useRef(goPrevious);
  const goNextRef = useRef(goNext);
  const zoomInRef = useRef(zoomIn);
  const zoomOutRef = useRef(zoomOut);

  useEffect(() => {
    goPreviousRef.current = goPrevious;
    goNextRef.current = goNext;
    zoomInRef.current = zoomIn;
    zoomOutRef.current = zoomOut;
  }, [goPrevious, goNext, zoomIn, zoomOut]);

  // Human: Keyboard shortcuts for page turns and zoom while the dialog has focus.
  // Agent: LISTENS document keydown capture; PREVENTS default for handled keys.
  useEffect(() => {
    if (!open) return;

    function handleDocumentKeyDown(event: globalThis.KeyboardEvent) {
      if (event.isComposing) return;
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        event.stopPropagation();
        goPreviousRef.current();
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        event.stopPropagation();
        goNextRef.current();
      } else if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        zoomInRef.current();
      } else if (event.key === "-") {
        event.preventDefault();
        zoomOutRef.current();
      }
    }

    document.addEventListener("keydown", handleDocumentKeyDown, true);
    return () => document.removeEventListener("keydown", handleDocumentKeyDown, true);
  }, [open]);

  useEffect(() => {
    if (!open || !viewportNode) return;

    function handleWheel(event: WheelEvent) {
      if (!event.ctrlKey) return;
      event.preventDefault();
      event.stopPropagation();
      applyWheelZoom(normalizeWheelDelta(event));
    }

    viewportNode.addEventListener("wheel", handleWheel, { passive: false });
    return () => viewportNode.removeEventListener("wheel", handleWheel);
  }, [open, viewportNode, applyWheelZoom]);

  const handleContentKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      goPrevious();
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      goNext();
    }
  };

  const positionLabel = numPages > 0 ? `Page ${pageNumber} of ${numPages}` : null;
  const scaledWidth = pageWidth ? Math.round(pageWidth * zoom) : undefined;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "flex w-[min(84rem,calc(100vw-2rem))] max-w-[calc(100vw-2rem)] flex-col gap-0 overflow-hidden p-0",
          "h-[95vh] max-h-[95vh] sm:max-w-[min(84rem,calc(100vw-2rem))]",
        )}
        style={{
          display: "flex",
          flexDirection: "column",
          width: "min(84rem, calc(100vw - 2rem))",
          maxWidth: "min(84rem, calc(100vw - 2rem))",
          height: "95vh",
          maxHeight: "95vh",
        }}
        onKeyDown={handleContentKeyDown}
      >
        <DialogHeader className="shrink-0 gap-1 border-b px-4 py-3 pr-12">
          <DialogTitle className="truncate">{file?.name ?? "PDF preview"}</DialogTitle>
          <DialogDescription>
            {positionLabel
              ? `${positionLabel} — Ctrl+scroll zooms; scroll pans; arrow keys turn pages.`
              : "View PDF pages in the browser. Editing will be added in a later release."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex shrink-0 items-center justify-between gap-2 border-b px-4 py-2">
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              disabled={!hasPrevious}
              onClick={goPrevious}
              aria-label="Previous page"
            >
              <ChevronLeft className="size-4" />
            </Button>
            <span className="min-w-[7rem] text-center text-sm text-neutral-600">
              {positionLabel ?? "—"}
            </span>
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              disabled={!hasNext}
              onClick={goNext}
              aria-label="Next page"
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>

          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              disabled={zoom <= MIN_ZOOM}
              onClick={zoomOut}
              aria-label="Zoom out"
            >
              <ZoomOut className="size-4" />
            </Button>
            <span className="min-w-[3.5rem] text-center text-sm text-neutral-600">
              {Math.round(zoom * 1000) / 10}%
            </span>
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              disabled={zoom >= MAX_ZOOM}
              onClick={zoomIn}
              aria-label="Zoom in"
            >
              <ZoomIn className="size-4" />
            </Button>
          </div>
        </div>

        <div
          ref={viewportRef}
          tabIndex={-1}
          className="relative min-h-0 flex-1 overflow-auto bg-neutral-100 px-4 py-6 outline-none"
        >
          {error ? (
            <p className="text-destructive px-4 text-center text-sm" role="alert">
              {error}
            </p>
          ) : null}

          {pdfData ? (
            // Human: Viewer shell — future edit mode can mount annotation tools above this canvas stack.
            // Agent: RENDERS react-pdf layers; onLoadSuccess SETS numPages; Page WRITES canvas + text layer.
            <div className="mx-auto flex w-fit flex-col items-center">
              <Document
                file={pdfData}
                loading={
                  <div className="flex items-center gap-2 py-12 text-sm text-neutral-600">
                    <Loader2 className="size-5 animate-spin" aria-hidden />
                    Rendering PDF…
                  </div>
                }
                onLoadSuccess={({ numPages: loadedPages }) => {
                  setNumPages(loadedPages);
                  setPageNumber((current) => Math.min(current, loadedPages));
                }}
                onLoadError={(loadError) => {
                  setError(loadError.message || "Could not open this PDF.");
                }}
                className="flex flex-col items-center"
              >
                <Page
                  pageNumber={pageNumber}
                  width={scaledWidth}
                  renderAnnotationLayer
                  renderTextLayer
                  loading={
                    <div className="flex min-h-[40vh] items-center justify-center">
                      <Loader2 className="size-6 animate-spin text-neutral-500" aria-hidden />
                    </div>
                  }
                  className={cn("shadow-md", loading && "opacity-70")}
                />
              </Document>
            </div>
          ) : null}

          {loading && !pdfData ? (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-neutral-100 text-sm text-neutral-600">
              <Loader2 className="size-6 animate-spin" aria-hidden />
              <span className="sr-only">Loading PDF…</span>
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
