// Human: Integration tests for upload batch subscribe/getUploadBatch alignment.
// Agent: ASSERTS subscribe delivers the same snapshot pointer as getUploadBatch.

import { afterEach, describe, expect, it } from "vitest";
import { publishUploadBatchSnapshot } from "@/lib/upload-batch-snapshot";
import {
  dismissUploadBatch,
  getUploadBatch,
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
