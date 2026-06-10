// Human: Admin Console — Storage Nodes panel with filters, performance view, and responsive cards.
// Agent: CALLS fetchAdminStorage; RENDERS table (md+) and card list (mobile); OPENS detail/edit dialogs.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAdminQuery } from "@/hooks/useAdminQuery";
import {
  Loader2,
  MoreHorizontal,
  PanelRightOpen,
  Plus,
  RefreshCw,
  Server,
  Settings,
} from "lucide-react";
import {
  fetchAdminStorage,
  type AdminStorageNodeRow,
} from "@/api/client";
import { AdminAddStorageNodeDialog } from "@/components/admin/console/AdminAddStorageNodeDialog";
import { AdminEditStorageNodeDialog } from "@/components/admin/console/AdminEditStorageNodeDialog";
import { AdminStorageNodeDetailDialog } from "@/components/admin/console/AdminStorageNodeDetailDialog";
import {
  AdminConsoleOutlineButton,
  AdminConsolePageHeader,
  AdminConsolePrimaryButton,
  adminConsoleContentClassName,
} from "@/components/admin/console/admin-console-ui";
import {
  isPrimaryStorageNode,
  storageNodeStatusHint,
  storageNodeStatusLabel,
  storageNodeStatusMeta,
} from "@/lib/storage-node-status";
import { cn } from "@/lib/utils";
import { formatBytes, formatLastRefreshed } from "@/lib/utils-app";

type StorageTabId = "all" | "perf";
type NodeFilter = "all" | "active" | "degraded" | "high-util";

type MetricBadgeTone = "success" | "info" | "warning";

const HIGH_UTIL_PERCENT = 85;
const SLOW_LATENCY_MS = 50;

/** Human: Utilization percent from byte counts — used for labels, filters, and progress bars. */
function storageUtilPercentFromBytes(usedBytes: number, capacityBytes: number | null): number {
  if (capacityBytes == null || capacityBytes <= 0) return 0;
  return Math.min(100, Math.round((usedBytes / capacityBytes) * 100));
}

/** Human: Used / total capacity with per-value units (KB, MB, GB, TB) from byte counts. */
function formatStorageUtilizationPair(usedBytes: number, capacityBytes: number | null): string {
  if (capacityBytes != null && capacityBytes > 0) {
    return `${formatBytes(usedBytes)} / ${formatBytes(capacityBytes)}`;
  }
  return formatBytes(usedBytes);
}

/** Human: KPI card — optional click applies a node filter or switches tabs. */
function StorageMetricCard({
  label,
  value,
  detail,
  badge,
  active,
  onClick,
}: {
  label: string;
  value: string;
  detail: string;
  badge: { label: string; tone: MetricBadgeTone };
  active?: boolean;
  onClick?: () => void;
}) {
  const badgeClass =
    badge.tone === "info"
      ? "bg-[#EFF6FF] text-[#3B82F6]"
      : badge.tone === "warning"
        ? "bg-[#FEF3C7] text-[#D97706]"
        : "bg-[#ECFDF5] text-[#10B981]";

  const Wrapper = onClick ? "button" : "div";

  return (
    <Wrapper
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={cn(
        "flex flex-col gap-3 rounded-xl border border-[#E5E7EB] bg-white p-5 text-left transition-colors",
        onClick && "cursor-pointer hover:border-[#2563EB]/40 hover:bg-[#F7F8FA]/50",
        active && "border-[#2563EB] ring-2 ring-[#2563EB]/20",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-[13px] font-bold text-[#666666]">{label}</p>
        <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold", badgeClass)}>
          {badge.label}
        </span>
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-2xl font-bold leading-none text-[#1A1A1A]">{value}</p>
        <p className="text-xs font-normal text-[#888888]">{detail}</p>
      </div>
    </Wrapper>
  );
}

/** Human: Underline tabs — scrollable on narrow viewports. */
function StorageNodesTabs({
  tabs,
  activeId,
  onChange,
}: {
  tabs: { id: string; label: string }[];
  activeId: string;
  onChange: (id: string) => void;
}) {
  return (
    <div
      className="flex gap-6 overflow-x-auto border-b border-[#E5E7EB] sm:gap-8"
      role="tablist"
      aria-label="Storage section tabs"
    >
      {tabs.map((tab) => {
        const active = tab.id === activeId;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(tab.id)}
            className={cn(
              "flex min-w-[140px] shrink-0 flex-col items-center gap-3 px-2 pb-3 text-sm transition-colors sm:min-w-[180px]",
              active ? "font-semibold text-[#2563EB]" : "font-normal text-[#666666] hover:text-[#1A1A1A]",
            )}
          >
            <span className="whitespace-nowrap">{tab.label}</span>
            <span
              className={cn("h-0.5 w-full rounded-full", active ? "bg-[#2563EB]" : "bg-transparent")}
              aria-hidden
            />
          </button>
        );
      })}
    </div>
  );
}

/** Human: Status pill with shared vocabulary from storage-node-status.ts. */
function NodeStatusBadge({ status }: { status: string }) {
  const meta = storageNodeStatusMeta(status);
  const StatusIcon = meta.Icon;
  const hint = storageNodeStatusHint(status);

  return (
    <span
      title={hint ?? undefined}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold",
        meta.badgeClass,
      )}
    >
      <StatusIcon className={cn("size-3", meta.iconClass)} aria-hidden />
      {storageNodeStatusLabel(status)}
    </span>
  );
}

