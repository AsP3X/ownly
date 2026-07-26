// Human: Unit tests for persisted video volume and playback rate.
// Agent: ASSERTS defaults, round-trip, clamping, and rate helpers.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  VIDEO_PLAYBACK_DEFAULT_PREFERENCES,
  VIDEO_PLAYBACK_PREFERENCES_STORAGE_KEY,
  formatVideoPlaybackRate,
  nextVideoPlaybackRate,
  readVideoPlaybackPreferences,
  writeVideoPlaybackPreferences,
} from "@/lib/video-playback-preference";

describe("video playback preferences", () => {
  const store = new Map<string, string>();

  beforeEach(() => {
    store.clear();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("defaults to full volume and 1× when storage is empty", () => {
    expect(readVideoPlaybackPreferences()).toEqual(VIDEO_PLAYBACK_DEFAULT_PREFERENCES);
  });

  it("persists volume and rate across reads", () => {
    writeVideoPlaybackPreferences({ volume: 0.4, playbackRate: 1.5 });
    expect(store.get(VIDEO_PLAYBACK_PREFERENCES_STORAGE_KEY)).toBe(
      JSON.stringify({ volume: 0.4, playbackRate: 1.5 }),
    );
    expect(readVideoPlaybackPreferences()).toEqual({
      volume: 0.4,
      playbackRate: 1.5,
    });
  });

  it("clamps volume and rejects unknown rates", () => {
    store.set(
      VIDEO_PLAYBACK_PREFERENCES_STORAGE_KEY,
      JSON.stringify({ volume: 2.5, playbackRate: 3 }),
    );
    expect(readVideoPlaybackPreferences()).toEqual({
      volume: 1,
      playbackRate: 1,
    });
  });

  it("cycles discrete rates and formats labels", () => {
    expect(nextVideoPlaybackRate(1)).toBe(1.25);
    expect(nextVideoPlaybackRate(2)).toBe(0.5);
    expect(formatVideoPlaybackRate(1)).toBe("1×");
    expect(formatVideoPlaybackRate(1.25)).toBe("1.25×");
  });
});
