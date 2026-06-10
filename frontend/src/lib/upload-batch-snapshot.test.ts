// Human: Unit tests for the upload batch snapshot cache used by useSyncExternalStore.
// Agent: ASSERTS publish/read return the same stable object reference.

import { describe, expect, it } from "vitest";
import {
  publishUploadBatchSnapshot,
  readUploadBatchSnapshot,
} from "@/lib/upload-batch-snapshot";

describe("upload batch snapshot cache", () => {
  it("returns null until a snapshot is published", () => {
    publishUploadBatchSnapshot(null);
    expect(readUploadBatchSnapshot()).toBeNull();
  });

  it("reuses the same object reference across repeated reads", () => {
    const snapshot = {
      id: "batch-1",
      status: "uploading" as const,
      items: [],
    };
    publishUploadBatchSnapshot(snapshot);

    expect(readUploadBatchSnapshot()).toBe(snapshot);
    expect(readUploadBatchSnapshot()).toBe(snapshot);
  });

  it("replaces the cached reference when a new snapshot is published", () => {
    const first = { id: "a", status: "uploading" as const, items: [] };
    const second = { id: "b", status: "complete" as const, items: [] };
    publishUploadBatchSnapshot(first);
    publishUploadBatchSnapshot(second);

    expect(readUploadBatchSnapshot()).toBe(second);
    expect(readUploadBatchSnapshot()).not.toBe(first);
  });
});
