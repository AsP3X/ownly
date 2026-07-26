import { describe, expect, it } from "vitest";
import { formatValueWithNumberFormat } from "@/lib/spreadsheet/number-formats";

describe("formatValueWithNumberFormat custom codes", () => {
  it("formats percent custom codes", () => {
    expect(formatValueWithNumberFormat(0.255, "custom", "0.0%")).toBe("25.5%");
  });

  it("formats thousand-separated number codes", () => {
    expect(formatValueWithNumberFormat(1234.5, "custom", "#,##0.00")).toBe("1,234.50");
  });

  it("formats simple currency custom codes", () => {
    expect(formatValueWithNumberFormat(12, "custom", "$#,##0.00")).toBe("$12.00");
  });
});
