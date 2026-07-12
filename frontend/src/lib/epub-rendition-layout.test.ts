// Human: Unit tests for epub.js host measurement helpers.
// Agent: READS measureRenditionHost with mocked getBoundingClientRect.

import { describe, expect, it } from "vitest";
import { measureRenditionHost } from "@/lib/epub-rendition-layout";

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
