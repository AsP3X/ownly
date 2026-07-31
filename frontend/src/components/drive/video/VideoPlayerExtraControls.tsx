// Human: Volume rail, speed menu, quality picker, and PiP button shared by video surfaces.
// Agent: PRESENTATIONAL + local menu open state; CALLS transport handlers from parent.

import {
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
} from "react";
import {
  Captions,
  CaptionsOff,
  Gauge,
  PictureInPicture2,
  Settings2,
  Volume2,
  VolumeX,
} from "lucide-react";
import type { HlsQualityState } from "@/hooks/useHlsVideoAttach";
import {
  VIDEO_PLAYBACK_RATES,
  formatVideoPlaybackRate,
  type VideoPlaybackRate,
} from "@/lib/video-playback-preference";
import { cn } from "@/lib/utils";

type Density = "desktop" | "mobile";

type VolumeControlProps = {
  volume: number;
  effectiveVolume: number;
  muted: boolean;
  disabled?: boolean;
  density?: Density;
  onToggleMute: () => void;
  onVolumeInput: (event: ChangeEvent<HTMLInputElement>) => void;
};

// Human: Mute toggle + translucent volume range (matches audio player rail language).
// Agent: READS effectiveVolume for fill width; CALLS onVolumeInput / onToggleMute.
export function VideoVolumeControl({
  volume,
  effectiveVolume,
  muted,
  disabled = false,
  density = "desktop",
  onToggleMute,
  onVolumeInput,
}: VolumeControlProps) {
  const isMobile = density === "mobile";
  const displayVolume = muted ? 0 : effectiveVolume;

  return (
    <div className={cn("flex items-center", isMobile ? "gap-1.5" : "gap-2")}>
      <button
        type="button"
        onClick={onToggleMute}
        disabled={disabled}
        aria-label={muted || volume === 0 ? "Unmute" : "Mute"}
        className={cn(
          "text-white transition hover:text-white/80 disabled:opacity-40",
        )}
      >
        {muted || volume === 0 ? (
          <VolumeX className={isMobile ? "size-4" : "size-6"} aria-hidden />
        ) : (
          <Volume2 className={isMobile ? "size-4" : "size-6"} aria-hidden />
        )}
      </button>
      <div
        className={cn(
          "relative cursor-pointer",
          isMobile ? "h-1.5 w-14" : "h-1.5 w-20",
          disabled && "pointer-events-none opacity-40",
        )}
      >
        <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-sm bg-white/25" />
        <div
          className="absolute left-0 top-1/2 h-1 -translate-y-1/2 rounded-sm bg-white"
          style={{ width: `${displayVolume * 100}%` }}
        />
        <div
          className="pointer-events-none absolute top-1/2 size-2.5 -translate-y-1/2 rounded-full bg-white"
          style={{ left: `calc(${displayVolume * 100}% - 5px)` }}
        />
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={displayVolume}
          onChange={onVolumeInput}
          disabled={disabled}
          aria-label="Volume"
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        />
      </div>
    </div>
  );
}

type MenuProps = {
  disabled?: boolean;
  density?: Density;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  triggerLabel: string;
  ariaLabel: string;
  icon?: "gauge" | "settings";
  children: ReactNode;
};

// Human: Lightweight upward popover for speed / quality (no radix dropdown dependency).
// Agent: CLOSES on outside click / Escape; POSITIONS above trigger.
function VideoControlMenu({
  disabled = false,
  density = "desktop",
  open,
  onOpenChange,
  triggerLabel,
  ariaLabel,
  icon = "gauge",
  children,
}: MenuProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const isMobile = density === "mobile";
  const Icon = icon === "settings" ? Settings2 : Gauge;

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        onOpenChange(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onOpenChange(false);
    };

    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open, onOpenChange]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => onOpenChange(!open)}
        className={cn(
          "flex items-center gap-1 text-white transition hover:text-white/80 disabled:opacity-40",
          isMobile ? "text-[11px]" : "text-sm",
        )}
      >
        <Icon className={isMobile ? "size-4" : "size-5"} aria-hidden />
        <span className="tabular-nums font-medium">{triggerLabel}</span>
      </button>
      {open ? (
        <div
          id={menuId}
          role="menu"
          className={cn(
            "absolute bottom-full right-0 z-50 mb-2 min-w-[7.5rem] overflow-hidden rounded-lg border border-white/15 bg-black/95 py-1 shadow-xl backdrop-blur-md",
            isMobile && "min-w-[6.5rem]",
          )}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}

function MenuItem({
  selected,
  label,
  onSelect,
}: {
  selected: boolean;
  label: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        "flex w-full items-center px-3 py-1.5 text-left text-sm text-white/90 transition hover:bg-white/10",
        selected && "bg-white/10 font-semibold text-sky-300",
      )}
    >
      {label}
    </button>
  );
}

type SpeedControlProps = {
  playbackRate: VideoPlaybackRate;
  disabled?: boolean;
  density?: Density;
  onSelectRate: (rate: VideoPlaybackRate) => void;
};

