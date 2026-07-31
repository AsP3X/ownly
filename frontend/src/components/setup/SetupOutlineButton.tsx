// Human: Secondary action button for setup (test connection, configure node).
// Agent: type=button so it never submits the wizard form; parent supplies onClick and disabled state.

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type SetupOutlineButtonProps = {
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
};

export function SetupOutlineButton({ onClick, disabled, children }: SetupOutlineButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        // Human: Full-width 44px on phones; auto-width compact control from sm up.
        "flex h-11 w-full items-center justify-center gap-2 rounded-md border border-edge bg-panel px-3.5 text-sm font-medium text-ink sm:h-9 sm:w-fit sm:justify-start",
        "transition-colors duration-150 hover:bg-surface",
        "focus-visible:ring-2 focus-visible:ring-focus/30 focus-visible:outline-none",
        "disabled:cursor-not-allowed disabled:opacity-60",
      )}
    >
      {children}
    </button>
  );
}
