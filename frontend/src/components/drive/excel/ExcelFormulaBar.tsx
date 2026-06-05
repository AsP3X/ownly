// Human: Excel formula bar — active cell name box, fx label, editable formula input.
// Agent: READS cell address + formula text; EMITS commit on Enter/blur per Pencil S1A5tt.

import { useState } from "react";
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
    <div className="flex h-9 shrink-0 items-center gap-2 border-b border-[#E5E7EB] bg-white px-4 py-1">
      <div className="flex h-[26px] w-12 items-center justify-center rounded border border-[#E5E7EB] bg-[#F7F8FA] text-xs font-bold text-[#1A1A1A]">
        {cellLabel}
      </div>
      <div className="h-4 w-px bg-[#E5E7EB]" aria-hidden />
      <span className="px-1 text-sm font-bold italic text-[#888888]">fx</span>
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
          "min-w-0 flex-1 rounded border border-[#E5E7EB] bg-white px-2 py-1 text-xs text-[#1A1A1A] outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB]",
          readOnly && "cursor-default bg-[#F7F8FA]",
        )}
        aria-label="Formula input"
      />
    </div>
  );
}
