// Human: YouTube-style poster picker — scored options with large preview in editor mode.
// Agent: FETCHES fetchFileThumbnails; PATCHES selectFileThumbnail; POSTS regenerateFileThumbnails on retry.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Loader2, RefreshCw } from "lucide-react";
import type { FileItem, VideoThumbnailsResponse } from "@/api/client";
import type { UploadPhase } from "@/lib/upload-manager";
import {
  fetchFile,
  fetchFileThumbnailBlob,
  fetchFileThumbnails,
  getErrorMessage,
  regenerateFileThumbnails,
  selectFileThumbnail,
} from "@/api/client";
import { Button } from "@/components/ui/button";
import { UploadProgressBar } from "@/components/drive/upload-batch-view";
import { cn } from "@/lib/utils";

type VideoThumbnailPickerProps = {
  file: FileItem;
  /** Human: Editor dialog uses light chrome; player variant kept for reuse if needed. */
  variant?: "editor" | "player";
  onSelected?: (selectedIndex: number) => void;
  /** Human: Notifies parent when thumbnail job status changes (e.g. after regenerate). */
  onFileUpdated?: (file: FileItem) => void;
};

type OptionPreview = {
  index: number;
  url: string;
};

// Human: True while the API row reports an active thumbnail background job.
// Agent: READS video_thumbnail_status queued|processing.
function isVideoThumbnailGenerating(file: FileItem): boolean {
  const status = file.video_thumbnail_status;
  return status === "queued" || status === "processing";
}

// Human: Upload-tray phase colors for the four thumbnail worker steps.
// Agent: MAPS processing|encrypting|storing to Tailwind classes for percent + bar fill.
function thumbnailPhaseStyles(phase: UploadPhase) {
  if (phase === "storing") {
    return {
      icon: "text-emerald-600",
      percent: "text-emerald-600",
      meta: "text-emerald-600",
    };
  }
  if (phase === "encrypting") {
    return {
      icon: "text-amber-600",
      percent: "text-amber-600",
      meta: "text-amber-600",
    };
  }
  return {
    icon: "text-fuchsia-700",
    percent: "text-fuchsia-700",
    meta: "text-fuchsia-700",
  };
}

// Human: Map server percent (0–100) to the four user-facing thumbnail steps.
// Agent: READS video_thumbnail_progress + status; RETURNS UploadPhase + label for UploadProgressBar.
function mapVideoThumbnailProgress(
  progress: number | undefined,
  status: string | null | undefined,
): {
  phase: UploadPhase;
  label: string;
  percent: number;
  indeterminate: boolean;
} {
  const pct = Math.min(100, Math.max(0, progress ?? 0));
  const queued = status === "queued";

  if (queued && pct <= 0) {
    return {
      phase: "processing",
      label: "Grabbing objects",
      percent: 0,
      indeterminate: true,
    };
  }

  if (pct < 35) {
    return {
      phase: "processing",
      label: "Grabbing objects",
      percent: Math.max(pct, 5),
      indeterminate: false,
    };
  }
  if (pct < 55) {
    return {
      phase: "processing",
      label: "Converting to temp",
      percent: pct,
      indeterminate: false,
    };
  }
  if (pct < 90) {
    return {
      phase: "encrypting",
      label: "Extracting thumbnail",
      percent: pct,
      indeterminate: false,
    };
  }
  return {
    phase: "storing",
    label: "Cleaning up",
    percent: pct,
    indeterminate: false,
  };
}

// Human: Stepped progress UI while thumbnails generate — mirrors upload dialog layout.
// Agent: READS file.video_thumbnail_progress; RENDERS UploadProgressBar + step label.
function ThumbnailGenerationProgress({ file }: { file: FileItem }) {
  const step = mapVideoThumbnailProgress(
    file.video_thumbnail_progress,
    file.video_thumbnail_status,
  );
  const styles = thumbnailPhaseStyles(step.phase);
  const percentLabel = step.indeterminate ? "Working…" : `${step.percent}%`;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Loader2 className={cn("size-3 shrink-0 animate-spin", styles.icon)} aria-hidden />
          <p className="text-sm font-semibold text-neutral-700">Generating thumbnails</p>
        </div>
        <span className={cn("shrink-0 text-[13px] font-semibold tabular-nums", styles.percent)}>
          {percentLabel}
        </span>
      </div>
      <UploadProgressBar
        value={step.percent}
        phase={step.phase}
        indeterminate={step.indeterminate}
        statusLabel={step.label}
      />
      <p className={cn("text-[11px] leading-tight", styles.meta)}>{step.label}</p>
    </div>
  );
}

