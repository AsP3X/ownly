// Human: Unit tests for explorer range selection and marquee geometry.
import { describe, expect, it } from "vitest";
import {
  entryRefKey,
  exceedsDragThreshold,
  marqueeBoxFromPoints,
  marqueeIntersects,
  sliceEntryRange,
  splitEntryRefs,
  type ExplorerEntryRef,
} from "@/lib/explorer-selection";

const ORDER: ExplorerEntryRef[] = [
  { kind: "folder", id: "work" },
  { kind: "folder", id: "photos" },
  { kind: "file", id: "a" },
  { kind: "file", id: "b" },
  { kind: "file", id: "c" },
];

describe("sliceEntryRange", () => {
  it("selects everything between the anchor and the target", () => {
    const range = sliceEntryRange(ORDER, "folder:photos", "file:b");
    expect(range.map(entryRefKey)).toEqual(["folder:photos", "file:a", "file:b"]);
  });

  it("works the same when the range is dragged upward", () => {
    const range = sliceEntryRange(ORDER, "file:b", "folder:photos");
    expect(range.map(entryRefKey)).toEqual(["folder:photos", "file:a", "file:b"]);
  });

  it("returns the single entry when both ends match", () => {
    expect(sliceEntryRange(ORDER, "file:a", "file:a").map(entryRefKey)).toEqual(["file:a"]);
  });

  it("returns nothing when the anchor is stale", () => {
    expect(sliceEntryRange(ORDER, "file:gone", "file:b")).toEqual([]);
  });

  it("keeps files and folders in separate id spaces", () => {
    const collidingOrder: ExplorerEntryRef[] = [
      { kind: "folder", id: "same" },
      { kind: "file", id: "same" },
    ];
    expect(sliceEntryRange(collidingOrder, "file:same", "file:same").map(entryRefKey)).toEqual([
      "file:same",
    ]);
  });
});

describe("splitEntryRefs", () => {
  it("splits refs into the two id lists selection state uses", () => {
    expect(splitEntryRefs(ORDER)).toEqual({
      fileIds: ["a", "b", "c"],
      folderIds: ["work", "photos"],
    });
  });
});

describe("marquee geometry", () => {
  it("builds a box no matter which way the drag went", () => {
    const downRight = marqueeBoxFromPoints({ x: 10, y: 10 }, { x: 50, y: 40 });
    const upLeft = marqueeBoxFromPoints({ x: 50, y: 40 }, { x: 10, y: 10 });
    expect(downRight).toEqual({ left: 10, top: 10, width: 40, height: 30 });
    expect(upLeft).toEqual(downRight);
  });

  it("counts overlap but not a shared edge", () => {
    const box = { left: 0, top: 0, width: 100, height: 100 };
    expect(marqueeIntersects(box, { left: 90, top: 90, width: 50, height: 50 })).toBe(true);
    // Human: Tile starts exactly where the box ends — a hairline touch must not select it.
    expect(marqueeIntersects(box, { left: 100, top: 0, width: 50, height: 50 })).toBe(false);
    expect(marqueeIntersects(box, { left: 120, top: 0, width: 50, height: 50 })).toBe(false);
  });

  it("treats small movements as a click", () => {
    expect(exceedsDragThreshold({ x: 0, y: 0 }, { x: 2, y: 2 })).toBe(false);
    expect(exceedsDragThreshold({ x: 0, y: 0 }, { x: 0, y: 5 })).toBe(true);
  });
});
