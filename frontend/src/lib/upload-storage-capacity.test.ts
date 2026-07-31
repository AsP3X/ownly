// Human: Unit tests for the upload capacity check that runs after duplicate detection.
import { describe, expect, it } from "vitest";
import {
  buildUploadConflictPlan,
  type PendingUploadFile,
} from "@/lib/upload-conflicts";
import {
  effectiveRemainingFromDashboard,
  limitingStorageKind,
  splitUploadsByCapacity,
  storageOverflowNotice,
  storageWarningForFile,
} from "@/lib/upload-storage-capacity";

type Row = { id: string; size: number };

const sizeOf = (row: Row) => row.size;

describe("splitUploadsByCapacity", () => {
  it("keeps every row when remaining storage is uncapped", () => {
    const rows: Row[] = [
      { id: "a", size: 10 },
      { id: "b", size: 20 },
    ];
    const split = splitUploadsByCapacity(rows, Number.POSITIVE_INFINITY, sizeOf);
    expect(split.fitting).toEqual(rows);
    expect(split.blocked).toEqual([]);
    expect(split.requiredBytes).toBe(30);
  });

  it("fills in order and blocks only the rows that overflow", () => {
    const rows: Row[] = [
      { id: "a", size: 60 },
      { id: "b", size: 60 },
      { id: "c", size: 30 },
    ];
    const split = splitUploadsByCapacity(rows, 100, sizeOf);
    expect(split.fitting.map((row) => row.id)).toEqual(["a", "c"]);
    expect(split.blocked.map((row) => row.id)).toEqual(["b"]);
    expect(split.blocked[0]?.storageWarning).toContain("remaining library storage");
    expect(split.requiredBytes).toBe(150);
  });

  it("names the storage network when that ceiling is tighter than the account quota", () => {
    const split = splitUploadsByCapacity([{ id: "a", size: 1_400_000_000 }], 945_000_000, sizeOf, "network");
    expect(split.fitting).toEqual([]);
    expect(split.blocked[0]?.storageWarning).toContain("storage network");
    expect(split.blocked[0]?.storageWarning).toContain("account quota alone is not enough");
  });

  it("blocks everything when nothing fits", () => {
    const split = splitUploadsByCapacity([{ id: "a", size: 10 }], 0, sizeOf);
    expect(split.fitting).toEqual([]);
    expect(split.blocked).toHaveLength(1);
  });
});

describe("upload preflight ordering", () => {
  function pendingFile(name: string, size: number, contentHash: string): PendingUploadFile {
    return {
      file: { name, size } as File,
      contentHash,
    };
  }

  // Human: Duplicates must be removed before the size check, so a duplicate never consumes quota.
  it("sizes only the non-duplicate remainder against remaining storage", () => {
    const pending = [
      pendingFile("dupe.bin", 90, "hash-dupe"),
      pendingFile("fresh.bin", 40, "hash-fresh"),
    ];

    const plan = buildUploadConflictPlan(
      pending,
      [
        {
          upload_name: "dupe.bin",
          upload_size_bytes: 90,
          upload_content_hash: "hash-dupe",
          existing: { id: "existing-1", name: "dupe.bin" },
        } as never,
      ],
      [],
      { skipDuplicates: true, restoreRecycle: true },
    );

    expect(plan.skipDuplicateCount).toBe(1);

    const split = splitUploadsByCapacity(plan.uploadFiles, 50, (row) => row.file.size);
    expect(split.fitting).toHaveLength(1);
    expect(split.blocked).toHaveLength(0);
    expect(split.requiredBytes).toBe(40);
  });
});

describe("storageOverflowNotice", () => {
  it("names the shortfall and the way forward", () => {
    const notice = storageOverflowNotice(2, 300, 100);
    expect(notice).toContain("2 files do not fit");
    expect(notice).toContain("Press Upload again");
  });

  it("uses singular wording for one blocked file", () => {
    expect(storageOverflowNotice(1, 300, 100)).toContain("1 file does not fit");
  });

  it("points admins at node capacity when the network is the limit", () => {
    const notice = storageOverflowNotice(1, 1_400_000_000, 945_000_000, "network");
    expect(notice).toContain("storage network");
    expect(notice).toContain("storage node capacity");
  });
});

describe("limitingStorageKind", () => {
  it("reports network when free node space is tighter than the account quota", () => {
    expect(
      limitingStorageKind({
        used_bytes: 49 * 1024 ** 3,
        quota_bytes: 100 * 1024 ** 3,
        network_remaining_bytes: 945 * 1024 ** 2,
      }),
    ).toBe("network");
  });

  it("reports quota when library headroom is the tighter ceiling", () => {
    expect(
      limitingStorageKind({
        used_bytes: 49 * 1024 ** 3,
        quota_bytes: 50 * 1024 ** 3,
        network_remaining_bytes: 20 * 1024 ** 3,
      }),
    ).toBe("quota");
  });
});

describe("storageWarningForFile", () => {
  it("explains that raising only the account quota cannot open network space", () => {
    const warning = storageWarningForFile(1.4 * 1024 ** 3, 945 * 1024 ** 2, "network");
    expect(warning).toContain("storage network");
    expect(warning).toContain("account quota alone is not enough");
  });
});

describe("effectiveRemainingFromDashboard", () => {
  it("prefers the effective remaining bytes reported by the dashboard", () => {
    expect(
      effectiveRemainingFromDashboard({
        used_bytes: 10,
        quota_bytes: 100,
        effective_remaining_bytes: 25,
      }),
    ).toBe(25);
  });

  it("falls back to quota headroom when the network cap is unknown", () => {
    expect(effectiveRemainingFromDashboard({ used_bytes: 10, quota_bytes: 100 })).toBe(90);
  });
});
