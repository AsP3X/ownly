// Human: Topbar profile chip from component/Topbar — 32px avatar + name/role stack (login-signup.pencil).
// Agent: RENDERS trigger only; parent supplies open state and dropdown via DriveProfileMenu sibling.

import { cn } from "@/lib/utils";

export type DriveProfileTriggerProps = {
  displayName: string;
  roleLabel: string;
  initials: string;
  open?: boolean;
  onClick: () => void;
  className?: string;
};

// Human: Clickable profile cluster — active state uses #F7F8FA fill and lg radius per Profile Menu wireframe.
// Agent: READS open for aria-expanded + highlight; CALLS onClick from parent.
export function DriveProfileTrigger({
  displayName,
  roleLabel,
  initials,
  open = false,
  onClick,
  className,
}: DriveProfileTriggerProps) {
  return (
    <button
      type="button"
      aria-label="Open account menu"
      aria-expanded={open}
      aria-haspopup="menu"
      onClick={onClick}
      className={cn(
        "flex items-center gap-2.5 rounded-lg px-3 py-1.5 outline-none transition-colors",
        open ? "bg-[#F7F8FA]" : "hover:bg-[#F7F8FA]",
        className,
      )}
    >
      <div
        className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[#2563EB] text-xs font-bold text-white"
        aria-hidden
      >
        {initials}
      </div>
      <div className="hidden min-w-0 flex-col gap-0.5 text-left sm:flex">
        <span className="truncate text-[13px] font-bold text-[#1A1A1A]">{displayName}</span>
        <span className="truncate text-[11px] text-[#666666]">{roleLabel}</span>
      </div>
    </button>
  );
}
