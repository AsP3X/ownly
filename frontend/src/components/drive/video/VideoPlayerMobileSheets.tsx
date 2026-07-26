// Human: Bottom sheets for mobile video player — file info and overflow actions menu.
// Agent: RENDERS Sheet primitives; CALLS onDownload/onShare; OPENS info sheet from more menu.

import { Download, Info, Repeat, Share2 } from "lucide-react";
import type { FileItem } from "@/api/client";
import { formatVideoTime } from "@/components/drive/video/video-time";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import type { HlsQualityState } from "@/hooks/useHlsVideoAttach";
import {
  VIDEO_PLAYBACK_RATES,
  formatVideoPlaybackRate,
  type VideoPlaybackRate,
} from "@/lib/video-playback-preference";
import { formatBytes, formatFileOpened } from "@/lib/utils-app";
import { cn } from "@/lib/utils";

type VideoPlayerInfoSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  file: FileItem;
  folderLabel?: string | null;
  durationSeconds: number;
  videoWidth?: number | null;
  videoHeight?: number | null;
};

// Human: Detail row inside the mobile info sheet.
function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-white/10 py-3 last:border-0">
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-white/50">{label}</dt>
      <dd className="text-sm text-white">{value}</dd>
    </div>
  );
}

// Human: File metadata bottom sheet opened from Info rail button or more menu.
// Agent: READS FileItem + transport duration; NO network calls.
export function VideoPlayerInfoSheet({
  open,
  onOpenChange,
  file,
  folderLabel,
  durationSeconds,
  videoWidth,
  videoHeight,
}: VideoPlayerInfoSheetProps) {
  const dimensionLabel =
    videoWidth && videoHeight && videoWidth > 0 && videoHeight > 0
      ? `${videoWidth} × ${videoHeight}`
      : null;
  const durationLabel =
    durationSeconds > 0 ? formatVideoTime(durationSeconds) : null;
  const streamLabel = file.hls_ready ? "Ready to stream" : "Processing";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        overlayClassName="bg-black/60 backdrop-blur-sm"
        className="rounded-t-2xl border-white/10 bg-[#141414] text-white"
      >
        <SheetHeader className="px-1 pb-2">
          <SheetTitle className="truncate text-base text-white">{file.name}</SheetTitle>
          <SheetDescription className="text-white/60">File details</SheetDescription>
        </SheetHeader>
        <dl className="px-1">
          <InfoRow label="Size" value={formatBytes(file.size_bytes)} />
          {durationLabel ? <InfoRow label="Duration" value={durationLabel} /> : null}
          {folderLabel ? <InfoRow label="Location" value={folderLabel} /> : null}
          {dimensionLabel ? <InfoRow label="Dimensions" value={dimensionLabel} /> : null}
          <InfoRow label="Type" value={file.mime_type ?? "Unknown"} />
          <InfoRow label="Stream" value={streamLabel} />
          <InfoRow label="Modified" value={formatFileOpened(file.updated_at)} />
          <InfoRow label="Created" value={formatFileOpened(file.created_at)} />
        </dl>
      </SheetContent>
    </Sheet>
  );
}

type VideoPlayerMoreMenuSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  file: FileItem;
  loop: boolean;
  onToggleLoop: () => void;
  playbackRate?: VideoPlaybackRate;
  onSelectPlaybackRate?: (rate: VideoPlaybackRate) => void;
  quality?: HlsQualityState;
  onSelectQualityLevel?: (levelIndex: number) => void;
  showDownloadAction: boolean;
  showShareAction: boolean;
  onDownload?: (file: FileItem) => void;
  onShare?: (file: FileItem) => void;
  onShowInfo: () => void;
};

// Human: Overflow menu — download, share, and link to file details sheet.
// Agent: CALLS parent handlers; CLOSES self before opening info.
function MoreMenuButton({
  label,
  icon: Icon,
  onClick,
  disabled = false,
}: {
  label: string;
  icon: typeof Download;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-sm font-medium text-white transition hover:bg-white/10 disabled:opacity-40",
      )}
    >
      <Icon className="size-5 shrink-0 text-white/80" aria-hidden />
      {label}
    </button>
  );
}

