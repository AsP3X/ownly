// Human: Audit filter bar — search, time range, faceted multi-selects, and removable active-filter chips.
// Agent: CONTROLLED by AuditFilterState; every change calls onChange with a new state object.

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AdminAuditFacetBucket, AdminAuditSeverity } from "@/api/client";
import {
  activeChips,
  AUDIT_CATEGORY_GROUPS,
  AUDIT_RANGE_PRESETS,
  AUDIT_SEVERITIES,
  categoryLabel,
  hasActiveFilters,
  toggleValue,
  type AuditFilterState,
  type AuditRangePreset,
} from "@/components/admin/console/audit-log-filters";

function countFor(buckets: AdminAuditFacetBucket[], key: string): number | null {
  return buckets.find((bucket) => bucket.key === key)?.count ?? null;
}

/** Human: Dropdown holding multi-select options with live facet counts. */
function FacetDropdown({
  label,
  selectedCount,
  children,
}: {
  label: string;
  selectedCount: number;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Human: Close on outside click or Escape so the dropdown never traps the operator.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="true"
        className={cn(
          "flex h-9 items-center gap-1.5 rounded-lg border px-3 text-xs font-semibold transition-colors",
          selectedCount > 0
            ? "border-brand bg-brand-weak text-brand"
            : "border-edge bg-panel text-ink-muted hover:text-ink",
        )}
      >
        {label}
        {selectedCount > 0 ? (
          <span className="rounded-full bg-brand px-1.5 text-[10px] font-bold text-brand-on">
            {selectedCount}
          </span>
        ) : null}
        <ChevronDown className="size-3.5 shrink-0" aria-hidden />
      </button>
      {open ? (
        <div className="absolute left-0 z-30 mt-1 max-h-80 w-64 overflow-y-auto rounded-lg border border-edge bg-panel p-1 shadow-lg">
          {children}
        </div>
      ) : null}
    </div>
  );
}

/** Human: One selectable option row with its facet count. */
function FacetOption({
  label,
  count,
  selected,
  onToggle,
}: {
  label: string;
  count: number | null;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitemcheckbox"
      aria-checked={selected}
      onClick={onToggle}
      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-ink hover:bg-surface"
    >
      <span
        className={cn(
          "flex size-4 shrink-0 items-center justify-center rounded border",
          selected ? "border-brand bg-brand text-brand-on" : "border-edge",
        )}
        aria-hidden
      >
        {selected ? <Check className="size-3" /> : null}
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count != null ? (
        <span className="shrink-0 text-[10px] font-semibold text-ink-faint">
          {count.toLocaleString()}
        </span>
      ) : null}
    </button>
  );
}

