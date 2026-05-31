// Human: Desktop session chrome from login-signup.pencil component/Topbar — status, profile, and sign-out.
// Agent: RENDERS static layout only; CALLS onSignOut from parent; styling via Tailwind design tokens (#2563EB, #E5E7EB).

import { LogOut, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";

export type DriveDesktopTopbarProps = {
  displayName: string;
  roleLabel: string;
  initials: string;
  onSignOut: () => void;
  className?: string;
};

// Human: Full-width bar above drive main content on lg+ — mobile uses MobileDriveHeader instead.
// Agent: READS display props; WRITES nothing; HTTP sign-out handled by parent onSignOut.
export function DriveDesktopTopbar({
  displayName,
  roleLabel,
  initials,
  onSignOut,
  className,
}: DriveDesktopTopbarProps) {
  return (
    <header
      className={cn(
        "hidden h-16 shrink-0 items-center justify-between rounded-xl border border-[#E5E7EB] bg-white px-6 lg:flex",
        className,
      )}
    >
      {/* Human: Left cluster — shield + zero-knowledge session copy per Pencil Left Group */}
      <div className="flex min-w-0 items-center gap-3">
        <ShieldCheck className="size-4 shrink-0 text-[#10B981]" aria-hidden />
        <p className="truncate text-[13px] font-medium text-[#666666]">
          Secure Zero-Knowledge Session Active
        </p>
      </div>

      {/* Human: Right cluster — profile block, divider, outlined sign-out control */}
      <div className="flex shrink-0 items-center gap-6">
        <div className="flex items-center gap-2.5">
          <div
            className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[#2563EB] text-xs font-bold text-white"
            aria-hidden
          >
            {initials}
          </div>
          <div className="hidden min-w-0 flex-col gap-0.5 sm:flex">
            <p className="truncate text-[13px] font-bold text-[#1A1A1A]">{displayName}</p>
            <p className="truncate text-[11px] text-[#666666]">{roleLabel}</p>
          </div>
        </div>

        <div className="h-6 w-px shrink-0 bg-[#E5E7EB]" aria-hidden />

        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-lg border border-[#E5E7EB] bg-white px-3 py-1.5 text-xs font-semibold text-[#EF4444] transition-colors hover:bg-[#F7F8FA]"
          onClick={onSignOut}
        >
          <LogOut className="size-3.5 shrink-0" aria-hidden />
          Sign Out
        </button>
      </div>
    </header>
  );
}