// Human: Chip row for speed / quality selection inside the more menu.
// Agent: CALLS onSelect when a chip is pressed; highlights selected chip.
function ChoiceChips({
  label,
  options,
  selectedKey,
  onSelect,
}: {
  label: string;
  options: { key: string; label: string }[];
  selectedKey: string;
  onSelect: (key: string) => void;
}) {
  return (
    <div className="rounded-xl px-4 py-3">
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-white/50">
        {label}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {options.map((option) => {
          const selected = option.key === selectedKey;
          return (
            <button
              key={option.key}
              type="button"
              onClick={() => onSelect(option.key)}
              className={cn(
                "rounded-full border px-2.5 py-1 text-xs font-medium transition",
                selected
                  ? "border-sky-400/60 bg-sky-400/15 text-sky-200"
                  : "border-white/15 bg-white/5 text-white/80 hover:bg-white/10",
              )}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Human: More options sheet from top-right chrome button.
// Agent: MIRRORS action rail entries plus file details entry; includes speed/quality chips.
export function VideoPlayerMoreMenuSheet({
  open,
  onOpenChange,
  file,
  loop,
  onToggleLoop,
  playbackRate,
  onSelectPlaybackRate,
  quality,
  onSelectQualityLevel,
  showDownloadAction,
  showShareAction,
  onDownload,
  onShare,
  onShowInfo,
}: VideoPlayerMoreMenuSheetProps) {
  const showSpeed = Boolean(onSelectPlaybackRate && playbackRate != null);
  const showQuality =
    Boolean(onSelectQualityLevel && quality && quality.levels.length >= 2);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        overlayClassName="bg-black/60 backdrop-blur-sm"
        className="max-h-[85svh] overflow-y-auto rounded-t-2xl border-white/10 bg-[#141414] text-white"
      >
        <SheetHeader className="px-1 pb-2">
          <SheetTitle className="text-base text-white">More options</SheetTitle>
          <SheetDescription className="truncate text-white/60">{file.name}</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-1 px-1">
          {/* Human: Loop toggle — mirrors transport bar repeat control for overflow menu users. */}
          {/* Agent: CALLS onToggleLoop; READS loop for Switch checked state. */}
          <div className="flex items-center justify-between rounded-xl px-4 py-3">
            <div className="flex items-center gap-3">
              <Repeat className="size-5 shrink-0 text-white/80" aria-hidden />
              <span className="text-sm font-medium text-white">Loop video</span>
            </div>
            <Switch
              checked={loop}
              onCheckedChange={onToggleLoop}
              aria-label={loop ? "Disable loop" : "Enable loop"}
            />
          </div>
          {showSpeed ? (
            <ChoiceChips
              label="Playback speed"
              selectedKey={String(playbackRate)}
              options={VIDEO_PLAYBACK_RATES.map((rate) => ({
                key: String(rate),
                label: formatVideoPlaybackRate(rate),
              }))}
              onSelect={(key) => {
                const rate = Number(key) as VideoPlaybackRate;
                onSelectPlaybackRate?.(rate);
              }}
            />
          ) : null}
          {showQuality && quality ? (
            <ChoiceChips
              label="Quality"
              selectedKey={quality.autoEnabled ? "auto" : String(quality.selectedLevel)}
              options={[
                { key: "auto", label: "Auto" },
                ...[...quality.levels]
                  .slice()
                  .sort((a, b) => b.height - a.height || b.bitrate - a.bitrate)
                  .map((level) => ({
                    key: String(level.index),
                    label: level.label,
                  })),
              ]}
              onSelect={(key) => {
                if (key === "auto") onSelectQualityLevel?.(-1);
                else onSelectQualityLevel?.(Number(key));
              }}
            />
          ) : null}
          <MoreMenuButton
            label="Save"
            icon={Download}
            disabled={!showDownloadAction}
            onClick={
              showDownloadAction
                ? () => {
                    onOpenChange(false);
                    onDownload?.(file);
                  }
                : undefined
            }
          />
          <MoreMenuButton
            label="Share"
            icon={Share2}
            disabled={!showShareAction}
            onClick={
              showShareAction
                ? () => {
                    onOpenChange(false);
                    onShare?.(file);
                  }
                : undefined
            }
          />
          <MoreMenuButton
            label="File details"
            icon={Info}
            onClick={() => {
              onOpenChange(false);
              onShowInfo();
            }}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}
