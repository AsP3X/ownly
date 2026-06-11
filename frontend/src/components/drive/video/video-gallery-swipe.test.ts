// Human: Unit tests for gallery swipe zone detection on mobile video player.
// Agent: ASSERTS isVideoGallerySwipeZone respects data-video-gallery-swipe-zone boundary.

import { describe, expect, it } from "vitest";
import { isVideoGallerySwipeZone } from "@/components/drive/video/video-gallery-swipe";

describe("isVideoGallerySwipeZone", () => {
  it("returns true for touches inside the swipe zone", () => {
    const zone = document.createElement("div");
    zone.setAttribute("data-video-gallery-swipe-zone", "");
    const video = document.createElement("video");
    zone.appendChild(video);
    document.body.appendChild(zone);

    expect(isVideoGallerySwipeZone(video)).toBe(true);

    zone.remove();
  });

  it("returns false for touches outside the swipe zone", () => {
    const chrome = document.createElement("button");
    document.body.appendChild(chrome);

    expect(isVideoGallerySwipeZone(chrome)).toBe(false);

    chrome.remove();
  });
});
