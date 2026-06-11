// Human: Unit tests for video orientation classification and player shell helpers.
// Agent: ASSERTS classifyVideoOrientation + shell class resolution for landscape/square/portrait.

import { describe, expect, it } from "vitest";
import {
  classifyVideoOrientation,
  readServerVideoNaturalSize,
  resolveDesktopVideoFallbackAspectClass,
  resolveDesktopVideoShellClass,
  resolveInlineVideoAspectClass,
  resolveMobileVideoShellClass,
  toVideoNaturalSize,
  videoDialogLandscapePlayerShellClass,
  videoDialogSquarePlayerShellClass,
  videoDialogVerticalPlayerShellClass,
  videoMobileImmersiveShellClass,
  videoMobileLandscapeVideoShellClass,
  videoMobileSquareVideoShellClass,
  videoMobileVerticalVideoShellClass,
} from "@/components/drive/video/video-player-layout";

describe("classifyVideoOrientation", () => {
  it("labels landscape sources", () => {
    expect(classifyVideoOrientation(1920, 1080)).toBe("landscape");
    expect(classifyVideoOrientation(1280, 720)).toBe("landscape");
  });

  it("labels portrait sources", () => {
    expect(classifyVideoOrientation(1080, 1920)).toBe("portrait");
    expect(classifyVideoOrientation(720, 1280)).toBe("portrait");
  });

  it("labels near-square sources as square", () => {
    expect(classifyVideoOrientation(1080, 1080)).toBe("square");
    expect(classifyVideoOrientation(1000, 1040)).toBe("square");
    expect(classifyVideoOrientation(1040, 1000)).toBe("square");
  });

  it("falls back to landscape for invalid dimensions", () => {
    expect(classifyVideoOrientation(0, 1080)).toBe("landscape");
    expect(classifyVideoOrientation(1920, -1)).toBe("landscape");
  });
});

describe("readServerVideoNaturalSize", () => {
  it("builds a natural size record from server fields", () => {
    expect(readServerVideoNaturalSize(1080, 1920)).toEqual(
      toVideoNaturalSize(1080, 1920),
    );
    expect(readServerVideoNaturalSize(null, 1920)).toBeNull();
    expect(readServerVideoNaturalSize(0, 1920)).toBeNull();
  });
});

describe("resolve video shell classes", () => {
  it("maps orientation to desktop shells", () => {
    expect(resolveDesktopVideoShellClass("landscape")).toBe(
      videoDialogLandscapePlayerShellClass,
    );
    expect(resolveDesktopVideoShellClass("portrait")).toBe(
      videoDialogVerticalPlayerShellClass,
    );
    expect(resolveDesktopVideoShellClass("square")).toBe(
      videoDialogSquarePlayerShellClass,
    );
  });

  it("maps orientation to mobile immersive shells", () => {
    expect(resolveMobileVideoShellClass("landscape")).toBe(
      videoMobileImmersiveShellClass,
    );
    expect(resolveMobileVideoShellClass("portrait")).toBe(
      videoMobileImmersiveShellClass,
    );
    expect(resolveMobileVideoShellClass("square")).toBe(
      videoMobileImmersiveShellClass,
    );
    expect(videoMobileLandscapeVideoShellClass).toBe(videoMobileImmersiveShellClass);
    expect(videoMobileVerticalVideoShellClass).toBe(videoMobileImmersiveShellClass);
    expect(videoMobileSquareVideoShellClass).toBe(videoMobileImmersiveShellClass);
  });

  it("maps desktop fallback aspect before metadata loads", () => {
    expect(resolveDesktopVideoFallbackAspectClass("landscape", false)).toBe("aspect-[4/3]");
    expect(resolveDesktopVideoFallbackAspectClass("portrait", false)).toBe("aspect-[9/16]");
    expect(resolveDesktopVideoFallbackAspectClass("square", false)).toBe("aspect-square");
    expect(resolveDesktopVideoFallbackAspectClass("landscape", true)).toBe("");
  });

  it("maps orientation to inline public-share aspect classes", () => {
    expect(resolveInlineVideoAspectClass("landscape")).toContain("aspect-video");
    expect(resolveInlineVideoAspectClass("portrait")).toContain("aspect-[9/16]");
    expect(resolveInlineVideoAspectClass("square")).toContain("aspect-square");
    expect(resolveInlineVideoAspectClass(null)).toContain("aspect-video");
  });
});
