// Human: Unit tests for EPUB blob loading — epub.js must open zip archives as binary, not directory URLs.
// Agent: MOCKS epubjs; READS openEpubBookFromBlob.

import { beforeEach, describe, expect, it, vi } from "vitest";

const ePubMock = vi.fn();

vi.mock("epubjs", () => ({
  default: (input: unknown, options?: unknown) => ePubMock(input, options),
}));

import { openEpubBookFromBlob } from "@/lib/epub-document-source";

describe("openEpubBookFromBlob", () => {
  beforeEach(() => {
    ePubMock.mockReset();
    ePubMock.mockReturnValue({
      ready: Promise.resolve(),
      opened: Promise.resolve(),
      loaded: {
        metadata: Promise.resolve(),
        navigation: Promise.resolve(),
        spine: Promise.resolve(),
        resources: Promise.resolve(),
      },
      package: {},
    });
  });

  it("opens downloaded bytes as a binary EPUB archive", async () => {
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
    const blob = new Blob([bytes], { type: "application/epub+zip" });
    blob.arrayBuffer = vi.fn().mockResolvedValue(bytes.buffer);

    await openEpubBookFromBlob(blob);

    expect(blob.arrayBuffer).toHaveBeenCalledTimes(1);
    expect(ePubMock).toHaveBeenCalledWith(bytes.buffer, { openAs: "binary" });
  });
});
