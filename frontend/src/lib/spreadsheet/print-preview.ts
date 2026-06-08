// Human: Print preview helpers — resolve print bounds and isolate printable DOM for window.print().
// Agent: READS SheetData printArea; CLONES preview element; HIDES rest of page during print.

import { formatCellDisplay } from "@/lib/spreadsheet/cells";
import type { PageMargins, SheetData, SheetPrintArea } from "@/lib/spreadsheet/types";

export type PrintPreviewBounds = SheetPrintArea;

const DEFAULT_MARGINS: PageMargins = {
  top: 0.75,
  bottom: 0.75,
  left: 0.7,
  right: 0.7,
  header: 0.3,
  footer: 0.3,
};

function usedSheetBounds(sheet: SheetData): PrintPreviewBounds {
  let endRow = 0;
  let endCol = 0;
  sheet.rows.forEach((row, rowIndex) => {
    row.forEach((cell, colIndex) => {
      const hasContent =
        cell.value !== null && cell.value !== "" && cell.display.trim() !== "";
      if (hasContent) {
        endRow = Math.max(endRow, rowIndex);
        endCol = Math.max(endCol, colIndex);
      }
    });
  });
  return { startRow: 0, startCol: 0, endRow, endCol };
}

// Human: Resolve printable cell bounds — print area when set, otherwise used range.
// Agent: RETURNS row/col bounds for preview table extraction.
export function resolvePrintBounds(sheet: SheetData): PrintPreviewBounds {
  if (sheet.printArea) return sheet.printArea;
  return usedSheetBounds(sheet);
}

function cellText(sheet: SheetData, row: number, col: number, showFormulas: boolean): string {
  const cell = sheet.rows[row]?.[col];
  if (!cell) return "";
  if (showFormulas && cell.formula) return cell.formula;
  if (cell.display) return cell.display;
  return formatCellDisplay(cell.value, cell.style?.numberFormat ?? "general");
}

export type PrintPreviewMatrix = {
  bounds: PrintPreviewBounds;
  rows: string[][];
};

// Human: Extract a 2D string matrix for print preview rendering.
// Agent: READS bounds; RETURNS display strings per cell.
export function buildPrintPreviewMatrix(
  sheet: SheetData,
  showFormulas = false,
): PrintPreviewMatrix {
  const bounds = resolvePrintBounds(sheet);
  const rows: string[][] = [];
  for (let row = bounds.startRow; row <= bounds.endRow; row += 1) {
    const line: string[] = [];
    for (let col = bounds.startCol; col <= bounds.endCol; col += 1) {
      line.push(cellText(sheet, row, col, showFormulas));
    }
    rows.push(line);
  }
  return { bounds, rows };
}

// Human: Print only the preview element — hides other body content during window.print().
// Agent: CLONES node; INJECTS @media print CSS; REMOVES after print dialog closes.
export function printSpreadsheetElement(element: HTMLElement, margins: PageMargins = DEFAULT_MARGINS): void {
  const wrapper = document.createElement("div");
  wrapper.id = "ownly-excel-print-wrapper";
  wrapper.setAttribute("data-ownly-excel-print", "true");

  const clone = element.cloneNode(true) as HTMLElement;
  clone.style.margin = "0 auto";
  wrapper.appendChild(clone);

  const style = document.createElement("style");
  style.setAttribute("data-ownly-excel-print-style", "true");
  style.textContent = `
    @page {
      margin: ${margins.top}in ${margins.right}in ${margins.bottom}in ${margins.left}in;
    }
    @media print {
      body > *:not(#ownly-excel-print-wrapper) {
        display: none !important;
      }
      #ownly-excel-print-wrapper {
        display: block !important;
        position: static !important;
        width: 100% !important;
      }
    }
  `;

  document.head.appendChild(style);
  document.body.appendChild(wrapper);

  const cleanup = () => {
    wrapper.remove();
    style.remove();
    window.removeEventListener("afterprint", cleanup);
  };

  window.addEventListener("afterprint", cleanup);
  window.print();

  window.setTimeout(cleanup, 2000);
}
