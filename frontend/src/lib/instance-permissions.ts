// Human: Helpers for instance permission strings from /me/permissions.
// Agent: READS permission slugs; USED by admin route guards, sidebar filtering, and share ACL UI.

import type { AdminNavId } from "@/components/admin/admin-nav";

/** Human: True when the caller holds instance.admin or the exact permission slug. */
export function hasInstancePermission(
  permissions: readonly string[] | undefined,
  required: string,
): boolean {
  if (!permissions?.length) return false;
  if (permissions.includes("instance.admin")) return true;
  return permissions.includes(required);
}

/** Human: True when any instance.* permission is present (delegated admin). */
export function hasAnyInstanceAccess(permissions: readonly string[] | undefined): boolean {
  if (!permissions?.length) return false;
  return permissions.some((p) => p.startsWith("instance."));
}

/** Human: JWT admin role or instance.admin grant — source of truth for admin chrome. */
export function isInstanceAdmin(
  permissions: readonly string[] | undefined,
  jwtRole: string | undefined,
): boolean {
  if (jwtRole === "admin") return true;
  return hasInstancePermission(permissions, "instance.admin");
}

/** Human: Minimum instance permission per admin console section. */
export const ADMIN_NAV_PERMISSIONS: Record<AdminNavId, string> = {
  overview: "instance.settings.read",
  "users-security": "instance.users.read",
  "security-policies": "instance.settings.read",
  "storage-nodes": "instance.settings.read",
  "audit-logs": "instance.audit.read",
  "system-settings": "instance.settings.read",
};

/** Human: Filter admin sidebar tabs to sections the caller may access. */
export function filterAdminNav<T extends { id: AdminNavId }>(
  items: readonly T[],
  permissions: readonly string[] | undefined,
  jwtRole: string | undefined,
): T[] {
  if (isInstanceAdmin(permissions, jwtRole)) return [...items];
  return items.filter((item) =>
    hasInstancePermission(permissions, ADMIN_NAV_PERMISSIONS[item.id]),
  );
}

/** Human: Content permissions assignable in share/ACL dialogs. */
export const CONTENT_PERMISSION_OPTIONS = [
  { id: "content.read", label: "Read" },
  { id: "content.write", label: "Write" },
  { id: "content.delete", label: "Delete" },
  { id: "content.share", label: "Share" },
  { id: "content.manage_acl", label: "Manage ACL" },
] as const;
