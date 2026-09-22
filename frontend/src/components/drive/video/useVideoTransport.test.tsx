// Human: iOS Safari native HLS freezes forever when currentTime is set before media data exists.
// Resume and early seeks must wait for `canplay` — reproduced and verified in the iOS 27 simulator.
// Agent: Renders the real useVideoTransport against a jsdom <video> with stubbed readyState/currentTime.

import { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { FileItem } from "@/api/client";

vi.mock("@/lib/video-resume-preference", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/video-resume-preference")>();
  return {
    ...actual,
    readVideoResumePosition: () => 34,
    isMeaningfulResumePosition: () => true,
    writeVideoResumePosition: () => undefined,
  };
});

import { useVideoTransport } from "./useVideoTransport";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Human: Playback preferences read localStorage on mount; Node's global needs a file path.
const memoryStorage = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (key: string) => memoryStorage.get(key) ?? null,
  setItem: (key: string, value: string) => void memoryStorage.set(key, value),
  removeItem: (key: string) => void memoryStorage.delete(key),
});

const file = {
  id: "resume-file",
  name: "resume.mp4",
  mime_type: "video/mp4",
  size_bytes: 1,
  folder_id: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  hls_ready: true,
  hls_encode_status: "ready",
  conversion_progress: 100,
} as FileItem;

function Harness() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  useVideoTransport({ videoRef, file, fullscreenTargetRef: cardRef });
  return (
    <div ref={cardRef}>
      <video ref={videoRef} />
    </div>
  );
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;

// Human: Stub the media state jsdom does not implement and record every currentTime write.
function mountWithStubbedVideo() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(<Harness />));

  const video = container.querySelector("video")!;
  const state = { readyState: 1, currentTime: 0 };
  const writes: number[] = [];
  Object.defineProperty(video, "readyState", { configurable: true, get: () => state.readyState });
  Object.defineProperty(video, "duration", { configurable: true, get: () => 1930 });
  Object.defineProperty(video, "currentTime", {
    configurable: true,
    get: () => state.currentTime,
    set: (value: number) => {
      writes.push(value);
      state.currentTime = value;
    },
  });
  return { video, state, writes };
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = null;
  root = null;
});

describe("useVideoTransport resume seek", () => {
  it("defers the resume seek from loadedmetadata until canplay", () => {
    const { video, state, writes } = mountWithStubbedVideo();

    act(() => {
      video.dispatchEvent(new Event("loadedmetadata"));
    });
    expect(writes).toEqual([]);

    state.readyState = 3;
    act(() => {
      video.dispatchEvent(new Event("canplay"));
    });
    expect(writes).toEqual([34]);

    // Human: Only once — later canplay events (after buffering) must not jump back.
    act(() => {
      video.dispatchEvent(new Event("canplay"));
    });
    expect(writes).toEqual([34]);
  });

  it("seeks immediately when the element can already play", () => {
    const { video, state, writes } = mountWithStubbedVideo();
    state.readyState = 4;

    act(() => {
      video.dispatchEvent(new Event("loadedmetadata"));
    });
    expect(writes).toEqual([34]);
  });
});
