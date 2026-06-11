// Human: Unit tests for vertical gallery snap timing helpers.
// Agent: ASSERTS videoGallerySnapDurationMs clamps to min/max bounds.

import { describe, expect, it } from "vitest";
import {
  VIDEO_GALLERY_SNAP_MAX_MS,
  VIDEO_GALLERY_SNAP_MIN_MS,
  videoGallerySnapDurationMs,
} from "@/components/drive/video/video-gallery-scroll";

describe("videoGallerySnapDurationMs", () => {
  it("clamps short travel to minimum duration", () => {
    expect(videoGallerySnapDurationMs(10)).toBe(VIDEO_GALLERY_SNAP_MIN_MS);
  });

  it("caps long travel at maximum duration", () => {
    expect(videoGallerySnapDurationMs(1200)).toBe(VIDEO_GALLERY_SNAP_MAX_MS);
  });
});
