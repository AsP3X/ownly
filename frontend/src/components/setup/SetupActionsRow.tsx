// Human: Back + primary action row, shared by every wizard step.
// Agent: PRIMARY is type=submit so Enter in any field advances; parent owns handlers and loading state.

import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

type SetupActionsRowProps = {
  onBack: () => void;
  primaryLabel: string;
  loading?: boolean;
  loadingLabel?: string;
  backDisabled?: boolean;
  primaryDisabled?: boolean;
};

export function SetupActionsRow({
  onBack,
  primaryLabel,
  loading,
  loadingLabel,
  backDisabled,
  primaryDisabled,
}: SetupActionsRowProps) {
  const label = loading ? (loadingLabel ?? primaryLabel) : primaryLabel;

  return (
    <div className="flex items-center gap-2 sm:justify-end">
      {/* Human: Kept mounted but hidden on step 1 so the primary button never shifts. */}
      <button
        type="button"
        disabled={backDisabled || loading}
        onClick={onBack}
        className={cn(
          // Human: 44px tall on phones (thumb target), compact from sm up.
          "h-11 shrink-0 rounded-md border border-edge bg-panel px-5 text-sm font-medium text-ink sm:h-9 sm:px-4",
          "transition-colors duration-150 hover:bg-surface",
          "focus-visible:ring-2 focus-visible:ring-focus/30 focus-visible:outline-none",
          "disabled:cursor-not-allowed disabled:opacity-50",
          backDisabled && "pointer-events-none invisible",
        )}
      >
        Back
      </button>

      <button
        type="submit"
        disabled={primaryDisabled || loading}
        aria-busy={loading || undefined}
        className={cn(
          // Human: Fills the remaining width on phones so the main action is the obvious target.
          "flex h-11 flex-1 items-center justify-center gap-2 rounded-md bg-brand px-5 text-sm font-semibold text-brand-on",
          "sm:h-9 sm:flex-initial sm:px-4",
          "transition-colors duration-150 hover:bg-brand-hover",
          "focus-visible:ring-2 focus-visible:ring-focus/40 focus-visible:outline-none",
          "disabled:cursor-not-allowed disabled:opacity-60",
        )}
      >
        {loading ? <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden /> : null}
        {label}
      </button>
    </div>
  );
}
