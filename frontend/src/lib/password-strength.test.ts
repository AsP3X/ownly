import { describe, expect, it } from "vitest";
import { PASSWORD_MIN_LENGTH, scorePassword } from "@/lib/password-strength";

describe("scorePassword", () => {
  it("reports an empty password as score 0 and below the minimum", () => {
    const result = scorePassword("");
    expect(result.score).toBe(0);
    expect(result.meetsMinimum).toBe(false);
    expect(result.requirements.every((requirement) => !requirement.met)).toBe(true);
  });

  it("caps anything under the enforced minimum length at weak", () => {
    const result = scorePassword("Ab1!");
    expect(result.score).toBe(1);
    expect(result.meetsMinimum).toBe(false);
    expect(result.requirements.find((r) => r.id === "length")?.met).toBe(false);
  });

  it("scores a password meeting every advertised rule as strong", () => {
    const result = scorePassword("Str0ng!Passphrase");
    expect(result.score).toBe(4);
    expect(result.label).toBe("Strong");
    expect(result.meetsMinimum).toBe(true);
  });

  it("gives long passphrases credit without symbols", () => {
    const result = scorePassword("correcthorsebatterystaple");
    expect(result.meetsMinimum).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(2);
  });

  it("keeps the requirement list in a stable order", () => {
    expect(scorePassword("x").requirements.map((r) => r.id)).toEqual([
      "length",
      "case",
      "digit",
      "symbol",
    ]);
  });

  it("mirrors the API minimum length in the requirement copy", () => {
    const lengthRule = scorePassword("").requirements[0];
    expect(lengthRule.label).toContain(String(PASSWORD_MIN_LENGTH));
  });
});
