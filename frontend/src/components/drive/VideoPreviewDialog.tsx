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

export function VideoPreviewDialog({ file, open, onOpenChange }: VideoPreviewDialogProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
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
        const normalized = res.url.startsWith("http")
          ? res.url
          : res.url.startsWith("/")
            ? res.url
            : `/${res.url}`;
        setStreamUrl(normalized);
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

    let hls: Hls | null = null;

    if (streamUrl.includes("/playlist")) {
      if (Hls.isSupported()) {
        hls = new Hls({
          enableWorker: true,
          xhrSetup: (xhr) => {
            const token = getToken();
            if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
          },
        });
        hls.loadSource(streamUrl);
        hls.attachMedia(video);
        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (data.fatal) {
            setError("Playback failed. Try again later.");
          }
        });
      } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = streamUrl;
      } else {
        setError("This browser cannot play HLS video.");
      }
    } else {
      video.src = streamUrl;
    }

    return () => {
      if (hls) hls.destroy();
      video.removeAttribute("src");
      video.load();
    };
  }, [streamUrl, open]);

  const failed = file?.hls_encode_status === "failed";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-full max-w-[calc(100%-2rem)] gap-4 overflow-hidden sm:max-w-2xl">
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
          />
          {loadingStream ? (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/40 text-sm text-white">
              Loading stream…
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
