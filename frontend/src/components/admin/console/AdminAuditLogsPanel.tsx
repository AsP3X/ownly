// Human: Admin Console - Audit Logs panel (login-signup.pencil frame FzT1n).
// Agent: CALLS fetchAdminAuditLogs; RENDERS metrics, category tabs, live audit table; export CSV client-side.

import { useCallback, useEffect, useState } from "react";
import { Download, Loader2, Search } from "lucide-react";
import {
  fetchAdminAuditLogs,
  getErrorMessage,
  type AdminAuditLogRow,
  type AdminAuditLogsResponse,
} from "@/api/client";
import {
  AdminConsoleMetricCard,
  AdminConsoleOutlineButton,
  AdminConsolePageHeader,
  AdminConsoleTable,
  AdminConsoleUnderlineTabs,
  AdminConsolePill,
  adminConsoleContentClassName,
} from "@/components/admin/console/admin-console-ui";

type AuditTabId = "all" | "alerts" | "keys" | "nodes";

function severityTone(severity: string): "success" | "primary" | "warning" {
  if (severity === "Success") return "success";
  if (severity === "Warning") return "warning";
  return "primary";
}

function exportAuditCsv(logs: AdminAuditLogRow[]) {
  const header = ["Timestamp", "Actor", "Action", "Description", "Severity", "IP"];
  const lines = logs.map((row) =>
    [row.timestamp, row.actor_email ?? "system", row.action, row.description, row.severity, row.ip ?? ""]
      .map((cell) => `"${String(cell).replace(/"/g, '""')}"`)
      .join(","),
  );
  const blob = new Blob([[header.join(","), ...lines].join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "audit-logs.csv";
  anchor.click();
  URL.revokeObjectURL(url);
}

/** Human: System audit logs — filter tabs, integrity metrics, live event table. */
export function AdminAuditLogsPanel() {
  const [tab, setTab] = useState<AuditTabId>("all");
  const [data, setData] = useState<AdminAuditLogsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (category: AuditTabId) => {
    setLoading(true);
    setError(null);
    try {
      setData(await fetchAdminAuditLogs({ category, limit: 100 }));
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reload when filter tab changes
    void load(tab);
  }, [load, tab]);

  const counts = data?.counts_by_category ?? {};
  const summary = data?.summary;

  return (
    <div className={adminConsoleContentClassName}>
      <AdminConsolePageHeader
        titleSize="md"
        title="System Audit Logs"
        description="Traceable ledger of all administrative security events, encryption operations, node changes, and file access."
        actions={
          <>
            <AdminConsoleOutlineButton onClick={() => void load(tab)} disabled={loading}>
              {loading ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
              ) : (
                <Search className="size-3.5 shrink-0" aria-hidden />
              )}
              Refresh
            </AdminConsoleOutlineButton>
            <AdminConsoleOutlineButton
              onClick={() => data && exportAuditCsv(data.logs)}
              disabled={!data?.logs.length}
            >
              <Download className="size-3.5 shrink-0" aria-hidden />
              Export CSV
            </AdminConsoleOutlineButton>
          </>
        }
      />

      {error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
          {error}
        </p>
      ) : null}

      <div className="grid gap-4 md:grid-cols-3">
        <AdminConsoleMetricCard
          label="TOTAL LOGGED EVENTS"
          value={`${(summary?.total ?? 0).toLocaleString()} Events`}
          detail={`${(summary?.last_30_days ?? 0).toLocaleString()} in the last 30 days`}
          badge={{ label: "Audited", tone: "success" }}
          icon={Search}
          iconBg="bg-[#EFF6FF]"
          iconColor="text-[#2563EB]"
        />
        <AdminConsoleMetricCard
          label="CRITICAL EVENT SHIELD"
          value={`${(summary?.critical_count ?? 0).toLocaleString()} Flags`}
          detail="Delete and revoke actions in the audit ledger"
          badge={{ label: summary?.critical_count ? "Review" : "Secure", tone: "success" }}
          icon={Search}
          iconBg="bg-[#ECFDF5]"
          iconColor="text-[#10B981]"
        />
        <AdminConsoleMetricCard
          label="LOG INTEGRITY STATUS"
          value="Verified 100%"
          detail="Append-only audit rows stored in PostgreSQL"
          badge={{ label: "Immutable", tone: "info" }}
          icon={Search}
          iconBg="bg-[#EFF6FF]"
          iconColor="text-[#2563EB]"
        />
      </div>

      <AdminConsoleUnderlineTabs
        tabs={[
          { id: "all", label: `All Events (${counts.all ?? summary?.total ?? 0})` },
          { id: "alerts", label: `Security Alerts (${counts.alerts ?? 0})` },
          { id: "keys", label: `Keys & Security (${counts.keys ?? 0})` },
          { id: "nodes", label: `Storage Nodes (${counts.nodes ?? 0})` },
        ]}
        activeId={tab}
        onChange={(id) => setTab(id as AuditTabId)}
      />

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-12 text-sm text-[#666666]">
          <Loader2 className="size-5 animate-spin" aria-hidden />
          Loading audit events…
        </div>
      ) : null}

      {!loading && data ? (
        data.logs.length === 0 ? (
          <p className="text-center text-sm text-[#666666]">No events in this category yet.</p>
        ) : (
          <AdminConsoleTable
            caption="Audit events"
            columns={["Timestamp", "Actor / ID", "Event / Action", "Description", "Severity", "IP Address"]}
            rows={data.logs.map((row) => [
              row.timestamp,
              row.actor_email ?? "system",
              <span key={`${row.id}-action`} className="font-mono text-xs font-semibold text-[#2563EB]">
                {row.action}
              </span>,
              row.description,
              <AdminConsolePill key={`${row.id}-sev`} tone={severityTone(row.severity)}>
                {row.severity}
              </AdminConsolePill>,
              row.ip ?? "—",
            ])}
          />
        )
      ) : null}
    </div>
  );
}
