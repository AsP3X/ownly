// Human: Inline PDF viewer for single-file public shares — Pencil PDF Preview variant (toolbar + scroll).
// Agent: FETCHES fetchPublicShareBlobForPreview; RENDERS react-pdf Document; READS pdf-viewer worker setup.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { FileText, Loader2, Printer, ZoomIn, ZoomOut } from "lucide-react";
import { Document, Page } from "react-pdf";
import type { FileItem } from "@/api/client";
import { fetchPublicShareBlobForPreview, getErrorMessage } from "@/api/client";
import { createPdfBlobObjectUrl, revokePdfBlobObjectUrl } from "@/lib/pdf-document-source";
import "@/lib/pdf-viewer";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

type PublicShareInlinePdfProps = {
  token: string;
  file: FileItem;
  sharePassword: string | null;
};

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2;
const ZOOM_STEP = 0.25;
const DEFAULT_ZOOM = 0.85;

function clampZoom(value: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number(value.toFixed(3))));
}

export function PublicShareInlinePdf({ token, file, sharePassword }: PublicShareInlinePdfProps) {
  const [pdfObjectUrl, setPdfObjectUrl] = useState<string | null>(null);
  const pdfObjectUrlRef = useRef<string | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [numPages, setNumPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const [pageWidth, setPageWidth] = useState<number | undefined>(undefined);
  const [viewportNode, setViewportNode] = useState<HTMLDivElement | null>(null);

  const viewportRef = useCallback((node: HTMLDivElement | null) => {
    setViewportNode(node);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    revokePdfBlobObjectUrl(pdfObjectUrlRef.current);
    pdfObjectUrlRef.current = null;
    setPdfObjectUrl(null);
    setNumPages(0);
    setCurrentPage(1);
    setZoom(DEFAULT_ZOOM);
    void fetchPublicShareBlobForPreview(token, file.id, sharePassword)
      .then((blob) => {
        if (cancelled) return;
        const url = createPdfBlobObjectUrl(blob);
        pdfObjectUrlRef.current = url;
        setPdfObjectUrl(url);
      })
      .catch((e) => {
        if (!cancelled) setError(getErrorMessage(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      revokePdfBlobObjectUrl(pdfObjectUrlRef.current);
      pdfObjectUrlRef.current = null;
    };
  }, [token, file.id, sharePassword]);

  useLayoutEffect(() => {
    if (!viewportNode) return;
    const updateWidth = () => {
      setPageWidth(Math.max(viewportNode.clientWidth - 48, 280));
    };
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(viewportNode);
    return () => observer.disconnect();
  }, [viewportNode]);

  return (
    <div className="flex max-h-[min(850px,calc(100vh-12rem))] flex-col overflow-hidden rounded-2xl border border-[#E5E7EB] bg-white shadow-[0_12px_32px_#00000014]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E5E7EB] px-4 py-3 sm:px-5">
        <div className="flex min-w-0 items-center gap-2">
          <FileText className="size-4 shrink-0 text-[#EF4444]" aria-hidden />
          <p className="truncate text-sm font-semibold text-[#1A1A1A]">{file.name}</p>
          <span className="rounded-md bg-[#F0FDF4] px-2 py-0.5 text-[10px] font-semibold text-[#166534]">
            Verified
          </span>
        </div>
        <div className="flex items-center gap-2 text-sm text-[#666666]">
          <span>
            {numPages > 0 ? `${currentPage} of ${numPages}` : "—"}
          </span>
          <button
            type="button"
            className="flex size-8 items-center justify-center rounded-lg border border-[#E5E7EB] bg-white hover:bg-[#F7F8FA]"
            onClick={() => setZoom((z) => clampZoom(z - ZOOM_STEP))}
            aria-label="Zoom out"
          >
            <ZoomOut className="size-4" />
          </button>
          <span className="min-w-[3rem] text-center font-semibold text-[#1A1A1A]">
            {Math.round(zoom * 100)}%
          </span>
          <button
            type="button"
            className="flex size-8 items-center justify-center rounded-lg border border-[#E5E7EB] bg-white hover:bg-[#F7F8FA]"
            onClick={() => setZoom((z) => clampZoom(z + ZOOM_STEP))}
            aria-label="Zoom in"
          >
            <ZoomIn className="size-4" />
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#2563EB] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#1d4ed8]"
            onClick={() => window.print()}
          >
            <Printer className="size-3.5" />
            Print
          </button>
        </div>
      </div>

      <div
        ref={viewportRef}
        className="relative flex-1 overflow-auto bg-[#1e293b] p-4"
        onScroll={(event) => {
          const container = event.currentTarget;
          const pages = container.querySelectorAll("[data-pdf-page]");
          const mid = container.scrollTop + container.clientHeight / 2;
          for (let i = 0; i < pages.length; i++) {
            const page = pages[i] as HTMLElement;
            if (page.offsetTop <= mid && page.offsetTop + page.offsetHeight > mid) {
              setCurrentPage(i + 1);
              break;
            }
          }
        }}
      >
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-24 text-sm text-white/80">
            <Loader2 className="size-5 animate-spin" />
            Loading PDF…
          </div>
        ) : null}
        {error ? <p className="py-12 text-center text-sm text-red-300">{error}</p> : null}
        {pdfObjectUrl && !error ? (
          <Document
            file={pdfObjectUrl}
            onLoadSuccess={({ numPages: total }) => setNumPages(total)}
            loading={null}
            className="mx-auto flex flex-col items-center gap-4"
          >
            {Array.from({ length: numPages }, (_, index) => (
              <div key={index + 1} data-pdf-page className="shadow-lg">
                <Page pageNumber={index + 1} width={pageWidth ? pageWidth * zoom : undefined} />
              </div>
            ))}
          </Document>
        ) : null}
      </div>
    </div>
  );
}
