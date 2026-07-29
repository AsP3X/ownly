// Human: Persist last audio volume/mute across sessions so players reopen at the same level.
// Agent: READS/WRITES localStorage key; FALLS BACK to defaults when storage is unavailable.

export const AUDIO_VOLUME_STORAGE_KEY = "ownly.audio.volume.v1";

export type StoredAudioVolume = {
  volume: number;
  muted: boolean;
};

const DEFAULT_VOLUME: StoredAudioVolume = {
  volume: 1,
  muted: false,
};

// Human: Clamp volume to the HTMLMediaElement 0–1 range.
// Agent: RETURNS finite volume in [0, 1].
function clampVolume(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_VOLUME.volume;
  return Math.min(1, Math.max(0, value));
}

// Human: Load the last volume/mute preference for the shared transport hook.
// Agent: READS localStorage JSON; RETURNS defaults on missing or invalid payload.
export function readStoredAudioVolume(): StoredAudioVolume {
  if (typeof window === "undefined") return DEFAULT_VOLUME;
  try {
    const raw = window.localStorage.getItem(AUDIO_VOLUME_STORAGE_KEY);
    if (!raw) return DEFAULT_VOLUME;
    const parsed = JSON.parse(raw) as Partial<StoredAudioVolume>;
    return {
      volume: clampVolume(typeof parsed.volume === "number" ? parsed.volume : DEFAULT_VOLUME.volume),
      muted: Boolean(parsed.muted),
    };
  } catch {
    return DEFAULT_VOLUME;
  }
}

// Human: Persist volume/mute after the user adjusts the rail or mute toggle.
// Agent: WRITES localStorage; SWALLOWS quota / private-mode errors.
export function writeStoredAudioVolume(next: StoredAudioVolume): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      AUDIO_VOLUME_STORAGE_KEY,
      JSON.stringify({
        volume: clampVolume(next.volume),
        muted: Boolean(next.muted),
      }),
    );
  } catch {
    // Human: Private mode or full quota — playback still works without persistence.
  }
}
