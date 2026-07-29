// Human: Unit tests for shared upload tray status wording.
import { describe, expect, it } from "vitest";
import {
  formatUploadBatchStatusLine,
  formatUploadFilesProgress,
  formatUploadQueueSummary,
  getUploadPhaseLabel,
  getUploadPercentLabel,
} from "@/lib/upload-status-copy";

describe("getUploadPhaseLabel", () => {
  it("uses short media-aware pipeline labels", () => {
    expect(
      getUploadPhaseLabel({ phase: "uploading", mimeType: "video/mp4", isReprocess: false }),
    ).toBe("Uploading");
    expect(
      getUploadPhaseLabel({ phase: "processing", mimeType: "video/mp4", isReprocess: false }),
    ).toBe("Converting");
    expect(
      getUploadPhaseLabel({ phase: "encrypting", mimeType: "video/mp4", isReprocess: false }),
    ).toBe("Encrypting");
    expect(
      getUploadPhaseLabel({ phase: "storing", mimeType: "video/mp4", isReprocess: false }),
    ).toBe("Saving");
  });

  it("uses Processing for generic files instead of Indexing/Moving variants", () => {
    expect(
      getUploadPhaseLabel({ phase: "processing", mimeType: "application/pdf", isReprocess: false }),
    ).toBe("Processing");
    expect(
      getUploadPhaseLabel({ phase: "storing", mimeType: "application/pdf", isReprocess: false }),
    ).toBe("Saving");
  });
});

describe("formatUploadBatchStatusLine", () => {
  const base = {
    total: 3,
    done: 1,
    failed: 0,
    cancelled: 0,
    inFlight: 1,
    waiting: 1,
  };

  it("formats in-progress counts consistently", () => {
    expect(
      formatUploadBatchStatusLine({
        counts: base,
        isComplete: false,
        etaLabel: "~2m left",
        remainingBytesLabel: "10 MB left",
      }),
    ).toBe("1 active · 1 queued · ~2m left · 10 MB left");
  });

  it("formats clean completion", () => {
    expect(
      formatUploadBatchStatusLine({
        counts: { ...base, done: 3, inFlight: 0, waiting: 0 },
        isComplete: true,
      }),
    ).toBe("All 3 files uploaded");
  });

  it("formats partial completion", () => {
    expect(
      formatUploadBatchStatusLine({
        counts: { ...base, done: 1, failed: 1, cancelled: 1, inFlight: 0, waiting: 0 },
        isComplete: true,
      }),
    ).toBe("1 uploaded · 1 failed · 1 cancelled");
  });
});

describe("helpers", () => {
  it("formats file progress and queue summary", () => {
    expect(formatUploadFilesProgress(2, 5)).toBe("2 of 5 files");
    expect(formatUploadQueueSummary(3)).toBe("3 files waiting in queue");
  });

  it("uses ellipsis for indeterminate post-upload percent", () => {
    expect(
      getUploadPercentLabel({ phase: "processing", progress: 0, indeterminate: true }),
    ).toBe("…");
    expect(getUploadPercentLabel({ phase: "uploading", progress: 42 })).toBe("42%");
  });
});
