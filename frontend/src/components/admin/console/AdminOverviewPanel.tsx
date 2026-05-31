// Human: Admin Console - Dashboard Overview panel (login-signup.pencil frame Kb6HJ).
// Agent: CALLS fetchAdminOverview; RENDERS live KPIs, workload chart, resource bars, recent audit alerts.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  Database,
  Download,
  Info,
  Loader2,
  RotateCw,
  Server,
  ShieldAlert,
  Users,
} from "lucide-react";
import { fetchAdminOverview, getErrorMessage, type AdminOverviewResponse } from "@/api/client";
import {
  AdminConsoleMetricCard,
  AdminConsoleOutlineButton,
  AdminConsolePageHeader,
  AdminConsolePanel,
  AdminConsolePrimaryButton,
  AdminConsoleResourceRow,
  AdminConsoleTable,
  AdminConsolePill,
  adminConsoleContentClassName,
} from "@/components/admin/console/admin-console-ui";
import { formatBytes } from "@/lib/utils-app";

// Human: Bar area height in px — bars use explicit pixels, not % (broken inside flex items-end).
const WORKLOAD_CHART_BAR_AREA_PX = 120;

function severityTone(severity: string): "danger" | "warning" | "primary" {
  if (severity === "Critical" || severity === "Warning") return "warning";
  if (severity === "danger") return "danger";
  return "primary";
}

