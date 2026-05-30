// Human: Read-only connection URL preview box on the database setup step.
// Agent: DISPLAYS assembled postgres URL; parent owns string value.

type SetupConnectionUrlBoxProps = {
  url: string;
};

export function SetupConnectionUrlBox({ url }: SetupConnectionUrlBoxProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[13px] font-semibold text-[#1A1A1A]">Connection URL</span>
      <div className="rounded-lg border border-[#E5E7EB] bg-[#F7F8FA] px-3 py-2.5">
        <p className="break-all font-sans text-[11px] text-[#666666]">{url}</p>
      </div>
    </div>
  );
}
