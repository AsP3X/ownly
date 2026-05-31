// Human: Inline audio card for single-file public shares — Pencil mobile card + desktop Audio Player Core.
// Agent: FETCHES stream URL; RENDERS MobileAudioPlayerCard below lg, LightAudioPlayer default on desktop.

import { useCallback, useEffect, useRef, useState } from "react";
import { PublicShareMobileActionStack } from "@/components/public-share/PublicShareMobileActionStack";
import { PublicShareSecurityBadge } from "@/components/public-share/PublicShareSecurityBadge";
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
          <PublicShareMobileActionStack
            downloadLabel={downloadLabel}
            onDownload={onDownload}
            onSave={onSave}
            downloadDisabled={downloadDisabled}
            downloadLoading={downloadLoading}
            saveDisabled={saveDisabled}
            saveLoading={saveLoading}
          />
        ) : null}

        <PublicShareSecurityBadge variant="row" />
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
