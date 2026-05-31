// Human: Inline image preview for single-file public shares — Pencil Image Preview variant (main column).
// Agent: FETCHES fetchPublicShareBlobForPreview; REVOKES object URLs on unmount; RENDERS zoom toolbar chrome.

import { useEffect, useRef, useState } from "react";
import { Download, ImageIcon, Loader2, Minus, Plus } from "lucide-react";
import type { FileItem } from "@/api/client";
import { fetchPublicShareBlobForPreview, getErrorMessage } from "@/api/client";
import { cn } from "@/lib/utils";

type PublicShareInlineImageProps = {
  token: string;
  file: FileItem;
  sharePassword: string | null;
  onDownload?: () => void;
  downloadDisabled?: boolean;
};

export function PublicShareInlineImage({
  token,
  file,
  sharePassword,
  onDownload,
  downloadDisabled,
}: PublicShareInlineImageProps) {
  const [displayUrl, setDisplayUrl] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [zoom, setZoom] = useState(1);
  const objectUrlRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    void fetchPublicShareBlobForPreview(token, file.id, sharePassword)
      .then((blob) => {
        if (cancelled) return;
        if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
        const url = URL.createObjectURL(blob);
        objectUrlRef.current = url;
        setDisplayUrl(url);
      })
      .catch((e) => {
        if (!cancelled) setError(getErrorMessage(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };
  }, [token, file.id, sharePassword]);

  return (
    <div className="overflow-hidden rounded-2xl border border-[#E5E7EB] bg-white shadow-[0_12px_32px_#00000014]">
      <div className="flex items-center justify-between gap-3 border-b border-[#E5E7EB] bg-[#111118] px-4 py-3 text-white sm:px-5">
        <div className="flex min-w-0 items-center gap-2">
          <ImageIcon className="size-4 shrink-0 text-[#93C5FD]" aria-hidden />
          <p className="truncate text-sm font-semibold">{file.name}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            className="flex size-8 items-center justify-center rounded-lg bg-white/10 text-white transition-colors hover:bg-white/20"
            onClick={() => setZoom((z) => Math.max(0.5, Number((z - 0.25).toFixed(2))))}
            aria-label="Zoom out"
          >
            <Minus className="size-4" />
          </button>
          <button
            type="button"
            className="flex size-8 items-center justify-center rounded-lg bg-white/10 text-white transition-colors hover:bg-white/20"
            onClick={() => setZoom((z) => Math.min(3, Number((z + 0.25).toFixed(2))))}
            aria-label="Zoom in"
          >
            <Plus className="size-4" />
          </button>
          {onDownload ? (
            <button
              type="button"
              disabled={downloadDisabled}
              onClick={onDownload}
              className="hidden items-center gap-1.5 rounded-lg bg-[#2563EB] px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[#1d4ed8] disabled:opacity-60 lg:inline-flex"
            >
              <Download className="size-3.5" />
              Download
            </button>
          ) : null}
        </div>
      </div>

      <div className="relative flex min-h-[320px] items-center justify-center bg-[#111118] p-4 sm:min-h-[480px]">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-white/80">
            <Loader2 className="size-5 animate-spin" />
            Loading image…
          </div>
        ) : null}
        {error ? <p className="text-sm text-red-300">{error}</p> : null}
        {displayUrl && !error ? (
          <img
            src={displayUrl}
            alt={file.name}
            className={cn("max-h-[70vh] max-w-full object-contain transition-transform duration-200")}
            style={{ transform: `scale(${zoom})` }}
          />
        ) : null}
      </div>
    </div>
  );
}