export function AuditFilterBar({
  state,
  onChange,
  facets,
  searchRef,
}: {
  state: AuditFilterState;
  onChange: (next: AuditFilterState) => void;
  facets: {
    categories: AdminAuditFacetBucket[];
    severities: AdminAuditFacetBucket[];
    actions: AdminAuditFacetBucket[];
    actors: AdminAuditFacetBucket[];
  } | null;
  searchRef?: React.RefObject<HTMLInputElement | null>;
}) {
  const chips = activeChips(state);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex h-9 min-w-[240px] flex-1 items-center gap-2 rounded-lg border border-edge bg-panel px-3">
          <Search className="size-3.5 shrink-0 text-ink-faint" aria-hidden />
          <input
            ref={searchRef}
            type="search"
            value={state.q}
            onChange={(event) => onChange({ ...state, q: event.target.value })}
            placeholder="Search action, actor, resource, or IP…   (press / to focus)"
            aria-label="Search audit events"
            className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-faint"
          />
        </div>

        <select
          value={state.preset}
          onChange={(event) =>
            onChange({ ...state, preset: event.target.value as AuditRangePreset })
          }
          aria-label="Time range"
          className="h-9 rounded-lg border border-edge bg-panel px-2 text-xs font-semibold text-ink outline-none"
        >
          {AUDIT_RANGE_PRESETS.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.label}
            </option>
          ))}
          <option value="custom">Custom range…</option>
        </select>

        <FacetDropdown label="Category" selectedCount={state.categories.length}>
          {AUDIT_CATEGORY_GROUPS.map((group) => (
            <div key={group.label}>
              <p className="px-2 pb-1 pt-2 text-[10px] font-bold uppercase tracking-wide text-ink-faint">
                {group.label}
              </p>
              {group.categories.map((category) => (
                <FacetOption
                  key={category}
                  label={categoryLabel(category)}
                  count={facets ? countFor(facets.categories, category) : null}
                  selected={state.categories.includes(category)}
                  onToggle={() =>
                    onChange({ ...state, categories: toggleValue(state.categories, category) })
                  }
                />
              ))}
            </div>
          ))}
        </FacetDropdown>

        <FacetDropdown label="Severity" selectedCount={state.severities.length}>
          {AUDIT_SEVERITIES.map((severity) => (
            <FacetOption
              key={severity}
              label={severity}
              count={facets ? countFor(facets.severities, severity) : null}
              selected={state.severities.includes(severity)}
              onToggle={() =>
                onChange({
                  ...state,
                  severities: toggleValue<AdminAuditSeverity>(state.severities, severity),
                })
              }
            />
          ))}
        </FacetDropdown>

        <FacetDropdown label="Actor" selectedCount={state.actors.length}>
          {facets?.actors.length ? (
            facets.actors.map((actor) => (
              <FacetOption
                key={actor.key}
                label={actor.label}
                count={actor.count}
                selected={state.actors.includes(actor.key)}
                onToggle={() => onChange({ ...state, actors: toggleValue(state.actors, actor.key) })}
              />
            ))
          ) : (
            <p className="px-2 py-3 text-xs text-ink-faint">No actors in range</p>
          )}
        </FacetDropdown>

        <FacetDropdown label="Action" selectedCount={state.actions.length}>
          {facets?.actions.length ? (
            facets.actions.map((action) => (
              <FacetOption
                key={action.key}
                label={action.key}
                count={action.count}
                selected={state.actions.includes(action.key)}
                onToggle={() =>
                  onChange({ ...state, actions: toggleValue(state.actions, action.key) })
                }
              />
            ))
          ) : (
            <p className="px-2 py-3 text-xs text-ink-faint">No actions in range</p>
          )}
        </FacetDropdown>
      </div>

      {state.preset === "custom" ? (
        <div className="flex flex-wrap items-center gap-2 text-xs text-ink-muted">
          <label className="flex items-center gap-1.5">
            From
            <input
              type="datetime-local"
              value={state.from}
              onChange={(event) => onChange({ ...state, from: event.target.value })}
              className="h-9 rounded-lg border border-edge bg-panel px-2 text-xs text-ink outline-none"
            />
          </label>
          <label className="flex items-center gap-1.5">
            To
            <input
              type="datetime-local"
              value={state.to}
              onChange={(event) => onChange({ ...state, to: event.target.value })}
              className="h-9 rounded-lg border border-edge bg-panel px-2 text-xs text-ink outline-none"
            />
          </label>
        </div>
      ) : null}

      {chips.length ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {chips.map((chip) => (
            <span
              key={chip.id}
              className="inline-flex items-center gap-1 rounded-full border border-edge bg-surface py-1 pl-2.5 pr-1 text-[11px] text-ink"
            >
              <span className="font-semibold text-ink-muted">{chip.label}:</span>
              <span className="max-w-[220px] truncate">{chip.value}</span>
              <button
                type="button"
                onClick={() => onChange(chip.remove(state))}
                aria-label={`Remove ${chip.label} filter ${chip.value}`}
                className="rounded-full p-0.5 text-ink-faint hover:bg-panel hover:text-ink"
              >
                <X className="size-3" aria-hidden />
              </button>
            </span>
          ))}
          {hasActiveFilters(state) ? (
            <button
              type="button"
              onClick={() =>
                onChange({
                  ...state,
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
                })
              }
              className="rounded-full px-2 py-1 text-[11px] font-semibold text-brand hover:underline"
            >
              Clear all
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
