// Human: Admin Console - System Settings panels (login-signup.pencil HcA0b, uqdvB, F6aAB).
// Agent: RENDERS General / Security & Encryption / SMTP & Alerts tabs with settings rows.

import { useState } from "react";
import { Save } from "lucide-react";
import {
  AdminConsoleField,
  AdminConsolePageHeader,
  AdminConsolePrimaryButton,
  AdminConsoleSettingsPanel,
  AdminConsoleSettingsRow,
  AdminConsoleUnderlineTabs,
  adminConsoleContentClassName,
} from "@/components/admin/console/admin-console-ui";

/** Human: System settings with three underline tabs matching Pencil settings frames. */
export function AdminSystemSettingsPanel() {
  const [tab, setTab] = useState("general");

  return (
    <div className={adminConsoleContentClassName}>
      <AdminConsolePageHeader
        title="System Settings"
        description="Configure global platform behavior, encryption parameters, and server settings."
        actions={
          <AdminConsolePrimaryButton>
            <Save className="size-4 shrink-0" aria-hidden />
            Save Changes
          </AdminConsolePrimaryButton>
        }
      />

      <AdminConsoleUnderlineTabs
        tabs={[
          { id: "general", label: "General Settings" },
          { id: "security", label: "Security & Encryption" },
          { id: "smtp", label: "SMTP & Alerts" },
        ]}
        activeId={tab}
        onChange={setTab}
      />

      <AdminConsoleSettingsPanel>
        {tab === "general" ? (
          <>
            <AdminConsoleSettingsRow
              title="Platform Identity"
              description="Set your custom platform branding name and primary public-facing URL address for emails and logs."
            >
              <div className="flex flex-col gap-4">
                <AdminConsoleField label="Platform Name" value="Ownly Cloud Storage" />
                <AdminConsoleField label="Console URL" value="https://console.ownly.sh" />
              </div>
            </AdminConsoleSettingsRow>
            <AdminConsoleSettingsRow
              title="System Status"
              description="Temporarily freeze user client access and sync actions during database migrations."
            >
              <p className="text-sm text-[#666666]">
                Maintenance Mode is currently inactive (clients online)
              </p>
            </AdminConsoleSettingsRow>
            <AdminConsoleSettingsRow
              title="Default User Settings"
              description="Assign global defaults for user onboarding and mandatory compliance settings."
            >
              <div className="flex flex-col gap-4">
                <AdminConsoleField
                  label="Default Onboarding Role"
                  value="Standard User (Write/Share Enabled)"
                />
                <label className="flex items-center gap-2 text-sm text-[#1A1A1A]">
                  <input type="checkbox" defaultChecked className="size-4 rounded border-[#E5E7EB]" />
                  Enforce Multi-Factor Authentication (MFA) on first administrator login
                </label>
              </div>
            </AdminConsoleSettingsRow>
            <AdminConsoleSettingsRow
              title="Storage Capacity Quota"
              description="Set the default maximum storage limit per-user across all clusters prior to admin overrides."
            >
              <div className="flex flex-col gap-2">
                <AdminConsoleField label="Default Allocated Quota" value="100" suffix="GB" />
                <p className="text-xs text-[#888888]">
                  Set to 0 for unlimited cloud storage. Changes apply to standard user signups instantly.
                </p>
              </div>
            </AdminConsoleSettingsRow>
          </>
        ) : null}

        {tab === "security" ? (
          <>
            <AdminConsoleSettingsRow
              title="Session Timeout"
              description="Configure auto-logout and idle timeout durations for admin and user console sessions to mitigate hijacking."
            >
              <div className="flex flex-col gap-4">
                <AdminConsoleField label="Max Idle Duration" value="1 Hour (Recommended)" />
                <label className="flex items-center gap-2 text-sm text-[#1A1A1A]">
                  <input type="checkbox" defaultChecked className="size-4 rounded border-[#E5E7EB]" />
                  Terminate current session on browser tab close
                </label>
              </div>
            </AdminConsoleSettingsRow>
            <AdminConsoleSettingsRow
              title="Zero-Knowledge Encryption"
              description="Specify the server-side cryptographic primitives and key derivation procedures applied to stored objects."
            >
              <div className="flex flex-col gap-4">
                <AdminConsoleField
                  label="Standard Encryption Cipher"
                  value="AES-256-GCM (Hardware Accelerated)"
                />
                <AdminConsoleField
                  label="Key Derivation Function (KDF)"
                  value="Argon2id (Memory: 16 MB, Iterations: 3)"
                />
              </div>
            </AdminConsoleSettingsRow>
            <AdminConsoleSettingsRow
              title="IP Access Restriction"
              description="Limit access to the server command panel to specified IP address ranges and internal office networks."
            >
              <div className="flex flex-col gap-4">
                <AdminConsoleField
                  label="Allowed CIDR Blocks (Comma separated)"
                  value="192.168.1.0/24, 10.0.0.0/8"
                />
                <label className="flex items-center gap-2 text-sm text-[#1A1A1A]">
                  <input type="checkbox" className="size-4 rounded border-[#E5E7EB]" />
                  Enforce strict IP geo-fencing limits (deny logins outside home country)
                </label>
              </div>
            </AdminConsoleSettingsRow>
          </>
        ) : null}

        {tab === "smtp" ? (
          <>
            <AdminConsoleSettingsRow
              title="Mail Server Settings"
              description="Configure outbound SMTP server settings to dispatch system invitations, password reset messages, and alerts."
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <AdminConsoleField label="SMTP Host Server" value="smtp.sendgrid.net" />
                <AdminConsoleField label="Port" value="587" />
                <AdminConsoleField label="Sender Address (From)" value="noreply@ownly.sh" />
                <AdminConsoleField label="Connection Security" value="STARTTLS" />
              </div>
            </AdminConsoleSettingsRow>
            <AdminConsoleSettingsRow
              title="Server Authentication"
              description="Provide credential secrets and SMTP API keys to authorize server notifications with external providers."
            >
              <div className="flex flex-col gap-4">
                <AdminConsoleField label="SMTP Username" value="apikey" />
                <AdminConsoleField label="SMTP Password / API Key" value="••••••••••••••••••••" />
              </div>
            </AdminConsoleSettingsRow>
            <AdminConsoleSettingsRow
              title="Event Notification Rules"
              description="Configure real-time server alert conditions that trigger direct email notifications to super administrators."
            >
              <div className="flex flex-col gap-3 text-sm text-[#1A1A1A]">
                <label className="flex items-center gap-2">
                  <input type="checkbox" defaultChecked className="size-4 rounded border-[#E5E7EB]" />
                  Notify immediately on storage node critical offline events
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" defaultChecked className="size-4 rounded border-[#E5E7EB]" />
                  Send digest report when daily database audits detect policy violations
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" className="size-4 rounded border-[#E5E7EB]" />
                  Alert on standard user registration and space expansion limits reached
                </label>
              </div>
            </AdminConsoleSettingsRow>
          </>
        ) : null}
      </AdminConsoleSettingsPanel>
    </div>
  );
}
