// Human: Grid tile PDF preview for DriveCloudExplorer — lazy-rendered first page above file metadata.
// Agent: LAZY-FETCHES fetchFileBlobForPreview when visible; RENDERS react-pdf Page 1; FALLBACK icon on error.

import { useEffect, useRef, useState } from "react";
import { FileText, Loader2 } from "lucide-react";
import { Document, Page } from "react-pdf";
import type { FileItem } from "@/api/client";
import { fetchFileBlobForPreview } from "@/api/client";
import "@/lib/pdf-viewer";
import { cn } from "@/lib/utils";

// Human: Render width for the first page — sized for explorer grid tiles (4:3 frame).
const THUMBNAIL_PAGE_WIDTH = 140;

type ExplorerPdfThumbnailProps = {
  file: FileItem;
  className?: string;
};

/** Human: Lazy-loaded first-page preview for explorer PDF grid tiles. */
export function ExplorerPdfThumbnail({ file, className }: ExplorerPdfThumbnailProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [pdfData, setPdfData] = useState<ArrayBuffer | null>(null);
  const [failed, setFailed] = useState(false);

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
      ) : pdfData ? (
        <div className="flex size-full items-center justify-center bg-white">
          <Document
            file={pdfData}
            loading={
              <div className="flex size-full items-center justify-center">
                <Loader2 className="size-5 animate-spin text-[#888888]" aria-hidden />
              </div>
            }
            onLoadError={() => setFailed(true)}
            className="flex max-h-full max-w-full items-center justify-center"
          >
            <Page
              pageNumber={1}
              width={THUMBNAIL_PAGE_WIDTH}
              renderAnnotationLayer={false}
              renderTextLayer={false}
              loading={
                <div className="flex size-full items-center justify-center">
                  <Loader2 className="size-5 animate-spin text-[#888888]" aria-hidden />
                </div>
              }
              className="max-h-full [&_canvas]:max-h-full [&_canvas]:w-auto"
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
