// Human: Explorer thumbnail polling helpers — shimmer while server JPEG sidecars generate.
// Agent: ASSERTS shouldPollFileThumbnail + isThumbnailProcessing for EPUB document rows.

import { describe, expect, it } from "vitest";
import type { FileItem } from "@/api/client";
import {
  fileProcessingCompactLabel,
  fileProcessingLabel,
  fileProcessingPercent,
  isFileProcessing,
  isThumbnailProcessing,
  isVideoRebuilding,
  shouldPollFileThumbnail,
} from "@/lib/file-processing";

function makeFile(overrides: Partial<FileItem>): FileItem {
  return {
    id: "file-1",
    name: "book.epub",
    mime_type: "application/epub+zip",
    size_bytes: 1024,
    updated_at: "2026-07-12T00:00:00Z",
    hls_ready: false,
    conversion_progress: 0,
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

describe("file-processing video rebuild progress", () => {
  it("treats reprocessing videos as in-progress with overall percent", () => {
    const file = makeFile({
      name: "clip.mp4",
      mime_type: "video/mp4",
      hls_ready: false,
      hls_encode_status: "reprocessing",
      conversion_progress: 37,
    });
    expect(isFileProcessing(file)).toBe(true);
    expect(isVideoRebuilding(file)).toBe(true);
    expect(fileProcessingPercent(file)).toBe(37);
    expect(fileProcessingLabel(file)).toBe("Rebuilding stream 37%");
    expect(fileProcessingCompactLabel(file)).toBe("Rebuild 37%");
  });

  it("shows ellipsis rebuild label while still queued at 0%", () => {
    const file = makeFile({
      name: "clip.mp4",
      mime_type: "video/mp4",
      hls_ready: false,
      hls_encode_status: "reprocessing",
      conversion_progress: 0,
    });
    expect(fileProcessingPercent(file)).toBe(0);
    expect(fileProcessingLabel(file)).toBe("Rebuilding stream…");
    expect(fileProcessingCompactLabel(file)).toBe("Rebuilding…");
  });

  it("does not label first-time ingest as rebuilding", () => {
    const file = makeFile({
      name: "clip.mp4",
      mime_type: "video/mp4",
      hls_ready: false,
      hls_encode_status: "processing",
      conversion_progress: 20,
    });
    expect(isVideoRebuilding(file)).toBe(false);
    expect(fileProcessingLabel(file)).toMatch(/^Processing file/);
  });
});