/** Human: Primary node pill — marks the env-bootstrapped registry entry. */
function PrimaryNodeBadge() {
  return (
    <span className="inline-flex rounded-md bg-[#DBEAFE] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#2563EB]">
      Primary
    </span>
  );
}

/** Human: Node ID cell — server chip, id/region, optional primary badge. */
function NodeInfoCell({ row }: { row: AdminStorageNodeRow }) {
  const meta = storageNodeStatusMeta(row.status);

  return (
    <div className="flex items-center gap-3">
      <div
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-full",
          meta.chipBg,
        )}
        aria-hidden
      >
        <Server className={cn("size-3.5", meta.chipIconClass)} />
      </div>
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-semibold text-[#1A1A1A]">{row.id}</span>
          {isPrimaryStorageNode(row.id) ? <PrimaryNodeBadge /> : null}
        </span>
        <span className="truncate text-xs text-[#666666]">{row.region_label}</span>
      </div>
    </div>
  );
}

/** Human: Capacity label, utilization %, and progress bar. */
function StorageCapacityCell({
  usedBytes,
  capacityBytes,
}: {
  usedBytes: number;
  capacityBytes: number | null;
}) {
  const percent = storageUtilPercentFromBytes(usedBytes, capacityBytes);
  const label = formatStorageUtilizationPair(usedBytes, capacityBytes);
  const fillWidth =
    usedBytes > 0 && capacityBytes != null && capacityBytes > 0 ? Math.max(percent, 2) : 0;

  return (
    <div className="flex w-full min-w-[120px] flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[13px] font-medium text-[#1A1A1A]">{label}</span>
        {capacityBytes != null && capacityBytes > 0 ? (
          <span className="shrink-0 text-xs font-semibold text-[#2563EB]">{percent}%</span>
        ) : null}
      </div>
      <div
        className="h-1 overflow-hidden rounded-sm bg-[#E5E7EB]"
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Storage used: ${label}`}
      >
        <div
          className="h-full rounded-sm bg-[#2563EB] transition-[width] duration-300 ease-out"
          style={{ width: `${fillWidth}%` }}
        />
      </div>
    </div>
  );
}

/** Human: Overflow menu — view details and edit; replaces dead power icon. */
function NodeActionsMenu({
  onView,
  onEdit,
}: {
  onView: () => void;
  onEdit: () => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          setOpen((value) => !value);
        }}
        className="flex size-8 items-center justify-center rounded-lg text-[#666666] transition-colors hover:bg-[#F7F8FA] hover:text-[#1A1A1A]"
        aria-label="Node actions"
        aria-expanded={open}
        aria-haspopup="menu"
        title="Node actions"
      >
        <MoreHorizontal className="size-4" aria-hidden />
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 z-20 mt-1 min-w-[168px] overflow-hidden rounded-lg border border-[#E5E7EB] bg-white py-1 shadow-lg"
        >
          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-[#1A1A1A] hover:bg-[#F7F8FA]"
            onClick={(event) => {
              event.stopPropagation();
              setOpen(false);
              onView();
            }}
          >
            <PanelRightOpen className="size-4 text-[#666666]" aria-hidden />
            View details
          </button>
          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-[#1A1A1A] hover:bg-[#F7F8FA]"
            onClick={(event) => {
              event.stopPropagation();
              setOpen(false);
              onEdit();
            }}
          >
            <Settings className="size-4 text-[#666666]" aria-hidden />
            Edit settings
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** Human: Desktop table — row click opens detail; degraded rows show status hint via badge title. */
function StorageNodesTable({
  nodes,
  highlightSlowLatency,
  onEditNode,
  onOpenDetail,
}: {
  nodes: AdminStorageNodeRow[];
  highlightSlowLatency: boolean;
  onEditNode: (node: AdminStorageNodeRow) => void;
  onOpenDetail: (node: AdminStorageNodeRow) => void;
}) {
  return (
    <div className="hidden overflow-x-auto rounded-xl border border-[#E5E7EB] bg-white md:block">
      <table className="w-full min-w-[800px] text-left">
        <caption className="sr-only">Storage nodes</caption>
        <thead>
          <tr className="h-12 border-b border-[#E5E7EB] bg-[#F7F8FA]">
            {["Node ID / Region", "Endpoint host", "Status", "Storage Capacity", "Latency", "Actions"].map(
              (col) => (
                <th
                  key={col}
                  className="px-5 py-0 text-xs font-semibold text-[#666666] first:min-w-[260px]"
                >
                  {col}
                </th>
              ),
            )}
          </tr>
        </thead>
        <tbody className="divide-y divide-[#E5E7EB]">
          {nodes.map((row) => {
            const slow =
              highlightSlowLatency &&
              row.latency_ms != null &&
              row.latency_ms > SLOW_LATENCY_MS;
            return (
              <tr
                key={row.id}
                className={cn(
                  "h-16 cursor-pointer text-[#1A1A1A] hover:bg-[#F7F8FA]/60",
                  slow && "bg-[#FFFBEB]/60",
                )}
                onClick={() => onOpenDetail(row)}
              >
                <td className="px-5 py-0 align-middle">
                  <NodeInfoCell row={row} />
                </td>
                <td className="px-5 py-0 align-middle text-[13px] text-[#666666]">
                  {row.endpoint_host}
                </td>
                <td className="px-5 py-0 align-middle">
                  <NodeStatusBadge status={row.status} />
                </td>
                <td className="px-5 py-0 align-middle">
                  <StorageCapacityCell
                    usedBytes={row.used_bytes}
                    capacityBytes={row.target_capacity_bytes}
                  />
                </td>
                <td className="px-5 py-0 align-middle text-[13px]">
                  {row.latency_ms != null ? `${row.latency_ms} ms` : "—"}
                </td>
                <td className="px-5 py-0 align-middle" onClick={(event) => event.stopPropagation()}>
                  <NodeActionsMenu
                    onView={() => onOpenDetail(row)}
                    onEdit={() => onEditNode(row)}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Human: Mobile card list — replaces horizontal table scroll on small screens. */
function StorageNodesMobileList({
  nodes,
  highlightSlowLatency,
  onEditNode,
  onOpenDetail,
}: {
  nodes: AdminStorageNodeRow[];
  highlightSlowLatency: boolean;
  onEditNode: (node: AdminStorageNodeRow) => void;
  onOpenDetail: (node: AdminStorageNodeRow) => void;
}) {
  return (
    <div className="flex flex-col gap-3 md:hidden">
      {nodes.map((row) => {
        const slow =
          highlightSlowLatency &&
          row.latency_ms != null &&
          row.latency_ms > SLOW_LATENCY_MS;
        return (
          <article
            key={row.id}
            className={cn(
              "rounded-xl border border-[#E5E7EB] bg-white p-4",
              slow && "border-[#F59E0B]/40 bg-[#FFFBEB]/40",
            )}
          >
            <button
              type="button"
              className="flex w-full flex-col gap-3 text-left"
              onClick={() => onOpenDetail(row)}
            >
              <div className="flex items-start justify-between gap-3">
                <NodeInfoCell row={row} />
                <NodeStatusBadge status={row.status} />
              </div>
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-xs font-semibold text-[#888888]">Endpoint host</dt>
                  <dd className="mt-0.5 font-medium text-[#1A1A1A]">{row.endpoint_host}</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold text-[#888888]">Latency</dt>
                  <dd className="mt-0.5 font-medium text-[#1A1A1A]">
                    {row.latency_ms != null ? `${row.latency_ms} ms` : "—"}
                  </dd>
                </div>
              </dl>
              <StorageCapacityCell
                usedBytes={row.used_bytes}
                capacityBytes={row.target_capacity_bytes}
              />
            </button>
            <div className="mt-3 flex justify-end border-t border-[#E5E7EB] pt-3">
              <NodeActionsMenu
                onView={() => onOpenDetail(row)}
                onEdit={() => onEditNode(row)}
              />
            </div>
          </article>
        );
      })}
    </div>
  );
}

/** Human: Performance tab — per-node latency and utilization comparison (not duplicated KPI text). */
function StoragePerformancePanel({
  nodes,
  avgLatencyMs,
}: {
  nodes: AdminStorageNodeRow[];
  avgLatencyMs: number | null;
}) {
  const maxLatency = Math.max(1, ...nodes.map((node) => node.latency_ms ?? 0));

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-[#666666]">
        Per-node probe results from the latest refresh. Network average latency:{" "}
        <span className="font-semibold text-[#1A1A1A]">
          {avgLatencyMs != null ? `${avgLatencyMs} ms` : "—"}
        </span>
        .
      </p>
      <div className="overflow-hidden rounded-xl border border-[#E5E7EB] bg-white">
        {nodes.map((node, index) => {
          const util = storageUtilPercentFromBytes(node.used_bytes, node.target_capacity_bytes);
          const latencyPct =
            node.latency_ms != null ? Math.max(4, Math.round((node.latency_ms / maxLatency) * 100)) : 0;
          return (
            <div
              key={node.id}
              className={cn(
                "flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6",
                index > 0 && "border-t border-[#E5E7EB]",
              )}
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-[#1A1A1A]">{node.id}</p>
                <p className="truncate text-xs text-[#666666]">{node.region_label}</p>
              </div>
              <div className="grid w-full gap-3 sm:max-w-md sm:grid-cols-2">
                <div className="flex flex-col gap-1">
                  <div className="flex justify-between text-xs text-[#666666]">
                    <span>Latency</span>
                    <span className="font-medium text-[#1A1A1A]">
                      {node.latency_ms != null ? `${node.latency_ms} ms` : "—"}
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-sm bg-[#E5E7EB]">
                    <div
                      className="h-full rounded-sm bg-[#10B981]"
                      style={{ width: `${latencyPct}%` }}
                    />
                  </div>
                </div>
                <div className="flex flex-col gap-1">
                  <div className="flex justify-between text-xs text-[#666666]">
                    <span>Utilization</span>
                    <span className="font-medium text-[#1A1A1A]">{util}%</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-sm bg-[#E5E7EB]">
                    <div
                      className="h-full rounded-sm bg-[#2563EB]"
                      style={{ width: `${Math.max(util, node.used_bytes > 0 ? 4 : 0)}%` }}
                    />
                  </div>
                </div>
              </div>
              <NodeStatusBadge status={node.status} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Human: Empty registry — actionable card instead of plain helper text. */
function StorageNodesEmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-xl border border-dashed border-[#E5E7EB] bg-white px-6 py-12 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-[#EFF6FF]">
        <Server className="size-6 text-[#2563EB]" aria-hidden />
      </div>
      <div className="flex max-w-md flex-col gap-2">
        <h2 className="text-lg font-bold text-[#1A1A1A]">No storage nodes configured</h2>
        <p className="text-sm leading-relaxed text-[#666666]">
          Register a Nebular endpoint to monitor capacity and health probes, or configure object
          storage environment variables and restart the API to bootstrap the primary node.
        </p>
      </div>
      <AdminConsolePrimaryButton onClick={onAdd}>
        <Plus className="size-4 shrink-0" aria-hidden />
        Add Storage Node
      </AdminConsolePrimaryButton>
    </div>
  );
}

/** Human: Apply KPI-driven filters before rendering node lists. */
function filterStorageNodes(
  nodes: AdminStorageNodeRow[],
  filter: NodeFilter,
): AdminStorageNodeRow[] {
  switch (filter) {
    case "active":
      return nodes.filter((node) => node.status === "healthy");
    case "degraded":
      return nodes.filter((node) => node.status !== "healthy");
    case "high-util":
      return nodes.filter(
        (node) =>
          storageUtilPercentFromBytes(node.used_bytes, node.target_capacity_bytes) >= HIGH_UTIL_PERCENT,
      );
    default:
      return nodes;
  }
}

/** Human: Storage nodes network — health metrics and configured backend node table. */
export function AdminStorageNodesPanel() {
  const [tab, setTab] = useState<StorageTabId>("all");
  const [nodeFilter, setNodeFilter] = useState<NodeFilter>("all");
  const [highlightSlowLatency, setHighlightSlowLatency] = useState(false);
  const [addNodeOpen, setAddNodeOpen] = useState(false);
  const [editNodeOpen, setEditNodeOpen] = useState(false);
  const [editNode, setEditNode] = useState<AdminStorageNodeRow | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailNode, setDetailNode] = useState<AdminStorageNodeRow | null>(null);
  const [detailInitialTab, setDetailInitialTab] = useState<"overview" | "explore">("overview");

  const loadStorage = useCallback(() => fetchAdminStorage(), []);
  const { data, loading, refreshing, error, lastUpdatedAt, reload } = useAdminQuery(loadStorage);

  const metrics = data?.metrics;
  const utilizationPct =
    metrics?.capacity_bytes && metrics.capacity_bytes > 0
      ? Math.round((metrics.used_bytes / metrics.capacity_bytes) * 1000) / 10
      : 0;
  const usedLabel = metrics
    ? formatStorageUtilizationPair(metrics.used_bytes, metrics.capacity_bytes)
    : "—";

  const inactiveNodes = metrics ? metrics.total_nodes - metrics.active_nodes : 0;
  const nodeStatusDetail =
    metrics && metrics.total_nodes === 0
      ? "Object storage not configured"
      : inactiveNodes > 0
        ? `${inactiveNodes} node${inactiveNodes > 1 ? "s" : ""} currently unavailable`
        : "All configured nodes operational";

  const latencyBadgeLabel =
    metrics?.avg_latency_ms != null && metrics.avg_latency_ms <= SLOW_LATENCY_MS ? "Optimal" : "Live";

  const filteredNodes = useMemo(
    () => filterStorageNodes(data?.nodes ?? [], nodeFilter),
    [data?.nodes, nodeFilter],
  );

  const refreshedLabel = formatLastRefreshed(lastUpdatedAt);

  function openDetail(node: AdminStorageNodeRow, initialTab: "overview" | "explore" = "overview") {
    setDetailInitialTab(initialTab);
    setDetailNode(node);
    setDetailOpen(true);
  }

  return (
    <div className={adminConsoleContentClassName}>
      <AdminConsolePageHeader
        titleSize="md"
        title="Storage Nodes Network"
        description="Monitor registered Nebular endpoints, capacity, and health probes."
        actions={
          <>
            <div className="flex flex-col items-end gap-1">
              <AdminConsoleOutlineButton
                onClick={() => void reload(true)}
                disabled={loading || refreshing}
              >
                {refreshing ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : (
                  <RefreshCw className="size-4 shrink-0" aria-hidden />
                )}
                Refresh
              </AdminConsoleOutlineButton>
              {refreshedLabel ? (
                <p className="text-[11px] text-[#888888]">{refreshedLabel}</p>
              ) : null}
            </div>
            <AdminConsolePrimaryButton onClick={() => setAddNodeOpen(true)}>
              <Plus className="size-4 shrink-0" aria-hidden />
              Add Storage Node
            </AdminConsolePrimaryButton>
          </>
        }
      />

      {error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
          {error}
        </p>
      ) : null}

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-12 text-sm text-[#666666]">
          <Loader2 className="size-5 animate-spin" aria-hidden />
          Loading storage nodes…
        </div>
      ) : null}

      {!loading && metrics && data ? (
        <>
          <StorageNodesTabs
            tabs={[
              { id: "all", label: `All Storage Nodes (${data.nodes.length})` },
              { id: "perf", label: "Performance Metrics" },
            ]}
            activeId={tab}
            onChange={(id) => {
              setTab(id as StorageTabId);
              if (id === "perf") {
                setHighlightSlowLatency(true);
              }
            }}
          />

          <div className="grid gap-4 md:grid-cols-3">
            <StorageMetricCard
              label="TOTAL STORAGE UTILIZED"
              value={usedLabel}
              detail={`${utilizationPct}% average disk storage utilized across network`}
              badge={{ label: utilizationPct > HIGH_UTIL_PERCENT ? "High" : "Optimal", tone: "success" }}
              active={nodeFilter === "high-util"}
              onClick={() => {
                setTab("all");
                setNodeFilter((current) => (current === "high-util" ? "all" : "high-util"));
                setHighlightSlowLatency(false);
              }}
            />
            <StorageMetricCard
              label="NODE STATUS SUMMARY"
              value={`${metrics.active_nodes} / ${metrics.total_nodes} Active`}
              detail={nodeStatusDetail}
              badge={{
                label:
                  metrics.active_nodes === metrics.total_nodes && metrics.total_nodes > 0
                    ? "Stable"
                    : "Degraded",
                tone:
                  metrics.active_nodes === metrics.total_nodes && metrics.total_nodes > 0
                    ? "info"
                    : "warning",
              }}
              active={nodeFilter === "active" || nodeFilter === "degraded"}
              onClick={() => {
                setTab("all");
                if (inactiveNodes > 0) {
                  setNodeFilter((current) => (current === "degraded" ? "all" : "degraded"));
                } else {
                  setNodeFilter((current) => (current === "active" ? "all" : "active"));
                }
                setHighlightSlowLatency(false);
              }}
            />
            <StorageMetricCard
              label="AVG NETWORK LATENCY"
              value={metrics.avg_latency_ms != null ? `${metrics.avg_latency_ms} ms` : "—"}
              detail="Health probe to object storage /health endpoint"
              badge={{ label: latencyBadgeLabel, tone: "success" }}
              active={highlightSlowLatency && tab === "all"}
              onClick={() => {
                setTab("perf");
                setHighlightSlowLatency(true);
                setNodeFilter("all");
              }}
            />
          </div>

          {nodeFilter !== "all" ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-[#666666]">
                Filter:{" "}
                {nodeFilter === "high-util"
                  ? `Utilization ≥ ${HIGH_UTIL_PERCENT}%`
                  : nodeFilter === "active"
                    ? "Active nodes only"
                    : "Degraded nodes only"}
              </span>
              <button
                type="button"
                onClick={() => setNodeFilter("all")}
                className="text-xs font-semibold text-[#2563EB] hover:underline"
              >
                Clear filter
              </button>
            </div>
          ) : null}

          {tab === "all" ? (
            data.nodes.length === 0 ? (
              <StorageNodesEmptyState onAdd={() => setAddNodeOpen(true)} />
            ) : filteredNodes.length === 0 ? (
              <p className="text-sm text-[#666666]">No nodes match the current filter.</p>
            ) : (
              <>
                <StorageNodesTable
                  nodes={filteredNodes}
                  highlightSlowLatency={highlightSlowLatency}
                  onEditNode={(node) => {
                    setEditNode(node);
                    setEditNodeOpen(true);
                  }}
                  onOpenDetail={(node) => openDetail(node)}
                />
                <StorageNodesMobileList
                  nodes={filteredNodes}
                  highlightSlowLatency={highlightSlowLatency}
                  onEditNode={(node) => {
                    setEditNode(node);
                    setEditNodeOpen(true);
                  }}
                  onOpenDetail={(node) => openDetail(node)}
                />
              </>
            )
          ) : data.nodes.length === 0 ? (
            <StorageNodesEmptyState onAdd={() => setAddNodeOpen(true)} />
          ) : (
            <StoragePerformancePanel nodes={data.nodes} avgLatencyMs={metrics.avg_latency_ms} />
          )}
        </>
      ) : null}

      <AdminAddStorageNodeDialog
        open={addNodeOpen}
        onOpenChange={setAddNodeOpen}
        onCreated={() => void reload(true)}
      />

      <AdminEditStorageNodeDialog
        key={editNode?.id ?? "edit-node-closed"}
        open={editNodeOpen}
        onOpenChange={(open) => {
          setEditNodeOpen(open);
          if (!open) setEditNode(null);
        }}
        node={editNode}
        onUpdated={() => void reload(true)}
      />

      <AdminStorageNodeDetailDialog
        open={detailOpen}
        onOpenChange={setDetailOpen}
        node={detailNode}
        initialTab={detailInitialTab}
      />
    </div>
  );
}
