// Human: Excel formula bar — active cell name box, fx label, editable formula input.
// Agent: READS cell address + formula text; EMITS commit on Enter/blur per Pencil S1A5tt at 1.5× scale.

import { useState } from "react";
import { scaledPx } from "@/components/drive/excel/excel-dialog-scale";
import { cn } from "@/lib/utils";

type ExcelFormulaBarProps = {
  cellLabel: string;
  value: string;
  readOnly: boolean;
  onCommit: (nextValue: string) => void;
};

export function ExcelFormulaBar({ cellLabel, value, readOnly, onCommit }: ExcelFormulaBarProps) {
  return (
    <ExcelFormulaBarInput
      key={`${cellLabel}:${value}`}
      cellLabel={cellLabel}
      value={value}
      readOnly={readOnly}
      onCommit={onCommit}
    />
  );
}

function ExcelFormulaBarInput({ cellLabel, value, readOnly, onCommit }: ExcelFormulaBarProps) {
  const [draft, setDraft] = useState(value);

  return (
    <div
      className="flex shrink-0 items-center border-b border-[#E5E7EB] bg-white"
      style={{
        height: scaledPx(36),
        gap: scaledPx(8),
        paddingInline: scaledPx(16),
        paddingBlock: scaledPx(4),
      }}
    >
      <div
        className="flex items-center justify-center rounded border border-[#E5E7EB] bg-[#F7F8FA] font-bold text-[#1A1A1A]"
        style={{
          height: scaledPx(26),
          width: scaledPx(48),
          fontSize: scaledPx(12),
        }}
      >
        {cellLabel}
      </div>
      <div className="bg-[#E5E7EB]" style={{ height: scaledPx(16), width: 1 }} aria-hidden />
      <span className="font-bold italic text-[#888888]" style={{ fontSize: scaledPx(14), paddingInline: scaledPx(4) }}>
        fx
      </span>
      <input
        type="text"
        value={draft}
        readOnly={readOnly}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            onCommit(draft);
            (event.target as HTMLInputElement).blur();
          }
        }}
        onBlur={() => {
          if (draft !== value) onCommit(draft);
        }}
        className={cn(
          "min-w-0 flex-1 rounded border border-[#E5E7EB] bg-white text-[#1A1A1A] outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB]",
          readOnly && "cursor-default bg-[#F7F8FA]",
        )}
        style={{
          fontSize: scaledPx(12),
          padding: `${scaledPx(4)}px ${scaledPx(8)}px`,
        }}
        aria-label="Formula input"
      />
    </div>
  );
}
