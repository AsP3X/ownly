// Human: Admin Console - Users & Security panel (login-signup.pencil frame h9Cwi).
// Agent: CALLS fetchAdminUsers/fetchAdminUserRoles; RENDERS directory + role catalog from API.

import { useCallback, useState } from "react";
import { Loader2, Pencil, RefreshCw, Trash2, UserPlus } from "lucide-react";
import { AdminDeleteUserDialog } from "@/components/admin/console/AdminDeleteUserDialog";
import {
  fetchAdminUserRoles,
  fetchAdminUsers,
  type AdminRoleRow,
  type AdminUserRow,
} from "@/api/client";
import { useAdminQuery } from "@/hooks/useAdminQuery";
import { AdminCreateUserDialog, AdminManageUserDialog } from "@/components/admin/console/AdminUserDialogs";
import {
  AdminConsolePageHeader,
  AdminConsolePanel,
  AdminConsolePrimaryButton,
  AdminConsoleTable,
  AdminConsoleUnderlineTabs,
  AdminConsoleUserAvatar,
  AdminConsolePill,
  adminConsoleContentClassName,
} from "@/components/admin/console/admin-console-ui";
import {
  adminRoleTableLabel,
  formatBytes,
  formatRelativeActive,
  userInitials,
} from "@/lib/utils-app";
import { useAuth } from "@/hooks/useAuth";

// Human: Combined users list + role catalog returned by the directory loader.
// Agent: READS fetchAdminUsers/fetchAdminUserRoles; USED by useAdminQuery in this panel.
type UsersDirectoryData = {
  users: Awaited<ReturnType<typeof fetchAdminUsers>>;
  roles: AdminRoleRow[];
};

