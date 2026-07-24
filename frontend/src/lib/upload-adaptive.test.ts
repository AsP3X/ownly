import { afterEach, describe, expect, it } from "vitest";
import {
  __resetUploadAdaptiveForTests,
  ADAPTIVE_PART_CONCURRENCY_DEFAULT,
  ADAPTIVE_PART_CONCURRENCY_MAX,
  ADAPTIVE_PART_CONCURRENCY_MIN,
  estimateRemainingSeconds,
  recordUploadPartSample,
  suggestedChunkSizeBytes,
  suggestedPartConcurrency,
} from "@/lib/upload-adaptive";

afterEach(() => {
  __resetUploadAdaptiveForTests();
});

describe("upload adaptive", () => {
  it("defaults concurrency until enough samples exist", () => {
    expect(suggestedPartConcurrency()).toBe(ADAPTIVE_PART_CONCURRENCY_DEFAULT);
  });

  it("drops concurrency when many parts fail", () => {
    for (let i = 0; i < 6; i += 1) {
      recordUploadPartSample({ ok: false, durationMs: 2000, bytes: 1024 });
    }
    expect(suggestedPartConcurrency()).toBe(ADAPTIVE_PART_CONCURRENCY_MIN);
  });

  it("raises concurrency on fast successful parts", () => {
    for (let i = 0; i < 6; i += 1) {
      recordUploadPartSample({ ok: true, durationMs: 500, bytes: 16 * 1024 * 1024 });
    }
    expect(suggestedPartConcurrency()).toBe(ADAPTIVE_PART_CONCURRENCY_MAX);
  });

  it("estimates remaining time from throughput samples", () => {
    for (let i = 0; i < 4; i += 1) {
      recordUploadPartSample({ ok: true, durationMs: 1000, bytes: 10 * 1024 * 1024 });
    }
    const eta = estimateRemainingSeconds(20 * 1024 * 1024);
    expect(eta).toBe(2);
  });

  it("suggests smaller chunks when fail rate is high", () => {
    for (let i = 0; i < 6; i += 1) {
      recordUploadPartSample({ ok: false, durationMs: 3000, bytes: 8 * 1024 * 1024 });
    }
    expect(suggestedChunkSizeBytes()).toBe(4 * 1024 * 1024);
  });
});
