// Human: Unit tests for continue-watching video resume positions.
// Agent: ASSERTS save/load/clear and meaningful-position thresholds.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  VIDEO_RESUME_STORAGE_KEY,
  clearVideoResumePosition,
  isMeaningfulResumePosition,
  readVideoResumePosition,
  writeVideoResumePosition,
} from "@/lib/video-resume-preference";

describe("video resume preferences", () => {
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

  it("treats only mid-clip positions as meaningful", () => {
    expect(isMeaningfulResumePosition(5, 120)).toBe(false);
    expect(isMeaningfulResumePosition(30, 120)).toBe(true);
    expect(isMeaningfulResumePosition(110, 120)).toBe(false);
    expect(isMeaningfulResumePosition(30, 20)).toBe(false);
  });

  it("persists and clears resume positions", () => {
    writeVideoResumePosition("file-a", 42, 300);
    expect(readVideoResumePosition("file-a")).toBe(42);
    expect(JSON.parse(store.get(VIDEO_RESUME_STORAGE_KEY)!)).toEqual({ "file-a": 42 });

    clearVideoResumePosition("file-a");
    expect(readVideoResumePosition("file-a")).toBeNull();
  });

  it("does not store near-start or near-end positions", () => {
    writeVideoResumePosition("file-b", 3, 300);
    expect(readVideoResumePosition("file-b")).toBeNull();
    writeVideoResumePosition("file-b", 50, 300);
    expect(readVideoResumePosition("file-b")).toBe(50);
    writeVideoResumePosition("file-b", 290, 300);
    expect(readVideoResumePosition("file-b")).toBeNull();
  });
});
