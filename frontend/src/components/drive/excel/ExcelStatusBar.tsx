// Human: Excel footer status bar — Ready indicator and selection metrics per Pencil h15ld0.
// Agent: READS formatted stats line; RENDERS green dot + Average/Count/Sum summary.

type ExcelStatusBarProps = {
  metricsLine: string;
};

export function ExcelStatusBar({ metricsLine }: ExcelStatusBarProps) {
  return (
    <div className="flex h-6 shrink-0 items-center justify-between border-t border-[#E5E7EB] bg-[#F7F8FA] px-4">
      <div className="flex items-center gap-1.5">
        <span className="size-1.5 rounded-full bg-[#10B981]" aria-hidden />
        <span className="text-[10px] text-[#888888]">Ready</span>
      </div>
      <p className="text-[10px] font-medium text-[#666666]">{metricsLine}</p>
    </div>
  );
}
