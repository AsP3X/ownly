// Human: Rotating the phone must not tear down the <video>. This asserts DOM node identity
// across an enabled -> disabled -> enabled flip, which is what rotation does to the gallery.
// Agent: Renders the real VideoVerticalGallery with react-dom/client into jsdom; no library needed.

import { StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { VideoVerticalGallery } from "./VideoVerticalGallery";

// Human: jsdom has neither ResizeObserver nor real layout. Both are stubbed so containerHeight
// becomes non-zero — otherwise trackActive would be false in BOTH states and the test would
// pass without ever exercising the swap it exists to catch.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

class StubResizeObserver {
  callback: () => void;
  constructor(callback: () => void) {
    this.callback = callback;
  }
  observe() {
    this.callback();
  }
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = StubResizeObserver;
Object.defineProperty(HTMLElement.prototype, "clientHeight", {
  configurable: true,
  get: () => 800,
});
import type { FileItem } from "@/api/client";

function video(id: string): FileItem {
  return {
    id,
    name: `${id}.mp4`,
    mime_type: "video/mp4",
    size_bytes: 1,
    folder_id: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    hls_ready: true,
    hls_encode_status: null,
    conversion_progress: 0,
  } as FileItem;
}

const videos = [video("a"), video("b"), video("c")];

let container: HTMLDivElement | null = null;
let root: Root | null = null;

function render(enabled: boolean) {
  if (!container) {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  }
  act(() => {
    root!.render(
      <StrictMode>
        <VideoVerticalGallery
          videos={videos}
          currentIndex={1}
          hasPrevious
          hasNext
          goPrevious={() => {}}
          goNext={() => {}}
          activeFileId="b"
          enabled={enabled}
        >
          {/* Stands in for VideoPlayerSurfaceMobile — the identity that must survive. */}
          <video data-testid="player" />
        </VideoVerticalGallery>
      </StrictMode>,
    );
  });
  return container!.querySelector('[data-testid="player"]');
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = null;
  root = null;
});

describe("VideoVerticalGallery — rotation", () => {
  it("keeps the same <video> node when swiping is disabled and re-enabled", () => {
    const portrait = render(true);
    expect(portrait).not.toBeNull();

    // Rotate to landscape: the gallery stops responding to swipes.
    const landscape = render(false);
    expect(landscape).toBe(portrait);

    // Rotate back.
    const backToPortrait = render(true);
    expect(backToPortrait).toBe(portrait);
  });

  it("really does restructure around the surviving node", () => {
    // Human: Guards the test itself. If both states rendered identically the identity check
    // above would pass for the wrong reason, so assert the swap actually happened: the adjacent
    // prev/next panels exist only while swiping is enabled.
    const enabledNode = render(true);
    const enabledPanels = container!.querySelectorAll("[data-gallery-adjacent]").length;

    const disabledNode = render(false);
    const disabledPanels = container!.querySelectorAll("[data-gallery-adjacent]").length;

    expect(enabledPanels).toBeGreaterThan(disabledPanels);
    expect(disabledPanels).toBe(0);
    expect(disabledNode).toBe(enabledNode);
  });
});
