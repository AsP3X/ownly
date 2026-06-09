// Human: Create and manage user dialogs for the admin console User Management panel.
// Agent: CALLS createAdminUser/updateAdminUser/deleteAdminUser; WRITES via parent onSaved callback.

import { useState } from "react";
import { Loader2 } from "lucide-react";
import {
  createAdminUser,
  getErrorMessage,
  updateAdminUser,
  type AdminUserRow,
} from "@/api/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { AdminActiveSessionsPanel } from "@/components/admin/console/AdminActiveSessionsPanel";
import {
  AdminEditUserBody,
  AdminEditUserCleanupRow,
  AdminEditUserDivider,
  AdminEditUserFooter,
  AdminEditUserRoleSegments,
  AdminEditUserSessionsRow,
  AdminEditUserStatusRow,
  AdminEditUserStorageSection,
} from "@/components/admin/console/AdminEditUserDialogLayout";
import {
  adminUserRoleTierFromApi,
  adminUserRoleTierToApi,
  normalizeAdminUserRole,
  type AdminUserRoleTier,
  userDisplayName,
} from "@/lib/utils-app";

type DialogBaseProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
};

function handleDialogOpenChange(
  next: boolean,
  onOpenChange: (open: boolean) => void,
  reset?: () => void,
) {
  if (next) reset?.();
  onOpenChange(next);
}

/** Human: Invite flow — email, password, role, and activation toggle. */
export function AdminCreateUserDialog({ open, onOpenChange, onSaved }: DialogBaseProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("pro");
  const [enabled, setEnabled] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function resetForm() {
    setEmail("");
    setPassword("");
    setRole("pro");
    setEnabled(true);
    setError(null);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await createAdminUser({ email, password, role, enabled });
      onOpenChange(false);
      onSaved();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => handleDialogOpenChange(next, onOpenChange, resetForm)}
    >
      <DialogContent className="max-w-md">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Add New User</DialogTitle>
            <DialogDescription>
              Create a local account with email and password. The user can sign in immediately when
              activation is enabled.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4 py-4">
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-semibold text-neutral-700">Email</span>
              <Input
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-semibold text-neutral-700">Password</span>
              <Input
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-semibold text-neutral-700">Access role</span>
              <select
                className="h-9 rounded-lg border border-input bg-transparent px-2.5 text-sm"
                value={role}
                onChange={(e) => setRole(e.target.value)}
              >
                <option value="standard">Standard User</option>
                <option value="pro">Pro User</option>
                <option value="admin">Administrator</option>
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm text-neutral-700">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
                className="size-4 rounded border-input"
              />
              Account activated (can sign in)
            </label>
            {error ? <p className="text-sm text-red-600">{error}</p> : null}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                  Creating…
                </>
              ) : (
                "Create user"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

type ManageProps = DialogBaseProps & {
  user: AdminUserRow | null;
  currentUserId?: string;
};

type ManageView = "edit" | "sessions";

/** Human: Inner form remounts per user id — matches Pencil Edit User Dialog (IlfEv). */
function AdminManageUserForm({
  user,
  currentUserId,
  onClose,
  onSaved,
}: {
  user: AdminUserRow;
  currentUserId?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [view, setView] = useState<ManageView>("edit");
  const [roleTier, setRoleTier] = useState<AdminUserRoleTier>(() => adminUserRoleTierFromApi(user.role));
  const [enabled, setEnabled] = useState(user.enabled);
  // Human: Effective quota shown in the directory — may come from instance default when override is null.
  // Agent: READS quota_bytes; USED for display and default-inheritance comparisons.
  const effectiveQuotaGb = Math.max(1, Math.round(user.quota_bytes / (1024 * 1024 * 1024)));
  const [quotaGb, setQuotaGb] = useState(effectiveQuotaGb);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isSelf = currentUserId === user.id;
  const apiRole = adminUserRoleTierToApi(roleTier);
  const storedRole = normalizeAdminUserRole(user.role);
  const quotaBytes = quotaGb * 1024 * 1024 * 1024;
  const sessionSubtitle = user.last_active_at
    ? "1 device currently authorized to access"
    : "No recent sign-in activity recorded";

  async function handleSave() {
    setSubmitting(true);
    setError(null);
    try {
      const body: {
        role?: string;
        enabled?: boolean;
        storage_quota_gb?: number;
      } = {};
      if (apiRole !== storedRole) body.role = apiRole;
      if (enabled !== user.enabled) body.enabled = enabled;
      // Human: Compare against stored override when present — not only effective quota_bytes.
      // Agent: PATCH storage_quota_gb when explicit column changes or user leaves instance default.
      const storedQuotaGb = user.storage_quota_gb;
      const quotaChanged =
        storedQuotaGb != null
          ? quotaGb !== storedQuotaGb
          : quotaGb !== effectiveQuotaGb;
      if (quotaChanged) body.storage_quota_gb = quotaGb;
      if (Object.keys(body).length === 0) {
        onClose();
        return;
      }
      await updateAdminUser(user.id, body);
      onClose();
      onSaved();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  if (view === "sessions") {
    return <AdminActiveSessionsPanel user={user} onBack={() => setView("edit")} />;
  }

  return (
    <div className="flex flex-col gap-[22px]">
      <div className="flex flex-col gap-1 pr-8">
        <h2 className="text-lg font-semibold text-[#1A1A1A]">Edit User Account</h2>
        <p className="text-[13px] text-[#666666]">
          {userDisplayName(user.email)} • {user.email}
        </p>
      </div>

      <AdminEditUserDivider />

      <AdminEditUserBody>
        <AdminEditUserStatusRow
          enabled={enabled}
          disabled={isSelf}
          onEnabledChange={setEnabled}
        />
        {isSelf ? (
          <p className="text-xs text-[#888888]">
            You cannot change your own account status or role here. Ask another administrator to update
            your account.
          </p>
        ) : null}
        <AdminEditUserRoleSegments
          value={roleTier}
          disabled={isSelf}
          onChange={setRoleTier}
        />
        <AdminEditUserStorageSection
          quotaGb={quotaGb}
          usedBytes={user.storage_bytes}
          quotaBytes={quotaBytes}
          onQuotaGbChange={setQuotaGb}
        />
        <AdminEditUserSessionsRow
          subtitle={sessionSubtitle}
          onManageSessions={() => setView("sessions")}
        />
        <AdminEditUserCleanupRow checked disabled onCheckedChange={() => undefined} />
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
      </AdminEditUserBody>

      <AdminEditUserDivider />

      <AdminEditUserFooter
        onCancel={onClose}
        onSave={() => void handleSave()}
        saving={submitting}
      />
    </div>
  );
}

/** Human: Edit User Account modal — login-signup.pencil Admin Console - Edit User Dialog Open. */
export function AdminManageUserDialog({
  open,
  onOpenChange,
  onSaved,
  user,
  currentUserId,
}: ManageProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton
        overlayClassName="bg-[#0F172A66] supports-backdrop-filter:backdrop-blur-[1px]"
        className="max-w-[580px] gap-0 rounded-2xl border border-[#E5E7EB] bg-white p-7 shadow-[0_16px_32px_-4px_rgba(0,0,0,0.16)] sm:max-w-[580px]"
      >
        {user ? (
          <AdminManageUserForm
            key={`${user.id}:${user.updated_at}:${user.storage_quota_gb ?? "default"}:${user.quota_bytes}`}
            user={user}
            currentUserId={currentUserId}
            onClose={() => onOpenChange(false)}
            onSaved={onSaved}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
