// Human: Integration tests for upload batch subscribe/getUploadBatch alignment and retry helpers.
// Agent: ASSERTS subscribe delivers the same snapshot pointer as getUploadBatch; retry no-ops without batch.

import { afterEach, describe, expect, it } from "vitest";
import { publishUploadBatchSnapshot } from "@/lib/upload-batch-snapshot";
import {
  dismissUploadBatch,
  getUploadBatch,
  retryFailedUploadItems,
  retryUploadItem,
  subscribeUploadBatch,
} from "@/lib/upload-manager";

afterEach(() => {
  publishUploadBatchSnapshot(null);
  dismissUploadBatch();
});

describe("upload batch subscribe alignment", () => {
  it("returns null consistently when no batch is active", () => {
    expect(getUploadBatch()).toBeNull();
    expect(getUploadBatch()).toBeNull();
  });

  it("delivers the cached snapshot reference from subscribe and getUploadBatch", () => {
    let fromSubscribe: ReturnType<typeof getUploadBatch> | undefined;
    const unsubscribe = subscribeUploadBatch((snapshot) => {
      fromSubscribe = snapshot;
    });

    expect(fromSubscribe).toBe(getUploadBatch());

    unsubscribe();
  });
});

describe("upload retry helpers", () => {
  it("retry helpers no-op when no batch is active", () => {
    expect(retryFailedUploadItems()).toBe(0);
    expect(retryUploadItem("missing")).toBe(false);
  });
});
