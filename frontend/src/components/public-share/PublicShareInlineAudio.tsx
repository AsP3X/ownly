// Human: Inline audio card for single-file public shares — Pencil mobile card + desktop Audio Player Core.
// Agent: FETCHES stream URL; RENDERS MobileAudioPlayerCard below lg, LightAudioPlayer default on desktop.

import { useCallback, useEffect, useRef, useState } from "react";
import { Download, FolderInput, Loader2, ShieldCheck } from "lucide-react";
import type { FileItem } from "@/api/client";
import { fetchPublicShareStreamUrlForPreview, getErrorMessage } from "@/api/client";
import { LightAudioPlayer } from "@/components/drive/audio/LightAudioPlayer";
import { MobileAudioPlayerCard } from "@/components/drive/audio/MobileAudioPlayerCard";
import { useIsDesktopPlayer } from "@/hooks/useVideoPlayerLayout";
import { audioFormatLabel, formatBytes } from "@/lib/utils-app";

type PublicShareInlineAudioProps = {
  token: string;
  file: FileItem;
  sharePassword: string | null;
  /** Human: Mobile Pencil layout — stacked download/save actions below the player card. */
  onDownload?: () => void;
  onSave?: () => void;
  downloadDisabled?: boolean;
  downloadLoading?: boolean;
  saveDisabled?: boolean;
  saveLoading?: boolean;
  showMobileActions?: boolean;
};

export function PublicShareInlineAudio({
  token,
  file,
  sharePassword,
  onDownload,
  onSave,
  downloadDisabled,
  downloadLoading,
  saveDisabled,
  saveLoading,
  showMobileActions = false,
}: PublicShareInlineAudioProps) {
  const isDesktop = useIsDesktopPlayer(true);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const revokeRef = useRef<string | null>(null);

  const clearUrl = useCallback(() => {
    if (revokeRef.current) {
      URL.revokeObjectURL(revokeRef.current);
      revokeRef.current = null;
    }
    setAudioUrl(null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    clearUrl();
    void fetchPublicShareStreamUrlForPreview(token, file, sharePassword)
      .then((entry) => {
        if (cancelled) return;
        if (entry.revokeOnClose) revokeRef.current = entry.url;
        setAudioUrl(entry.url);
      })
      .catch((e) => {
        if (!cancelled) setError(getErrorMessage(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      clearUrl();
    };
  }, [token, file, sharePassword, clearUrl]);

  const formatLabel = audioFormatLabel(file.mime_type, file.name);
  const specsLabel = `${formatLabel} • ${formatBytes(file.size_bytes)}`;
  const downloadLabel = `Download Audio (${formatBytes(file.size_bytes)})`;

  const playerProps = {
    src: audioUrl,
    title: file.name,
    mimeType: file.mime_type,
    loading,
    error,
  };

  if (!isDesktop) {
    return (
      <div className="flex flex-col gap-5">
        <MobileAudioPlayerCard specsLabel={specsLabel} {...playerProps} />

        {showMobileActions ? (
          <div className="flex flex-col gap-2.5">
            {onDownload ? (
              <button
                type="button"
                onClick={onDownload}
                disabled={downloadDisabled || downloadLoading}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-3.5 text-sm font-bold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {downloadLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <Download className="h-4 w-4 shrink-0" aria-hidden />
                )}
                {downloadLabel}
              </button>
            ) : null}
            {onSave ? (
              <button
                type="button"
                onClick={onSave}
                disabled={saveDisabled || saveLoading}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-[#E5E7EB] bg-white px-5 py-3.5 text-sm font-semibold text-[#1A1A1A] transition-colors hover:bg-[#F7F8FA] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {saveLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <FolderInput className="h-4 w-4 shrink-0" aria-hidden />
                )}
                Save to My Ownly
              </button>
            ) : null}
          </div>
        ) : null}

        <div className="flex items-center justify-center gap-1.5 py-2">
          <ShieldCheck className="h-3.5 w-3.5 text-green-600" aria-hidden />
          <span className="text-xs font-semibold text-green-600">
            Zero-Knowledge Verified Encryption
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-[#E5E7EB] bg-white p-6 shadow-[0_12px_32px_#00000014] sm:p-8">
      <p className="text-lg font-bold text-[#1A1A1A]">Audio Preview</p>
      <p className="mt-1 truncate text-sm text-[#666666]">{file.name}</p>
      <div className="mt-6">
        <LightAudioPlayer variant="default" {...playerProps} />
      </div>
    </div>
  );
}
