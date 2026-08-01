// Human: Contract tests for audit timestamp and severity formatting.
// Agent: relativeTime takes an injectable `now` so these tests are deterministic.

import { describe, expect, it } from "vitest";
import {
  formatContext,
  relativeTime,
  severityTone,
} from "@/components/admin/console/audit-log-format";

const NOW = Date.parse("2026-08-01T12:00:00Z");

describe("relativeTime", () => {
  it("collapses sub-minute ages to 'just now'", () => {
    expect(relativeTime("2026-08-01T11:59:30Z", NOW)).toBe("just now");
  });

  it("renders minutes, hours, and days", () => {
    expect(relativeTime("2026-08-01T11:56:00Z", NOW)).toBe("4m ago");
    expect(relativeTime("2026-08-01T09:00:00Z", NOW)).toBe("3h ago");
    expect(relativeTime("2026-07-29T12:00:00Z", NOW)).toBe("3d ago");
  });

  it("falls back to a date beyond 30 days", () => {
    const label = relativeTime("2026-01-01T12:00:00Z", NOW);
    expect(label).not.toContain("ago");
    expect(label).toContain("2026");
  });

  it("treats a clock-skewed future timestamp as 'just now' rather than a negative age", () => {
    expect(relativeTime("2026-08-01T12:05:00Z", NOW)).toBe("just now");
  });

  it("returns a dash for an unparseable timestamp", () => {
    expect(relativeTime("not-a-date", NOW)).toBe("—");
  });
});

describe("severityTone", () => {
  it("maps each severity to a distinct pill tone", () => {
    expect(severityTone("Critical")).toBe("danger");
    expect(severityTone("Warning")).toBe("warning");
    expect(severityTone("Notice")).toBe("primary");
    expect(severityTone("Info")).toBe("neutral");
  });
});

describe("formatContext", () => {
  it("pretty-prints an object", () => {
    expect(formatContext({ a: 1 })).toBe('{\n  "a": 1\n}');
  });

  it("returns null when there is no context", () => {
    expect(formatContext(null)).toBeNull();
    expect(formatContext(undefined)).toBeNull();
  });

  it("survives a circular structure instead of throwing", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(formatContext(circular)).toBe("[object Object]");
  });
});
