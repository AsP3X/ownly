// Human: Excel footer status bar — Ready indicator and selection metrics per Pencil h15ld0 at 1.5× scale.
// Agent: READS formatted stats line; RENDERS green dot + Average/Count/Sum summary.

import { scaledPx } from "@/components/drive/excel/excel-dialog-scale";

type ExcelStatusBarProps = {
  metricsLine: string;
  undoAvailable?: boolean;
  redoAvailable?: boolean;
  zoomPercent?: number;
  onZoomChange?: (percent: number) => void;
};

export function ExcelStatusBar({
  metricsLine,
  undoAvailable,
  redoAvailable,
  zoomPercent = 100,
  onZoomChange,
}: ExcelStatusBarProps) {
  const statusLabel = undoAvailable ? "Edited" : redoAvailable ? "Redo available" : "Ready";
  return (
    <div
      className="flex shrink-0 items-center justify-between border-t border-[#E5E7EB] bg-[#F7F8FA]"
      style={{ height: scaledPx(24), paddingInline: scaledPx(16) }}
    >
      <div className="flex items-center" style={{ gap: scaledPx(6) }}>
        <span
          className="rounded-full bg-[#10B981]"
          style={{ width: scaledPx(6), height: scaledPx(6) }}
          aria-hidden
        />
        <span className="text-[#888888]" style={{ fontSize: scaledPx(10) }}>
          {statusLabel}
        </span>
      </div>
      <div className="flex items-center gap-3">
        {onZoomChange ? (
          <div className="flex items-center gap-1">
            <button type="button" className="rounded px-1 hover:bg-[#E5E7EB]" onClick={() => onZoomChange(zoomPercent - 10)} aria-label="Zoom out">−</button>
            <span className="text-[#666666]" style={{ fontSize: scaledPx(10), minWidth: scaledPx(36), textAlign: "center" }}>{zoomPercent}%</span>
            <button type="button" className="rounded px-1 hover:bg-[#E5E7EB]" onClick={() => onZoomChange(zoomPercent + 10)} aria-label="Zoom in">+</button>
          </div>
        ) : null}
        <p className="font-medium text-[#666666]" style={{ fontSize: scaledPx(10) }}>
          {metricsLine}
        </p>
      </div>
    </div>
  );
}
