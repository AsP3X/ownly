// Human: Persist video volume and playback speed across preview sessions.
// Agent: READS/WRITES localStorage JSON; DEFAULTS volume 1 and rate 1.

export const VIDEO_PLAYBACK_PREFERENCES_STORAGE_KEY = "ownly:video-playback";

export const VIDEO_PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] as const;

export type VideoPlaybackRate = (typeof VIDEO_PLAYBACK_RATES)[number];

export type VideoPlaybackPreferences = {
  volume: number;
  playbackRate: VideoPlaybackRate;
};

export const VIDEO_PLAYBACK_DEFAULT_PREFERENCES: VideoPlaybackPreferences = {
  volume: 1,
  playbackRate: 1,
};

function readStorageValue(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorageValue(key: string, value: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // localStorage may be unavailable in private mode or some test runners.
  }
}

// Human: Clamp volume to the HTMLMediaElement 0–1 range.
// Agent: RETURNS finite number in [0, 1]; FALLS BACK to default when invalid.
function normalizeVolume(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return VIDEO_PLAYBACK_DEFAULT_PREFERENCES.volume;
  }
  return Math.min(1, Math.max(0, value));
}

// Human: Accept only the discrete player speed options.
// Agent: RETURNS nearest allowed rate or default 1×.
function normalizePlaybackRate(value: unknown): VideoPlaybackRate {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return VIDEO_PLAYBACK_DEFAULT_PREFERENCES.playbackRate;
  }
  const match = VIDEO_PLAYBACK_RATES.find((rate) => Math.abs(rate - value) < 0.001);
  return match ?? VIDEO_PLAYBACK_DEFAULT_PREFERENCES.playbackRate;
}

function normalizePreferences(value: unknown): VideoPlaybackPreferences {
  if (!value || typeof value !== "object") {
    return { ...VIDEO_PLAYBACK_DEFAULT_PREFERENCES };
  }
  const record = value as Record<string, unknown>;
  return {
    volume: normalizeVolume(record.volume),
    playbackRate: normalizePlaybackRate(record.playbackRate),
  };
}

// Human: Load saved volume/speed for the next video preview session.
// Agent: READS localStorage JSON; RETURNS defaults when unset or corrupt.
export function readVideoPlaybackPreferences(): VideoPlaybackPreferences {
  const raw = readStorageValue(VIDEO_PLAYBACK_PREFERENCES_STORAGE_KEY);
  if (!raw) return { ...VIDEO_PLAYBACK_DEFAULT_PREFERENCES };
  try {
    return normalizePreferences(JSON.parse(raw));
  } catch {
    return { ...VIDEO_PLAYBACK_DEFAULT_PREFERENCES };
  }
}

// Human: Remember volume and playback rate across sessions.
// Agent: WRITES normalized JSON to localStorage.
export function writeVideoPlaybackPreferences(
  preferences: Partial<VideoPlaybackPreferences>,
): VideoPlaybackPreferences {
  const current = readVideoPlaybackPreferences();
  const next = normalizePreferences({
    ...current,
    ...preferences,
  });
  writeStorageValue(VIDEO_PLAYBACK_PREFERENCES_STORAGE_KEY, JSON.stringify(next));
  return next;
}

// Human: Cycle through discrete rates (YouTube-style speed stepping).
// Agent: RETURNS next rate after current in VIDEO_PLAYBACK_RATES (wraps).
export function nextVideoPlaybackRate(current: number): VideoPlaybackRate {
  const index = VIDEO_PLAYBACK_RATES.findIndex((rate) => Math.abs(rate - current) < 0.001);
  if (index < 0) return 1;
  return VIDEO_PLAYBACK_RATES[(index + 1) % VIDEO_PLAYBACK_RATES.length]!;
}

// Human: Step to the previous discrete playback rate.
// Agent: RETURNS previous rate in VIDEO_PLAYBACK_RATES (wraps).
export function previousVideoPlaybackRate(current: number): VideoPlaybackRate {
  const index = VIDEO_PLAYBACK_RATES.findIndex((rate) => Math.abs(rate - current) < 0.001);
  if (index < 0) return 1;
  const prev = index === 0 ? VIDEO_PLAYBACK_RATES.length - 1 : index - 1;
  return VIDEO_PLAYBACK_RATES[prev]!;
}

// Human: Label for transport UI — "1×", "1.25×", etc.
// Agent: FORMATS rate with thin multiplication sign.
export function formatVideoPlaybackRate(rate: number): string {
  if (Math.abs(rate - 1) < 0.001) return "1×";
  const rounded = Math.round(rate * 100) / 100;
  return `${rounded}×`;
}
