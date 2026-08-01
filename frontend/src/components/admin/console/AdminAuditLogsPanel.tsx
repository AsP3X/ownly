// Human: Admin Console - System Audit Logs panel; faceted filtering, detail dialog, server-side CSV export.
// Agent: CALLS fetchAdminAuditLogs/fetchAdminAuditFacets/downloadAdminAuditCsv; SYNCS filter state to the URL.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Download, Loader2, RefreshCw, ScrollText, Users, Zap } from "lucide-react";
import {
  downloadAdminAuditCsv,
  fetchAdminAuditFacets,
  fetchAdminAuditLogs,
  getErrorMessage,
  type AdminAuditFacetsResponse,
  type AdminAuditLogRow,
  type AdminAuditSeverity,
} from "@/api/client";
import {
  AdminConsoleMetricCard,
  AdminConsoleOutlineButton,
  AdminConsolePageHeader,
  adminConsoleContentClassName,
} from "@/components/admin/console/admin-console-ui";
import { AuditEventDialog } from "@/components/admin/console/AuditEventDialog";
import { AuditFilterBar } from "@/components/admin/console/AuditFilterBar";
import { AuditLogTable } from "@/components/admin/console/AuditLogTable";
import {
  EMPTY_AUDIT_FILTER,
  fromUrlParams,
  hasActiveFilters,
  toApiParams,
  toggleValue,
  toUrlParams,
  type AuditFilterState,
} from "@/components/admin/console/audit-log-filters";

const SEARCH_DEBOUNCE_MS = 300;
const PAGE_SIZE = 50;

