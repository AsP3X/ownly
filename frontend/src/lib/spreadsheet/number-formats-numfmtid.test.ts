import { describe, expect, it } from "vitest";
import {
  formatCodeFromNumFmtId,
  numberFormatFromXlsxNumFmtId,
} from "@/lib/spreadsheet/number-formats";

describe("numFmtId resolution", () => {
  it("maps built-in ids", () => {
    expect(formatCodeFromNumFmtId(14)).toBe("m/d/yyyy");
    expect(numberFormatFromXlsxNumFmtId(14)).toBe("date");
    expect(numberFormatFromXlsxNumFmtId(10)).toBe("percent");
    expect(numberFormatFromXlsxNumFmtId(49)).toBe("text");
  });

  it("prefers custom map over built-ins", () => {
    expect(formatCodeFromNumFmtId(164, { 164: "0.000" })).toBe("0.000");
    expect(numberFormatFromXlsxNumFmtId(164, { 164: "dddd, mmmm dd" })).toBe("date");
    expect(formatCodeFromNumFmtId(200, { 200: "[Blue]#,##0" })).toBe("[Blue]#,##0");
  });
});
