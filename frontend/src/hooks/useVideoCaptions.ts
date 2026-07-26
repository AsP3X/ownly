// Human: Load extracted WebVTT as a blob URL track and toggle show/hide on the video element.
// Agent: FETCHES captions when captionsReady; WRITES textTracks mode; EXPOSES toggle + c key helper.

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { fetchFileCaptionsText } from "@/api/client";

type UseVideoCaptionsOptions = {
  videoRef: RefObject<HTMLVideoElement | null>;
  fileId: string;
  captionsReady: boolean;
  enabled?: boolean;
};

// Human: Soft captions from server-extracted VTT for the active preview video.
// Agent: ATTACHES <track> via blob URL; TOGGLES first captions/subtitles track mode.
export function useVideoCaptions({
  videoRef,
  fileId,
  captionsReady,
  enabled = true,
}: UseVideoCaptionsOptions) {
  const [trackUrl, setTrackUrl] = useState<string | null>(null);
  const [captionsOn, setCaptionsOn] = useState(false);
  const [available, setAvailable] = useState(false);
  const trackUrlRef = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled || !captionsReady || !fileId) {
      setAvailable(false);
      setTrackUrl(null);
      setCaptionsOn(false);
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const text = await fetchFileCaptionsText(fileId);
        if (cancelled) return;
        const blob = new Blob([text], { type: "text/vtt" });
        const url = URL.createObjectURL(blob);
        if (trackUrlRef.current) {
          URL.revokeObjectURL(trackUrlRef.current);
        }
        trackUrlRef.current = url;
        setTrackUrl(url);
        setAvailable(true);
      } catch {
        if (!cancelled) {
          setAvailable(false);
          setTrackUrl(null);
        }
      }
    })();

    return () => {
      cancelled = true;
      if (trackUrlRef.current) {
        URL.revokeObjectURL(trackUrlRef.current);
        trackUrlRef.current = null;
      }
    };
  }, [captionsReady, enabled, fileId]);

  // Human: Apply captions visibility to the HTMLTrackElement mode list.
  // Agent: SETS textTracks[i].mode showing|hidden for captions/subtitles kinds.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !available) return;

    const apply = () => {
      const tracks = video.textTracks;
      for (let i = 0; i < tracks.length; i++) {
        const track = tracks[i];
        if (!track) continue;
        if (track.kind === "captions" || track.kind === "subtitles") {
          track.mode = captionsOn ? "showing" : "hidden";
        }
      }
    };

    apply();
    video.addEventListener("loadedmetadata", apply);
    return () => video.removeEventListener("loadedmetadata", apply);
  }, [available, captionsOn, trackUrl, videoRef]);

  const toggleCaptions = useCallback(() => {
    if (!available) return;
    setCaptionsOn((prev) => !prev);
  }, [available]);

  // Human: YouTube-style "c" toggles captions when a track is available.
  // Agent: LISTENS keydown; IGNORES editable targets.
  useEffect(() => {
    if (!available) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing || event.defaultPrevented) return;
      if (event.key.toLowerCase() !== "c") return;
      const target = event.target;
      if (target instanceof HTMLElement) {
        const tag = target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable) {
          return;
        }
      }
      event.preventDefault();
      toggleCaptions();
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [available, toggleCaptions]);

  return {
    trackUrl,
    captionsOn,
    captionsAvailable: available,
    toggleCaptions,
  };
}
