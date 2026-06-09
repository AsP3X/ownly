// Human: Admin Console - System Settings panels (login-signup.pencil HcA0b, uqdvB, F6aAB).
// Agent: CALLS fetchAdminSettings/updateAdminSettings; RENDERS editable General / Security / SMTP tabs.

import { useCallback, useEffect, useState } from "react";
import { useAdminQuery } from "@/hooks/useAdminQuery";
import { HardDriveDownload, Loader2, Save, Trash2 } from "lucide-react";
import { useInstanceName } from "@/hooks/useInstanceName";
import {
  ENCRYPTION_SUMMARY,
  KEY_EXCHANGE,
  PASSWORD_KDF,
  QUANTUM_POSTURE,
  QUANTUM_READINESS_CHECKLIST,
  SYMMETRIC_CIPHER,
} from "@/lib/encryption-standards";
import {
  cleanupGifPreviewTempFiles,
  fetchAdminSettings,
  fetchAdminStorage,
  getErrorMessage,
  updateAdminSettings,
  type AdminSettingsPatch,
  type AdminSettingsResponse,
} from "@/api/client";
import {
  clearStorageMigrationPreview,
  previewMatchesScope,
  startStorageMigration,
  startStorageMigrationPreview,
  subscribeStorageMigrationJob,
  subscribeStorageMigrationPreview,
  type StorageMigrationJob,
  type StorageMigrationPreview,
} from "@/lib/storage-migration-manager";
import {
  AdminConsoleField,
  AdminConsoleOutlineButton,
  AdminConsolePageHeader,
  AdminConsolePrimaryButton,
  AdminConsoleSettingsPanel,
  AdminConsoleSettingsRow,
  AdminConsoleUnderlineTabs,
  adminConsoleContentClassName,
} from "@/components/admin/console/admin-console-ui";

