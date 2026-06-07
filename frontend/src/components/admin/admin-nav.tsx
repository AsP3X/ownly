// Human: Shared admin section ids and sidebar nav config for desktop + mobile console chrome.
// Agent: EXPORTED AdminNavId + ADMIN_NAV; READ by AdminSidebar and AdminMobileSidebarSheet.

import type { ReactNode } from "react";
import {
  FileText,
  LayoutDashboard,
  Server,
  Settings,
  Shield,
  Users,
} from "lucide-react";

export type AdminNavId =
  | "overview"
  | "users-security"
  | "security-policies"
  | "storage-nodes"
  | "audit-logs"
  | "system-settings";

export const ADMIN_NAV: { id: AdminNavId; label: string; icon: ReactNode }[] = [
  { id: "overview", label: "Overview", icon: <LayoutDashboard className="size-[18px]" strokeWidth={2} /> },
  { id: "users-security", label: "Users & Security", icon: <Users className="size-[18px]" strokeWidth={2} /> },
  {
    id: "security-policies",
    label: "Security Policies",
    icon: <Shield className="size-[18px]" strokeWidth={2} />,
  },
  { id: "storage-nodes", label: "Storage Nodes", icon: <Server className="size-[18px]" strokeWidth={2} /> },
  { id: "audit-logs", label: "Audit Logs", icon: <FileText className="size-[18px]" strokeWidth={2} /> },
  {
    id: "system-settings",
    label: "System Settings",
    icon: <Settings className="size-[18px]" strokeWidth={2} />,
  },
];
