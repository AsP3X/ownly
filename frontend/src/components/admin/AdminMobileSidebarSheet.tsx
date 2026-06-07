// Human: Slide-in admin navigation for viewports below lg — mirrors desktop AdminSidebar in a left sheet.
// Agent: Sheet side=left; CALLS onNavChange; CLOSES on nav or dashboard link; READS storage metrics footer.

import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Cloud } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useAdminStorageMetrics } from "@/hooks/useAdminStorageMetrics";
import { useInstanceName } from "@/hooks/useInstanceName";
import { formatBytes } from "@/lib/utils-app";
import { cn } from "@/lib/utils";

import { ADMIN_NAV, type AdminNavId } from "@/components/admin/admin-nav";

type AdminMobileSidebarSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activeNav: AdminNavId;
  onNavChange: (nav: AdminNavId) => void;
};

function AdminDrawerNavRow({
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
        "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-colors",
        active && "bg-[#F7F8FA] font-semibold text-[#1A1A1A]",
        !active && "text-[#666666] active:bg-[#F7F8FA]",
      )}
    >
      <span
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-xl",
          active ? "bg-blue-100 text-[#2563EB]" : "bg-[#F7F8FA] text-[#666666]",
        )}
        aria-hidden
      >
        {icon}
      </span>
      <span>{label}</span>
    </button>
  );
}

// Human: Global capacity footer — same scaling as desktop admin sidebar widget.
// Agent: READS usedBytes/capacityBytes; RENDERS progress bar for mobile drawer footer.
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
    <div className="flex flex-col gap-3 rounded-2xl bg-[#F7F8FA] p-4">
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

/** Human: Mobile admin drawer — opened from the header hamburger on /admin below lg. */
export function AdminMobileSidebarSheet({
  open,
  onOpenChange,
  activeNav,
  onNavChange,
}: AdminMobileSidebarSheetProps) {
  const { instanceName } = useInstanceName();
  const { usedBytes, capacityBytes, loading } = useAdminStorageMetrics();

  function handleNav(nav: AdminNavId) {
    onNavChange(nav);
    onOpenChange(false);
  }

  function handleDashboardLink() {
    onOpenChange(false);
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" className="w-[min(100vw-1rem,22rem)] gap-0 p-0">
        <SheetHeader className="border-b border-[#E5E7EB] bg-white px-5 py-5 text-left">
          <SheetTitle className="flex items-center gap-2 text-xl font-semibold tracking-tight">
            <Cloud className="size-6 text-[#2563EB]" aria-hidden />
            {instanceName}
          </SheetTitle>
          <SheetDescription>Admin console</SheetDescription>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto bg-white px-4 py-4">
          <Link
            to="/"
            onClick={handleDashboardLink}
            className="flex w-full items-center gap-3 rounded-xl border border-[#E5E7EB] bg-[#F7F8FA] px-3 py-3 text-sm font-semibold text-[#1A1A1A] transition-colors hover:bg-[#EEF2FF] hover:text-[#2563EB]"
          >
            <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-white text-[#2563EB]">
              <ArrowLeft className="size-4" />
            </span>
            Back to dashboard
          </Link>

          <nav
            className="flex flex-col gap-1 rounded-2xl bg-white p-2 ring-1 ring-[#E5E7EB]"
            aria-label="Admin navigation"
          >
            {ADMIN_NAV.map((item) => (
              <AdminDrawerNavRow
                key={item.id}
                label={item.label}
                icon={item.icon}
                active={activeNav === item.id}
                onClick={() => handleNav(item.id)}
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
        </div>
      </SheetContent>
    </Sheet>
  );
}
