// Human: Read-only connection URL preview on the database setup step.
// Agent: DISPLAYS assembled postgres URL (already redacted by the caller); parent owns the string.

type SetupConnectionUrlBoxProps = {
  url: string;
};

export function SetupConnectionUrlBox({ url }: SetupConnectionUrlBoxProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[13px] font-medium text-ink">Connection URL</span>
      <p className="rounded-md border border-edge bg-sunken px-3 py-2 font-mono text-xs leading-relaxed break-all text-ink-muted">
        {url}
      </p>
    </div>
  );
}
