// Human: Secondary notice box for Nebular OS storage endpoint copy on setup step 3.
// Agent: RENDERS read-only informational text; no API calls.

type SetupNoticeBoxProps = {
  children: React.ReactNode;
};

export function SetupNoticeBox({ children }: SetupNoticeBoxProps) {
  return (
    <div className="rounded-lg border border-edge bg-surface px-4 py-3 text-[13px] text-ink-muted">
      {children}
    </div>
  );
}
