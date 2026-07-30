import { describe, expect, it } from "vitest";
import {
  applyReplace,
  diffPlainText,
  transformOffset,
  transformReplace,
  type TextReplace,
} from "./text";
import fixtures from "./fixtures.json";

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

  it("runs shared fixtures.json", () => {
    for (const c of fixtures.cases) {
      const caseRec = c as Record<string, unknown>;
      const name = String(caseRec.name ?? "?");
      if (typeof caseRec.base === "string" && caseRec.a && caseRec.b) {
        const base = caseRec.base as string;
        const a = caseRec.a as TextReplace;
        const b = caseRec.b as TextReplace;
        if (caseRec.apply_b_first) {
          const afterB = applyReplace(base, b);
          expect(applyReplace(afterB, transformReplace(a, b)), name).toBe(
            caseRec.result,
          );
        } else {
          const ab = applyReplace(applyReplace(base, a), transformReplace(b, a));
          const ba = applyReplace(applyReplace(base, b), transformReplace(a, b));
          if (caseRec.result_ab) expect(ab, `${name} ab`).toBe(caseRec.result_ab);
          if (caseRec.result_ba) expect(ba, `${name} ba`).toBe(caseRec.result_ba);
        }
      } else if (typeof caseRec.base === "string" && caseRec.op) {
        expect(
          applyReplace(caseRec.base as string, caseRec.op as TextReplace),
          name,
        ).toBe(caseRec.result);
      } else if (caseRec.a && caseRec.b && caseRec.a_after_b) {
        expect(
          transformReplace(caseRec.a as TextReplace, caseRec.b as TextReplace),
          name,
        ).toEqual(caseRec.a_after_b);
      }
    }
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
