// Human: Audit filter state — the single model shared by the filter bar, table, and URL.
// Agent: SERIALIZES to URLSearchParams for both the API and the address bar; parse/serialize round-trip.

import type { AdminAuditSeverity } from "@/api/client";

export const AUDIT_SEVERITIES: AdminAuditSeverity[] = ["Critical", "Warning", "Notice", "Info"];

/** Human: Preset windows for the time range control; `all` clears the bounds. */
export type AuditRangePreset = "1h" | "24h" | "7d" | "30d" | "all" | "custom";

export const AUDIT_RANGE_PRESETS: { id: AuditRangePreset; label: string }[] = [
  { id: "1h", label: "Last hour" },
  { id: "24h", label: "Last 24 hours" },
  { id: "7d", label: "Last 7 days" },
  { id: "30d", label: "Last 30 days" },
  { id: "all", label: "All time" },
];

const PRESET_DURATION_MS: Record<Exclude<AuditRangePreset, "all" | "custom">, number> = {
  "1h": 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
};

/** Human: Category namespaces grouped the way an admin scans them, not alphabetically. */
export const AUDIT_CATEGORY_GROUPS: { label: string; categories: string[] }[] = [
  { label: "Security & Access", categories: ["auth", "admin", "permissions"] },
  { label: "Content", categories: ["files", "folders", "recycle_bin", "spreadsheet"] },
  { label: "Sharing", categories: ["shares", "groups"] },
  { label: "Infrastructure", categories: ["storage_nodes", "uploads", "setup"] },
];

const CATEGORY_LABELS: Record<string, string> = {
  auth: "Authentication",
  admin: "Administration",
  permissions: "Permissions",
  files: "Files",
  folders: "Folders",
  recycle_bin: "Recycle bin",
  spreadsheet: "Spreadsheet",
  shares: "Shares",
  groups: "Groups",
  storage_nodes: "Storage nodes",
  uploads: "Uploads",
  setup: "Setup",
};

// Human: Display name for a namespace, falling back to the raw value for categories added later.
export function categoryLabel(category: string): string {
  return CATEGORY_LABELS[category] ?? category;
}

export type AuditFilterState = {
  q: string;
  preset: AuditRangePreset;
  /** Human: Only meaningful when preset is "custom" — ISO date-time strings. */
  from: string;
  to: string;
  categories: string[];
  actions: string[];
  severities: AdminAuditSeverity[];
  actors: string[];
  ip: string;
  resourceType: string;
  resourceId: string;
  sort: "newest" | "oldest";
};

export const EMPTY_AUDIT_FILTER: AuditFilterState = {
  q: "",
  preset: "all",
  from: "",
  to: "",
  categories: [],
  actions: [],
  severities: [],
  actors: [],
  ip: "",
  resourceType: "",
  resourceId: "",
  sort: "newest",
};

// Human: Resolve a preset into absolute RFC 3339 bounds the API understands.
// Agent: Computed at request time so a long-lived tab keeps a moving window, not a frozen one.
export function resolveRange(state: AuditFilterState): { from?: string; to?: string } {
  if (state.preset === "all") return {};
  if (state.preset === "custom") {
    const from = state.from ? new Date(state.from) : null;
    const to = state.to ? new Date(state.to) : null;
    return {
      from: from && !Number.isNaN(from.getTime()) ? from.toISOString() : undefined,
      to: to && !Number.isNaN(to.getTime()) ? to.toISOString() : undefined,
    };
  }
  const duration = PRESET_DURATION_MS[state.preset];
  return { from: new Date(Date.now() - duration).toISOString() };
}

// Human: Build the query string for the API — filters only, no pagination.
// Agent: SHARED by rows, facets, and export so all three see an identical filter.
export function toApiParams(state: AuditFilterState): URLSearchParams {
  const params = new URLSearchParams();
  const trimmedQuery = state.q.trim();
  if (trimmedQuery) params.set("q", trimmedQuery);

  const { from, to } = resolveRange(state);
  if (from) params.set("from", from);
  if (to) params.set("to", to);

  if (state.categories.length) params.set("categories", state.categories.join(","));
  if (state.actions.length) params.set("actions", state.actions.join(","));
  if (state.severities.length) params.set("severities", state.severities.join(","));
  if (state.actors.length) params.set("actors", state.actors.join(","));
  if (state.ip.trim()) params.set("ip", state.ip.trim());
  if (state.resourceType.trim()) params.set("resource_type", state.resourceType.trim());
  if (state.resourceId.trim()) params.set("resource_id", state.resourceId.trim());
  if (state.sort !== "newest") params.set("sort", state.sort);

  return params;
}