/** Human: Dashboard overview — live metrics, workload, resource allocation, critical logs. */
export function AdminOverviewPanel() {
  const [data, setData] = useState<AdminOverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (showRefresh: boolean) => {
    if (showRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      setData(await fetchAdminOverview());
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial overview fetch on mount
    void load(false);
  }, [load]);

  const workloadMax = useMemo(() => {
    const values = data?.workload.map((b) => b.value) ?? [];
    return Math.max(1, ...values);
  }, [data?.workload]);

  const metrics = data?.metrics;
  const storageLabel =
    data?.storage_health.status === "healthy"
      ? "Online"
      : data?.storage_health.status === "degraded"
        ? "Degraded"
        : "Not configured";

  return (
    <div className={adminConsoleContentClassName}>
      <AdminConsolePageHeader
        title="Admin Console Dashboard"
        description="Monitor network load, active node volumes, storage utilization, and security events."
        actions={
          <>
            <AdminConsoleOutlineButton
              onClick={() => void load(true)}
              disabled={loading || refreshing}
            >
              {refreshing ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
              ) : (
                <RotateCw className="size-3.5 shrink-0" aria-hidden />
              )}
              Refresh Logs
            </AdminConsoleOutlineButton>
            <AdminConsolePrimaryButton
              onClick={() => {
                if (!data) return;
                const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
                const url = URL.createObjectURL(blob);
                const anchor = document.createElement("a");
                anchor.href = url;
                anchor.download = "admin-overview-report.json";
                anchor.click();
                URL.revokeObjectURL(url);
              }}
              disabled={!data}
            >
              <Download className="size-3.5 shrink-0" aria-hidden />
              Export Report
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
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-[#666666]">
          <Loader2 className="size-5 animate-spin" aria-hidden />
          Loading dashboard…
        </div>
      ) : null}

      {!loading && metrics ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <AdminConsoleMetricCard
              label="Active Console Users"
              value={metrics.enabled_users.toLocaleString()}
              detail={`${metrics.total_users} total accounts`}
              icon={Users}
              iconBg="bg-[#EFF6FF]"
              iconColor="text-[#2563EB]"
            />
            <AdminConsoleMetricCard
              label="Total Storage Pool"
              value={formatBytes(metrics.total_storage_bytes)}
              detail={`${metrics.total_files.toLocaleString()} files indexed`}
              icon={Database}
              iconBg="bg-[#FAF5FF]"
              iconColor="text-[#8B5CF6]"
            />
            <AdminConsoleMetricCard
              label="System Node Health"
              value={`${storageLabel}`}
              detail={
                <span className="inline-flex items-center gap-1 text-[#10B981]">
                  <Check className="size-3.5" aria-hidden />
                  {data.storage_health.storage_mode} • {data.storage_health.bucket}
                </span>
              }
              icon={Server}
              iconBg="bg-[#ECFDF5]"
              iconColor="text-[#10B981]"
            />
            <AdminConsoleMetricCard
              label="Active System Alerts"
              value={`${metrics.alert_count} Events`}
              detail={
                <span className="inline-flex items-center gap-1 text-[#EF4444]">
                  <Info className="size-3.5" aria-hidden />
                  Security and admin actions in audit log
                </span>
              }
              icon={ShieldAlert}
              iconBg="bg-[#FEF2F2]"
              iconColor="text-[#EF4444]"
            />
          </div>

          <div className="grid gap-5 xl:grid-cols-2">
            <AdminConsolePanel
              title="System Workload Diagnostics"
              subtitle="Recent API and audit activity (last 2 hours)"
              headerRight={
                <div className="flex flex-wrap gap-3 text-[11px] text-[#666666]">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="size-2 rounded-full bg-[#2563EB]" aria-hidden />
                    Event volume
                  </span>
                </div>
              }
            >
              <div
                className="flex justify-between gap-1.5"
                style={{ height: WORKLOAD_CHART_BAR_AREA_PX + 28 }}
                role="img"
                aria-label="Audit event volume per fifteen minute interval over the last two hours"
              >
                {data.workload.map((bar) => {
                  const barHeightPx = Math.max(
                    bar.value > 0 ? 6 : 2,
                    Math.round((bar.value / workloadMax) * WORKLOAD_CHART_BAR_AREA_PX),
                  );
                  return (
                    <div
                      key={`${bar.label}-${bar.value}`}
                      className="flex min-w-0 flex-1 flex-col items-center justify-end gap-2"
                      title={`${bar.value} events at ${bar.label}`}
                    >
                      <div
                        className="w-full min-w-[6px] max-w-6 rounded-t bg-[#2563EB] transition-[height]"
                        style={{ height: barHeightPx }}
                      />
                      <span className="truncate text-[10px] text-[#888888]">{bar.label}</span>
                    </div>
                  );
                })}
              </div>
              {data.workload.every((bar) => bar.value === 0) ? (
                <p className="text-xs text-[#888888]">
                  No audit events in the last two hours — bars will rise as users and admins act on the
                  instance.
                </p>
              ) : null}
            </AdminConsolePanel>

            <AdminConsolePanel title="Resource Allocation" subtitle="Instance utilization limits">
              <div className="flex flex-col gap-4">
                {data.resource_allocation.map((row) => (
                  <AdminConsoleResourceRow key={row.label} label={row.label} percent={row.percent} />
                ))}
              </div>
            </AdminConsolePanel>
          </div>

          <AdminConsolePanel
            title="Recent Critical Alerts & Logs"
            subtitle="Latest entries from the immutable audit ledger"
            headerRight={
              <div className="flex flex-wrap items-center gap-3">
                <AdminConsolePill tone="danger">
                  {data.recent_alerts.length} Recent Events
                </AdminConsolePill>
                <AdminConsoleOutlineButton onClick={() => void load(true)}>
                  Refresh
                </AdminConsoleOutlineButton>
              </div>
            }
          >
            {data.recent_alerts.length === 0 ? (
              <p className="text-sm text-[#666666]">No audit events recorded yet.</p>
            ) : (
              <AdminConsoleTable
                caption="Critical alerts"
                columns={["Severity", "Source", "Event Details", "Timestamp"]}
                rows={data.recent_alerts.map((row) => [
                  <AdminConsolePill key={`${row.timestamp}-sev`} tone={severityTone(row.severity)}>
                    {row.severity}
                  </AdminConsolePill>,
                  row.source,
                  row.detail.includes("failed") ? (
                    <span key={`${row.timestamp}-det`} className="inline-flex items-center gap-1">
                      <AlertTriangle className="size-3.5 text-[#EF4444]" aria-hidden />
                      {row.detail}
                    </span>
                  ) : (
                    row.detail
                  ),
                  row.timestamp,
                ])}
              />
            )}
          </AdminConsolePanel>
        </>
      ) : null}
    </div>
  );
}
