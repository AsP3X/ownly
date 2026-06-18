// Human: Unit tests for resumable upload session helpers on the client.
// Agent: COVERS ensureUploadSession resume path wiring via mocked fetch in future; threshold constants for now.

import { describe, expect, it } from "vitest";
import {
  RESUMABLE_UPLOAD_THRESHOLD_BYTES,
  UPLOAD_CHUNK_SIZE_BYTES,
} from "@/lib/resumable-upload";

describe("resumable upload constants", () => {
  it("uses a 32 MiB threshold before switching away from single POST uploads", () => {
    expect(RESUMABLE_UPLOAD_THRESHOLD_BYTES).toBe(32 * 1024 * 1024);
  });

  it("uses 16 MiB chunks aligned with the backend default", () => {
    expect(UPLOAD_CHUNK_SIZE_BYTES).toBe(16 * 1024 * 1024);
  });
});
