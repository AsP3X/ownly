// Human: Inline audio card for single-file public shares — Pencil Audio Preview variant (main column).
// Agent: FETCHES fetchPublicShareStreamUrlForPreview; RENDERS LightAudioPlayer default variant in white card.

import { useCallback, useEffect, useRef, useState } from "react";
import type { FileItem } from "@/api/client";
import { fetchPublicShareStreamUrlForPreview, getErrorMessage } from "@/api/client";
import { LightAudioPlayer } from "@/components/drive/audio/LightAudioPlayer";

type PublicShareInlineAudioProps = {
  token: string;
  file: FileItem;
  sharePassword: string | null;
};

export function PublicShareInlineAudio({ token, file, sharePassword }: PublicShareInlineAudioProps) {
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

  return (
    <div className="rounded-2xl border border-[#E5E7EB] bg-white p-6 shadow-[0_12px_32px_#00000014] sm:p-8">
      <p className="text-lg font-bold text-[#1A1A1A]">Audio Preview</p>
      <p className="mt-1 truncate text-sm text-[#666666]">{file.name}</p>
      <div className="mt-6">
        <LightAudioPlayer
          src={audioUrl}
          title={file.name}
          mimeType={file.mime_type}
          loading={loading}
          error={error}
          variant="default"
        />
      </div>
    </div>
  );
}
