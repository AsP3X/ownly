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
  let primaryAction = "Draft SUM formula for this column";
  let secondaryAction = "Write explanation comment";

  if (cell.formula) {
    badge = "Formula";
    badgeTone = "neutral";
    body = `Cell ${label} uses formula ${cell.formula} and currently displays '${displayValue}'. Trace precedents from the Formulas tab to audit inputs.`;
    primaryAction = "Trace precedents for this formula";
    secondaryAction = "Show dependents of this cell";
  } else if (numericValue !== null && budgetValue !== null && budgetValue > 0) {
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
    const adjustTarget = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    }).format(budgetValue);
    primaryAction = `Auto-adjust to match budget (${adjustTarget})`;
    secondaryAction = "Write explanation comment";
  } else if (numericValue !== null) {
    body = `This cell contains '${displayValue}'. Suggested formula: =SUM(${label.replace(/\d+$/, "2")}:${label}) or compare with nearby rows.`;
    primaryAction = `Insert =SUM above ${label}`;
    secondaryAction = "Format as currency";
  } else if (cell.comment?.trim()) {
    badge = "Commented";
    body = `Cell ${label} has a note: “${cell.comment.trim()}”. Value is '${displayValue}'.`;
    primaryAction = "Edit comment";
    secondaryAction = "Clear comment";
  }

  return {
    title: `Cell ${label} (${rowLabel})`,
    badge,
    badgeTone,
    body,
    primaryAction,
    secondaryAction,
  };
}

// Human: Local heuristic replies for Copilot prompt box (no server LLM yet).
// Agent: MATCHES keywords; RETURNS assistant-style text for ExcelCopilotSidebar.
export function buildCopilotPromptReply(prompt: string, address: CellAddress | null): string {
  const text = prompt.trim().toLowerCase();
  const cell = address ? cellAddressLabel(address) : "the active cell";
  if (!text) return "Ask me to draft a formula, explain a value, or suggest formatting.";
  if (text.includes("sum") || text.includes("total")) {
    return `Try =SUM(${cell.replace(/\d+$/, "2")}:${cell}) on the cell below your data, or use AutoSum on the Formulas tab.`;
  }
  if (text.includes("average") || text.includes("mean")) {
    return `Use =AVERAGE(range) for a simple mean, or =AVERAGEIF(range, criteria) to filter rows first.`;
  }
  if (text.includes("lookup") || text.includes("vlookup") || text.includes("xlookup")) {
    return `Prefer =XLOOKUP(lookup, lookup_array, return_array). For legacy sheets, =VLOOKUP(lookup, table, col, FALSE) still works.`;
  }
  if (text.includes("filter") || text.includes("unique") || text.includes("sort")) {
    return `Dynamic arrays: =FILTER(range, include), =SORT(range), =UNIQUE(range). Spills fill cells below/right — clear blockers to avoid #SPILL!.`;
  }
  if (text.includes("pivot")) {
    return `Select your data range, then Insert → PivotTable. Pick row fields and value aggregations (sum/count/average).`;
  }
  if (text.includes("format") || text.includes("currency") || text.includes("percent")) {
    return `Use Home → Number for Currency/Percent, or set a custom format. Format Painter copies style between cells.`;
  }
  return `I analyzed your request about ${cell}. For full LLM assistance, a server Copilot endpoint can be enabled later. Meanwhile try Insert Function, Trace Precedents, or describe a formula goal more specifically (sum, lookup, filter).`;
}
