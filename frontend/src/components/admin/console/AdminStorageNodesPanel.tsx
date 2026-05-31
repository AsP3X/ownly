// Human: Admin Console - Storage Nodes panel (login-signup.pencil frame AAH5J).
// Agent: CALLS fetchAdminStorage; RENDERS live object-storage node health and utilization.

import { useCallback, useEffect, useState } from "react";
import {
  Check,
  Info,
  Loader2,
  Plus,
  Power,
  RefreshCw,
  Server,
  Settings,
  Terminal,
} from "lucide-react";
import {
  fetchAdminStorage,
  getErrorMessage,
  type AdminStorageNodeRow,
  type AdminStorageResponse,
} from "@/api/client";
import { AdminAddStorageNodeDialog } from "@/components/admin/console/AdminAddStorageNodeDialog";
import { AdminEditStorageNodeDialog } from "@/components/admin/console/AdminEditStorageNodeDialog";
import { AdminStorageNodeTerminalDialog } from "@/components/admin/console/AdminStorageNodeTerminalDialog";
import {
  AdminConsoleOutlineButton,
  AdminConsolePageHeader,
  AdminConsolePrimaryButton,
  adminConsoleContentClassName,
} from "@/components/admin/console/admin-console-ui";
import { cn } from "@/lib/utils";
import { formatBytes } from "@/lib/utils-app";

type StorageTabId = "all" | "perf";

type MetricBadgeTone = "success" | "info" | "warning";

/** Human: KPI card with header badge — 24px value per Pencil metric cards. */
function StorageMetricCard({
  label,
  value,
  detail,
  badge,
}: {
  label: string;
  value: string;
  detail: string;
  badge: { label: string; tone: MetricBadgeTone };
}) {
  const badgeClass =
    badge.tone === "info"
      ? "bg-[#EFF6FF] text-[#3B82F6]"
      : badge.tone === "warning"
        ? "bg-[#FEF3C7] text-[#D97706]"
        : "bg-[#ECFDF5] text-[#10B981]";

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-[#E5E7EB] bg-white p-5">
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
    </div>
  );
}

/** Human: Underline tabs — 180px min width, 14px labels, 32px gap per Pencil ocelX frame. */
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
    <div className="flex gap-8 border-b border-[#E5E7EB]" role="tablist" aria-label="Storage section tabs">
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
              "flex min-w-[180px] flex-col items-center gap-3 px-2 pb-3 text-sm transition-colors",
              active ? "font-semibold text-[#2563EB]" : "font-normal text-[#666666] hover:text-[#1A1A1A]",
            )}
          >
            <span>{tab.label}</span>
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

/** Human: Parse "used / capacity" label into utilization percent for progress bar width. */
function storageUtilPercent(capacityLabel: string): number {
  const match = capacityLabel.match(/([\d.]+)\s*\/\s*([\d.]+)/);
  if (!match) return 0;
  const used = Number.parseFloat(match[1] ?? "0");
  const cap = Number.parseFloat(match[2] ?? "0");
  if (cap <= 0) return 0;
  return Math.min(100, Math.round((used / cap) * 1000) / 10);
}

/** Human: Format bytes as TB pair when capacity is known — matches Pencil "88.4 TB / 120 TB". */
function formatStorageTbPair(usedBytes: number, capacityBytes: number | null): string {
  if (capacityBytes != null && capacityBytes > 0) {
    const tb = 1024 ** 4;
    return `${(usedBytes / tb).toFixed(1)} TB / ${(capacityBytes / tb).toFixed(1)} TB`;
  }
  return formatBytes(usedBytes);
}

type NodeVisualStatus = "healthy" | "syncing" | "warning";

/** Human: Map backend status strings to Pencil badge + icon chip variants. */
function resolveNodeVisualStatus(status: string): NodeVisualStatus {
  if (status === "healthy") return "healthy";
  return "warning";
}

const NODE_STATUS_STYLES: Record<
  NodeVisualStatus,
  {
    label: string;
    badgeClass: string;
    iconClass: string;
    chipBg: string;
    chipIconClass: string;
    Icon: typeof Check;
  }
> = {
  healthy: {
    label: "Healthy",
    badgeClass: "bg-[#ECFDF5] text-[#10B981]",
    iconClass: "text-[#10B981]",
    chipBg: "bg-[#ECFDF5]",
    chipIconClass: "text-[#10B981]",
    Icon: Check,
  },
  syncing: {
    label: "Syncing",
    badgeClass: "bg-[#EFF6FF] text-[#3B82F6]",
    iconClass: "text-[#3B82F6]",
    chipBg: "bg-[#EFF6FF]",
    chipIconClass: "text-[#3B82F6]",
    Icon: RefreshCw,
  },
  warning: {
    label: "Warning",
    badgeClass: "bg-[#FEF3C7] text-[#D97706]",
    iconClass: "text-[#D97706]",
    chipBg: "bg-[#FEF3C7]",
    chipIconClass: "text-[#D97706]",
    Icon: Info,
  },
};

