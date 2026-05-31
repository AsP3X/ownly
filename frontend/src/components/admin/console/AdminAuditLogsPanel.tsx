// Human: Admin Console - Audit Logs panel (login-signup.pencil frame FzT1n).
// Agent: RENDERS metrics, event filter tabs, audit table; mock ledger rows.

import { useState } from "react";
import { Download, Search } from "lucide-react";
import {
  AdminConsoleMetricCard,
  AdminConsoleOutlineButton,
  AdminConsolePageHeader,
  AdminConsoleTable,
  AdminConsoleUnderlineTabs,
  AdminConsolePill,
  adminConsoleContentClassName,
} from "@/components/admin/console/admin-console-ui";

const EVENTS = [
  [
    "2026-05-31 14:24:12",
    "sarah.chen@ownly.io",
    "KEY_ROTATION",
    "Rotated RSA-4096 cluster decryption keys",
    "Success",
    "192.168.1.104",
  ],
  [
    "2026-05-31 13:10:45",
    "system-scheduler",
    "NODE_HEALTH",
    "Node-ap-south-09 trigger sync (rebuilding shard)",
    "Info",
    "13.233.5.74",
  ],
  [
    "2026-05-31 12:02:18",
    "alex.mercer@ownly.io",
    "USER_INVITE",
    "Invited new administrator: Emily Watson",
    "Success",
    "104.28.19.4",
  ],
];

/** Human: System audit logs — filter tabs, integrity metrics, event table. */
export function AdminAuditLogsPanel() {
  const [tab, setTab] = useState("all");

  return (
    <div className={adminConsoleContentClassName}>
      <AdminConsolePageHeader
        titleSize="md"
        title="System Audit Logs"
        description="Traceable ledger of all administrative security events, encryption operations, node changes, and file access."
        actions={
          <>
            <AdminConsoleOutlineButton>
              <Search className="size-3.5 shrink-0" aria-hidden />
              Filter System
            </AdminConsoleOutlineButton>
            <AdminConsoleOutlineButton>
              <Download className="size-3.5 shrink-0" aria-hidden />
              Export CSV / JSON
            </AdminConsoleOutlineButton>
          </>
        }
      />

      <div className="grid gap-4 md:grid-cols-3">
        <AdminConsoleMetricCard
          label="TOTAL LOGGED EVENTS"
          value="12,842 Events"
          detail="Last 30 days immutable cryptographically signed logs"
          badge={{ label: "Audited", tone: "success" }}
          icon={Search}
          iconBg="bg-[#EFF6FF]"
          iconColor="text-[#2563EB]"
        />
        <AdminConsoleMetricCard
          label="CRITICAL EVENT SHIELD"
          value="0 Security Flags"
          detail="No high-risk policy breaches or brute-force logins"
          badge={{ label: "Secure", tone: "success" }}
          icon={Search}
          iconBg="bg-[#ECFDF5]"
          iconColor="text-[#10B981]"
        />
        <AdminConsoleMetricCard
          label="LOG INTEGRITY STATUS"
          value="Verified 100%"
          detail="Signed ledger matches distributed SHA-256 state"
          badge={{ label: "Immutable", tone: "info" }}
          icon={Search}
          iconBg="bg-[#EFF6FF]"
          iconColor="text-[#2563EB]"
        />
      </div>

      <AdminConsoleUnderlineTabs
        tabs={[
          { id: "all", label: "All Events (4,821)" },
          { id: "alerts", label: "Security Alerts (0)" },
          { id: "keys", label: "Keys & Security (142)" },
          { id: "nodes", label: "Storage Nodes (824)" },
        ]}
        activeId={tab}
        onChange={setTab}
      />

      <AdminConsoleTable
        caption="Audit events"
        columns={["Timestamp", "Actor / ID", "Event / Action", "Description", "Severity", "IP Address"]}
        rows={EVENTS.map((row) => [
          row[0],
          row[1],
          <span key={`ev-${row[0]}`} className="font-mono text-xs font-semibold text-[#2563EB]">
            {row[2]}
          </span>,
          row[3],
          <AdminConsolePill key={`sev-${row[0]}`} tone={row[4] === "Success" ? "success" : "primary"}>
            {row[4]}
          </AdminConsolePill>,
          row[5],
        ])}
      />
    </div>
  );
}
