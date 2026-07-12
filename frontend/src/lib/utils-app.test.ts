// Human: Unit tests for drive utility helpers including EPUB mime detection.
// Agent: ASSERTS isEpubMime true/false for standard mime types and .epub extension fallback.

import { describe, expect, it } from "vitest";
import { isEpubMime } from "@/lib/utils-app";

describe("isEpubMime", () => {
  it("returns true for application/epub+zip", () => {
    expect(isEpubMime("application/epub+zip")).toBe(true);
    expect(isEpubMime("APPLICATION/EPUB+ZIP")).toBe(true);
  });

  it("returns true for application/epub", () => {
    expect(isEpubMime("application/epub")).toBe(true);
  });

  it("returns true for .epub extension when mime is missing or generic", () => {
    expect(isEpubMime(null, "chapter-one.epub")).toBe(true);
    expect(isEpubMime("application/octet-stream", "book.epub")).toBe(true);
    expect(isEpubMime("", "My Book.EPUB")).toBe(true);
  });

  it("returns false for non-epub mime types and extensions", () => {
    expect(isEpubMime("application/pdf")).toBe(false);
    expect(isEpubMime("application/pdf", "document.pdf")).toBe(false);
    expect(isEpubMime("text/plain", "notes.txt")).toBe(false);
    expect(isEpubMime(null, null)).toBe(false);
    expect(isEpubMime(undefined)).toBe(false);
  });
});
