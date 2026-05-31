// Human: Desktop drive sidebar — Ownly Main Overview wireframe (logo, nav, storage widget).
// Agent: RENDERS Tailwind-only layout; CALLS onNavChange; READS usage bytes for progress bar.

import type { ReactNode } from "react";
import {
  Cloud,
  HardDrive,
  Home,
  Settings,
  Shield,
  Trash2,
  Users,
} from "lucide-react";
import { useInstanceName } from "@/hooks/useInstanceName";
import { formatBytes } from "@/lib/utils-app";
import { cn } from "@/lib/utils";

export type DriveNavId = "home" | "my-files" | "shared-files" | "recycle-bin";

type DriveSidebarProps = {
  activeNav: DriveNavId;
  usedBytes: number;
  quotaBytes: number;
  onNavChange: (nav: DriveNavId) => void;
};

// Human: One sidebar nav row with icon + label; active row uses muted panel background.
// Agent: RENDERS button; DISABLED rows skip onClick and use reduced opacity.
function SidebarNavRow({
  label,
  icon,
  active,
  disabled,
  onClick,
}: {
  label: string;
  icon: ReactNode;
  active: boolean;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 rounded-lg px-4 py-2.5 text-left text-sm transition-colors",
        active && "bg-[#F7F8FA] font-semibold text-[#1A1A1A]",
        !active && !disabled && "text-[#666666] hover:bg-[#F7F8FA]",
        disabled && "cursor-not-allowed text-[#666666]/60",
      )}
    >
      <span
        className={cn(
          "flex size-[18px] shrink-0 items-center justify-center",
          active ? "text-[#2563EB]" : "text-[#666666]",
          disabled && "text-[#666666]/60",
        )}
        aria-hidden
      >
        {icon}
      </span>
      <span>{label}</span>
    </button>
  );
}

// Human: Storage quota block pinned to the bottom of the sidebar.
// Agent: COMPUTES percent from used/quota; RENDERS 6px track + blue fill via inline width.
function StorageWidget({ usedBytes, quotaBytes }: { usedBytes: number; quotaBytes: number }) {
  const ratio = quotaBytes > 0 ? usedBytes / quotaBytes : 0;
  const percent = Math.min(100, Math.round(ratio * 100));
  const fillWidth = usedBytes > 0 ? Math.max(percent, 2) : 0;

  return (
    <div className="flex flex-col gap-3 rounded-xl bg-[#F7F8FA] p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-[#666666]">Storage used</p>
      <p className="text-[15px] font-bold text-[#1A1A1A]">
        {formatBytes(usedBytes)} of {formatBytes(quotaBytes)}
      </p>
      <div
        className="h-1.5 w-full overflow-hidden rounded-sm bg-[#E5E7EB]"
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Storage used"
      >
        <div
          className="h-full rounded-sm bg-[#2563EB] transition-[width] duration-300 ease-out"
          style={{ width: `${fillWidth}%` }}
        />
      </div>
    </div>
  );
}

/** Human: Left rail for authenticated drive — matches Pencil Ownly Main Overview sidebar. */
export function DriveSidebar({ activeNav, usedBytes, quotaBytes, onNavChange }: DriveSidebarProps) {
  const { instanceName } = useInstanceName();

  return (
    <aside className="hidden h-full w-[260px] shrink-0 flex-col gap-10 overflow-hidden border-r border-[#E5E7EB] bg-white px-8 py-8 lg:flex">
      <div className="flex items-center justify-center gap-2">
        <Cloud className="size-7 text-[#2563EB]" aria-hidden />
        <span className="text-[22px] font-bold text-[#1A1A1A]">{instanceName}</span>
      </div>

      <nav className="flex flex-col gap-2" aria-label="Drive navigation">
        <SidebarNavRow
          label="Home"
          icon={<Home className="size-[18px]" strokeWidth={2.25} />}
          active={activeNav === "home"}
          onClick={() => onNavChange("home")}
        />
        <SidebarNavRow
          label="My Cloud"
          icon={<HardDrive className="size-[18px]" strokeWidth={2} />}
          active={activeNav === "my-files"}
          onClick={() => onNavChange("my-files")}
        />
        <SidebarNavRow
          label="Shared Files"
          icon={<Users className="size-[18px]" strokeWidth={2} />}
          active={activeNav === "shared-files"}
          onClick={() => onNavChange("shared-files")}
        />
        <SidebarNavRow
          label="Secure Vaults"
          icon={<Shield className="size-[18px]" strokeWidth={2} />}
          active={false}
          disabled
        />
        <SidebarNavRow
          label="Trash Bin"
          icon={<Trash2 className="size-[18px]" strokeWidth={2} />}
          active={activeNav === "recycle-bin"}
          onClick={() => onNavChange("recycle-bin")}
        />
        <SidebarNavRow
          label="Settings"
          icon={<Settings className="size-[18px]" strokeWidth={2} />}
          active={false}
          disabled
        />
      </nav>

      <div className="mt-auto">
        <StorageWidget usedBytes={usedBytes} quotaBytes={quotaBytes} />
      </div>
    </aside>
  );
}
