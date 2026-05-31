// Human: Admin Console - Key Management / Security Policies (login-signup.pencil frame Blt4j).
// Agent: RENDERS Global Policies | KMS & Keys tabs, KMS metrics, Shamir shares, rotation history.

import { useState } from "react";
import { RefreshCw } from "lucide-react";
import {
  AdminConsoleMetricCard,
  AdminConsolePageHeader,
  AdminConsolePanel,
  AdminConsolePrimaryButton,
  AdminConsoleUnderlineTabs,
  AdminConsoleUserAvatar,
  adminConsoleContentClassName,
} from "@/components/admin/console/admin-console-ui";

const ROTATION_HISTORY = [
  {
    title: "Automated Auto-Rotation of KMS Roots",
    initiator: "Initiator: KMS Daemon Consensus",
    status: "Consensus Optimal (5/5 nodes synchronized)",
    date: "May 19, 2026",
  },
  {
    title: "Emergency Recovery Key Resharding",
    initiator: "Initiator: Sarah Chen (Super Admin)",
    status: "Consensus Optimal (5/5 nodes synchronized)",
    date: "Apr 15, 2026",
  },
];

const CUSTODIANS = [
  { initials: "SC", name: "Sarah Chen", role: "Super Admin Key Custodian", shares: "1 Share" },
  { initials: "AM", name: "Alex Mercer", role: "SecOps Custodian", shares: "1 Share" },
  { initials: "H1", name: "Hardware HSM-01", role: "Global Vault HSM Node", shares: "1 Share" },
  { initials: "H2", name: "Hardware HSM-02", role: "Decentralized Escrow HSM", shares: "1 Share" },
  { initials: "EO", name: "Escrow Offline", role: "Cold Storage Escrow Share", shares: "1 Share" },
];

/** Human: Security Policies route — key management and global policy tabs. */
export function AdminKeyManagementPanel() {
  const [tab, setTab] = useState("kms");

  return (
    <div className={adminConsoleContentClassName}>
      <AdminConsolePageHeader
        title="Key Management"
        description="Rotate decentralized master keys, monitor KMS nodes, and manage Shamir's recovery custodians."
        actions={
          <AdminConsolePrimaryButton>
            <RefreshCw className="size-4 shrink-0" aria-hidden />
            Rotate Cryptographic Keys
          </AdminConsolePrimaryButton>
        }
      />

      <AdminConsoleUnderlineTabs
        tabs={[
          { id: "policies", label: "Global Policies" },
          { id: "kms", label: "KMS & Keys" },
        ]}
        activeId={tab}
        onChange={setTab}
      />

      {tab === "policies" ? (
        <AdminConsolePanel
          title="Global Security Policies"
          subtitle="Platform-wide encryption, session, and access defaults"
        >
          <ul className="flex flex-col gap-3 text-sm text-[#1A1A1A]">
            <li className="rounded-lg border border-[#E5E7EB] px-4 py-3">
              Enforce MFA for all administrator accounts
            </li>
            <li className="rounded-lg border border-[#E5E7EB] px-4 py-3">
              Require AES-256-GCM for at-rest object encryption
            </li>
            <li className="rounded-lg border border-[#E5E7EB] px-4 py-3">
              Auto-rotate cluster keys every 30 days
            </li>
          </ul>
        </AdminConsolePanel>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-3">
            <AdminConsoleMetricCard
              label="Active Encryption Standard"
              value="AES-GCM-256 / RSA-4096"
              detail="Enterprise hardware accelerated encryption"
              badge={{ label: "Active", tone: "success" }}
              icon={RefreshCw}
              iconBg="bg-[#EFF6FF]"
              iconColor="text-[#2563EB]"
            />
            <AdminConsoleMetricCard
              label="Distributed KMS Nodes"
              value="5 / 5 Network Nodes Active"
              detail="Decentralized consensus health is 100%"
              badge={{ label: "Syncing", tone: "info" }}
              icon={RefreshCw}
              iconBg="bg-[#EFF6FF]"
              iconColor="text-[#2563EB]"
            />
            <AdminConsoleMetricCard
              label="Automatic Key Rotation"
              value="Rotated 12 Days Ago"
              detail="Scheduled auto rotation in 18 days"
              badge={{ label: "Scheduled", tone: "warning" }}
              icon={RefreshCw}
              iconBg="bg-[#EFF6FF]"
              iconColor="text-[#2563EB]"
            />
          </div>

          <AdminConsolePanel
            title="Master Key Shamir's Recovery Shares (Threshold: 3 of 5)"
            subtitle="Five system custodians hold cryptographic key shares. Any three can rebuild the master key."
            headerRight={
              <span className="rounded-full bg-[#ECFDF5] px-2 py-0.5 text-[10px] font-bold text-[#10B981]">
                Threshold Active
              </span>
            }
          >
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {CUSTODIANS.map((c) => (
                <div
                  key={c.name}
                  className="flex items-center gap-3 rounded-lg border border-[#E5E7EB] bg-[#F7F8FA] p-3"
                >
                  <AdminConsoleUserAvatar initials={c.initials} />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-[#1A1A1A]">{c.name}</p>
                    <p className="text-xs text-[#666666]">{c.role}</p>
                    <p className="mt-1 text-[10px] font-bold uppercase text-[#2563EB]">{c.shares}</p>
                  </div>
                </div>
              ))}
            </div>
          </AdminConsolePanel>

          <AdminConsolePanel title="Cryptographic Key Rotation History">
            <ul className="flex flex-col gap-4">
              {ROTATION_HISTORY.map((item) => (
                <li
                  key={item.title}
                  className="flex flex-col gap-1 border-b border-[#E5E7EB] pb-4 last:border-0 last:pb-0"
                >
                  <p className="font-semibold text-[#1A1A1A]">{item.title}</p>
                  <p className="text-xs text-[#666666]">{item.initiator}</p>
                  <p className="text-xs font-medium text-[#10B981]">{item.status}</p>
                  <p className="text-xs text-[#888888]">{item.date}</p>
                </li>
              ))}
            </ul>
          </AdminConsolePanel>
        </>
      )}
    </div>
  );
}
