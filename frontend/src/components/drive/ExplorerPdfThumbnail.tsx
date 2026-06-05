// Human: Grid tile PDF preview for DriveCloudExplorer — lazy-rendered first page above file metadata.
// Agent: LAZY-FETCHES fetchFileBlobForPreview when visible; RENDERS react-pdf Page 1; FALLBACK icon on error.

import { useEffect, useRef, useState } from "react";
import { FileText, Loader2 } from "lucide-react";
import { Document, Page } from "react-pdf";
import type { FileItem } from "@/api/client";
import { fetchFileBlobForPreview } from "@/api/client";
import "@/lib/pdf-viewer";
import { cn } from "@/lib/utils";

type ExplorerPdfThumbnailProps = {
  file: FileItem;
  className?: string;
};

/** Human: Lazy-loaded first-page preview for explorer PDF grid tiles. */
export function ExplorerPdfThumbnail({ file, className }: ExplorerPdfThumbnailProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [pageWidth, setPageWidth] = useState(0);
  const [pdfData, setPdfData] = useState<ArrayBuffer | null>(null);
  const [failed, setFailed] = useState(false);

  // Human: Scale the rendered page to the tile width so the top of the document fills the preview frame.
  // Agent: ResizeObserver READS container width; WRITES pageWidth for react-pdf Page.
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    const updateWidth = () => {
      const width = element.clientWidth;
      if (width > 0) setPageWidth(Math.round(width));
    };

    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Human: Defer PDF fetch until the tile nears the viewport — avoids N+1 downloads for off-screen rows.
  // Agent: IntersectionObserver with rootMargin; WRITES visible true once; DISCONNECTS after first intersect.
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        setVisible(true);
        observer.disconnect();
      },
      { rootMargin: "240px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Human: Load PDF bytes once the tile is visible, then hand them to react-pdf for page-one rendering.
  // Agent: CALLS fetchFileBlobForPreview; WRITES ArrayBuffer; CLEARS state on file change or unmount.
  useEffect(() => {
    if (!visible) return;

    let cancelled = false;
    setFailed(false);
    setPdfData(null);

    void fetchFileBlobForPreview(file)
      .then(async (blob) => {
        if (cancelled) return;
        const buffer = await blob.arrayBuffer();
        if (cancelled) return;
        setPdfData(buffer);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, [visible, file.id]);

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative w-full overflow-hidden rounded-lg bg-[#F3F4F6]",
        "aspect-[4/3]",
        className,
      )}
    >
      {failed ? (
        <div className="flex size-full items-center justify-center">
          <FileText className="size-8 text-[#2563EB]" aria-hidden />
        </div>
      ) : pdfData && pageWidth > 0 ? (
        // Human: Top-aligned page — overflow clips the bottom so the tile shows the document header area.
        // Agent: items-start + overflow-hidden on ancestors; Page width matches tile for full-bleed width.
        <div className="flex size-full items-start justify-center overflow-hidden bg-white">
          <Document
            file={pdfData}
            loading={
              <div className="flex size-full items-center justify-center">
                <Loader2 className="size-5 animate-spin text-[#888888]" aria-hidden />
              </div>
            }
            onLoadError={() => setFailed(true)}
            className="w-full"
          >
            <Page
              pageNumber={1}
              width={pageWidth}
              renderAnnotationLayer={false}
              renderTextLayer={false}
              loading={
                <div className="flex size-full items-center justify-center">
                  <Loader2 className="size-5 animate-spin text-[#888888]" aria-hidden />
                </div>
              }
              className="[&_canvas]:h-auto [&_canvas]:w-full"
            />
          </Document>
        </div>
      ) : (
        <div className="flex size-full items-center justify-center">
          <Loader2 className="size-5 animate-spin text-[#888888]" aria-hidden />
        </div>
      )}
    </div>
  );
}
