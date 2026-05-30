// Human: Back (text) + primary action row from Pencil Actions Row on every setup step.
// Agent: RENDERS buttons only; parent supplies handlers and loading/disabled state.

type SetupActionsRowProps = {
  onBack: () => void;
  onPrimary: () => void;
  primaryLabel: string;
  loading?: boolean;
  loadingLabel?: string;
  backDisabled?: boolean;
  primaryDisabled?: boolean;
};

export function SetupActionsRow({
  onBack,
  onPrimary,
  primaryLabel,
  loading,
  loadingLabel,
  backDisabled,
  primaryDisabled,
}: SetupActionsRowProps) {
  return (
    <div className="flex items-center justify-between pt-2">
      <button
        type="button"
        disabled={backDisabled || loading}
        onClick={onBack}
        className="py-2.5 text-sm font-semibold text-[#666666] transition-colors hover:text-[#1A1A1A] disabled:cursor-not-allowed disabled:opacity-50"
      >
        Back
      </button>
      <button
        type="button"
        disabled={primaryDisabled || loading}
        onClick={onPrimary}
        className="rounded-lg bg-[#1A1A1A] px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#333333] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {loading ? (loadingLabel ?? primaryLabel) : primaryLabel}
      </button>
    </div>
  );
}
