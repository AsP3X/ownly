// Human: Full-width outline button for setup secondary actions (test connection, configure node).
// Agent: RENDERS native button; parent supplies onClick and disabled/loading state.

import type { ReactNode } from "react";

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
      className="flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-edge bg-panel text-sm font-medium text-ink transition-colors hover:bg-surface disabled:cursor-not-allowed disabled:opacity-60"
    >
      {children}
    </button>
  );
}