/** Human: System settings with three underline tabs — loads and saves via admin settings API. */
export function AdminSystemSettingsPanel() {
  const { setInstanceName } = useInstanceName();
  const [tab, setTab] = useState("general");
  const [editedForm, setEditedForm] = useState<AdminSettingsResponse | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [smtpPasswordDraft, setSmtpPasswordDraft] = useState("");
  const [cleaningGifPreviewTemp, setCleaningGifPreviewTemp] = useState(false);
  const [cleanupMessage, setCleanupMessage] = useState<string | null>(null);
  const [migrationNodeId, setMigrationNodeId] = useState("");
  const [migrationPrefix, setMigrationPrefix] = useState("");
  const [migrationRunning, setMigrationRunning] = useState(false);
  const [previewRunning, setPreviewRunning] = useState(false);
  const [migrationPreview, setMigrationPreview] = useState<StorageMigrationPreview | null>(null);
  const [migrationJob, setMigrationJob] = useState<StorageMigrationJob | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  // Human: Local draft for the default quota number field — avoids parseInt-on-keystroke fighting the input.
  // Agent: SYNCED from server snapshot; PARSED in handleSave into default_storage_quota_gb.
  const [defaultQuotaDraft, setDefaultQuotaDraft] = useState<string | null>(null);

  const loadSettings = useCallback(() => fetchAdminSettings(), []);
  const { data: serverData, loading, error: loadError } = useAdminQuery(loadSettings);
  const { data: storageOverview } = useAdminQuery(fetchAdminStorage);
  const error = actionError ?? loadError;

  useEffect(
    () =>
      subscribeStorageMigrationJob((job) => {
        setMigrationJob(job);
        setPreviewRunning(job?.status === "running" && job.kind === "preview");
        setMigrationRunning(job?.status === "running" && job.kind === "migrate");
      }),
    [],
  );

  useEffect(() => subscribeStorageMigrationPreview(setMigrationPreview), []);

  // Human: Changing node or prefix invalidates a prior preview — user must scan again.
  // Agent: CALLS clearStorageMigrationPreview only when stored preview scope diverges from form.
  useEffect(() => {
    if (
      migrationPreview &&
      !previewMatchesScope(migrationPreview, migrationNodeId || undefined, migrationPrefix || undefined)
    ) {
      clearStorageMigrationPreview();
    }
  }, [migrationNodeId, migrationPrefix, migrationPreview]);

  // Human: Prefer local edits over last server snapshot for controlled inputs.
  // Agent: READS editedForm then serverData; WRITES editedForm via patchForm/save.
  const form = editedForm ?? serverData ?? null;

  function patchForm(partial: Partial<AdminSettingsResponse>) {
    setEditedForm((prev) => {
      const base = prev ?? serverData;
      return base ? { ...base, ...partial } : prev;
    });
  }

  async function handleSave() {
    if (!form) return;
    setSaving(true);
    setActionError(null);
    setSavedMessage(null);
    const parsedDefaultQuotaGb = Number.parseInt(defaultQuotaDraft ?? String(form.default_storage_quota_gb), 10);
    const defaultStorageQuotaGb = Number.isNaN(parsedDefaultQuotaGb)
      ? form.default_storage_quota_gb
      : Math.max(1, parsedDefaultQuotaGb);

    const body: AdminSettingsPatch = {
      ...(smtpPasswordDraft.trim() ? { smtp_password: smtpPasswordDraft } : {}),
      instance_name: form.instance_name,
      console_url: form.console_url,
      allow_public_registration: form.allow_public_registration,
      require_account_activation: form.require_account_activation,
      default_storage_quota_gb: defaultStorageQuotaGb,
      maintenance_mode: form.maintenance_mode,
      default_onboarding_role: form.default_onboarding_role,
      enforce_mfa_on_admin_login: form.enforce_mfa_on_admin_login,
      gif_preview_temp_auto_cleanup: form.gif_preview_temp_auto_cleanup,
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
      setEditedForm(updated);
      setDefaultQuotaDraft(String(updated.default_storage_quota_gb));
      setInstanceName(updated.instance_name);
      setSmtpPasswordDraft("");
      setSavedMessage("Settings saved successfully.");
    } catch (err) {
      setActionError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  // Human: Run immediate purge of iOS GIF replay scratch dirs and cached MP4 sidecars.
  // Agent: POST cleanup-gif-preview-temp; SHOWS counts in cleanupMessage.
  async function handleCleanupGifPreviewTemp() {
    if (
      !window.confirm(
        "Remove all iOS GIF preview scratch directories and cached MP4 sidecars now? " +
          "Sidecars rebuild on the next preview open.",
      )
    ) {
      return;
    }

    setCleaningGifPreviewTemp(true);
    setActionError(null);
    setCleanupMessage(null);
    try {
      const result = await cleanupGifPreviewTempFiles();
      setCleanupMessage(
        `Cleanup complete — removed ${result.temp_dirs_removed} scratch director${
          result.temp_dirs_removed === 1 ? "y" : "ies"
        } and ${result.storage_objects_removed} cached preview object${
          result.storage_objects_removed === 1 ? "" : "s"
        }.`,
      );
    } catch (err) {
      setActionError(getErrorMessage(err));
    } finally {
      setCleaningGifPreviewTemp(false);
    }
  }

  const storageNodes = storageOverview?.nodes ?? [];
  const storageNodeIds = storageNodes.map((node) => node.id);
  const migrationScopeReady = previewMatchesScope(
    migrationPreview,
    migrationNodeId || undefined,
    migrationPrefix || undefined,
  );
  const migrationJobBusy = previewRunning || migrationRunning;

  // Human: Full dry-run scan — totals objects to migrate and unlocks Start migration.
  // Agent: CALLS startStorageMigrationPreview; PROGRESS in lower-right transfer tray.
  async function handlePreviewStorageMigration() {
    if (migrationJobBusy) return;

    setActionError(null);
    try {
      await startStorageMigrationPreview({
        nodeId: migrationNodeId.trim() || undefined,
        prefix: migrationPrefix.trim() || undefined,
      });
    } catch (err) {
      setActionError(getErrorMessage(err));
    }
  }

  // Human: Run migration after preview — progress bar uses preview total for percent.
  // Agent: CALLS startStorageMigration; REQUIRES matching migrationPreview with total > 0.
  async function handleStartStorageMigration() {
    if (migrationJobBusy) {
      setActionError("A storage migration or preview is already running.");
      return;
    }
    if (!migrationScopeReady || !migrationPreview) {
      setActionError("Run preview migration for the current node and prefix before starting migration.");
      return;
    }
    if (migrationPreview.totalWouldMigrate === 0) {
      setActionError("Preview found no objects that need migration.");
      return;
    }

    const nodeId = migrationNodeId.trim() || undefined;
    const prefix = migrationPrefix.trim() || undefined;
    const scope = nodeId
      ? `storage node "${nodeId}"`
      : storageNodes.length > 1
        ? "all storage nodes"
        : "the storage node";

    if (
      !window.confirm(
        `Migrate ${migrationPreview.totalWouldMigrate} legacy object(s) on ${scope}? Progress appears in the lower-right corner.`,
      )
    ) {
      return;
    }

    setActionError(null);
    try {
      await startStorageMigration({
        nodeId,
        prefix,
        previewRunId: migrationPreview.runId,
      });
    } catch (err) {
      setActionError(getErrorMessage(err));
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
      {cleanupMessage ? (
        <p className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          {cleanupMessage}
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
                  title="iOS GIF Preview Cleanup"
                  description="Manage ffmpeg scratch directories on the API host. Cached MP4 sidecars in object storage are kept until you run manual cleanup below."
                >
                  <div className="flex flex-col gap-4">
                    <label className="flex items-center gap-2 text-sm text-[#1A1A1A]">
                      <input
                        type="checkbox"
                        checked={form.gif_preview_temp_auto_cleanup}
                        onChange={(e) =>
                          patchForm({ gif_preview_temp_auto_cleanup: e.target.checked })
                        }
                        className="size-4 rounded border-[#E5E7EB]"
                      />
                      Automatically purge idle GIF preview scratch files after 2 minutes
                    </label>
                    <p className="text-xs text-[#888888]">
                      Only API-host scratch dirs with the{" "}
                      <code className="text-[11px]">ownly_gif_preview_</code> prefix are affected.
                      Object-storage preview MP4s ({" "}
                      <code className="text-[11px]">.ownly-gif-preview.mp4</code>) are not removed by
                      this timer. Active transcodes are skipped until ffmpeg finishes or times out.
                    </p>
                    <AdminConsoleOutlineButton
                      onClick={() => void handleCleanupGifPreviewTemp()}
                      disabled={cleaningGifPreviewTemp || saving || loading}
                    >
                      {cleaningGifPreviewTemp ? (
                        <Loader2 className="size-4 animate-spin" aria-hidden />
                      ) : (
                        <Trash2 className="size-4 shrink-0" aria-hidden />
                      )}
                      Clean up GIF preview files now
                    </AdminConsoleOutlineButton>
                  </div>
                </AdminConsoleSettingsRow>
                <AdminConsoleSettingsRow
                  title="Legacy Object Storage Migration"
                  description="Upgrade blobs written before flat encoded paths and NOSI compression. Run in batches until no objects remain to migrate."
                >
                  <div className="flex flex-col gap-4">
                    <p className="text-xs text-[#888888]">
                      Moves nested on-disk layouts (keys with{" "}
                      <code className="text-[11px]">/</code>) to the current flat filename encoding and
                      upgrades legacy <code className="text-[11px]">NOSB</code> /{" "}
                      <code className="text-[11px]">NOSZ</code> / raw blobs toward{" "}
                      <code className="text-[11px]">NOSI</code>. Safe to re-run — already-migrated objects
                      are skipped.
                    </p>
                    {storageNodes.length > 0 ? (
                      <label className="flex flex-col gap-1 text-sm text-[#1A1A1A]">
                        <span className="font-medium">Storage node</span>
                        <select
                          value={migrationNodeId}
                          onChange={(e) => setMigrationNodeId(e.target.value)}
                          className="rounded-lg border border-[#E5E7EB] bg-white px-3 py-2 text-sm"
                        >
                          <option value="">
                            {storageNodes.length > 1 ? "All nodes" : "Default node"}
                          </option>
                          {storageNodes.map((node) => (
                            <option key={node.id} value={node.id}>
                              {node.id} — {node.region_label}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : null}
                    <p className="text-xs text-[#888888]">
                      Run preview first to count objects that need migration. Progress appears in the
                      lower-right corner while preview or migration runs.
                    </p>
                    {migrationJob?.status === "running" ? (
                      <p className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                        {migrationJob.kind === "preview" ? "Preview" : "Migration"} in progress —{" "}
                        {migrationJob.kind === "preview"
                          ? `${migrationJob.migrated} would migrate so far`
                          : `${migrationJob.migrated}${migrationJob.totalTarget ? ` of ${migrationJob.totalTarget}` : ""} migrated`}
                        {migrationJob.failed > 0 ? ` · ${migrationJob.failed} failed` : ""}. Watch the
                        lower-right progress card or open the result dialog when finished.
                      </p>
                    ) : null}
                    {migrationScopeReady && migrationPreview ? (
                      <p className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-900">
                        Preview ready:{" "}
                        <span className="font-semibold">{migrationPreview.totalWouldMigrate}</span> to
                        migrate, {migrationPreview.totalSkipped} already up to date
                        {migrationPreview.totalScanned > 0
                          ? ` (${migrationPreview.totalScanned} scanned)`
                          : ""}
                        . You can start migration here or from the preview summary dialog.
                      </p>
                    ) : null}
                    <AdminConsoleField
                      label="Key prefix (optional)"
                      value={migrationPrefix}
                      placeholder="users/"
                      onChange={setMigrationPrefix}
                    />
                    <div className="flex flex-wrap gap-2">
                      <AdminConsoleOutlineButton
                        onClick={() => void handlePreviewStorageMigration()}
                        disabled={migrationJobBusy || saving || loading || storageNodeIds.length === 0}
                      >
                        {previewRunning ? (
                          <Loader2 className="size-4 animate-spin" aria-hidden />
                        ) : null}
                        Preview migration
                      </AdminConsoleOutlineButton>
                      <AdminConsoleOutlineButton
                        onClick={() => void handleStartStorageMigration()}
                        disabled={
                          migrationJobBusy ||
                          saving ||
                          loading ||
                          !migrationScopeReady ||
                          !migrationPreview ||
                          migrationPreview.totalWouldMigrate === 0
                        }
                      >
                        {migrationRunning ? (
                          <Loader2 className="size-4 animate-spin" aria-hidden />
                        ) : (
                          <HardDriveDownload className="size-4 shrink-0" aria-hidden />
                        )}
                        Start migration
                      </AdminConsoleOutlineButton>
                    </div>
                  </div>
                </AdminConsoleSettingsRow>
                <AdminConsoleSettingsRow
                  title="Storage Capacity Quota"
                  description="Set the default maximum storage limit per-user across all clusters prior to admin overrides."
                >
                  <div className="flex flex-col gap-2">
                    <AdminConsoleField
                      label="Default Allocated Quota"
                      value={defaultQuotaDraft ?? String(form.default_storage_quota_gb)}
                      type="number"
                      suffix="GB"
                      onChange={(v) => {
                        setDefaultQuotaDraft(v);
                        const parsed = Number.parseInt(v, 10);
                        if (!Number.isNaN(parsed) && parsed >= 1) {
                          patchForm({ default_storage_quota_gb: parsed });
                        }
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
                  title="Quantum-Resistant Encryption"
                  description="Symmetric AES-256-GCM protects stored data; hybrid post-quantum TLS protects keys in transit."
                >
                  <div className="flex flex-col gap-4">
                    <AdminConsoleField
                      label="Symmetric cipher (data at rest)"
                      value={SYMMETRIC_CIPHER}
                    />
                    <AdminConsoleField
                      label="Key exchange (hybrid PQC at edge)"
                      value={KEY_EXCHANGE}
                    />
                    <AdminConsoleField label="Password KDF" value={PASSWORD_KDF} />
                    <AdminConsoleField label="Posture summary" value={QUANTUM_POSTURE} />
                    <div className="rounded-lg border border-[#E5E7EB] bg-[#F7F8FA] px-4 py-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-[#666666]">
                        Deployment checklist
                      </p>
                      <ul className="mt-2 list-disc space-y-1 pl-4 text-sm text-[#666666]">
                        {QUANTUM_READINESS_CHECKLIST.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    </div>
                    <p className="text-xs text-[#888888]">
                      Active standard: {ENCRYPTION_SUMMARY}. HLS streaming segments remain AES-128-CBC
                      for player compatibility; segment keys are wrapped with {SYMMETRIC_CIPHER}.
                    </p>
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
