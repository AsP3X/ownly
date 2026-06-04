// Human: Admin console route — 1:1 shell and panels from login-signup.pencil Admin Console frames.
// Agent: RENDERS AdminSidebar + panels wired to /api/v1/admin/*; route /admin; redirects non-admins.

import { useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { Menu } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useAdminUrlState } from "@/hooks/useAdminUrlState";
import { displayNameFromEmail } from "@/lib/public-share-format";
import { userInitials, userRoleLabel } from "@/lib/utils-app";
import { AdminSidebar, type AdminNavId } from "@/components/admin/AdminSidebar";
import { AdminAuditLogsPanel } from "@/components/admin/console/AdminAuditLogsPanel";
import { AdminKeyManagementPanel } from "@/components/admin/console/AdminKeyManagementPanel";
import { AdminOverviewPanel } from "@/components/admin/console/AdminOverviewPanel";
import { AdminStorageNodesPanel } from "@/components/admin/console/AdminStorageNodesPanel";
import { AdminSystemSettingsPanel } from "@/components/admin/console/AdminSystemSettingsPanel";
import { AdminUsersSecurityPanel } from "@/components/admin/console/AdminUsersSecurityPanel";
import { DriveDesktopTopbar } from "@/components/drive/DriveDesktopTopbar";
import { Button } from "@/components/ui/button";

const MOBILE_NAV: { id: AdminNavId; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "users-security", label: "Users & Security" },
  { id: "security-policies", label: "Security Policies" },
  { id: "storage-nodes", label: "Storage Nodes" },
  { id: "audit-logs", label: "Audit Logs" },
  { id: "system-settings", label: "System Settings" },
];

// Human: Topbar status line per active admin screen (Pencil Topbar Instance descendants).
// Agent: READS activeNav; RETURNS status string for DriveDesktopTopbar.
function statusTextForNav(activeNav: AdminNavId): string {
  switch (activeNav) {
    case "overview":
      return "Admin Control Panel • Live instance metrics";
    case "storage-nodes":
      return "Secure Server-Side Session Active • Object storage health";
    case "audit-logs":
      return "Secure Server-Side Session Active • Audit Logger Active";
    default:
      return "Secure Server-Side Session Active";
  }
}

/** Human: Full admin console — explorer layout with pen-accurate section panels. */
export default function AdminDashboardWireframePage() {
  const { user, logout } = useAuth();
  const [activeNav, setActiveNav] = useState<AdminNavId>("overview");
  // Human: Persist the active admin section in ?section= so reload stays on the same panel.
  // Agent: CALLS useAdminUrlState; WRITES ADMIN_SECTION_PARAM when sidebar changes.
  useAdminUrlState(activeNav, setActiveNav);

  // Human: Only administrators may access the console — others return to drive.
  // Agent: READS user.role; NAVIGATE away when role !== admin.
  if (user && user.role !== "admin") {
    return <Navigate to="/" replace />;
  }

  const initials = userInitials(user?.email);
  const displayName = useMemo(
    () => (user?.email ? displayNameFromEmail(user.email) : "Administrator"),
    [user?.email],
  );
  const roleLabel = userRoleLabel(user?.role);

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-[#F7F8FA] text-[#1A1A1A]">
      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[260px_minmax(0,1fr)]">
        <AdminSidebar activeNav={activeNav} onNavChange={setActiveNav} />

        <div className="flex min-h-0 min-w-0 flex-col overflow-hidden">
          <div className="flex items-center gap-2 border-b border-[#E5E7EB] bg-white px-4 py-2 lg:hidden">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="text-[#666666] lg:hidden"
              aria-label="Open section menu"
            >
              <Menu className="size-5" />
            </Button>
            <select
              className="min-w-0 flex-1 rounded-lg border border-[#E5E7EB] bg-white px-3 py-2 text-sm"
              value={activeNav}
              onChange={(e) => setActiveNav(e.target.value as AdminNavId)}
              aria-label="Admin section"
            >
              {MOBILE_NAV.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>

          <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {/* Human: Topbar wrapper — Pencil padding [0,40] on dashboard; px-10 ≈ 40px */}
            <div className="shrink-0 px-4 pt-4 lg:px-10 lg:pt-6">
              <DriveDesktopTopbar
                displayName={displayName}
                roleLabel={roleLabel}
                initials={initials}
                email={user?.email}
                isAdmin={user?.role === "admin"}
                statusText={statusTextForNav(activeNav)}
                onSignOut={logout}
                className="flex max-lg:flex"
              />
            </div>

            {/* Human: Console scroll container — gap 24, padding 48 per Explorer Content */}
            <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-10 pt-6 lg:px-12 lg:pb-12 lg:pt-6">
              {activeNav === "overview" ? <AdminOverviewPanel /> : null}
              {activeNav === "users-security" ? <AdminUsersSecurityPanel /> : null}
              {activeNav === "security-policies" ? <AdminKeyManagementPanel /> : null}
              {activeNav === "storage-nodes" ? <AdminStorageNodesPanel /> : null}
              {activeNav === "audit-logs" ? <AdminAuditLogsPanel /> : null}
              {activeNav === "system-settings" ? <AdminSystemSettingsPanel /> : null}
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}
