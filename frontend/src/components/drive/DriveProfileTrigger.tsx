// Human: Topbar profile chip from component/Topbar — 32px avatar + name/role stack (login-signup.pencil).
// Agent: RENDERS trigger only; parent supplies open state and dropdown via DriveProfileMenu sibling.

import { ChevronDown } from "lucide-react";

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
        "flex items-center gap-2.5 rounded-lg py-1.5 pl-1.5 pr-2 transition-colors",
        // Human: Keyboard users previously got nothing — `outline-none` with no focus style.
        "outline-none focus-visible:ring-2 focus-visible:ring-focus/50",
        open ? "bg-surface" : "hover:bg-surface",
        className,
      )}
    >
      <span
        className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand text-xs font-bold text-brand-on"
        aria-hidden
      >
        {initials}
      </span>
      <span className="hidden min-w-0 flex-col text-left sm:flex">
        <span className="truncate text-[13px] font-semibold leading-tight text-ink">
          {displayName}
        </span>
        <span className="truncate text-[11px] leading-tight text-ink-muted">{roleLabel}</span>
      </span>
      {/* Human: Chevron makes the menu affordance visible and mirrors the open state. */}
      <ChevronDown
        className={cn(
          "size-3.5 shrink-0 text-ink-faint transition-transform duration-150",
          open && "rotate-180",
        )}
        aria-hidden
      />
    </button>
  );
}
