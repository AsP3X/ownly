// Human: Explorer thumbnail polling helpers — shimmer while server JPEG sidecars generate.
// Agent: ASSERTS shouldPollFileThumbnail + isThumbnailProcessing for EPUB document rows.

import { describe, expect, it } from "vitest";
import type { FileItem } from "@/api/client";
import { isThumbnailProcessing, shouldPollFileThumbnail } from "@/lib/file-processing";

function makeFile(overrides: Partial<FileItem>): FileItem {
  return {
    id: "file-1",
    name: "book.epub",
    mime_type: "application/epub+zip",
    size_bytes: 1024,
    updated_at: "2026-07-12T00:00:00Z",
    ...overrides,
  } as FileItem;
}

describe("file-processing EPUB thumbnails", () => {
  it("polls while EPUB document thumbnail is queued", () => {
    const file = makeFile({
      document_thumbnail_ready: false,
      document_thumbnail_status: "queued",
    });
    expect(shouldPollFileThumbnail(file)).toBe(true);
    expect(isThumbnailProcessing(file)).toBe(true);
  });

  it("stops polling when EPUB document thumbnail is ready", () => {
    const file = makeFile({
      document_thumbnail_ready: true,
      document_thumbnail_status: "ready",
    });
    expect(shouldPollFileThumbnail(file)).toBe(false);
    expect(isThumbnailProcessing(file)).toBe(false);
  });

  it("stops polling when EPUB document thumbnail failed", () => {
    const file = makeFile({
      document_thumbnail_ready: false,
      document_thumbnail_status: "failed",
    });
    expect(shouldPollFileThumbnail(file)).toBe(false);
    expect(isThumbnailProcessing(file)).toBe(false);
  });
});
