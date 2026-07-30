import { describe, expect, it } from "vitest";
import {
  applyTextReplace,
  scalarRangeToUtf16,
  scalarToUtf16Index,
  utf16ToScalarIndex,
} from "./collab-monaco";

describe("collab-monaco offsets", () => {
  it("round-trips ASCII 1:1", () => {
    const text = "hello world";
    for (let i = 0; i <= text.length; i++) {
      expect(scalarToUtf16Index(text, utf16ToScalarIndex(text, i))).toBe(i);
      expect(utf16ToScalarIndex(text, scalarToUtf16Index(text, i))).toBe(i);
    }
  });

  it("maps emoji (surrogate pair) correctly", () => {
    // "a" + 😀 (U+1F600, 2 UTF-16 units) + "b"
    const text = "a😀b";
    expect(text.length).toBe(4); // UTF-16
    expect([...text].length).toBe(3); // scalars

    expect(utf16ToScalarIndex(text, 0)).toBe(0);
    expect(utf16ToScalarIndex(text, 1)).toBe(1);
    // Mid-surrogate (after high half of 😀) still counts that one scalar
    expect(utf16ToScalarIndex(text, 2)).toBe(2);
    expect(utf16ToScalarIndex(text, 3)).toBe(2);
    expect(utf16ToScalarIndex(text, 4)).toBe(3);

    expect(scalarToUtf16Index(text, 0)).toBe(0);
    expect(scalarToUtf16Index(text, 1)).toBe(1);
    expect(scalarToUtf16Index(text, 2)).toBe(3);
    expect(scalarToUtf16Index(text, 3)).toBe(4);
  });

  it("applies replace with scalar indices over emoji", () => {
    const text = "a😀b";
    // Delete emoji (1 scalar at index 1), insert "X"
    const next = applyTextReplace(text, { index: 1, delete: 1, insert: "X" });
    expect(next).toBe("aXb");
  });

  it("maps scalar ranges to utf16 for decorations", () => {
    const text = "a😀b";
    expect(scalarRangeToUtf16(text, 1, 2)).toEqual({ startUtf16: 1, endUtf16: 3 });
    expect(scalarRangeToUtf16(text, 2, 2)).toEqual({ startUtf16: 3, endUtf16: 3 });
  });

  it("clamps out-of-range indices", () => {
    const text = "hi";
    expect(utf16ToScalarIndex(text, -5)).toBe(0);
    expect(utf16ToScalarIndex(text, 99)).toBe(2);
    expect(scalarToUtf16Index(text, -1)).toBe(0);
    expect(scalarToUtf16Index(text, 99)).toBe(2);
  });
});
