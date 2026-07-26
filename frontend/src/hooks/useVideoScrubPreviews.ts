// Human: Load seek-bar scrub storyboard (or poster fallbacks) as object URLs for hover previews.
// Agent: FETCHES manifest + JPEG blobs when video_thumbnail_ready; REVOKES URLs on cleanup.

import { useEffect, useMemo, useState } from "react";
import type { FileItem } from "@/api/client";
import {
  fetchFileScrubFrameBlob,
  fetchFileThumbnailBlob,
  fetchFileThumbnails,
} from "@/api/client";

export type ScrubPreviewFrame = {
  timestampSeconds: number;
  imageUrl: string;
};

type UseVideoScrubPreviewsOptions = {
  file: FileItem;
  /** Human: Skip network work for public-share previews (no scrub API yet). */
  enabled?: boolean;
};

// Human: Pick the scrub frame nearest to a hover time for the seek tooltip.
// Agent: LINEAR scan of sorted frames; RETURNS null when ladder empty.
export function findNearestScrubFrame(
  frames: ScrubPreviewFrame[],
  timeSeconds: number,
): ScrubPreviewFrame | null {
  if (frames.length === 0) return null;
  let best = frames[0]!;
  let bestDelta = Math.abs(best.timestampSeconds - timeSeconds);
  for (let i = 1; i < frames.length; i++) {
    const frame = frames[i]!;
    const delta = Math.abs(frame.timestampSeconds - timeSeconds);
    if (delta < bestDelta) {
      best = frame;
      bestDelta = delta;
    }
  }
  return best;
}

// Human: Prefetch scrub ladder for the open video preview.
// Agent: PREFERS scrub_frames; FALLS BACK to poster options; CLEANS object URLs.
export function useVideoScrubPreviews({
  file,
  enabled = true,
}: UseVideoScrubPreviewsOptions): {
  frames: ScrubPreviewFrame[];
  captionsReady: boolean;
} {
  const [frames, setFrames] = useState<ScrubPreviewFrame[]>([]);
  const [captionsReady, setCaptionsReady] = useState(false);

  const canLoad = enabled && Boolean(file.id) && Boolean(file.video_thumbnail_ready);

  useEffect(() => {
    if (!canLoad) {
      setFrames([]);
      setCaptionsReady(false);
      return;
    }

    let cancelled = false;
    const objectUrls: string[] = [];

    void (async () => {
      try {
        const manifest = await fetchFileThumbnails(file.id);
        if (cancelled) return;

        setCaptionsReady(Boolean(manifest.captions_ready));

        const scrub = manifest.scrub_frames ?? [];
        const sources =
          scrub.length > 0
            ? scrub.map((frame) => ({
                index: frame.index,
                timestampSeconds: frame.timestamp_seconds,
                kind: "scrub" as const,
              }))
            : manifest.options.map((option) => ({
                index: option.index,
                timestampSeconds: option.timestamp_seconds,
                kind: "poster" as const,
              }));

        if (sources.length === 0) {
          setFrames([]);
          return;
        }

        // Human: Cap concurrent fetches so opening a long video does not stampede the API.
        // Agent: SEQUENTIAL blob fetch; BUILDS object URLs.
        const loaded: ScrubPreviewFrame[] = [];
        for (const source of sources) {
          if (cancelled) return;
          try {
            const blob =
              source.kind === "scrub"
                ? await fetchFileScrubFrameBlob(file.id, source.index)
                : await fetchFileThumbnailBlob(file.id, source.index);
            if (cancelled) return;
            const url = URL.createObjectURL(blob);
            objectUrls.push(url);
            loaded.push({
              timestampSeconds: source.timestampSeconds,
              imageUrl: url,
            });
          } catch {
            // Skip individual missing frames; keep the rest of the ladder.
          }
        }

        if (!cancelled) {
          loaded.sort((a, b) => a.timestampSeconds - b.timestampSeconds);
          setFrames(loaded);
        }
      } catch {
        if (!cancelled) {
          setFrames([]);
          setCaptionsReady(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      for (const url of objectUrls) {
        URL.revokeObjectURL(url);
      }
    };
  }, [canLoad, file.id, file.video_thumbnail_ready, file.video_thumbnail_selected_index]);

  return useMemo(
    () => ({ frames, captionsReady }),
    [frames, captionsReady],
  );
}
