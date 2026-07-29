// Human: Segmented grid/list switch for the explorer toolbar.
// Agent: CONTROLLED by DrivePage via ExplorerViewMode; PERSISTENCE lives in drive-preferences.

import { LayoutGrid, Rows3 } from "lucide-react";
import type { ExplorerViewMode } from "@/lib/drive-preferences";
import { cn } from "@/lib/utils";

export type ExplorerViewSwitcherProps = {
  value: ExplorerViewMode;
  onChange: (mode: ExplorerViewMode) => void;
  className?: string;
};

const VIEW_OPTIONS: {
  id: ExplorerViewMode;
  label: string;
  icon: typeof LayoutGrid;
}[] = [
  { id: "grid", label: "Grid view", icon: LayoutGrid },
  { id: "list", label: "List view", icon: Rows3 },
];

// Human: Two-state layout toggle — icon only, tooltip and aria carry the meaning.
// Agent: RENDERS radiogroup; CALLS onChange with the picked mode.
export function ExplorerViewSwitcher({
  value,
  onChange,
  className,
}: ExplorerViewSwitcherProps) {
  return (
    <div
      role="radiogroup"
      aria-label="Explorer layout"
      className={cn(
        "flex h-9 items-center gap-0.5 rounded-lg border border-edge bg-panel p-0.5",
        className,
      )}
    >
      {VIEW_OPTIONS.map((option) => {
        const Icon = option.icon;
        const active = value === option.id;
        return (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={option.label}
            title={option.label}
            onClick={() => onChange(option.id)}
            className={cn(
              "flex size-7 items-center justify-center rounded-md transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/40",
              active
                ? "bg-brand-weak text-brand"
                : "text-ink-faint hover:bg-surface hover:text-ink",
            )}
          >
            <Icon className="size-4" aria-hidden />
          </button>
        );
      })}
    </div>
  );
}
