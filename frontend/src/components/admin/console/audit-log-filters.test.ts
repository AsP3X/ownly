// Human: Contract tests for audit filter state — URL round-trip, API params, and chip removal.
// Agent: PURE state module; no DOM, no network.

import { describe, expect, it } from "vitest";
import {
  activeChips,
  EMPTY_AUDIT_FILTER,
  fromUrlParams,
  hasActiveFilters,
  resolveRange,
  toApiParams,
  toggleValue,
  toUrlParams,
  type AuditFilterState,
} from "@/components/admin/console/audit-log-filters";

function filterWith(overrides: Partial<AuditFilterState>): AuditFilterState {
  return { ...EMPTY_AUDIT_FILTER, ...overrides };
}

describe("audit filter URL round-trip", () => {
  it("survives a full round-trip through the query string", () => {
    const original = filterWith({
      q: "alice",
      preset: "7d",
      categories: ["auth", "admin"],
      actions: ["auth.login"],
      severities: ["Critical", "Warning"],
      actors: ["alice@example.com"],
      ip: "10.0.0.1",
      resourceType: "file",
      resourceId: "f-1",
      sort: "oldest",
    });

    expect(fromUrlParams(toUrlParams(original))).toEqual(original);
  });

  it("round-trips an empty filter to an empty query string", () => {
    expect(toUrlParams(EMPTY_AUDIT_FILTER).toString()).toBe("");
    expect(fromUrlParams(new URLSearchParams(""))).toEqual(EMPTY_AUDIT_FILTER);
  });

  it("stores the preset rather than resolved timestamps so shared links stay relative", () => {
    const params = toUrlParams(filterWith({ preset: "24h" }));
    expect(params.get("range")).toBe("24h");
    expect(params.get("from")).toBeNull();
  });

  it("keeps custom range bounds", () => {
    const original = filterWith({
      preset: "custom",
      from: "2026-08-01T00:00",
      to: "2026-08-02T00:00",
    });
    expect(fromUrlParams(toUrlParams(original))).toEqual(original);
  });

  it("falls back to defaults for hand-edited garbage", () => {
    const params = new URLSearchParams("range=nonsense&severities=Critical,Bogus&sort=sideways");
    const parsed = fromUrlParams(params);
    expect(parsed.preset).toBe("all");
    expect(parsed.severities).toEqual(["Critical"]);
    expect(parsed.sort).toBe("newest");
  });
});

describe("API parameter serialization", () => {
  it("omits every empty dimension", () => {
    expect(toApiParams(EMPTY_AUDIT_FILTER).toString()).toBe("");
  });

  it("joins multi-value dimensions with commas", () => {
    const params = toApiParams(
      filterWith({ categories: ["auth", "files"], severities: ["Critical"] }),
    );
    expect(params.get("categories")).toBe("auth,files");
    expect(params.get("severities")).toBe("Critical");
  });

  it("trims whitespace-only text filters away", () => {
    const params = toApiParams(filterWith({ q: "   ", ip: "  " }));
    expect(params.get("q")).toBeNull();
    expect(params.get("ip")).toBeNull();
  });

  it("resolves a preset into an absolute from bound", () => {
    const params = toApiParams(filterWith({ preset: "1h" }));
    const from = params.get("from");
    expect(from).toBeTruthy();
    expect(Number.isNaN(Date.parse(from as string))).toBe(false);
  });

  it("sends no bounds for the all-time preset", () => {
    expect(resolveRange(filterWith({ preset: "all" }))).toEqual({});
  });

  it("ignores an unparseable custom bound rather than sending garbage", () => {
    const range = resolveRange(filterWith({ preset: "custom", from: "not-a-date", to: "" }));
    expect(range.from).toBeUndefined();
    expect(range.to).toBeUndefined();
  });
});

describe("active filter chips", () => {
  it("reports nothing active for an empty filter", () => {
    expect(activeChips(EMPTY_AUDIT_FILTER)).toEqual([]);
    expect(hasActiveFilters(EMPTY_AUDIT_FILTER)).toBe(false);
  });

  it("emits one chip per active constraint", () => {
    const state = filterWith({
      q: "alice",
      categories: ["auth", "files"],
      severities: ["Critical"],
    });
    expect(activeChips(state)).toHaveLength(4);
  });

  it("removes only the targeted value", () => {
    const state = filterWith({ categories: ["auth", "files"] });
    const chip = activeChips(state).find((c) => c.id === "category:auth");
    expect(chip?.remove(state).categories).toEqual(["files"]);
  });

  it("clears both bounds when the time chip is removed", () => {
    const state = filterWith({ preset: "custom", from: "2026-08-01T00:00", to: "2026-08-02T00:00" });
    const chip = activeChips(state).find((c) => c.id === "range");
    const next = chip?.remove(state);
    expect(next?.preset).toBe("all");
    expect(next?.from).toBe("");
    expect(next?.to).toBe("");
  });
});

describe("toggleValue", () => {
  it("adds a missing value and removes a present one", () => {
    expect(toggleValue(["a"], "b")).toEqual(["a", "b"]);
    expect(toggleValue(["a", "b"], "a")).toEqual(["b"]);
  });
});
