// Human: Admin Console - Storage Nodes panel (login-signup.pencil frame AAH5J).
// Agent: RENDERS metrics, underline tabs, nodes table; mock cluster data.

import { useState } from "react";
import { Plus, RefreshCw } from "lucide-react";
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

const NODES = [
  ["node-us-east-14", "Virginia, US", "104.28.19.4", "Healthy", "18.2 / 24.0 TB", "12 ms", "420 MB/s"],
  ["node-eu-west-03", "Frankfurt, DE", "185.12.84.11", "Healthy", "14.1 / 16.0 TB", "24 ms", "380 MB/s"],
  ["node-ap-south-09", "Mumbai, IN", "13.233.5.74", "Syncing", "6.4 / 12.0 TB", "48 ms", "210 MB/s"],
];

/** Human: Storage nodes network — rebalance/add actions, metrics, node table. */
export function AdminStorageNodesPanel() {
  const [tab, setTab] = useState("all");

  return (
    <div className={adminConsoleContentClassName}>
      <AdminConsolePageHeader
        titleSize="md"
        title="Storage Nodes Network"
        description="Monitor network health, data replication status, and peer performance across global storage clusters."
        actions={
          <>
            <AdminConsoleOutlineButton>
              <RefreshCw className="size-3.5 shrink-0" aria-hidden />
              Rebalance Clusters
            </AdminConsoleOutlineButton>
            <AdminConsolePrimaryButton>
              <Plus className="size-3.5 shrink-0" aria-hidden />
              Add Storage Node
            </AdminConsolePrimaryButton>
          </>
        }
      />

      <div className="grid gap-4 md:grid-cols-3">
        <AdminConsoleMetricCard
          label="TOTAL STORAGE UTILIZED"
          value="88.4 TB / 120 TB"
          detail="73.6% average disk storage utilized across network"
          badge={{ label: "Optimal", tone: "success" }}
          icon={RefreshCw}
          iconBg="bg-[#EFF6FF]"
          iconColor="text-[#2563EB]"
        />
        <AdminConsoleMetricCard
          label="NODE STATUS SUMMARY"
          value="34 / 35 Active"
          detail="1 node currently syncing (node-ap-south-09)"
          badge={{ label: "Stable", tone: "success" }}
          icon={RefreshCw}
          iconBg="bg-[#ECFDF5]"
          iconColor="text-[#10B981]"
        />
        <AdminConsoleMetricCard
          label="AVG NETWORK LATENCY"
          value="24.2 ms"
          detail="99.98% file retrieval success rate (last 24h)"
          badge={{ label: "Optimal", tone: "success" }}
          icon={RefreshCw}
          iconBg="bg-[#EFF6FF]"
          iconColor="text-[#2563EB]"
        />
      </div>

      <AdminConsoleUnderlineTabs
        tabs={[
          { id: "all", label: "All Storage Nodes (35)" },
          { id: "perf", label: "Performance Metrics" },
          { id: "sync", label: "Replication & Sync" },
        ]}
        activeId={tab}
        onChange={setTab}
      />

      {tab === "all" ? (
        <AdminConsoleTable
          caption="Storage nodes"
          columns={[
            "Node ID / Region",
            "IP Address",
            "Status",
            "Storage Capacity",
            "Latency",
            "Bandwidth",
            "Actions",
          ]}
          rows={NODES.map((row) => [
            <div key={row[0]} className="flex flex-col">
              <span className="font-semibold">{row[0]}</span>
              <span className="text-xs text-[#666666]">{row[1]}</span>
            </div>,
            row[2],
            <AdminConsolePill key={`st-${row[0]}`} tone={row[3] === "Healthy" ? "success" : "warning"}>
              {row[3]}
            </AdminConsolePill>,
            row[4],
            row[5],
            row[6],
            <button key={`act-${row[0]}`} type="button" className="text-xs font-semibold text-[#2563EB]">
              Manage
            </button>,
          ])}
        />
      ) : (
        <p className="text-sm text-[#666666]">
          {tab === "perf"
            ? "Performance metrics charts connect when observability APIs are available."
            : "Replication and sync status panels connect when cluster APIs are available."}
        </p>
      )}
    </div>
  );
}
