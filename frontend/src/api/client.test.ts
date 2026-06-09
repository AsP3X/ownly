// Human: Unit tests for API error parsing helpers used across the drive and admin UI.
// Agent: ASSERTS getErrorMessage + normalizeStorageErrorMessage behavior for ApiError and strings.

import { describe, expect, it } from "vitest";
import {
  ApiError,
  getErrorMessage,
  normalizeStorageErrorMessage,
} from "@/api/client";

describe("getErrorMessage", () => {
  it("returns ApiError message text", () => {
    const err = new ApiError("Not allowed", "forbidden", 403);
    expect(getErrorMessage(err)).toBe("Not allowed");
  });

  it("normalizes aggregate capacity storage errors", () => {
    const err = new ApiError("Insufficient aggregate capacity on node", "storage", 507);
    expect(getErrorMessage(err)).toMatch(/Not enough storage space/);
  });

  it("falls back for unknown values", () => {
    expect(getErrorMessage(undefined)).toBe("Something went wrong");
  });
});

describe("normalizeStorageErrorMessage", () => {
  it("rewrites capacity errors to user-friendly copy", () => {
    expect(
      normalizeStorageErrorMessage("Cluster lacks sufficient capacity for stripe"),
    ).toMatch(/Not enough storage space/);
  });

  it("passes through unrelated messages", () => {
    expect(normalizeStorageErrorMessage("File not found")).toBe("File not found");
  });
});
