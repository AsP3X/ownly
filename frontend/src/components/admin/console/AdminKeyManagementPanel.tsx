// Human: Admin Console - Key Management / Security Policies (login-signup.pencil frame Blt4j).
// Agent: CALLS fetchAdminSecurity; RENDERS live policies and audit-derived rotation history.

import { useCallback, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { fetchAdminSecurity } from "@/api/client";
import { useAdminQuery } from "@/hooks/useAdminQuery";
import { DEFAULT_ENCRYPTION_PROFILE } from "@/lib/encryption-standards";
import {
  AdminConsoleMetricCard,
  AdminConsolePageHeader,
  AdminConsolePanel,
  AdminConsolePrimaryButton,
  AdminConsoleUnderlineTabs,
  adminConsoleContentClassName,
} from "@/components/admin/console/admin-console-ui";

/** Human: Security Policies route — key management and global policy tabs from live API. */
export function AdminKeyManagementPanel() {
  const [tab, setTab] = useState("kms");
  const loadSecurity = useCallback(() => fetchAdminSecurity(), []);
  const { data, loading, refreshing, error, reload } = useAdminQuery(loadSecurity);

  return (
    <div className={adminConsoleContentClassName}>
      <AdminConsolePageHeader
        title="Key Management"
        description="Rotate decentralized master keys, monitor KMS nodes, and manage Shamir's recovery custodians."
        actions={
          <AdminConsolePrimaryButton onClick={() => void reload(true)} disabled={loading || refreshing}>
            {loading || refreshing ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <RefreshCw className="size-4 shrink-0" aria-hidden />
            )}
            Refresh Status
          </AdminConsolePrimaryButton>
        }
      />

      {error ? (
        <p className="rounded-lg border border-danger/40 bg-danger-weak px-4 py-3 text-sm text-danger" role="alert">
          {error}
        </p>
      ) : null}

      <AdminConsoleUnderlineTabs
        tabs={[
          { id: "policies", label: "Global Policies" },
          { id: "kms", label: "KMS & Keys" },
        ]}
        activeId={tab}
        onChange={setTab}
      />

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-12 text-sm text-ink-muted">
          <Loader2 className="size-5 animate-spin" aria-hidden />
          Loading security overview…
        </div>
      ) : null}

      {!loading && data && tab === "policies" ? (
        <AdminConsolePanel
          title="Global Security Policies"
          subtitle="Platform-wide encryption, session, and access defaults"
        >
          <ul className="flex flex-col gap-3 text-sm text-ink">
            {data.policies.map((policy) => (
              <li
                key={policy.label}
                className="flex items-center justify-between rounded-lg border border-edge px-4 py-3"
              >
                <span>{policy.label}</span>
                <span
                  className={
                    policy.enabled
                      ? "text-xs font-semibold text-ok"
                      : "text-xs font-semibold text-ink-muted"
                  }
                >
                  {policy.enabled ? "Enabled" : "Disabled"}
                </span>
              </li>
            ))}
          </ul>
        </AdminConsolePanel>
      ) : null}

      {!loading && data && tab === "kms" ? (
        <>
          {(() => {
            const encryption = data.encryption ?? DEFAULT_ENCRYPTION_PROFILE;
            return (
              <>
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                  <AdminConsoleMetricCard
                    label="Symmetric encryption"
                    value={encryption.symmetric_cipher}
                    detail={encryption.quantum_posture}
                    badge={{ label: "AES-256", tone: "success" }}
                    icon={RefreshCw}
                    iconBg="bg-brand-weak"
                    iconColor="text-brand"
                  />
                  <AdminConsoleMetricCard
                    label="Key exchange"
                    value="Hybrid PQC TLS"
                    detail={encryption.key_exchange}
                    badge={{ label: "Edge", tone: "info" }}
                    icon={RefreshCw}
                    iconBg="bg-brand-weak"
                    iconColor="text-brand"
                  />
                  <AdminConsoleMetricCard
                    label="Storage Nodes"
                    value={`${data.kms_nodes_active} / ${data.kms_nodes_total} Active`}
                    detail={`Storage status: ${data.storage_status}`}
                    badge={{
                      label: data.storage_status === "healthy" ? "Healthy" : "Review",
                      tone: "info",
                    }}
                    icon={RefreshCw}
                    iconBg="bg-brand-weak"
                    iconColor="text-brand"
                  />
                  <AdminConsoleMetricCard
                    label="Audit Trail"
                    value={`${data.rotation_history.length} Events`}
                    detail="Recent admin and setup actions"
                    badge={{ label: "Live", tone: "warning" }}
                    icon={RefreshCw}
                    iconBg="bg-brand-weak"
                    iconColor="text-brand"
                  />
                </div>

                <AdminConsolePanel
                  title="Instance Security Posture"
                  subtitle="Encryption and storage health for this deployment"
                >
                  <div className="flex flex-col gap-3 text-sm text-ink-muted">
                    <p>
                      <span className="font-semibold text-ink">Key wrapping: </span>
                      {encryption.key_wrapping}
                    </p>
                    <p>
                      <span className="font-semibold text-ink">Streaming segments: </span>
                      {encryption.streaming_segment_cipher}
                    </p>
                    <p>
                      <span className="font-semibold text-ink">Passwords: </span>
                      {encryption.password_kdf}
                    </p>
                    <p>
                      This instance uses AES-256-GCM envelope encryption for content keys and Argon2id for
                      credentials. Terminate HTTPS with hybrid post-quantum TLS (ML-KEM + classical) at your
                      reverse proxy to protect keys against harvest-now, decrypt-later threats.
                    </p>
                  </div>
                </AdminConsolePanel>
              </>
            );
          })()}

          <AdminConsolePanel title="Security & Admin Action History">
            {data.rotation_history.length === 0 ? (
              <p className="text-sm text-ink-muted">No admin security events recorded yet.</p>
            ) : (
              <ul className="flex flex-col gap-4">
                {data.rotation_history.map((item) => (
                  <li
                    key={`${item.title}-${item.date}`}
                    className="flex flex-col gap-1 border-b border-edge pb-4 last:border-0 last:pb-0"
                  >
                    <p className="font-semibold text-ink">{item.title}</p>
                    <p className="text-xs text-ink-muted">{item.initiator}</p>
                    <p className="text-xs font-medium text-ok">{item.status}</p>
                    <p className="text-xs text-ink-faint">{item.date}</p>
                  </li>
                ))}
              </ul>
            )}
          </AdminConsolePanel>
        </>
      ) : null}
    </div>
  );
}
