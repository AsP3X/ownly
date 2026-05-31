// Human: Admin Console - Storage Nodes panel (login-signup.pencil frame AAH5J).
// Agent: CALLS fetchAdminStorage; RENDERS live object-storage node health and utilization.

import { useCallback, useEffect, useState } from "react";
import { Loader2, Plus, RefreshCw } from "lucide-react";
import { fetchAdminStorage, getErrorMessage, type AdminStorageResponse } from "@/api/client";
import {
  AdminConsoleMetricCard,
  AdminConsoleOutlineButton,
  AdminConsolePageHeader,
  AdminConsolePrimaryButton,
  AdminConsoleTable,
  AdminConsoleUnderlineTabs,
  AdminConsolePill,
  adminConsoleContentClassName,
} from "@/components/admin/console/admin-console-ui";
import { formatBytes } from "@/lib/utils-app";

/** Human: Storage nodes network — health metrics and configured backend node table. */
export function AdminStorageNodesPanel() {
  const [tab, setTab] = useState("all");
  const [data, setData] = useState<AdminStorageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
  const usedLabel =
    metrics?.capacity_bytes != null
      ? `${formatBytes(metrics.used_bytes)} / ${formatBytes(metrics.capacity_bytes)}`
      : formatBytes(metrics?.used_bytes ?? 0);
  const utilizationPct =
    metrics?.capacity_bytes && metrics.capacity_bytes > 0
      ? Math.round((metrics.used_bytes / metrics.capacity_bytes) * 1000) / 10
      : 0;

  return (
    <div className={adminConsoleContentClassName}>
      <AdminConsolePageHeader
        titleSize="md"
        title="Storage Nodes Network"
        description="Monitor network health, data replication status, and peer performance across global storage clusters."
        actions={
          <>
            <AdminConsoleOutlineButton onClick={() => void load(true)} disabled={loading || refreshing}>
              {refreshing ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
              ) : (
                <RefreshCw className="size-3.5 shrink-0" aria-hidden />
              )}
              Refresh Health
            </AdminConsoleOutlineButton>
            <AdminConsolePrimaryButton disabled>
              <Plus className="size-3.5 shrink-0" aria-hidden />
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

      {!loading && metrics ? (
        <>
          <div className="grid gap-4 md:grid-cols-3">
            <AdminConsoleMetricCard
              label="TOTAL STORAGE UTILIZED"
              value={usedLabel}
              detail={`${utilizationPct}% of allocated instance capacity`}
              badge={{ label: utilizationPct > 85 ? "High" : "Optimal", tone: "success" }}
              icon={RefreshCw}
              iconBg="bg-[#EFF6FF]"
              iconColor="text-[#2563EB]"
            />
            <AdminConsoleMetricCard
              label="NODE STATUS SUMMARY"
              value={`${metrics.active_nodes} / ${metrics.total_nodes} Active`}
              detail={
                metrics.total_nodes === 0
                  ? "Object storage not configured"
                  : "Configured Nebular OS backend"
              }
              badge={{ label: metrics.active_nodes === metrics.total_nodes ? "Stable" : "Degraded", tone: "success" }}
              icon={RefreshCw}
              iconBg="bg-[#ECFDF5]"
              iconColor="text-[#10B981]"
            />
            <AdminConsoleMetricCard
              label="AVG NETWORK LATENCY"
              value={metrics.avg_latency_ms != null ? `${metrics.avg_latency_ms} ms` : "—"}
              detail="Health probe to object storage /health endpoint"
              badge={{ label: "Live", tone: "success" }}
              icon={RefreshCw}
              iconBg="bg-[#EFF6FF]"
              iconColor="text-[#2563EB]"
            />
          </div>

          <AdminConsoleUnderlineTabs
            tabs={[
              { id: "all", label: `All Storage Nodes (${data.nodes.length})` },
              { id: "perf", label: "Performance Metrics" },
              { id: "sync", label: "Replication & Sync" },
            ]}
            activeId={tab}
            onChange={setTab}
          />

          {tab === "all" ? (
            data.nodes.length === 0 ? (
              <p className="text-sm text-[#666666]">
                No object storage node is configured. Set object storage environment variables and restart
                the API.
              </p>
            ) : (
              <AdminConsoleTable
                caption="Storage nodes"
                columns={[
                  "Node ID / Region",
                  "IP Address",
                  "Status",
                  "Storage Capacity",
                  "Latency",
                  "Mode",
                  "Actions",
                ]}
                rows={data.nodes.map((row) => [
                  <div key={row.id} className="flex flex-col">
                    <span className="font-semibold">{row.id}</span>
                    <span className="text-xs text-[#666666]">{row.region_label}</span>
                  </div>,
                  row.endpoint_host,
                  <AdminConsolePill
                    key={`${row.id}-status`}
                    tone={row.status === "healthy" ? "success" : "warning"}
                  >
                    {row.status}
                  </AdminConsolePill>,
                  row.capacity_label,
                  row.latency_ms != null ? `${row.latency_ms} ms` : "—",
                  row.storage_mode,
                  <button
                    key={`${row.id}-act`}
                    type="button"
                    className="text-xs font-semibold text-[#2563EB]"
                    onClick={() => void load(true)}
                  >
                    Refresh
                  </button>,
                ])}
              />
            )
          ) : (
            <p className="text-sm text-[#666666]">
              {tab === "perf"
                ? `Current utilization: ${utilizationPct}%. Latency: ${metrics.avg_latency_ms ?? "n/a"} ms.`
                : "This instance uses a single configured object storage backend; replication is managed by your storage provider."}
            </p>
          )}
        </>
      ) : null}
    </div>
  );
}
