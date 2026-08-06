// Human: Unit tests for move/delete feedback wording and undo bookkeeping.
import { describe, expect, it } from "vitest";
import type { FileItem, FolderItem } from "@/api/client";
import {
  captureMoveOrigins,
  describeMoveFailure,
  describeMoveSummary,
  describeMoveUndoneSummary,
  describeRecycleSummary,
  describeRestoreSummary,
  formatItemCount,
} from "@/lib/drive-actions";
import { formatFolderPathLabel, ROOT_FOLDER_LABEL } from "@/lib/folder-path";

function file(id: string, name: string, folderId: string | null): FileItem {
  return {
    id,
    name,
    mime_type: "application/pdf",
    size_bytes: 10,
    folder_id: folderId,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    hls_ready: false,
    hls_encode_status: null,
    conversion_progress: 0,
  };
}

function folder(id: string, name: string, parentId: string | null): FolderItem {
  return {
    id,
    name,
    parent_id: parentId,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
}

describe("captureMoveOrigins", () => {
  it("records where each item lived before the move", () => {
    const origins = captureMoveOrigins(
      [file("f1", "report.pdf", "src")],
      [folder("d1", "Scans", null)],
      "dst",
    );

    expect(origins).toEqual([
      { kind: "file", id: "f1", name: "report.pdf", parentId: "src" },
      { kind: "folder", id: "d1", name: "Scans", parentId: null },
    ]);
  });

  it("skips items already in the destination so no needless request is sent", () => {
    const origins = captureMoveOrigins(
      [file("f1", "report.pdf", "dst"), file("f2", "notes.txt", null)],
      [folder("d1", "Scans", "dst")],
      "dst",
    );

    expect(origins.map((origin) => origin.id)).toEqual(["f2"]);
  });

  it("treats the drive root as a destination of its own", () => {
    const origins = captureMoveOrigins(
      [file("f1", "report.pdf", null), file("f2", "notes.txt", "src")],
      [],
      null,
    );

    expect(origins.map((origin) => origin.id)).toEqual(["f2"]);
  });

  it("never moves a folder into itself", () => {
    const origins = captureMoveOrigins([], [folder("d1", "Scans", "src")], "d1");

    expect(origins).toEqual([]);
  });
});

describe("move and delete summaries", () => {
  const origins = captureMoveOrigins(
    [file("f1", "report.pdf", "src"), file("f2", "notes.txt", "src")],
    [],
    "dst",
  );

  it("names a single item and counts a batch", () => {
    expect(describeMoveSummary(origins.slice(0, 1), "Invoices")).toBe(
      "Moved “report.pdf” to Invoices",
    );
    expect(describeMoveSummary(origins, "Invoices")).toBe("Moved 2 items to Invoices");
  });

  it("reports what undo put back", () => {
    expect(describeMoveUndoneSummary(origins.slice(0, 1))).toBe("“report.pdf” moved back");
    expect(describeMoveUndoneSummary(origins)).toBe("2 items moved back");
  });

  it("describes recycle and restore results", () => {
    expect(describeRecycleSummary(["report.pdf"])).toBe(
      "“report.pdf” moved to the recycle bin",
    );
    expect(describeRecycleSummary(["a", "b", "c"])).toBe("3 items moved to the recycle bin");
    expect(describeRecycleSummary([undefined])).toBe("1 item moved to the recycle bin");
    expect(describeRestoreSummary(1)).toBe("Restored from the recycle bin");
    expect(describeRestoreSummary(4)).toBe("Restored 4 items");
  });

  it("only reports a move failure when something actually failed", () => {
    expect(describeMoveFailure(0, "boom")).toBe("");
    expect(describeMoveFailure(2, "Folder is full")).toBe(
      "2 items could not be moved: Folder is full",
    );
  });

  it("pluralizes item counts", () => {
    expect(formatItemCount(1)).toBe("1 item");
    expect(formatItemCount(0)).toBe("0 items");
  });
});

describe("formatFolderPathLabel", () => {
  it("falls back to the root label for items at the drive root", () => {
    expect(formatFolderPathLabel([])).toBe(ROOT_FOLDER_LABEL);
    expect(formatFolderPathLabel(undefined)).toBe(ROOT_FOLDER_LABEL);
  });

  it("prefixes the trail with the root label", () => {
    expect(
      formatFolderPathLabel([
        { id: "a", name: "Work" },
        { id: "b", name: "Invoices" },
      ]),
    ).toBe("My Cloud / Work / Invoices");
  });
});