/** Human: User directory with underline tabs and live compliance summary cards. */
export function AdminUsersSecurityPanel() {
  const { user: currentUser } = useAuth();
  const [tab, setTab] = useState("directory");
  const [createOpen, setCreateOpen] = useState(false);
  const [manageUser, setManageUser] = useState<AdminUserRow | null>(null);
  const [deleteUser, setDeleteUser] = useState<AdminUserRow | null>(null);

  const loadDirectory = useCallback(async (): Promise<UsersDirectoryData> => {
    const [usersRes, rolesRes] = await Promise.all([fetchAdminUsers(), fetchAdminUserRoles()]);
    return { users: usersRes, roles: rolesRes.roles };
  }, []);

  const { data, loading, refreshing, error, reload } = useAdminQuery(loadDirectory);

  const summary = data?.users.summary;
  const users = data?.users.users ?? [];
  const roles = data?.roles ?? [];
  const enabledCount = summary?.enabled_count ?? 0;
  const total = summary?.total ?? 0;
  const activationPct = summary?.activation_rate_percent ?? 0;

  return (
    <div className={adminConsoleContentClassName}>
      <AdminConsolePageHeader
        title="User Management"
        description="Monitor user directory, manage access roles, and audit security compliance."
        actions={
          <>
            <button
              type="button"
              onClick={() => void reload(true)}
              disabled={loading || refreshing}
              className="inline-flex items-center gap-2 rounded-lg border border-[#E5E7EB] bg-white px-4 py-2.5 text-[13px] font-semibold text-[#666666] transition-colors hover:bg-[#F7F8FA] disabled:opacity-60"
            >
              {refreshing ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
              ) : (
                <RefreshCw className="size-3.5 shrink-0" aria-hidden />
              )}
              Refresh
            </button>
            <AdminConsolePrimaryButton onClick={() => setCreateOpen(true)} disabled={loading}>
              <UserPlus className="size-4 shrink-0" aria-hidden />
              Add New User
            </AdminConsolePrimaryButton>
          </>
        }
      />

      {error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
          {error}
        </p>
      ) : null}

      <AdminConsoleUnderlineTabs
        tabs={[
          { id: "directory", label: `Active Directory (${total})` },
          { id: "roles", label: "Security Roles" },
        ]}
        activeId={tab}
        onChange={setTab}
      />

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-[#666666]">
          <Loader2 className="size-5 animate-spin" aria-hidden />
          Loading users…
        </div>
      ) : null}

      {!loading && tab === "directory" ? (
        <>
          <AdminConsoleTable
            caption="Users"
            columns={[
              "User / Email",
              "Access Role",
              "Account Status",
              "Storage Utilized",
              "Last Active",
              "Actions",
            ]}
            rows={users.map((user) => [
              <div key={user.id} className="flex items-center gap-3">
                <AdminConsoleUserAvatar initials={userInitials(user.email)} />
                <div className="min-w-0">
                  <p className="font-semibold text-[#1A1A1A]">{user.email.split("@")[0]}</p>
                  <p className="truncate text-xs text-[#666666]">{user.email}</p>
                </div>
              </div>,
              <AdminConsolePill key={`r-${user.id}`} tone="primary">
                {adminRoleTableLabel(user.role)}
              </AdminConsolePill>,
              <AdminConsolePill
                key={`s-${user.id}`}
                tone={user.enabled ? "success" : "warning"}
              >
                {user.enabled ? "Active" : "Pending activation"}
              </AdminConsolePill>,
              formatBytes(user.storage_bytes),
              formatRelativeActive(user.last_active_at),
              <div key={`a-${user.id}`} className="flex items-center gap-4">
                <button
                  type="button"
                  className="text-[#666666] transition-colors hover:text-[#2563EB]"
                  aria-label={`Edit ${user.email}`}
                  onClick={() => setManageUser(user)}
                >
                  <Pencil className="size-4" aria-hidden />
                </button>
                <button
                  type="button"
                  className="text-[#666666] transition-colors hover:text-[#DC2626] disabled:cursor-not-allowed disabled:opacity-40"
                  aria-label={`Delete ${user.email}`}
                  disabled={currentUser?.id === user.id}
                  onClick={() => setDeleteUser(user)}
                >
                  <Trash2 className="size-4" aria-hidden />
                </button>
              </div>,
            ])}
          />

          {users.length === 0 ? (
            <p className="text-center text-sm text-[#666666]">No users yet. Add the first account above.</p>
          ) : null}

          <div className="grid gap-4 md:grid-cols-2">
            <AdminConsolePanel title="Account Activation Status">
              <div className="flex items-end justify-between gap-4">
                <div>
                  <AdminConsolePill tone={activationPct >= 100 ? "success" : "warning"}>
                    {activationPct >= 100 ? "Fully active" : "Partial"}
                  </AdminConsolePill>
                  <p className="mt-2 text-3xl font-bold text-[#1A1A1A]">
                    {activationPct.toFixed(1)}%
                  </p>
                  <p className="mt-1 text-xs text-[#666666]">
                    {enabledCount} of {total} accounts can sign in
                  </p>
                </div>
              </div>
            </AdminConsolePanel>
            <AdminConsolePanel title="Administrator Coverage">
              <AdminConsolePill tone="success">Protected</AdminConsolePill>
              <p className="mt-2 text-sm text-[#666666]">
                {summary?.admin_count ?? 0} administrator
                {(summary?.admin_count ?? 0) === 1 ? "" : "s"} on this instance. At least one active
                admin is always required.
              </p>
            </AdminConsolePanel>
          </div>
        </>
      ) : null}

      {!loading && tab === "roles" ? (
        <AdminConsolePanel title="Security Roles" subtitle="Instance role catalog and attached permissions">
          <AdminConsoleTable
            caption="Roles"
            columns={["Role", "Members", "Permissions", "Type"]}
            rows={roles.map((role) => [
              role.label,
              String(role.member_count),
              <span key={`perm-${role.id}`} className="font-mono text-xs text-[#666666]">
                {role.permissions}
              </span>,
              role.role_type === "system" ? "System" : "Custom",
            ])}
          />
        </AdminConsolePanel>
      ) : null}

      <AdminCreateUserDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSaved={() => void reload(true)}
      />
      <AdminManageUserDialog
        open={manageUser !== null}
        onOpenChange={(open) => {
          if (!open) setManageUser(null);
        }}
        user={manageUser}
        currentUserId={currentUser?.id}
        onSaved={() => void reload(true)}
      />
      <AdminDeleteUserDialog
        user={deleteUser}
        open={deleteUser !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteUser(null);
        }}
        onDeleted={() => void reload(true)}
      />
    </div>
  );
}
