// Human: Unit tests for epub.js host measurement helpers.
// Agent: READS measureRenditionHost / waitForRenditionHostLayout with mocked getBoundingClientRect.

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EpubRenditionHostLayoutError,
  measureRenditionHost,
  waitForRenditionHostLayout,
} from "@/lib/epub-rendition-layout";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("measureRenditionHost", () => {
  it("returns floored pixel dimensions with a minimum of 1", () => {
    const node = {
      getBoundingClientRect: () => ({
        x: 0,
        y: 0,
        width: 812.8,
        height: 640.2,
        top: 0,
        left: 0,
        right: 812.8,
        bottom: 640.2,
        toJSON: () => ({}),
      }),
    } as HTMLElement;

    expect(measureRenditionHost(node)).toEqual({ width: 812, height: 640 });
  });

  it("never returns zero when the host has collapsed bounds", () => {
    const node = {
      getBoundingClientRect: () => ({
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        toJSON: () => ({}),
      }),
    } as HTMLElement;

    expect(measureRenditionHost(node)).toEqual({ width: 1, height: 1 });
  });
});

describe("waitForRenditionHostLayout", () => {
  it("resolves when the host has stable usable dimensions", async () => {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 0;
    });

    const node = {
      getBoundingClientRect: () => ({
        x: 0,
        y: 0,
        width: 400,
        height: 600,
        top: 0,
        left: 0,
        right: 400,
        bottom: 600,
        toJSON: () => ({}),
      }),
    } as HTMLElement;

    await expect(waitForRenditionHostLayout(node, 4)).resolves.toBeUndefined();
  });

  it("throws when the host never becomes large enough", async () => {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 0;
    });

    const node = {
      getBoundingClientRect: () => ({
        x: 0,
        y: 0,
        width: 10,
        height: 10,
        top: 0,
        left: 0,
        right: 10,
        bottom: 10,
        toJSON: () => ({}),
      }),
    } as HTMLElement;

    await expect(waitForRenditionHostLayout(node, 3)).rejects.toBeInstanceOf(EpubRenditionHostLayoutError);
  });
});
