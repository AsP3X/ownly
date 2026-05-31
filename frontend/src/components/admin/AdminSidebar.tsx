// Human: Admin sidebar — login-signup.pencil L5DyOw instance with admin nav overrides.
// Agent: RENDERS 260px Ownly rail; CALLS onNavChange; WRITES global capacity label from active route.

import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  Cloud,
  FileText,
  LayoutDashboard,
  Server,
  Settings,
  Shield,
  Users,
} from "lucide-react";
import { useInstanceName } from "@/hooks/useInstanceName";
import { cn } from "@/lib/utils";

export type AdminNavId =
  | "overview"
  | "users-security"
  | "security-policies"
  | "storage-nodes"
  | "audit-logs"
  | "system-settings";

type AdminSidebarProps = {
  activeNav: AdminNavId;
  onNavChange: (nav: AdminNavId) => void;
};

// Human: Capacity footer copy shifts on storage/audit screens per Pencil sidebar descendants.
// Agent: READS activeNav; RETURNS {used,total} TB strings for progress widget.
function capacityForNav(activeNav: AdminNavId): { used: number; total: number } {
  if (activeNav === "storage-nodes" || activeNav === "audit-logs") {
    return { used: 88.4, total: 120 };
  }
  return { used: 45.2, total: 120 };
}

function AdminNavRow({
  label,
  icon,
  active,
  onClick,
}: {
  label: string;
  icon: ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 rounded-lg px-4 py-2.5 text-left text-sm transition-colors",
        active && "bg-[#F7F8FA] font-semibold text-[#1A1A1A]",
        !active && "text-[#666666] hover:bg-[#F7F8FA]",
      )}
    >
      <span
        className={cn(
          "flex size-[18px] shrink-0 items-center justify-center",
          active ? "text-[#2563EB]" : "text-[#666666]",
        )}
        aria-hidden
      >
        {icon}
      </span>
      <span>{label}</span>
    </button>
  );
}

function GlobalCapacityWidget({ usedTb, totalTb }: { usedTb: number; totalTb: number }) {
  const percent = Math.round((usedTb / totalTb) * 100);
  const fillWidth = Math.max(percent, 2);

  return (
    <div className="flex flex-col gap-3 rounded-xl bg-[#F7F8FA] p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-[#666666]">Global capacity</p>
      <p className="text-[15px] font-bold text-[#1A1A1A]">
        {usedTb} TB of {totalTb} TB
      </p>
      <div
        className="h-1.5 w-full overflow-hidden rounded-sm bg-[#E5E7EB]"
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Global storage capacity"
      >
        <div
          className="h-full rounded-sm bg-[#2563EB] transition-[width] duration-300 ease-out"
          style={{ width: `${fillWidth}%` }}
        />
      </div>
    </div>
  );
}

const ADMIN_NAV: { id: AdminNavId; label: string; icon: ReactNode }[] = [
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

/** Human: Left rail for /admin — matches Pencil Admin Sidebar on every console frame. */
export function AdminSidebar({ activeNav, onNavChange }: AdminSidebarProps) {
  const { instanceName } = useInstanceName();
  const capacity = capacityForNav(activeNav);

  return (
    <aside className="hidden h-full w-[260px] shrink-0 flex-col gap-10 overflow-hidden border-r border-[#E5E7EB] bg-white px-8 py-8 lg:flex">
      <Link to="/" className="flex items-center justify-center gap-2 outline-none">
        <Cloud className="size-7 text-[#2563EB]" aria-hidden />
        <span className="text-[22px] font-bold text-[#1A1A1A]">{instanceName}</span>
      </Link>

      <nav className="flex flex-col gap-2" aria-label="Admin navigation">
        {ADMIN_NAV.map((item) => (
          <AdminNavRow
            key={item.id}
            label={item.label}
            icon={item.icon}
            active={activeNav === item.id}
            onClick={() => onNavChange(item.id)}
          />
        ))}
      </nav>

      <div className="mt-auto">
        <GlobalCapacityWidget usedTb={capacity.used} totalTb={capacity.total} />
      </div>
    </aside>
  );
}
