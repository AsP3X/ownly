// Human: Audit event table — sortable by time, click a cell to filter, click a row for detail.
// Agent: PURPOSE-BUILT (not AdminConsoleTable) because rows need identity, selection, and cell actions.

import { ArrowDown, ArrowUp } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AdminAuditLogRow } from "@/api/client";
import { AdminConsolePill } from "@/components/admin/console/admin-console-ui";
import {
  absoluteTime,
  relativeTime,
  severityTone,
} from "@/components/admin/console/audit-log-format";

/** Human: A cell that adds its own value as a filter — "this looks odd" to "show me all of these". */
function FilterableCell({
  value,
  title,
  onFilter,
  className,
}: {
  value: string;
  title: string;
  onFilter: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onFilter();
      }}
      title={title}
      className={cn(
        "max-w-full truncate rounded px-1 py-0.5 text-left hover:bg-brand-weak hover:text-brand",
        className,
      )}
    >
      {value}
    </button>
  );
}

export function AuditLogTable({
  rows,
  sort,
  onSortChange,
  onSelect,
  selectedId,
  onFilterActor,
  onFilterAction,
  onFilterSeverity,
  onFilterIp,
}: {
  rows: AdminAuditLogRow[];
  sort: "newest" | "oldest";
  onSortChange: (sort: "newest" | "oldest") => void;
  onSelect: (row: AdminAuditLogRow) => void;
  selectedId: string | null;
  onFilterActor: (actor: string) => void;
  onFilterAction: (action: string) => void;
  onFilterSeverity: (severity: AdminAuditLogRow["severity"]) => void;
  onFilterIp: (ip: string) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-edge bg-panel">
      <table className="w-full min-w-[900px] text-left text-sm">
        <caption className="sr-only">Audit events</caption>
        <thead>
          <tr className="border-b border-edge bg-surface text-[11px] font-bold uppercase tracking-wide text-ink-faint">
            <th className="px-4 py-3 font-bold">
              <button
                type="button"
                onClick={() => onSortChange(sort === "newest" ? "oldest" : "newest")}
                aria-label={`Sort by time, currently ${sort === "newest" ? "newest first" : "oldest first"}`}
                className="inline-flex items-center gap-1 hover:text-ink"
              >
                Time
                {sort === "newest" ? (
                  <ArrowDown className="size-3" aria-hidden />
                ) : (
                  <ArrowUp className="size-3" aria-hidden />
                )}
              </button>
            </th>
            <th className="px-4 py-3 font-bold">Actor</th>
            <th className="px-4 py-3 font-bold">Action</th>
            <th className="px-4 py-3 font-bold">Description</th>
            <th className="px-4 py-3 font-bold">Severity</th>
            <th className="px-4 py-3 font-bold">IP</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-edge">
          {rows.map((row) => {
            const actor = row.actor_email ?? "system";
            return (
              <tr
                key={row.id}
                onClick={() => onSelect(row)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSelect(row);
                  }
                }}
                tabIndex={0}
                aria-selected={row.id === selectedId}
                className={cn(
                  "cursor-pointer text-ink outline-none hover:bg-surface/60 focus-visible:bg-surface",
                  row.id === selectedId && "bg-brand-weak/40",
                )}
              >
                <td className="whitespace-nowrap px-4 py-3 align-middle">
                  <span title={absoluteTime(row.timestamp)} className="text-xs text-ink-muted">
                    {relativeTime(row.timestamp)}
                  </span>
                </td>
                <td className="max-w-[200px] px-4 py-3 align-middle">
                  <FilterableCell
                    value={actor}
                    title={`Filter by actor ${actor}`}
                    onFilter={() => onFilterActor(actor)}
                    className="text-xs"
                  />
                </td>
                <td className="max-w-[220px] px-4 py-3 align-middle">
                  <FilterableCell
                    value={row.action}
                    title={`Filter by action ${row.action}`}
                    onFilter={() => onFilterAction(row.action)}
                    className="font-mono text-xs font-semibold text-brand"
                  />
                </td>
                <td className="px-4 py-3 align-middle text-xs">{row.label}</td>
                <td className="px-4 py-3 align-middle">
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onFilterSeverity(row.severity);
                    }}
                    title={`Filter by severity ${row.severity}`}
                  >
                    <AdminConsolePill tone={severityTone(row.severity)}>
                      {row.severity}
                    </AdminConsolePill>
                  </button>
                </td>
                <td className="px-4 py-3 align-middle">
                  {row.ip ? (
                    <FilterableCell
                      value={row.ip}
                      title={`Filter by IP ${row.ip}`}
                      onFilter={() => onFilterIp(row.ip as string)}
                      className="font-mono text-xs text-ink-muted"
                    />
                  ) : (
                    <span className="text-xs text-ink-faint">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
