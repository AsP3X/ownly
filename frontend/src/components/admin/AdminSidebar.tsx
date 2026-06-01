// Human: Admin sidebar — login-signup.pencil L5DyOw instance with admin nav overrides.
// Agent: RENDERS 260px Ownly rail; CALLS onNavChange; READS live storage metrics for capacity footer.

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
import { useAdminStorageMetrics } from "@/hooks/useAdminStorageMetrics";
import { useInstanceName } from "@/hooks/useInstanceName";
import { formatBytes } from "@/lib/utils-app";
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

// Human: Network-wide storage footer — same byte scaling as drive sidebar StorageWidget.
// Agent: READS usedBytes/capacityBytes; COMPUTES percent; RENDERS formatBytes labels + progress bar.
function GlobalCapacityWidget({
  usedBytes,
  capacityBytes,
  loading,
}: {
  usedBytes: number;
  capacityBytes: number | null;
  loading: boolean;
}) {
  const ratio = capacityBytes != null && capacityBytes > 0 ? usedBytes / capacityBytes : 0;
  const percent = Math.min(100, Math.round(ratio * 100));
  const fillWidth = usedBytes > 0 && capacityBytes != null && capacityBytes > 0 ? Math.max(percent, 2) : 0;

  const label =
    loading
      ? "—"
      : capacityBytes != null && capacityBytes > 0
        ? `${formatBytes(usedBytes)} of ${formatBytes(capacityBytes)}`
        : formatBytes(usedBytes);

  return (
    <div className="flex flex-col gap-3 rounded-xl bg-[#F7F8FA] p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-[#666666]">Global capacity</p>
      <p className="text-[15px] font-bold text-[#1A1A1A]">{label}</p>
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
  const { usedBytes, capacityBytes, loading } = useAdminStorageMetrics();

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
        <GlobalCapacityWidget
          usedBytes={usedBytes}
          capacityBytes={capacityBytes}
          loading={loading}
        />
      </div>
    </aside>
  );
}
