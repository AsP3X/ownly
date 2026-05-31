// Human: Admin Console - System Settings panels (login-signup.pencil HcA0b, uqdvB, F6aAB).
// Agent: CALLS fetchAdminSettings/updateAdminSettings; RENDERS editable General / Security / SMTP tabs.

import { useCallback, useEffect, useState } from "react";
import { Loader2, Save } from "lucide-react";
import {
  fetchAdminSettings,
  getErrorMessage,
  updateAdminSettings,
  type AdminSettingsPatch,
  type AdminSettingsResponse,
} from "@/api/client";
import {
  AdminConsoleField,
  AdminConsolePageHeader,
  AdminConsolePrimaryButton,
  AdminConsoleSettingsPanel,
  AdminConsoleSettingsRow,
  AdminConsoleUnderlineTabs,
  adminConsoleContentClassName,
} from "@/components/admin/console/admin-console-ui";

/** Human: System settings with three underline tabs — loads and saves via admin settings API. */
export function AdminSystemSettingsPanel() {
  const [tab, setTab] = useState("general");
  const [form, setForm] = useState<AdminSettingsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [smtpPasswordDraft, setSmtpPasswordDraft] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setForm(await fetchAdminSettings());
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load settings on panel mount
    void load();
  }, [load]);

  function patchForm(partial: Partial<AdminSettingsResponse>) {
    setForm((prev) => (prev ? { ...prev, ...partial } : prev));
  }

  async function handleSave() {
    if (!form) return;
    setSaving(true);
    setError(null);
    setSavedMessage(null);
    const body: AdminSettingsPatch = {
      ...(smtpPasswordDraft.trim() ? { smtp_password: smtpPasswordDraft } : {}),
      instance_name: form.instance_name,
      console_url: form.console_url,
      allow_public_registration: form.allow_public_registration,
      require_account_activation: form.require_account_activation,
      default_storage_quota_gb: form.default_storage_quota_gb,
      maintenance_mode: form.maintenance_mode,
      default_onboarding_role: form.default_onboarding_role,
      enforce_mfa_on_admin_login: form.enforce_mfa_on_admin_login,
      smtp_host: form.smtp.host,
      smtp_port: form.smtp.port,
      smtp_from: form.smtp.from_address,
      smtp_security: form.smtp.security,
      smtp_username: form.smtp.username,
      notification_storage_offline: form.notification_rules.storage_offline,
      notification_audit_violations: form.notification_rules.audit_violations,
      notification_quota_alerts: form.notification_rules.quota_alerts,
    };
    try {
      const updated = await updateAdminSettings(body);
      setForm(updated);
      setSmtpPasswordDraft("");
      setSavedMessage("Settings saved successfully.");
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={adminConsoleContentClassName}>
      <AdminConsolePageHeader
        title="System Settings"
        description="Configure global platform behavior, encryption parameters, and server settings."
        actions={
          <AdminConsolePrimaryButton onClick={() => void handleSave()} disabled={saving || loading || !form}>
            {saving ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <Save className="size-4 shrink-0" aria-hidden />
            )}
            Save Changes
          </AdminConsolePrimaryButton>
        }
      />

      {error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
          {error}
        </p>
      ) : null}
      {savedMessage ? (
        <p className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          {savedMessage}
        </p>
      ) : null}

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-12 text-sm text-[#666666]">
          <Loader2 className="size-5 animate-spin" aria-hidden />
          Loading settings…
        </div>
      ) : null}

      {!loading && form ? (
        <>
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
                    <AdminConsoleField
                      label="Platform Name"
                      value={form.instance_name}
                      onChange={(v) => patchForm({ instance_name: v })}
                    />
                    <AdminConsoleField
                      label="Console URL"
                      value={form.console_url}
                      onChange={(v) => patchForm({ console_url: v })}
                    />
                  </div>
                </AdminConsoleSettingsRow>
                <AdminConsoleSettingsRow
                  title="System Status"
                  description="Temporarily freeze user client access and sync actions during database migrations."
                >
                  <label className="flex items-center gap-2 text-sm text-[#1A1A1A]">
                    <input
                      type="checkbox"
                      checked={form.maintenance_mode}
                      onChange={(e) => patchForm({ maintenance_mode: e.target.checked })}
                      className="size-4 rounded border-[#E5E7EB]"
                    />
                    Maintenance mode {form.maintenance_mode ? "(active)" : "(inactive — clients online)"}
                  </label>
                </AdminConsoleSettingsRow>
                <AdminConsoleSettingsRow
                  title="Default User Settings"
                  description="Assign global defaults for user onboarding and mandatory compliance settings."
                >
                  <div className="flex flex-col gap-4">
                    <AdminConsoleField
                      label="Default Onboarding Role"
                      value={form.default_onboarding_role}
                      onChange={(v) => patchForm({ default_onboarding_role: v })}
                    />
                    <label className="flex items-center gap-2 text-sm text-[#1A1A1A]">
                      <input
                        type="checkbox"
                        checked={form.enforce_mfa_on_admin_login}
                        onChange={(e) => patchForm({ enforce_mfa_on_admin_login: e.target.checked })}
                        className="size-4 rounded border-[#E5E7EB]"
                      />
                      Enforce Multi-Factor Authentication (MFA) on first administrator login
                    </label>
                    <label className="flex items-center gap-2 text-sm text-[#1A1A1A]">
                      <input
                        type="checkbox"
                        checked={form.allow_public_registration}
                        onChange={(e) => patchForm({ allow_public_registration: e.target.checked })}
                        className="size-4 rounded border-[#E5E7EB]"
                      />
                      Allow public self-service registration
                    </label>
                    <label className="flex items-center gap-2 text-sm text-[#1A1A1A]">
                      <input
                        type="checkbox"
                        checked={form.require_account_activation}
                        onChange={(e) => patchForm({ require_account_activation: e.target.checked })}
                        className="size-4 rounded border-[#E5E7EB]"
                      />
                      Require account activation before first sign-in
                    </label>
                  </div>
                </AdminConsoleSettingsRow>
                <AdminConsoleSettingsRow
                  title="Storage Capacity Quota"
                  description="Set the default maximum storage limit per-user across all clusters prior to admin overrides."
                >
                  <div className="flex flex-col gap-2">
                    <AdminConsoleField
                      label="Default Allocated Quota"
                      value={String(form.default_storage_quota_gb)}
                      type="number"
                      suffix="GB"
                      onChange={(v) => {
                        const parsed = Number.parseInt(v, 10);
                        if (!Number.isNaN(parsed)) patchForm({ default_storage_quota_gb: Math.max(1, parsed) });
                      }}
                    />
                    <p className="text-xs text-[#888888]">
                      Applies to new accounts. Existing users keep their current usage until changed per user.
                    </p>
                  </div>
                </AdminConsoleSettingsRow>
              </>
            ) : null}

            {tab === "security" ? (
              <>
                <AdminConsoleSettingsRow
                  title="Session Timeout"
                  description="Session lifetime is enforced by JWT expiry on the API server (configured via environment)."
                >
                  <p className="text-sm text-[#666666]">
                    Adjust session duration in server environment variables and restart the API stack.
                  </p>
                </AdminConsoleSettingsRow>
                <AdminConsoleSettingsRow
                  title="Zero-Knowledge Encryption"
                  description="Cryptographic primitives applied to stored objects and credentials."
                >
                  <div className="flex flex-col gap-4">
                    <AdminConsoleField
                      label="Standard Encryption Cipher"
                      value="AES-256-GCM (object storage at rest)"
                    />
                    <AdminConsoleField
                      label="Key Derivation Function (KDF)"
                      value="Argon2id (password hashing)"
                    />
                  </div>
                </AdminConsoleSettingsRow>
                <AdminConsoleSettingsRow
                  title="IP Access Restriction"
                  description="Network-level restrictions are enforced outside this application (reverse proxy / firewall)."
                >
                  <p className="text-sm text-[#666666]">
                    Configure allowed CIDR blocks on your edge proxy or hosting provider.
                  </p>
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
                    <AdminConsoleField
                      label="SMTP Host Server"
                      value={form.smtp.host}
                      onChange={(v) => patchForm({ smtp: { ...form.smtp, host: v } })}
                    />
                    <AdminConsoleField
                      label="Port"
                      value={form.smtp.port}
                      onChange={(v) => patchForm({ smtp: { ...form.smtp, port: v } })}
                    />
                    <AdminConsoleField
                      label="Sender Address (From)"
                      value={form.smtp.from_address}
                      onChange={(v) => patchForm({ smtp: { ...form.smtp, from_address: v } })}
                    />
                    <AdminConsoleField
                      label="Connection Security"
                      value={form.smtp.security}
                      onChange={(v) => patchForm({ smtp: { ...form.smtp, security: v } })}
                    />
                  </div>
                </AdminConsoleSettingsRow>
                <AdminConsoleSettingsRow
                  title="Server Authentication"
                  description="Provide credential secrets and SMTP API keys to authorize server notifications with external providers."
                >
                  <div className="flex flex-col gap-4">
                    <AdminConsoleField
                      label="SMTP Username"
                      value={form.smtp.username}
                      onChange={(v) => patchForm({ smtp: { ...form.smtp, username: v } })}
                    />
                    <AdminConsoleField
                      label="SMTP Password / API Key"
                      value={smtpPasswordDraft}
                      type="password"
                      placeholder={
                        form.smtp.password_set ? "Leave blank to keep current secret" : "Enter password"
                      }
                      onChange={setSmtpPasswordDraft}
                    />
                  </div>
                </AdminConsoleSettingsRow>
                <AdminConsoleSettingsRow
                  title="Event Notification Rules"
                  description="Configure real-time server alert conditions that trigger direct email notifications to super administrators."
                >
                  <div className="flex flex-col gap-3 text-sm text-[#1A1A1A]">
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={form.notification_rules.storage_offline}
                        onChange={(e) =>
                          patchForm({
                            notification_rules: {
                              ...form.notification_rules,
                              storage_offline: e.target.checked,
                            },
                          })
                        }
                        className="size-4 rounded border-[#E5E7EB]"
                      />
                      Notify immediately on storage node critical offline events
                    </label>
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={form.notification_rules.audit_violations}
                        onChange={(e) =>
                          patchForm({
                            notification_rules: {
                              ...form.notification_rules,
                              audit_violations: e.target.checked,
                            },
                          })
                        }
                        className="size-4 rounded border-[#E5E7EB]"
                      />
                      Send digest report when daily database audits detect policy violations
                    </label>
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={form.notification_rules.quota_alerts}
                        onChange={(e) =>
                          patchForm({
                            notification_rules: {
                              ...form.notification_rules,
                              quota_alerts: e.target.checked,
                            },
                          })
                        }
                        className="size-4 rounded border-[#E5E7EB]"
                      />
                      Alert on standard user registration and space expansion limits reached
                    </label>
                  </div>
                </AdminConsoleSettingsRow>
              </>
            ) : null}
          </AdminConsoleSettingsPanel>
        </>
      ) : null}
    </div>
  );
}