// Human: Serialize filter state for the address bar so a filtered view is shareable and reload-safe.
// Agent: Stores the preset, not resolved timestamps — a shared link keeps a relative window.
export function toUrlParams(state: AuditFilterState): URLSearchParams {
  const params = new URLSearchParams();
  if (state.q.trim()) params.set("q", state.q.trim());
  if (state.preset !== "all") params.set("range", state.preset);
  if (state.preset === "custom") {
    if (state.from) params.set("from", state.from);
    if (state.to) params.set("to", state.to);
  }
  if (state.categories.length) params.set("categories", state.categories.join(","));
  if (state.actions.length) params.set("actions", state.actions.join(","));
  if (state.severities.length) params.set("severities", state.severities.join(","));
  if (state.actors.length) params.set("actors", state.actors.join(","));
  if (state.ip.trim()) params.set("ip", state.ip.trim());
  if (state.resourceType.trim()) params.set("resource_type", state.resourceType.trim());
  if (state.resourceId.trim()) params.set("resource_id", state.resourceId.trim());
  if (state.sort !== "newest") params.set("sort", state.sort);
  return params;
}

function splitParam(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function parsePreset(raw: string | null): AuditRangePreset {
  if (!raw) return "all";
  const known: AuditRangePreset[] = ["1h", "24h", "7d", "30d", "all", "custom"];
  return known.includes(raw as AuditRangePreset) ? (raw as AuditRangePreset) : "all";
}

// Human: Rebuild filter state from the address bar on load or back-navigation.
// Agent: Unknown values fall back to defaults — a hand-edited URL must never wedge the panel.
export function fromUrlParams(params: URLSearchParams): AuditFilterState {
  const severities = splitParam(params.get("severities")).filter((value): value is AdminAuditSeverity =>
    AUDIT_SEVERITIES.includes(value as AdminAuditSeverity),
  );
  const sort = params.get("sort") === "oldest" ? "oldest" : "newest";

  return {
    q: params.get("q") ?? "",
    preset: parsePreset(params.get("range")),
    from: params.get("from") ?? "",
    to: params.get("to") ?? "",
    categories: splitParam(params.get("categories")),
    actions: splitParam(params.get("actions")),
    severities,
    actors: splitParam(params.get("actors")),
    ip: params.get("ip") ?? "",
    resourceType: params.get("resource_type") ?? "",
    resourceId: params.get("resource_id") ?? "",
    sort,
  };
}

/** Human: One removable filter chip — `remove` returns the state without that constraint. */
export type AuditFilterChip = {
  id: string;
  label: string;
  value: string;
  remove: (state: AuditFilterState) => AuditFilterState;
};

// Human: Every active constraint as a chip, so filter state is always visible, never hidden in dropdowns.
export function activeChips(state: AuditFilterState): AuditFilterChip[] {
  const chips: AuditFilterChip[] = [];

  if (state.q.trim()) {
    chips.push({
      id: "q",
      label: "Search",
      value: state.q.trim(),
      remove: (s) => ({ ...s, q: "" }),
    });
  }

  if (state.preset !== "all") {
    const presetLabel =
      state.preset === "custom"
        ? [state.from || "…", state.to || "…"].join(" → ")
        : (AUDIT_RANGE_PRESETS.find((p) => p.id === state.preset)?.label ?? state.preset);
    chips.push({
      id: "range",
      label: "Time",
      value: presetLabel,
      remove: (s) => ({ ...s, preset: "all", from: "", to: "" }),
    });
  }

  for (const category of state.categories) {
    chips.push({
      id: `category:${category}`,
      label: "Category",
      value: categoryLabel(category),
      remove: (s) => ({ ...s, categories: s.categories.filter((c) => c !== category) }),
    });
  }

  for (const action of state.actions) {
    chips.push({
      id: `action:${action}`,
      label: "Action",
      value: action,
      remove: (s) => ({ ...s, actions: s.actions.filter((a) => a !== action) }),
    });
  }

  for (const severity of state.severities) {
    chips.push({
      id: `severity:${severity}`,
      label: "Severity",
      value: severity,
      remove: (s) => ({ ...s, severities: s.severities.filter((v) => v !== severity) }),
    });
  }

  for (const actor of state.actors) {
    chips.push({
      id: `actor:${actor}`,
      label: "Actor",
      value: actor,
      remove: (s) => ({ ...s, actors: s.actors.filter((a) => a !== actor) }),
    });
  }

  if (state.ip.trim()) {
    chips.push({
      id: "ip",
      label: "IP",
      value: state.ip.trim(),
      remove: (s) => ({ ...s, ip: "" }),
    });
  }

  if (state.resourceType.trim()) {
    chips.push({
      id: "resource_type",
      label: "Resource type",
      value: state.resourceType.trim(),
      remove: (s) => ({ ...s, resourceType: "" }),
    });
  }

  if (state.resourceId.trim()) {
    chips.push({
      id: "resource_id",
      label: "Resource",
      value: state.resourceId.trim(),
      remove: (s) => ({ ...s, resourceId: "" }),
    });
  }

  return chips;
}

export function hasActiveFilters(state: AuditFilterState): boolean {
  return activeChips(state).length > 0;
}

// Human: Toggle one value in a multi-select dimension — powers both dropdowns and click-to-filter.
export function toggleValue<T>(values: T[], value: T): T[] {
  return values.includes(value) ? values.filter((v) => v !== value) : [...values, value];
}