/** Human: Horizontal strip for choosing among auto-generated video poster frames. */
export function VideoThumbnailPicker({
  file,
  variant = "editor",
  onSelected,
  onFileUpdated,
}: VideoThumbnailPickerProps) {
  const objectUrlsRef = useRef<string[]>([]);
  const [manifest, setManifest] = useState<VideoThumbnailsResponse | null>(null);
  const [previews, setPreviews] = useState<OptionPreview[]>([]);
  const [loading, setLoading] = useState(false);
  const [savingIndex, setSavingIndex] = useState<number | null>(null);
  const [regenerating, setRegenerating] = useState(false);
  const [error, setError] = useState("");

  const revokePreviews = useCallback(() => {
    for (const url of objectUrlsRef.current) {
      URL.revokeObjectURL(url);
    }
    objectUrlsRef.current = [];
  }, []);

  // Human: Poll file row while thumbnails generate so the picker can load options when ready.
  // Agent: CALLS fetchFile on interval; STOPS when video_thumbnail_ready or failed/cancelled.
  useEffect(() => {
    if (file.video_thumbnail_ready || !isVideoThumbnailGenerating(file)) {
      return;
    }

    let cancelled = false;
    const poll = () => {
      void fetchFile(file.id)
        .then(({ file: next }) => {
          if (cancelled) return;
          onFileUpdated?.(next);
        })
        .catch(() => {
          // Human: Ignore transient poll errors — the user can retry regenerate manually.
        });
    };

    poll();
    const timer = window.setInterval(poll, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [
    file.id,
    file.video_thumbnail_ready,
    file.video_thumbnail_status,
    file.video_thumbnail_progress,
    onFileUpdated,
  ]);

  // Human: Load manifest + option JPEGs when the picker mounts or the active file changes.
  // Agent: CALLS fetchFileThumbnails + fetchFileThumbnailBlob per option; REVOKES URLs on cleanup.
  useEffect(() => {
    if (!file.video_thumbnail_ready) {
      setManifest(null);
      setPreviews([]);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError("");
    revokePreviews();
    setPreviews([]);

    void fetchFileThumbnails(file.id)
      .then(async (data) => {
        if (cancelled) return;
        setManifest(data);
        const nextPreviews: OptionPreview[] = [];
        for (const option of data.options) {
          const blob = await fetchFileThumbnailBlob(file.id, option.index);
          if (cancelled) return;
          const url = URL.createObjectURL(blob);
          objectUrlsRef.current.push(url);
          nextPreviews.push({ index: option.index, url });
        }
        if (!cancelled) setPreviews(nextPreviews);
      })
      .catch((err) => {
        if (!cancelled) setError(getErrorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      revokePreviews();
    };
  }, [file.id, file.video_thumbnail_ready, revokePreviews]);

  const handleRegenerate = useCallback(async () => {
    if (regenerating || isVideoThumbnailGenerating(file)) return;
    setRegenerating(true);
    setError("");
    try {
      const { file: updated } = await regenerateFileThumbnails(file.id);
      onFileUpdated?.(updated);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setRegenerating(false);
    }
  }, [file, onFileUpdated, regenerating]);

  const handleSelect = useCallback(
    async (index: number) => {
      if (!manifest || manifest.selected_index === index || savingIndex !== null) return;
      setSavingIndex(index);
      setError("");
      try {
        const updated = await selectFileThumbnail(file.id, index);
        setManifest(updated);
        onSelected?.(index);
      } catch (err) {
        setError(getErrorMessage(err));
      } finally {
        setSavingIndex(null);
      }
    },
    [file.id, manifest, onSelected, savingIndex],
  );

  const selectedPreview = useMemo(() => {
    if (!manifest) return null;
    return previews.find((preview) => preview.index === manifest.selected_index) ?? null;
  }, [manifest, previews]);

  const generating = isVideoThumbnailGenerating(file);
  const failed = file.video_thumbnail_status === "failed";
  const cancelled = file.video_thumbnail_status === "cancelled";

  if (!file.video_thumbnail_ready) {
    return (
      <div className="flex flex-col gap-3">
        {generating ? (
          <ThumbnailGenerationProgress file={file} />
        ) : (
          <p className="text-sm text-neutral-500">
            {failed
              ? (file.video_thumbnail_error ?? "Thumbnail generation failed.")
              : cancelled
                ? "Thumbnail generation was cancelled."
                : "Thumbnails are not available yet."}
          </p>
        )}
        {error ? (
          <p className="text-xs text-red-500" role="alert">
            {error}
          </p>
        ) : null}
        <Button
          type="button"
          variant="outline"
          className="w-fit gap-2"
          disabled={generating || regenerating}
          onClick={() => void handleRegenerate()}
        >
          {regenerating || generating ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <RefreshCw className="size-4" aria-hidden />
          )}
          {generating ? "Generating…" : "Regenerate thumbnails"}
        </Button>
      </div>
    );
  }

  const isEditor = variant === "editor";

  return (
    <div
      className={cn(
        isEditor ? "flex flex-col gap-4" : "mx-auto mt-4 w-full max-w-[1200px] rounded-2xl border border-white/10 bg-[#111118]/90 px-4 py-3 backdrop-blur-md",
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <p
          className={cn(
            "text-xs font-semibold uppercase tracking-wide",
            isEditor ? "text-neutral-500" : "text-[#E5E7EB]",
          )}
        >
          {isEditor ? "Preview" : "Choose thumbnail"}
        </p>
        {loading ? (
          <Loader2
            className={cn("size-4 animate-spin", isEditor ? "text-neutral-400" : "text-white/70")}
            aria-hidden
          />
        ) : null}
      </div>

      {error ? (
        <p className="text-xs text-red-500" role="alert">
          {error}
        </p>
      ) : null}

      {/* Human: Large preview of the active poster — primary focus in the editor dialog. */}
      {isEditor ? (
        <div className="overflow-hidden rounded-xl border border-neutral-200 bg-neutral-100">
          {selectedPreview ? (
            <img
              src={selectedPreview.url}
              alt=""
              className="aspect-video w-full object-cover"
              draggable={false}
            />
          ) : (
            <div className="flex aspect-video items-center justify-center">
              <Loader2 className="size-6 animate-spin text-neutral-400" aria-hidden />
            </div>
          )}
        </div>
      ) : null}

      <div>
        {isEditor ? (
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
            Options
          </p>
        ) : null}
        {/* Human: Horizontal scroll rail — inner w-max ensures overflow on narrow dialogs. */}
        <div
          className={cn(
            "-mx-1 overflow-x-auto overscroll-x-contain px-1 pb-2 touch-pan-x",
            isEditor && "rounded-lg border border-neutral-100 bg-neutral-50/80",
          )}
          role="listbox"
          aria-label="Thumbnail options"
        >
          <div className="flex w-max min-w-full gap-2 p-2">
          {previews.map((preview) => {
            const isSelected = manifest?.selected_index === preview.index;
            const isSaving = savingIndex === preview.index;
            return (
              <button
                key={preview.index}
                type="button"
                disabled={isSaving || savingIndex !== null}
                onClick={() => void handleSelect(preview.index)}
                aria-label={`Use thumbnail option ${preview.index + 1}`}
                aria-pressed={isSelected}
                className={cn(
                  "relative shrink-0 overflow-hidden rounded-lg border-2 transition-colors",
                  isEditor ? "h-20 w-32 sm:h-24 sm:w-40" : "h-16 w-28 sm:h-20 sm:w-36",
                  isSelected
                    ? "border-[#2563EB]"
                    : isEditor
                      ? "border-transparent hover:border-neutral-300"
                      : "border-transparent hover:border-white/30",
                )}
              >
                <img
                  src={preview.url}
                  alt=""
                  className="size-full object-cover"
                  draggable={false}
                />
                {isSelected ? (
                  <span className="absolute right-1 top-1 flex size-5 items-center justify-center rounded-full bg-[#2563EB] text-white">
                    <Check className="size-3" aria-hidden />
                  </span>
                ) : null}
                {isSaving ? (
                  <span className="absolute inset-0 flex items-center justify-center bg-black/50">
                    <Loader2 className="size-4 animate-spin text-white" aria-hidden />
                  </span>
                ) : null}
              </button>
            );
          })}
          </div>
        </div>
        {isEditor && previews.length > 1 ? (
          <p className="mt-1 text-[11px] text-neutral-400">Scroll sideways to see all options.</p>
        ) : null}
      </div>

      {isEditor ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="w-fit gap-2 text-neutral-500"
          disabled={generating || regenerating}
          onClick={() => void handleRegenerate()}
        >
          {regenerating || generating ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <RefreshCw className="size-4" aria-hidden />
          )}
          Regenerate thumbnails
        </Button>
      ) : null}
    </div>
  );
}
