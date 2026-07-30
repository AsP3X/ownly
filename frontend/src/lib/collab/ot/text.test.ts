import { describe, expect, it } from "vitest";
import {
  applyReplace,
  diffPlainText,
  transformOffset,
  transformReplace,
  type TextReplace,
} from "./text";

describe("collab OT text (parity with Rust)", () => {
  it("applies insert/delete/replace", () => {
    expect(
      applyReplace("hello", { index: 2, delete: 0, insert: "XX" }),
    ).toBe("heXXllo");
    expect(
      applyReplace("hello", { index: 1, delete: 3, insert: "" }),
    ).toBe("ho");
    expect(
      applyReplace("hello", { index: 1, delete: 3, insert: "i" }),
    ).toBe("hio");
  });

  it("converges concurrent end edits", () => {
    const base = "hello world";
    const a: TextReplace = { index: 0, delete: 0, insert: "X" };
    const b: TextReplace = { index: 11, delete: 0, insert: "Y" };

    const s1 = applyReplace(base, a);
    const sAb = applyReplace(s1, transformReplace(b, a));

    const s2 = applyReplace(base, b);
    const sBa = applyReplace(s2, transformReplace(a, b));

    expect(sAb).toBe("Xhello worldY");
    expect(sBa).toBe("Xhello worldY");
  });

  it("keeps both inserts at same index (server-first)", () => {
    const base = "abcd";
    const a: TextReplace = { index: 2, delete: 0, insert: "A" };
    const b: TextReplace = { index: 2, delete: 0, insert: "B" };
    const afterB = applyReplace(base, b);
    const finalText = applyReplace(afterB, transformReplace(a, b));
    expect(finalText).toBe("abBAcd");
  });

  it("handles unicode scalar indices", () => {
    expect(
      applyReplace("a😀b", { index: 1, delete: 1, insert: "X" }),
    ).toBe("aXb");
  });

  it("transforms offsets through replace", () => {
    const op: TextReplace = { index: 2, delete: 3, insert: "ZZ" };
    expect(transformOffset(0, op)).toBe(0);
    expect(transformOffset(2, op)).toBe(2);
    expect(transformOffset(3, op)).toBe(4);
    expect(transformOffset(6, op)).toBe(5);
  });

  it("diffPlainText produces single replace", () => {
    expect(diffPlainText("abc", "abc")).toBeNull();
    expect(diffPlainText("hello", "hallo")).toEqual({
      index: 1,
      delete: 1,
      insert: "a",
    });
  });
});
