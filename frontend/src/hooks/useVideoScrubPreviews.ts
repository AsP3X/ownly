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

// Human: Delay storyboard JPEG fetches so opening a video does not compete with HLS startup.
// Agent: APPLIED after the thumbnail manifest (captions_ready) returns; CANCELLED on unmount.
const SCRUB_FETCH_DEFER_MS = 2000;

// Human: Parallelism for seek-bar preview JPEGs after playback has had a chance to start.
// Agent: BATCH size for Promise.all over scrub/poster sources.
const SCRUB_FETCH_CONCURRENCY = 3;

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

        // Human: Storyboard JPEGs wait so playlist/init/first-segment win the connection budget.
        // Agent: DELAY SCRUB_FETCH_DEFER_MS; CHECK cancelled; THEN fetch with SCRUB_FETCH_CONCURRENCY.
        await new Promise<void>((resolve) => {
          window.setTimeout(resolve, SCRUB_FETCH_DEFER_MS);
        });
        if (cancelled) return;

        const loaded: ScrubPreviewFrame[] = [];
        for (let offset = 0; offset < sources.length; offset += SCRUB_FETCH_CONCURRENCY) {
          if (cancelled) return;
          const batch = sources.slice(offset, offset + SCRUB_FETCH_CONCURRENCY);
          const batchResults = await Promise.all(
            batch.map(async (source) => {
              try {
                const blob =
                  source.kind === "scrub"
                    ? await fetchFileScrubFrameBlob(file.id, source.index)
                    : await fetchFileThumbnailBlob(file.id, source.index);
                return {
                  timestampSeconds: source.timestampSeconds,
                  blob,
                };
              } catch {
                return null;
              }
            }),
          );
          if (cancelled) return;
          for (const result of batchResults) {
            if (!result) continue;
            const url = URL.createObjectURL(result.blob);
            objectUrls.push(url);
            loaded.push({
              timestampSeconds: result.timestampSeconds,
              imageUrl: url,
            });
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
