// Human: Unit tests for EPUB navigation helpers used by the preview controller.
// Agent: READS epub-navigation pure functions; no epub.js runtime required.

import { describe, expect, it } from "vitest";
import {
  clampSpineIndex,
  computeChapterProgress,
  flattenEpubToc,
  formatChapterProgressCompact,
  formatChapterProgressLabel,
  isEpubTocEntryActive,
  resolveChapterLabel,
} from "@/lib/epub-navigation";

describe("flattenEpubToc", () => {
  it("flattens nested navigation items with depth", () => {
    const entries = flattenEpubToc([
      {
        id: "cover",
        label: "Cover",
        href: "cover.xhtml",
        subitems: [
          { id: "ch1", label: "Chapter I", href: "chapter1.xhtml" },
        ],
      },
    ]);

    expect(entries).toEqual([
      { id: "cover", label: "Cover", href: "cover.xhtml", depth: 0 },
      { id: "ch1", label: "Chapter I", href: "chapter1.xhtml", depth: 1 },
    ]);
  });
});

describe("clampSpineIndex", () => {
  it("clamps to valid spine bounds", () => {
    expect(clampSpineIndex(-1, 5)).toBe(0);
    expect(clampSpineIndex(3, 5)).toBe(3);
    expect(clampSpineIndex(9, 5)).toBe(4);
    expect(clampSpineIndex(0, 0)).toBe(0);
  });
});

describe("computeChapterProgress", () => {
  it("returns fraction based on 1-based chapter position", () => {
    expect(computeChapterProgress(0, 10)).toBeCloseTo(0.1);
    expect(computeChapterProgress(9, 10)).toBe(1);
    expect(computeChapterProgress(0, 0)).toBe(0);
  });
});

describe("formatChapterProgressLabel", () => {
  it("formats chapter indicator text from spine index", () => {
    expect(formatChapterProgressLabel(41, 318)).toBe("Chapter 42 of 318");
    expect(formatChapterProgressLabel(0, 0)).toBe("Chapter 0 of 0");
  });
});

describe("formatChapterProgressCompact", () => {
  it("formats compact chapter indicator text", () => {
    expect(formatChapterProgressCompact(41, 318)).toBe("42 / 318");
    expect(formatChapterProgressCompact(0, 0)).toBe("0 / 0");
  });
});

describe("resolveChapterLabel", () => {
  it("prefers matching TOC label for current href", () => {
    const label = resolveChapterLabel(
      [{ id: "c3", label: "Chapter III", href: "chapter3.xhtml", depth: 0 }],
      "chapter3.xhtml#start",
      2,
    );
    expect(label).toBe("Chapter III");
  });

  it("falls back to numbered chapter when TOC has no match", () => {
    expect(resolveChapterLabel([], null, 4)).toBe("Chapter 5");
  });
});

describe("isEpubTocEntryActive", () => {
  it("matches equal paths ignoring fragment and case", () => {
    expect(isEpubTocEntryActive("Chapter3.xhtml#frag", "chapter3.xhtml")).toBe(true);
  });

  it("matches when one href is a path-suffixed form of the other", () => {
    expect(isEpubTocEntryActive("OEBPS/chapter3.xhtml", "chapter3.xhtml")).toBe(true);
    expect(isEpubTocEntryActive("chapter3.xhtml", "OEBPS/chapter3.xhtml")).toBe(true);
  });

  it("does not treat unrelated substrings as active", () => {
    expect(isEpubTocEntryActive("ba.xhtml", "a.xhtml")).toBe(false);
    expect(isEpubTocEntryActive(null, "chapter.xhtml")).toBe(false);
  });
});
