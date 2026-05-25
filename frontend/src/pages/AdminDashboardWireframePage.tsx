// Human: Admin dashboard UI wireframe — full layout spec matching the drive shell design language.
// Agent: RENDERS mock data only; route /admin; no admin API calls; links back to drive at "/".

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  Activity,
  ArrowLeft,
  BarChart3,
  ClipboardList,
  FolderOpen,
  Key,
  LayoutGrid,
  LogOut,
  Search,
  Settings,
  Shield,
  Users,
  UsersRound,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { userInitials } from "@/lib/utils-app";
import { cn } from "@/lib/utils";
import { AdminWireframeAnalyticsTab } from "@/components/admin/wireframe/AdminWireframeAnalyticsTab";
import {
  AdminWireframeAuditTab,
  AdminWireframeGroupsTab,
  AdminWireframePermissionsTab,
  AdminWireframeUsersTab,
} from "@/components/admin/wireframe/AdminWireframeManagementTabs";
import {
  AdminWireframeSecurityTab,
  AdminWireframeStorageTab,
} from "@/components/admin/wireframe/AdminWireframeInfrastructureTab";
import { AdminWireframeOverviewTab } from "@/components/admin/wireframe/AdminWireframeOverviewTab";
import { AdminWireframeSettingsTab } from "@/components/admin/wireframe/AdminWireframeSettingsTab";
import { WireframeBadge } from "@/components/admin/wireframe/wireframe-primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";

type AdminNavId =
  | "overview"
  | "analytics"
  | "users"
  | "groups"
  | "permissions"
  | "audit"
  | "storage"
  | "security"
  | "settings";

const ADMIN_NAV: { id: AdminNavId; label: string; icon: typeof Activity; group?: string }[] = [
  { id: "overview", label: "Overview", icon: Activity },
  { id: "analytics", label: "Analytics", icon: BarChart3 },
  { id: "users", label: "Users", icon: Users, group: "Directory" },
  { id: "groups", label: "Groups", icon: UsersRound },
  { id: "permissions", label: "Permissions", icon: Key },
  { id: "audit", label: "Audit log", icon: ClipboardList },
  { id: "storage", label: "Storage", icon: FolderOpen, group: "Infrastructure" },
  { id: "security", label: "Security", icon: Shield },
  { id: "settings", label: "Settings", icon: Settings },
];

// Human: Sidebar row with blue active rail — same pattern as DrivePage SidebarNavItem.
function AdminNavItem({
  label,
  icon: Icon,
  active,
  onClick,
}: {
  label: string;
  icon: typeof Activity;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 rounded-md py-2 pl-1 pr-2 text-left text-sm transition-colors",
        active && "font-semibold text-blue-700",
        !active && "text-neutral-700 hover:bg-neutral-100",
      )}
    >
      <span
        className={cn(
          "h-[18px] w-[3px] shrink-0 rounded-full",
          active ? "bg-blue-600" : "bg-transparent",
        )}
        aria-hidden
      />
      <Icon className="size-4 shrink-0 text-neutral-500" aria-hidden />
      <span>{label}</span>
    </button>
  );
}

