// Human: Users, groups, permissions, and audit wireframe panels for admin management.
// Agent: RENDERS static tables and toolbars; maps to future /api/v1/admin/* routes.

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  TableToolbar,
  WireframePageHeader,
  WireframeTable,
} from "@/components/admin/wireframe/wireframe-primitives";

/** Human: User directory with approval workflow filters. */
export function AdminWireframeUsersTab() {
  return (
    <div className="flex flex-col gap-6">
      <WireframePageHeader
        title="Users"
        description="Manage accounts, roles, quotas, and activation status."
        actions={
          <Button type="button" className="bg-blue-600 hover:bg-blue-700">
            Invite user
          </Button>
        }
      />
      <TableToolbar
        searchPlaceholder="Search by name or email…"
        filters={[
          { label: "All", active: true },
          { label: "Active" },
          { label: "Pending" },
          { label: "Suspended" },
        ]}
      />
      <WireframeTable
        caption="Users"
        columns={["User", "Status", "Groups", "Storage", "Last active", ""]}
        rows={[
          ["admin@example.com", "Active", "Administrators", "12.4 GB", "Just now", "⋯"],
          ["jane@corp.com", "Active", "Editors", "84.2 GB", "2h ago", "⋯"],
          ["new.user@test.io", "Pending approval", "—", "—", "—", "Approve"],
          ["legacy@old.net", "Suspended", "Users", "201 GB", "30d ago", "⋯"],
        ]}
      />
      <p className="text-xs text-neutral-400">
        Bulk actions: approve · suspend · reset password · set quota · add to group
      </p>
    </div>
  );
}

/** Human: Group membership and system groups wireframe. */
export function AdminWireframeGroupsTab() {
  return (
    <div className="flex flex-col gap-6">
      <WireframePageHeader
        title="Groups"
        description="Organize users and attach instance-level permissions."
        actions={
          <Button type="button" className="bg-blue-600 hover:bg-blue-700">
            Create group
          </Button>
        }
      />
      <div className="grid gap-4 md:grid-cols-2">
        <Card className="border-neutral-200 shadow-none">
          <CardHeader>
            <CardTitle className="text-base">Administrators</CardTitle>
            <CardDescription>System group · cannot delete</CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-neutral-600">
            <Badge className="mb-2">instance.admin</Badge>
            <p>3 members · Full instance control</p>
          </CardContent>
        </Card>
        <Card className="border-neutral-200 shadow-none">
          <CardHeader>
            <CardTitle className="text-base">Editors</CardTitle>
            <CardDescription>Custom group</CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-neutral-600">
            <p>24 members · Content write + share</p>
          </CardContent>
        </Card>
      </div>
      <WireframeTable
        caption="Groups"
        columns={["Name", "Members", "Permissions", "Type", ""]}
        rows={[
          ["Administrators", "3", "instance.*", "System", "View"],
          ["Editors", "24", "12 grants", "Custom", "⋯"],
          ["Guests", "8", "content.read", "Custom", "⋯"],
        ]}
      />
    </div>
  );
}

/** Human: Instance-level permission grants matrix. */
export function AdminWireframePermissionsTab() {
  return (
    <div className="flex flex-col gap-6">
      <WireframePageHeader
        title="Permissions"
        description="Grant or deny atomic permissions to users and groups on the instance."
        actions={
          <Button type="button" className="bg-blue-600 hover:bg-blue-700">
            Add grant
          </Button>
        }
      />
      <TableToolbar searchPlaceholder="Filter by permission or subject…" />
      <WireframeTable
        caption="Permission grants"
        columns={["Subject", "Permission", "Effect", "Granted", ""]}
        rows={[
          ["group:Editors", "content.write", "Allow", "May 1, 2026", "⋯"],
          ["user:jane@corp.com", "instance.audit.read", "Allow", "Apr 12, 2026", "⋯"],
          ["group:Guests", "content.delete", "Deny", "Mar 3, 2026", "⋯"],
        ]}
      />
      <Card className="border-neutral-200 bg-neutral-50/50 shadow-none">
        <CardContent className="py-4 text-sm text-neutral-600">
          Permission catalog: 42 instance permissions · 18 content permissions · Inheritance and deny-wins
          documented in admin guide.
        </CardContent>
      </Card>
    </div>
  );
}

/** Human: Searchable audit log explorer. */
export function AdminWireframeAuditTab() {
  return (
    <div className="flex flex-col gap-6">
      <WireframePageHeader
        title="Audit log"
        description="Immutable record of security-relevant actions across the instance."
        actions={
          <Button type="button" variant="outline" className="border-neutral-200">
            Export JSON
          </Button>
        }
      />
      <TableToolbar
        searchPlaceholder="Search action, user, resource…"
        filters={[
          { label: "All actions" },
          { label: "Auth", active: false },
          { label: "Files" },
          { label: "Permissions" },
        ]}
      />
      <WireframeTable
        caption="Audit events"
        columns={["Time", "Actor", "Action", "Resource", "IP"]}
        rows={[
          ["10:42:01", "admin@example.com", "files.upload", "file/8f2…", "192.168.1.4"],
          ["10:41:55", "jane@corp.com", "permissions.grant", "folder/3a1…", "10.0.0.22"],
          ["10:38:12", "—", "auth.login.failed", "—", "203.0.113.8"],
          ["10:12:00", "admin@example.com", "instance.settings.update", "settings", "192.168.1.4"],
        ]}
      />
    </div>
  );
}