/** Human: Status pill with icon — Pencil WiThy / puUJi badge frames. */
function NodeStatusBadge({ status }: { status: string }) {
  const visual = resolveNodeVisualStatus(status);
  const styles = NODE_STATUS_STYLES[visual];
  const StatusIcon = styles.Icon;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold",
        styles.badgeClass,
      )}
    >
      <StatusIcon className={cn("size-3", styles.iconClass)} aria-hidden />
      {visual === "warning" && status === "not_configured" ? "Not configured" : styles.label}
    </span>
  );
}

/** Human: Node ID cell — 32px server chip + id/region stack per Pencil IH5k7 frame. */
function NodeInfoCell({ row }: { row: AdminStorageNodeRow }) {
  const visual = resolveNodeVisualStatus(row.status);
  const styles = NODE_STATUS_STYLES[visual];

  return (
    <div className="flex items-center gap-3">
      <div
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-full",
          styles.chipBg,
        )}
        aria-hidden
      >
        <Server className={cn("size-3.5", styles.chipIconClass)} />
      </div>
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate text-sm font-semibold text-[#1A1A1A]">{row.id}</span>
        <span className="truncate text-xs text-[#666666]">{row.region_label}</span>
      </div>
    </div>
  );
}

/** Human: Storage capacity cell — label + 4px progress bar per Pencil lciNf frame. */
function StorageCapacityCell({ capacityLabel }: { capacityLabel: string }) {
  const percent = storageUtilPercent(capacityLabel);

  return (
    <div className="flex w-full min-w-[120px] flex-col gap-1">
      <span className="text-[13px] font-medium text-[#1A1A1A]">{capacityLabel}</span>
      <div className="h-1 overflow-hidden rounded-sm bg-[#E5E7EB]">
        <div
          className="h-full rounded-sm bg-[#2563EB] transition-[width]"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

/** Human: Row action icons — terminal, settings, power per Pencil Oyrpb frame. */
function NodeRowActions({
  onEdit,
  onOpenTerminal,
}: {
  onEdit: () => void;
  onOpenTerminal: () => void;
}) {
  return (
    <div className="flex items-center gap-4">
      <button
        type="button"
        onClick={onOpenTerminal}
        className="text-[#666666] transition-colors hover:text-[#1A1A1A]"
        aria-label="Open node terminal"
      >
        <Terminal className="size-4" aria-hidden />
      </button>
      <button
        type="button"
        onClick={onEdit}
        className="text-[#666666] transition-colors hover:text-[#1A1A1A]"
        aria-label="Edit storage node"
      >
        <Settings className="size-4" aria-hidden />
      </button>
      <button
        type="button"
        className="text-[#EF4444] transition-colors hover:text-[#DC2626]"
        aria-label="Power off node"
      >
        <Power className="size-4" aria-hidden />
      </button>
    </div>
  );
}

/** Human: Storage nodes table — custom layout matching Pencil Oz264 container. */
function StorageNodesTable({
  nodes,
  onEditNode,
  onOpenTerminal,
}: {
  nodes: AdminStorageNodeRow[];
  onEditNode: (node: AdminStorageNodeRow) => void;
  onOpenTerminal: (node: AdminStorageNodeRow) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-[#E5E7EB] bg-white">
      <table className="w-full min-w-[960px] text-left">
        <caption className="sr-only">Storage nodes</caption>
        <thead>
          <tr className="h-12 border-b border-[#E5E7EB] bg-[#F7F8FA]">
            {[
              "Node ID / Region",
              "IP Address",
              "Status",
              "Storage Capacity",
              "Latency",
              "Bandwidth",
              "Actions",
            ].map((col) => (
              <th
                key={col}
                className="px-5 py-0 text-xs font-semibold text-[#666666] first:min-w-[260px]"
              >
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-[#E5E7EB]">
          {nodes.map((row) => (
            <tr key={row.id} className="h-16 text-[#1A1A1A] hover:bg-[#F7F8FA]/60">
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
                <StorageCapacityCell capacityLabel={row.capacity_label} />
              </td>
              <td className="px-5 py-0 align-middle text-[13px]">
                {row.latency_ms != null ? `${row.latency_ms} ms` : "—"}
              </td>
              <td className="px-5 py-0 align-middle text-[13px]">—</td>
              <td className="px-5 py-0 align-middle">
                <NodeRowActions
                  onEdit={() => onEditNode(row)}
                  onOpenTerminal={() => onOpenTerminal(row)}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Human: Storage nodes network — health metrics and configured backend node table. */
export function AdminStorageNodesPanel() {
  const [tab, setTab] = useState<StorageTabId>("all");
  const [data, setData] = useState<AdminStorageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addNodeOpen, setAddNodeOpen] = useState(false);
  const [editNodeOpen, setEditNodeOpen] = useState(false);
  const [editNode, setEditNode] = useState<AdminStorageNodeRow | null>(null);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [terminalNode, setTerminalNode] = useState<AdminStorageNodeRow | null>(null);
  const [terminalSessionKey, setTerminalSessionKey] = useState(0);

  const load = useCallback(async (showRefresh: boolean) => {
    if (showRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      setData(await fetchAdminStorage());
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial storage fetch on mount
    void load(false);
  }, [load]);

  const metrics = data?.metrics;
  const utilizationPct =
    metrics?.capacity_bytes && metrics.capacity_bytes > 0
      ? Math.round((metrics.used_bytes / metrics.capacity_bytes) * 1000) / 10
      : 0;
  const usedLabel = metrics
    ? formatStorageTbPair(metrics.used_bytes, metrics.capacity_bytes)
    : "—";

  const inactiveNodes = metrics ? metrics.total_nodes - metrics.active_nodes : 0;
  const nodeStatusDetail =
    metrics && metrics.total_nodes === 0
      ? "Object storage not configured"
      : inactiveNodes > 0
        ? `${inactiveNodes} node${inactiveNodes > 1 ? "s" : ""} currently unavailable`
        : "All configured nodes operational";

  const latencyBadgeLabel =
    metrics?.avg_latency_ms != null && metrics.avg_latency_ms <= 50 ? "Optimal" : "Live";

  return (
    <div className={adminConsoleContentClassName}>
      <AdminConsolePageHeader
        titleSize="md"
        title="Storage Nodes Network"
        description="Monitor registered Nebular endpoints, capacity, and health probes."
        actions={
          <>
            <AdminConsoleOutlineButton onClick={() => void load(true)} disabled={loading || refreshing}>
              {refreshing ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <RefreshCw className="size-4 shrink-0" aria-hidden />
              )}
              Refresh
            </AdminConsoleOutlineButton>
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
            onChange={(id) => setTab(id as StorageTabId)}
          />

          <div className="grid gap-4 md:grid-cols-3">
            <StorageMetricCard
              label="TOTAL STORAGE UTILIZED"
              value={usedLabel}
              detail={`${utilizationPct}% average disk storage utilized across network`}
              badge={{ label: utilizationPct > 85 ? "High" : "Optimal", tone: "success" }}
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
            />
            <StorageMetricCard
              label="AVG NETWORK LATENCY"
              value={metrics.avg_latency_ms != null ? `${metrics.avg_latency_ms} ms` : "—"}
              detail="Health probe to object storage /health endpoint"
              badge={{ label: latencyBadgeLabel, tone: "success" }}
            />
          </div>

          {tab === "all" ? (
            data.nodes.length === 0 ? (
              <p className="text-sm text-[#666666]">
                No object storage node is configured. Set object storage environment variables and restart
                the API.
              </p>
            ) : (
              <StorageNodesTable
                nodes={data.nodes}
                onEditNode={(node) => {
                  setEditNode(node);
                  setEditNodeOpen(true);
                }}
                onOpenTerminal={(node) => {
                  setTerminalNode(node);
                  setTerminalSessionKey((key) => key + 1);
                  setTerminalOpen(true);
                }}
              />
            )
          ) : (
            <p className="text-sm text-[#666666]">
              {`Current utilization: ${utilizationPct}%. Latency: ${metrics.avg_latency_ms ?? "n/a"} ms.`}
            </p>
          )}
        </>
      ) : null}

      <AdminAddStorageNodeDialog
        open={addNodeOpen}
        onOpenChange={setAddNodeOpen}
        onCreated={() => void load(true)}
      />

      <AdminEditStorageNodeDialog
        key={editNode?.id ?? "edit-node-closed"}
        open={editNodeOpen}
        onOpenChange={(open) => {
          setEditNodeOpen(open);
          if (!open) setEditNode(null);
        }}
        node={editNode}
        onUpdated={() => void load(true)}
      />

      <AdminStorageNodeTerminalDialog
        open={terminalOpen}
        onOpenChange={setTerminalOpen}
        node={terminalNode}
        sessionKey={terminalSessionKey}
      />
    </div>
  );
}