/** Human: Full-screen admin wireframe with header, sidebar, and tab panels. */
export default function AdminDashboardWireframePage() {
  const { user, logout } = useAuth();
  const [activeNav, setActiveNav] = useState<AdminNavId>("overview");
  const [profileOpen, setProfileOpen] = useState(false);
  const [adminQuery, setAdminQuery] = useState("");
  const profileRef = useRef<HTMLDivElement>(null);
  const initials = userInitials(user?.email);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) {
        setProfileOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  let panel: ReactNode;
  switch (activeNav) {
    case "overview":
      panel = <AdminWireframeOverviewTab />;
      break;
    case "analytics":
      panel = <AdminWireframeAnalyticsTab />;
      break;
    case "users":
      panel = <AdminWireframeUsersTab />;
      break;
    case "groups":
      panel = <AdminWireframeGroupsTab />;
      break;
    case "permissions":
      panel = <AdminWireframePermissionsTab />;
      break;
    case "audit":
      panel = <AdminWireframeAuditTab />;
      break;
    case "storage":
      panel = <AdminWireframeStorageTab />;
      break;
    case "security":
      panel = <AdminWireframeSecurityTab />;
      break;
    case "settings":
      panel = <AdminWireframeSettingsTab />;
      break;
    default:
      panel = <AdminWireframeOverviewTab />;
  }

  const activeLabel = ADMIN_NAV.find((n) => n.id === activeNav)?.label ?? "Admin";

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-white text-neutral-900">
      <header className="z-20 shrink-0 border-b border-neutral-200 bg-white">
        <div className="grid h-12 grid-cols-[auto_1fr_auto] items-center gap-3 px-3 md:px-4">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon-sm" className="text-neutral-600" aria-label="App menu">
              <LayoutGrid />
            </Button>
            <div className="flex size-7 items-center justify-center rounded-md bg-blue-600 text-xs font-bold text-white">
              MV
            </div>
            <div className="hidden items-center gap-2 sm:flex">
              <Link
                to="/"
                className="rounded-full px-3 py-1 text-sm font-medium text-neutral-600 hover:bg-neutral-100"
              >
                Files
              </Link>
              <span className="rounded-full bg-blue-50 px-3 py-1 text-sm font-medium text-blue-700">
                Admin
              </span>
              <WireframeBadge />
            </div>
          </div>

          <div className="mx-auto hidden w-full max-w-xl md:block">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-neutral-400" />
              <Input
                className="h-9 rounded-full border-neutral-200 bg-[#f3f2f1] pl-9 shadow-none focus-visible:ring-blue-500/30"
                placeholder="Search users, audit events, settings…"
                value={adminQuery}
                onChange={(e) => setAdminQuery(e.target.value)}
                aria-label="Search admin"
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-2">
            <Link
              to="/"
              className="hidden items-center gap-1.5 rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-sm font-medium text-neutral-800 hover:bg-neutral-50 sm:inline-flex"
            >
              <ArrowLeft className="size-3.5" aria-hidden />
              Back to files
            </Link>
            <div ref={profileRef} className="relative">
              <button
                type="button"
                aria-label="Open profile menu"
                aria-expanded={profileOpen}
                onClick={() => setProfileOpen((open) => !open)}
                className="flex size-8 items-center justify-center rounded-full bg-blue-100 text-xs font-semibold text-blue-800 ring-2 ring-transparent transition hover:ring-blue-200"
              >
                {initials}
              </button>
              {profileOpen ? (
                <div className="absolute right-0 top-full z-50 mt-2 w-56 rounded-lg border border-neutral-200 bg-white py-1 shadow-md">
                  <p className="truncate px-3 py-2 text-sm text-neutral-500">{user?.email}</p>
                  <Separator />
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-3 py-2 text-sm text-neutral-800 hover:bg-neutral-50"
                    onClick={() => {
                      setProfileOpen(false);
                      logout();
                    }}
                  >
                    <LogOut className="size-4" />
                    Sign out
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[240px_minmax(0,1fr)]">
        <aside className="hidden shrink-0 flex-col gap-4 overflow-y-auto border-r border-neutral-200 bg-white px-4 py-4 lg:flex">
          <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">Administration</p>
          <nav className="flex flex-col gap-0.5" aria-label="Admin navigation">
            {ADMIN_NAV.map((item, index) => {
              const prev = ADMIN_NAV[index - 1];
              const showGroup = item.group && item.group !== prev?.group;
              return (
                <div key={item.id}>
                  {showGroup ? (
                    <p className="mb-1 mt-3 text-xs font-medium uppercase tracking-wide text-neutral-400">
                      {item.group}
                    </p>
                  ) : null}
                  <AdminNavItem
                    label={item.label}
                    icon={item.icon}
                    active={activeNav === item.id}
                    onClick={() => setActiveNav(item.id)}
                  />
                </div>
              );
            })}
          </nav>
          <div className="mt-auto rounded-lg border border-dashed border-neutral-300 bg-neutral-50/80 p-3 text-xs text-neutral-500">
            This page is a UI wireframe. Connect panels to{" "}
            <span className="font-mono text-[10px]">/api/v1/admin/*</span> when the backend ships.
          </div>
        </aside>

        {/* Human: Full-width scroll region — matches DrivePage shell; no max-width cap on admin panels. */}
        {/* Agent: min-h-0 overflow-y-auto; READS user scroll; sidebar sibling stays viewport-anchored. */}
        <main className="min-h-0 overflow-y-auto bg-[#f3f2f1] px-4 pt-4 pb-4 md:p-6 lg:bg-transparent lg:px-6 lg:pt-0 lg:pb-6">
          <div className="flex min-h-full w-full min-w-0 flex-col gap-4 rounded-xl border border-neutral-200 bg-white p-4 shadow-sm md:p-6 lg:min-h-full lg:p-6 max-lg:border-0 max-lg:bg-transparent max-lg:p-0 max-lg:shadow-none">
            <div className="flex flex-col gap-1 border-b border-neutral-100 pb-4 lg:hidden">
              <label htmlFor="admin-mobile-nav" className="text-xs font-medium text-neutral-500">
                Section
              </label>
              <select
                id="admin-mobile-nav"
                className="rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm"
                value={activeNav}
                onChange={(e) => setActiveNav(e.target.value as AdminNavId)}
              >
                {ADMIN_NAV.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="hidden border-b border-neutral-100 pb-4 lg:block">
              <h1 className="text-xl font-semibold text-neutral-900">{activeLabel}</h1>
            </div>
            <div className="min-w-0 flex-1">{panel}</div>
          </div>
        </main>
      </div>
    </div>
  );
}