// Human: Playback speed picker — 0.5× … 2× discrete options.
// Agent: CALLS onSelectRate; CLOSES menu after selection.
export function VideoSpeedControl({
  playbackRate,
  disabled = false,
  density = "desktop",
  onSelectRate,
}: SpeedControlProps) {
  const [open, setOpen] = useState(false);

  return (
    <VideoControlMenu
      disabled={disabled}
      density={density}
      open={open}
      onOpenChange={setOpen}
      triggerLabel={formatVideoPlaybackRate(playbackRate)}
      ariaLabel={`Playback speed ${formatVideoPlaybackRate(playbackRate)}`}
      icon="gauge"
    >
      {VIDEO_PLAYBACK_RATES.map((rate) => (
        <MenuItem
          key={rate}
          selected={Math.abs(rate - playbackRate) < 0.001}
          label={formatVideoPlaybackRate(rate)}
          onSelect={() => {
            onSelectRate(rate);
            setOpen(false);
          }}
        />
      ))}
    </VideoControlMenu>
  );
}

type QualityControlProps = {
  quality: HlsQualityState;
  disabled?: boolean;
  density?: Density;
  onSelectLevel: (levelIndex: number) => void;
};

// Human: ABR quality menu — Auto plus each ladder rung from hls.js.
// Agent: HIDES when levels empty (native HLS / progressive); CALLS onSelectLevel(-1) for Auto.
export function VideoQualityControl({
  quality,
  disabled = false,
  density = "desktop",
  onSelectLevel,
}: QualityControlProps) {
  const [open, setOpen] = useState(false);

  if (quality.levels.length < 2) return null;

  const activeLabel = quality.autoEnabled
    ? quality.currentLevel >= 0
      ? `Auto · ${quality.levels.find((l) => l.index === quality.currentLevel)?.label ?? "Auto"}`
      : "Auto"
    : (quality.levels.find((l) => l.index === quality.selectedLevel)?.label ?? "Quality");

  // Compact trigger for the control bar
  const triggerLabel = quality.autoEnabled
    ? "Auto"
    : (quality.levels.find((l) => l.index === quality.selectedLevel)?.label ?? "Quality");

  return (
    <VideoControlMenu
      disabled={disabled}
      density={density}
      open={open}
      onOpenChange={setOpen}
      triggerLabel={triggerLabel}
      ariaLabel={`Video quality ${activeLabel}`}
      icon="settings"
    >
      <MenuItem
        selected={quality.autoEnabled}
        label={
          quality.autoEnabled && quality.currentLevel >= 0
            ? `Auto (${quality.levels.find((l) => l.index === quality.currentLevel)?.label ?? "…"})`
            : "Auto"
        }
        onSelect={() => {
          onSelectLevel(-1);
          setOpen(false);
        }}
      />
      {/* Highest first for familiar picker order */}
      {[...quality.levels]
        .slice()
        .sort((a, b) => b.height - a.height || b.bitrate - a.bitrate)
        .map((level) => (
          <MenuItem
            key={level.index}
            selected={!quality.autoEnabled && quality.selectedLevel === level.index}
            label={level.label}
            onSelect={() => {
              onSelectLevel(level.index);
              setOpen(false);
            }}
          />
        ))}
    </VideoControlMenu>
  );
}

type PiPButtonProps = {
  supported: boolean;
  active: boolean;
  disabled?: boolean;
  density?: Density;
  onToggle: () => void;
};

// Human: Picture-in-Picture toggle when the browser supports it.
// Agent: RETURNS null when unsupported so mobile Safari can omit the control.
export function VideoPiPButton({
  supported,
  active,
  disabled = false,
  density = "desktop",
  onToggle,
}: PiPButtonProps) {
  if (!supported) return null;
  const isMobile = density === "mobile";

  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      aria-label={active ? "Exit picture in picture" : "Picture in picture"}
      aria-pressed={active}
      className={cn(
        "text-white transition hover:text-white/80 disabled:opacity-40",
        active && "text-brand",
      )}
    >
      <PictureInPicture2 className={isMobile ? "size-4" : "size-6"} aria-hidden />
    </button>
  );
}

type CaptionsButtonProps = {
  available: boolean;
  active: boolean;
  disabled?: boolean;
  density?: Density;
  onToggle: () => void;
};

// Human: Soft captions toggle — only when extracted WebVTT is available.
// Agent: RETURNS null when no caption sidecar so chrome stays compact.
export function VideoCaptionsButton({
  available,
  active,
  disabled = false,
  density = "desktop",
  onToggle,
}: CaptionsButtonProps) {
  if (!available) return null;
  const isMobile = density === "mobile";
  const Icon = active ? Captions : CaptionsOff;

  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      aria-label={active ? "Hide captions" : "Show captions"}
      aria-pressed={active}
      className={cn(
        "text-white transition hover:text-white/80 disabled:opacity-40",
        active && "text-brand",
      )}
    >
      <Icon className={isMobile ? "size-4" : "size-6"} aria-hidden />
    </button>
  );
}
