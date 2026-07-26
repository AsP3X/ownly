// Human: Unit tests for nearest scrub-frame lookup on the seek bar.
// Agent: ASSERTS empty ladder, exact match, and midpoint nearest-neighbor.

import { describe, expect, it } from "vitest";
import { findNearestScrubFrame, type ScrubPreviewFrame } from "@/hooks/useVideoScrubPreviews";

describe("findNearestScrubFrame", () => {
  const frames: ScrubPreviewFrame[] = [
    { timestampSeconds: 0, imageUrl: "a" },
    { timestampSeconds: 10, imageUrl: "b" },
    { timestampSeconds: 20, imageUrl: "c" },
  ];

  it("returns null for an empty ladder", () => {
    expect(findNearestScrubFrame([], 5)).toBeNull();
  });

  it("returns the closest frame by absolute time distance", () => {
    expect(findNearestScrubFrame(frames, 0)?.imageUrl).toBe("a");
    expect(findNearestScrubFrame(frames, 12)?.imageUrl).toBe("b");
    expect(findNearestScrubFrame(frames, 19)?.imageUrl).toBe("c");
  });
});
