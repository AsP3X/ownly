// Human: Unit tests for resumable upload session helpers on the client.
// Agent: COVERS threshold routing and direct_upload session flag typing.

import { describe, expect, it } from "vitest";
import {
  RESUMABLE_UPLOAD_THRESHOLD_BYTES,
  RESUMABLE_VIDEO_THRESHOLD_BYTES,
  shouldUseResumableUpload,
  UPLOAD_CHUNK_SIZE_BYTES,
  type ResumableServerSession,
} from "@/lib/resumable-upload";

describe("resumable upload constants", () => {
  it("uses a 32 MiB threshold before switching away from single POST uploads", () => {
    expect(RESUMABLE_UPLOAD_THRESHOLD_BYTES).toBe(32 * 1024 * 1024);
  });

  it("uses an 8 MiB threshold for video uploads", () => {
    expect(RESUMABLE_VIDEO_THRESHOLD_BYTES).toBe(8 * 1024 * 1024);
  });

  it("uses 16 MiB chunks aligned with the backend default", () => {
    expect(UPLOAD_CHUNK_SIZE_BYTES).toBe(16 * 1024 * 1024);
  });
});

describe("shouldUseResumableUpload", () => {
  it("routes large non-video files through chunked upload", () => {
    const file = new File([new Uint8Array(RESUMABLE_UPLOAD_THRESHOLD_BYTES + 1)], "big.bin", {
      type: "application/octet-stream",
    });
    expect(shouldUseResumableUpload(file)).toBe(true);
  });

  it("routes small video files through chunked upload below the global threshold", () => {
    const file = new File([new Uint8Array(RESUMABLE_VIDEO_THRESHOLD_BYTES + 1)], "clip.mp4", {
      type: "video/mp4",
    });
    expect(shouldUseResumableUpload(file)).toBe(true);
  });

  it("keeps small non-video files on single POST upload", () => {
    const file = new File([new Uint8Array(1024)], "note.txt", { type: "text/plain" });
    expect(shouldUseResumableUpload(file)).toBe(false);
  });
});

describe("ResumableServerSession direct_upload", () => {
  it("treats missing direct_upload as false (proxy part PUT path)", () => {
    const session: ResumableServerSession = {
      session_id: "s1",
      file_id: "f1",
      chunk_size: UPLOAD_CHUNK_SIZE_BYTES,
      total_parts: 1,
      total_size: 100,
      bytes_received: 0,
      parts_received: [],
      status: "active",
      expires_at: new Date().toISOString(),
    };
    expect(Boolean(session.direct_upload)).toBe(false);
  });
});
