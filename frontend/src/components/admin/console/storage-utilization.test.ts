// Human: Utilization maths for the admin storage panel — regression cover for the over-target case.
// Agent: Numbers mirror a real report: 121 GB on a node configured with a 100 GB target.

import { describe, expect, it } from "vitest";

import {
  isOverCapacity,
  storageBarFillPercent,
  storageUtilPercentFromBytes,
} from "./AdminStorageNodesPanel";

const GB = 1024 * 1024 * 1024;

describe("storageUtilPercentFromBytes", () => {
  it("reports the true percent when a node holds more than its target", () => {
    // Human: This clamped to 100 before, so the KPI card said 121% while the node row said 100%.
    expect(storageUtilPercentFromBytes(121 * GB, 100 * GB)).toBe(121);
  });

  it("reports normal utilization unchanged", () => {
    expect(storageUtilPercentFromBytes(50 * GB, 100 * GB)).toBe(50);
    expect(storageUtilPercentFromBytes(0, 100 * GB)).toBe(0);
  });

  it("returns 0 when no capacity target is configured", () => {
    expect(storageUtilPercentFromBytes(121 * GB, null)).toBe(0);
    expect(storageUtilPercentFromBytes(121 * GB, 0)).toBe(0);
  });
});

describe("storageBarFillPercent", () => {
  it("clamps the bar to a full track even when over target", () => {
    expect(storageBarFillPercent(121, true)).toBe(100);
  });

  it("keeps a sliver visible for small non-zero usage", () => {
    expect(storageBarFillPercent(0, true)).toBe(2);
    expect(storageBarFillPercent(1, true, 4)).toBe(4);
  });

  it("renders nothing when the node holds no bytes", () => {
    expect(storageBarFillPercent(0, false)).toBe(0);
  });
});

describe("isOverCapacity", () => {
  it("flags a node past its configured target", () => {
    expect(isOverCapacity(121 * GB, 100 * GB)).toBe(true);
  });

  it("does not flag a node at or under target", () => {
    expect(isOverCapacity(100 * GB, 100 * GB)).toBe(false);
    expect(isOverCapacity(99 * GB, 100 * GB)).toBe(false);
  });

  it("never flags when no target is configured", () => {
    // Human: An unset target means unlimited on the backend, so it cannot be exceeded.
    expect(isOverCapacity(121 * GB, null)).toBe(false);
    expect(isOverCapacity(121 * GB, 0)).toBe(false);
  });
});