export function AdminAuditLogsPanel() {
  const [filter, setFilter] = useState<AuditFilterState>(() =>
    fromUrlParams(new URLSearchParams(window.location.search)),
  );
  // Human: Debounced copy — typing must not fire a request per keystroke.
  const [appliedFilter, setAppliedFilter] = useState(filter);

  const [rows, setRows] = useState<AdminAuditLogRow[]>([]);
  const [totalMatching, setTotalMatching] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [facets, setFacets] = useState<AdminAuditFacetsResponse | null>(null);

  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<AdminAuditLogRow | null>(null);

  const searchRef = useRef<HTMLInputElement>(null);

  // Human: Debounce filter changes into the applied filter that actually drives requests.
  useEffect(() => {
    const timer = window.setTimeout(() => setAppliedFilter(filter), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [filter]);

  // Human: Mirror filter state into the address bar so the view is shareable and survives reload.
  // Agent: replaceState — filtering should not stack history entries.
  useEffect(() => {
    const params = toUrlParams(appliedFilter).toString();
    const next = `${window.location.pathname}${params ? `?${params}` : ""}`;
    window.history.replaceState(null, "", next);
  }, [appliedFilter]);

  const apiParams = useMemo(() => toApiParams(appliedFilter).toString(), [appliedFilter]);

  const loadPage = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams(apiParams);
      params.set("limit", String(PAGE_SIZE));
      const response = await fetchAdminAuditLogs(params);
      setRows(response.rows);
      setTotalMatching(response.total_matching);
      setNextCursor(response.next_cursor);
    } catch (err) {
      setError(getErrorMessage(err));
      setRows([]);
      setTotalMatching(0);
      setNextCursor(null);
    } finally {
      setLoading(false);
    }
  }, [apiParams]);

  // Human: Facets are heavier than the row query, so they load alongside rather than blocking them.
  const loadFacets = useCallback(async () => {
    try {
      setFacets(await fetchAdminAuditFacets(new URLSearchParams(apiParams)));
    } catch {
      // Human: Facet counts are an enhancement — the table stays usable without them.
      setFacets(null);
    }
  }, [apiParams]);

  useEffect(() => {
    void loadPage();
    void loadFacets();
  }, [loadPage, loadFacets]);

  // Human: "/" focuses search, matching the muscle memory of log tools.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "/") return;
      const target = event.target as HTMLElement | null;
      const typing =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable;
      if (typing) return;
      event.preventDefault();
      searchRef.current?.focus();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  async function loadMore() {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const params = new URLSearchParams(apiParams);
      params.set("limit", String(PAGE_SIZE));
      params.set("cursor", nextCursor);
      const response = await fetchAdminAuditLogs(params);
      setRows((current) => [...current, ...response.rows]);
      setNextCursor(response.next_cursor);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoadingMore(false);
    }
  }

  async function runExport() {
    const cap = facets?.export_max_rows ?? 0;
    // Human: Truncation is announced before the download, never discovered inside the file.
    if (cap > 0 && totalMatching > cap) {
      const proceed = window.confirm(
        `Exporting ${cap.toLocaleString()} of ${totalMatching.toLocaleString()} matching events.\n\n` +
          "Raise the audit export row limit in System Settings to export more.\n\nContinue?",
      );
      if (!proceed) return;
    }

    setExporting(true);
    try {
      await downloadAdminAuditCsv(new URLSearchParams(apiParams));
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setExporting(false);
    }
  }

  const summary = facets?.summary;
  const filtered = hasActiveFilters(appliedFilter);

  return (
    <div className={adminConsoleContentClassName}>
      <AdminConsolePageHeader
        titleSize="md"
        title="System Audit Logs"
        description="Traceable ledger of all administrative security events, encryption operations, node changes, and file access."
        actions={
          <>
            <AdminConsoleOutlineButton
              onClick={() => {
                void loadPage();
                void loadFacets();
              }}
              disabled={loading}
            >
              {loading ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
              ) : (
                <RefreshCw className="size-3.5 shrink-0" aria-hidden />
              )}
              Refresh
            </AdminConsoleOutlineButton>
            <AdminConsoleOutlineButton onClick={() => void runExport()} disabled={exporting || !rows.length}>
              {exporting ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
              ) : (
                <Download className="size-3.5 shrink-0" aria-hidden />
              )}
              Export CSV
            </AdminConsoleOutlineButton>
          </>
        }
      />

      {error ? (
        <p className="rounded-lg border border-danger/40 bg-danger-weak px-4 py-3 text-sm text-danger" role="alert">
          {error}
        </p>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <AdminConsoleMetricCard
          label={filtered ? "MATCHING EVENTS" : "TOTAL LOGGED EVENTS"}
          value={(summary?.total ?? 0).toLocaleString()}
          detail={filtered ? "Within the active filter" : "Across the whole ledger"}
          icon={ScrollText}
          iconBg="bg-brand-weak"
          iconColor="text-brand"
        />
        <AdminConsoleMetricCard
          label="CRITICAL & WARNING"
          value={(summary?.elevated ?? 0).toLocaleString()}
          detail="Destructive or access-reducing events"
          badge={summary?.elevated ? { label: "Review", tone: "warning" } : { label: "Clear", tone: "success" }}
          icon={AlertTriangle}
          iconBg="bg-warn-weak"
          iconColor="text-warn"
        />
        <AdminConsoleMetricCard
          label="DISTINCT ACTORS"
          value={(summary?.distinct_actors ?? 0).toLocaleString()}
          detail="Unique authenticated users in range"
          icon={Users}
          iconBg="bg-ok-weak"
          iconColor="text-ok"
        />
        <AdminConsoleMetricCard
          label="BUSIEST ACTION"
          value={summary?.busiest_action ?? "—"}
          detail={
            summary?.busiest_action
              ? `${summary.busiest_action_count.toLocaleString()} events`
              : "No events in range"
          }
          icon={Zap}
          iconBg="bg-brand-weak"
          iconColor="text-brand"
        />
      </div>

      <AuditFilterBar
        state={filter}
        onChange={setFilter}
        facets={facets}
        searchRef={searchRef}
      />

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-12 text-sm text-ink-muted">
          <Loader2 className="size-5 animate-spin" aria-hidden />
          Loading audit events…
        </div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-edge bg-panel py-12 text-center">
          <p className="text-sm text-ink-muted">
            {filtered ? "No events match these filters." : "No audit events have been recorded yet."}
          </p>
          {filtered ? (
            <button
              type="button"
              onClick={() => setFilter(EMPTY_AUDIT_FILTER)}
              className="text-xs font-semibold text-brand hover:underline"
            >
              Clear filters
            </button>
          ) : null}
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between text-xs text-ink-muted">
            <span>
              Showing {rows.length.toLocaleString()} of {totalMatching.toLocaleString()} matching
              {totalMatching === 1 ? " event" : " events"}
            </span>
          </div>

          <AuditLogTable
            rows={rows}
            sort={filter.sort}
            onSortChange={(sort) => setFilter((current) => ({ ...current, sort }))}
            onSelect={setSelected}
            selectedId={selected?.id ?? null}
            onFilterActor={(actor) =>
              setFilter((current) => ({ ...current, actors: toggleValue(current.actors, actor) }))
            }
            onFilterAction={(action) =>
              setFilter((current) => ({ ...current, actions: toggleValue(current.actions, action) }))
            }
            onFilterSeverity={(severity) =>
              setFilter((current) => ({
                ...current,
                severities: toggleValue<AdminAuditSeverity>(current.severities, severity),
              }))
            }
            onFilterIp={(ip) =>
              setFilter((current) => ({ ...current, ip: current.ip === ip ? "" : ip }))
            }
          />

          {nextCursor ? (
            <div className="flex justify-center">
              <AdminConsoleOutlineButton onClick={() => void loadMore()} disabled={loadingMore}>
                {loadingMore ? (
                  <Loader2 className="size-3.5 animate-spin" aria-hidden />
                ) : null}
                Load more
              </AdminConsoleOutlineButton>
            </div>
          ) : null}
        </>
      )}

      <AuditEventDialog row={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
