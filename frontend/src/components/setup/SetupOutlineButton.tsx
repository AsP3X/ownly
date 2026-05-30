// Human: Full-width outline button for "Test connection" on the database step.
// Agent: RENDERS native button; parent supplies onClick and disabled/loading state.

type SetupOutlineButtonProps = {
  onClick: () => void;
  disabled?: boolean;
  children: string;
};

export function SetupOutlineButton({ onClick, disabled, children }: SetupOutlineButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex h-10 w-full items-center justify-center rounded-lg border border-[#E5E7EB] bg-white text-sm font-medium text-[#1A1A1A] transition-colors hover:bg-[#F7F8FA] disabled:cursor-not-allowed disabled:opacity-60"
    >
      {children}
    </button>
  );
}
