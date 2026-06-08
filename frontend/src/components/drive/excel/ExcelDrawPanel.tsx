// Human: Draw tab — ink tools overlay on the spreadsheet grid.
// Agent: EMITS stroke payloads to workbook sheet.drawings via dialog parent.

import { PenLine, Eraser } from "lucide-react";
import { RibbonGroup, RibbonIconButton } from "@/components/drive/excel/excel-ribbon-primitives";
import { scaledPx } from "@/components/drive/excel/excel-dialog-scale";

type ExcelDrawPanelProps = {
  drawMode: "pen" | "eraser" | null;
  strokeColor: string;
  onDrawModeChange: (mode: "pen" | "eraser" | null) => void;
  onStrokeColorChange: (color: string) => void;
  onClearDrawings: () => void;
};

export function ExcelDrawPanel({
  drawMode,
  strokeColor,
  onDrawModeChange,
  onStrokeColorChange,
  onClearDrawings,
}: ExcelDrawPanelProps) {
  const sz = scaledPx(16);
  return (
    <>
      <RibbonGroup label="Tools">
        <RibbonIconButton
          label="Pen"
          icon={<PenLine style={{ width: sz, height: sz }} aria-hidden />}
          active={drawMode === "pen"}
          onClick={() => onDrawModeChange(drawMode === "pen" ? null : "pen")}
        />
        <RibbonIconButton
          label="Eraser"
          icon={<Eraser style={{ width: sz, height: sz }} aria-hidden />}
          active={drawMode === "eraser"}
          onClick={() => onDrawModeChange(drawMode === "eraser" ? null : "eraser")}
        />
      </RibbonGroup>
      <RibbonGroup label="Color">
        <input
          type="color"
          aria-label="Ink color"
          value={strokeColor}
          onChange={(event) => onStrokeColorChange(event.target.value)}
          className="h-8 w-10 cursor-pointer rounded border border-[#E5E7EB]"
        />
        <button
          type="button"
          className="rounded-sm px-2 py-1 text-xs hover:bg-[#E5E5E5]"
          onClick={onClearDrawings}
        >
          Clear all ink
        </button>
      </RibbonGroup>
    </>
  );
}
