// Human: Ownly AI Copilot sidebar copy for the selected spreadsheet cell.
// Agent: READS cell value + row context; RETURNS analysis text and suggested actions per Pencil card.

import { cellAddressLabel, formatCellDisplay } from "@/lib/spreadsheet/cells";
import type { CellAddress, SheetCell } from "@/lib/spreadsheet/types";

export type CopilotAnalysis = {
  title: string;
  badge: string | null;
  badgeTone: "over-budget" | "under-budget" | "neutral";
  body: string;
  primaryAction: string;
  secondaryAction: string;
};

function parseCurrency(value: string | number | null): number | null {
  if (value === null) return null;
  if (typeof value === "number") return value;
  const parsed = Number(String(value).replace(/[$,\s]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

// Human: Build copilot card content from the active cell and its budget neighbour when available.
// Agent: READS rows + address; RETURNS CopilotAnalysis for sidebar card + action buttons.
export function buildCopilotAnalysis(
  rows: SheetCell[][],
  address: CellAddress | null,
): CopilotAnalysis | null {
  if (!address) return null;

  const cell = rows[address.row]?.[address.col];
  if (!cell) return null;

  const label = cellAddressLabel(address);
  const rowLabel = rows[address.row]?.[0]?.display?.trim() || "Selected row";
  const displayValue = cell.display || formatCellDisplay(cell.value, cell.style?.numberFormat ?? "currency");
  const numericValue = parseCurrency(cell.value);
  const budgetCell = rows[address.row]?.[6];
  const budgetValue = parseCurrency(budgetCell?.value ?? null);

  let badge: string | null = null;
  let badgeTone: CopilotAnalysis["badgeTone"] = "neutral";
  let body = `This cell contains '${displayValue}'. Review the surrounding forecast row for context before making changes.`;

  if (numericValue !== null && budgetValue !== null && budgetValue > 0) {
    const delta = numericValue - budgetValue;
    const percent = Math.abs((delta / budgetValue) * 100);
    if (delta > 0) {
      badge = "Over Budget";
      badgeTone = "over-budget";
      body = `This cell contains '${displayValue}'. The forecast is $${Math.abs(delta).toLocaleString("en-US")} (${percent.toFixed(1)}%) higher than the budgeted threshold of $${budgetValue.toLocaleString("en-US")} defined in budget row.`;
    } else if (delta < 0) {
      badge = "Under Budget";
      badgeTone = "under-budget";
      body = `This cell contains '${displayValue}'. The forecast is $${Math.abs(delta).toLocaleString("en-US")} (${percent.toFixed(1)}%) below the budgeted amount of $${budgetValue.toLocaleString("en-US")}.`;
    } else {
      badge = "On Track";
      body = `This cell contains '${displayValue}'. The forecast matches the budgeted amount of $${budgetValue.toLocaleString("en-US")}.`;
    }
  } else if (numericValue !== null) {
    body = `This cell contains '${displayValue}'. Use Copilot to draft a formula, compare nearby rows, or explain this value to stakeholders.`;
  }

  const adjustTarget =
    budgetValue !== null
      ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(
          budgetValue,
        )
      : displayValue;

  return {
    title: `Cell ${label} (${rowLabel})`,
    badge,
    badgeTone,
    body,
    primaryAction: `Auto-adjust to match budget (${adjustTarget})`,
    secondaryAction: "Write explanation comment",
  };
}
