// Human: In-browser video preview via HLS — files are HLS-ready as soon as upload completes.
// Agent: READS fetchVideoStreamUrl; USES hls.js + Authorization on XHR; RENDERS Dialog + video.

import { useEffect, useRef, useState } from "react";
import Hls from "hls.js";
import type { FileItem } from "@/api/client";
import { fetchVideoStreamUrl, getErrorMessage } from "@/api/client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type VideoPreviewDialogProps = {
  file: FileItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

function getToken(): string | null {
  return localStorage.getItem("mediavault_token");
}

// Human: Resolve playlist/segment URLs against the site origin for hls.js XHR loads.
// Agent: RETURNS absolute href; CALLS window.location.origin for relative `/api/v1/...` paths.
function resolveStreamUrl(url: string): string {
  if (url.startsWith("http")) return url;
  const path = url.startsWith("/") ? url : `/${url}`;
  return new URL(path, window.location.origin).href;
}

// Human: Configure hls.js for on-demand AES-128 HLS (not live LL-HLS).
// Agent: lowLatencyMode false; backBufferLength caps MSE memory; xhrSetup adds Bearer token.
function createHlsInstance(): Hls {
  return new Hls({
    enableWorker: true,
    lowLatencyMode: false,
    backBufferLength: 90,
    maxBufferHole: 0.5,
    xhrSetup: (xhr) => {
      const token = getToken();
      if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    },
  });
}

export function VideoPreviewDialog({ file, open, onOpenChange }: VideoPreviewDialogProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const [streamUrl, setStreamUrl] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [loadingStream, setLoadingStream] = useState(false);

  useEffect(() => {
    setStreamUrl(null);
    setError("");
  }, [file?.id]);

  useEffect(() => {
    if (!open || !file?.id || !file.hls_ready) {
      setStreamUrl(null);
      return;
    }

    let cancelled = false;
    setLoadingStream(true);
    setError("");

    void fetchVideoStreamUrl(file.id)
      .then((res) => {
        if (cancelled) return;
        if (!res.url) {
          setError(res.hls_encode_error ?? "Video is not ready for playback.");
          setStreamUrl(null);
          return;
        }
        setStreamUrl(resolveStreamUrl(res.url));
      })
      .catch((e) => {
        if (!cancelled) setError(getErrorMessage(e));
      })
      .finally(() => {
        if (!cancelled) setLoadingStream(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, file?.id, file?.hls_ready]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !streamUrl || !open) return;

    let disposed = false;

    const destroyHls = () => {
      hlsRef.current?.destroy();
      hlsRef.current = null;
    };

    const failPlayback = (message: string) => {
      if (!disposed) setError(message);
      destroyHls();
      video.removeAttribute("src");
      video.load();
    };

    destroyHls();

    if (streamUrl.includes("/playlist") && Hls.isSupported()) {
      const hls = createHlsInstance();
      hlsRef.current = hls;
      hls.loadSource(streamUrl);
      hls.attachMedia(video);

      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal || disposed) return;
        switch (data.type) {
          case Hls.ErrorTypes.NETWORK_ERROR:
            hls.startLoad();
            break;
          case Hls.ErrorTypes.MEDIA_ERROR:
            hls.recoverMediaError();
            break;
          default:
            failPlayback("Playback failed. Try again later.");
            break;
        }
      });

      return () => {
        disposed = true;
        destroyHls();
        video.removeAttribute("src");
        video.load();
      };
    }

    if (streamUrl.includes("/playlist") && video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = streamUrl;
      return () => {
        disposed = true;
        video.removeAttribute("src");
        video.load();
      };
    }

    if (streamUrl.includes("/playlist")) {
      failPlayback("This browser cannot play HLS video.");
      return;
    }

    video.src = streamUrl;
    return () => {
      disposed = true;
      video.removeAttribute("src");
      video.load();
    };
  }, [streamUrl, open]);

  const failed = file?.hls_encode_status === "failed";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Human: Wide modal so the 16:9 player is roughly twice the default dialog width. */}
      {/* Agent: sm:max-w-[84rem] doubles prior sm:max-w-2xl (42rem); still capped by viewport gutter. */}
      <DialogContent className="w-full max-w-[calc(100%-2rem)] gap-4 overflow-hidden sm:max-w-[84rem]">
        <DialogHeader className="min-w-0 pr-8">
          <DialogTitle className="truncate">{file?.name ?? "Video preview"}</DialogTitle>
          <DialogDescription>
            {failed
              ? (file.hls_encode_error ?? "Video processing failed.")
              : "Streamed with encrypted HLS segments."}
          </DialogDescription>
        </DialogHeader>

        {error ? (
          <p className="text-destructive text-sm" role="alert">
            {error}
          </p>
        ) : null}

        <div className="relative aspect-video w-full max-w-full min-w-0 overflow-hidden rounded-lg bg-black">
          <video
            ref={videoRef}
            className="size-full max-h-full max-w-full object-contain"
            controls
            playsInline
            preload="metadata"
          />
          {loadingStream ? (
            <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-black/40 text-sm text-white">
              Loading stream…
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
