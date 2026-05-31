// Human: Admin Console - Dashboard Overview panel (login-signup.pencil frame Kb6HJ).
// Agent: RENDERS mock KPIs, workload chart, resource bars, critical alerts table; no API.

import {
  AlertTriangle,
  Check,
  Database,
  Download,
  Info,
  RotateCw,
  Server,
  ShieldAlert,
  TrendingUp,
  Users,
} from "lucide-react";
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

const CHART_BARS = [
  { h: 40, color: "#10B981" },
  { h: 55, color: "#2563EB" },
  { h: 48, color: "#2563EB" },
  { h: 72, color: "#2563EB" },
  { h: 65, color: "#10B981" },
  { h: 80, color: "#2563EB" },
  { h: 58, color: "#2563EB" },
  { h: 45, color: "#10B981" },
];
const CHART_LABELS = ["10:00 AM", "10:15 AM", "10:30 AM", "10:45 AM", "11:00 AM", "11:15 AM", "11:30 AM", "11:45 AM"];

/** Human: Dashboard overview — metrics, diagnostics chart, resource allocation, critical logs. */
export function AdminOverviewPanel() {
  return (
    <div className={adminConsoleContentClassName}>
      <AdminConsolePageHeader
        title="Admin Console Dashboard"
        description="Monitor network load, active node volumes, storage utilization, and security events."
        actions={
          <>
            <AdminConsoleOutlineButton>
              <RotateCw className="size-3.5 shrink-0" aria-hidden />
              Refresh Logs
            </AdminConsoleOutlineButton>
            <AdminConsolePrimaryButton>
              <Download className="size-3.5 shrink-0" aria-hidden />
              Export Report
            </AdminConsolePrimaryButton>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <AdminConsoleMetricCard
          label="Active Console Users"
          value="14,842"
          detail={
            <span className="inline-flex items-center gap-1 text-[#10B981]">
              <TrendingUp className="size-3.5" aria-hidden />
              +12.4% vs last week
            </span>
          }
          icon={Users}
          iconBg="bg-[#EFF6FF]"
          iconColor="text-[#2563EB]"
        />
        <AdminConsoleMetricCard
          label="Total Storage Pool"
          value="45.2 TB / 120 TB"
          detail="37.6% Global Capacity"
          icon={Database}
          iconBg="bg-[#FAF5FF]"
          iconColor="text-[#8B5CF6]"
        />
        <AdminConsoleMetricCard
          label="System Node Health"
          value="99.98% Online"
          detail={
            <span className="inline-flex items-center gap-1 text-[#10B981]">
              <Check className="size-3.5" aria-hidden />
              24/24 Nodes Active
            </span>
          }
          icon={Server}
          iconBg="bg-[#ECFDF5]"
          iconColor="text-[#10B981]"
        />
        <AdminConsoleMetricCard
          label="Active System Alerts"
          value="3 Alerts Active"
          detail={
            <span className="inline-flex items-center gap-1 text-[#EF4444]">
              <Info className="size-3.5" aria-hidden />
              Action required immediately
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
          subtitle="Real-time virtualization cluster processor overhead"
          headerRight={
            <div className="flex flex-wrap gap-3 text-[11px] text-[#666666]">
              <span className="inline-flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-[#2563EB]" aria-hidden />
                CPU Load
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-[#10B981]" aria-hidden />
                Network I/O
              </span>
            </div>
          }
        >
          <div className="flex h-36 items-end justify-between gap-1" aria-hidden>
            {CHART_BARS.map((bar, index) => (
              <div key={CHART_LABELS[index]} className="flex min-w-0 flex-1 flex-col items-center gap-2">
                <div
                  className="w-full max-w-5 rounded-t"
                  style={{ height: `${bar.h}%`, backgroundColor: bar.color }}
                />
                <span className="truncate text-[10px] text-[#888888]">{CHART_LABELS[index]}</span>
              </div>
            ))}
          </div>
        </AdminConsolePanel>

        <AdminConsolePanel title="Resource Allocation" subtitle="Node cluster utilization limits">
          <div className="flex flex-col gap-4">
            <AdminConsoleResourceRow label="CPU Load (24 Cores)" percent={64} />
            <AdminConsoleResourceRow label="Cluster Memory (DDR5)" percent={78} />
            <AdminConsoleResourceRow label="Active Pool NVMe Storage" percent={52} />
            <AdminConsoleResourceRow label="Network Bandwidth Usage" percent={29} />
          </div>
        </AdminConsolePanel>
      </div>

      <AdminConsolePanel
        title="Recent Critical Alerts & Logs"
        subtitle="Live security audit and virtualization cluster failure diagnostics"
        headerRight={
          <div className="flex flex-wrap items-center gap-3">
            <AdminConsolePill tone="danger">4 Critical Logs Active</AdminConsolePill>
            <AdminConsoleOutlineButton>Open Log File</AdminConsoleOutlineButton>
          </div>
        }
      >
        <AdminConsoleTable
          caption="Critical alerts"
          columns={["Severity", "Source", "Event Details", "Timestamp"]}
          rows={[
            [
              <AdminConsolePill key="s1" tone="danger">
                Critical
              </AdminConsolePill>,
              "node-eu-west-03",
              "NVMe pool latency exceeded 120ms threshold",
              "2026-05-31 14:18:02",
            ],
            [
              <AdminConsolePill key="s2" tone="warning">
                Warning
              </AdminConsolePill>,
              "kms-consensus",
              "Shard resync delayed on node-ap-south-09",
              "2026-05-31 13:44:11",
            ],
            [
              <AdminConsolePill key="s3" tone="primary">
                Info
              </AdminConsolePill>,
              "auth-service",
              "MFA enforcement policy updated for administrators",
              "2026-05-31 12:02:18",
            ],
            [
              <AdminConsolePill key="s4" tone="danger">
                Critical
              </AdminConsolePill>,
              "hypervisor-02",
              <span className="inline-flex items-center gap-1">
                <AlertTriangle className="size-3.5 text-[#EF4444]" aria-hidden />
                VM migration failed — manual intervention required
              </span>,
              "2026-05-31 11:30:55",
            ],
          ]}
        />
      </AdminConsolePanel>
    </div>
  );
}
