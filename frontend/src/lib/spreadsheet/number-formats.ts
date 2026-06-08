// Human: Excel number format codes and detection for import/export round-trip.
// Agent: MAPS NumberFormat ↔ SheetJS cell.z; FORMATS display strings in grid.

import type { NumberFormat } from "@/lib/spreadsheet/types";

// Human: Built-in Excel format codes keyed by our NumberFormat enum.
// Agent: WRITTEN to cell.z on serialize when not custom.
export const BUILTIN_FORMAT_CODES: Record<Exclude<NumberFormat, "custom">, string> = {
  general: "General",
  number: "#,##0.00",
  currency: "$#,##0.00",
  accounting: '_("$"* #,##0.00_);_("$"* (#,##0.00);_("$"* "-"??_);_(@_)',
  percent: "0.00%",
  date: "m/d/yyyy",
  time: "h:mm:ss AM/PM",
  datetime: "m/d/yyyy h:mm",
  scientific: "0.00E+00",
  fraction: "# ?/?",
  text: "@",
};

// Human: Infer NumberFormat from a SheetJS z/w format string on import.
// Agent: RETURNS best-match enum; custom when pattern is unrecognized.
export function numberFormatFromXlsxCode(zCode: string | undefined, display?: string): NumberFormat {
  const code = (zCode ?? "").trim();
  const normalized = code.toLowerCase();
  const displayText = display ?? "";

  if (!code || normalized === "general") return "general";
  if (normalized.includes("%")) return "percent";
  if (normalized.includes("e+") || normalized.includes("e-")) return "scientific";
  if (normalized === "@" || normalized.includes("@")) return "text";
  if (normalized.includes("?/?")) return "fraction";
  if (normalized.includes("am/pm") || (normalized.includes("h:") && !normalized.includes("y"))) return "time";
  if (normalized.includes("y") && normalized.includes("h")) return "datetime";
  if (normalized.includes("y") || normalized.includes("d")) return "date";
  if (normalized.includes("_(") || normalized.includes("accounting")) return "accounting";
  if (normalized.includes("$") || displayText.includes("$")) return "currency";
  if (normalized.includes("#") || normalized.includes("0")) return "number";
  return "custom";
}

// Human: Resolve the Excel z-code to write for a cell style on export.
// Agent: PREFERS customNumberFormat when numberFormat is custom.
export function xlsxFormatCodeFromStyle(
  numberFormat: NumberFormat | undefined,
  customNumberFormat?: string,
): string | undefined {
  const format = numberFormat ?? "general";
  if (format === "custom") {
    return customNumberFormat?.trim() || undefined;
  }
  return BUILTIN_FORMAT_CODES[format];
}

// Human: Format a numeric or date value for grid display using ribbon number format.
// Agent: CALLS Intl or manual patterns; USED by cells.formatCellDisplay.
export function formatValueWithNumberFormat(
  value: string | number | null,
  format: NumberFormat = "general",
  customCode?: string,
): string {
  if (value === null || value === "") return "";
  if (typeof value === "string" && format !== "text") {
    const asNumber = Number(value.replace(/[$,%\s,]/g, ""));
    if (!Number.isFinite(asNumber)) return value;
    return formatValueWithNumberFormat(asNumber, format, customCode);
  }
  if (typeof value !== "number") return String(value);

  switch (format) {
    case "currency":
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(value);
    case "accounting":
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        currencySign: "accounting",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(value);
    case "percent":
      return new Intl.NumberFormat("en-US", {
        style: "percent",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(value);
    case "number":
      return new Intl.NumberFormat("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(value);
    case "scientific":
      return value.toExponential(2);
    case "date": {
      const date = excelSerialToDate(value);
      return date
        ? date.toLocaleDateString("en-US", { month: "numeric", day: "numeric", year: "numeric" })
        : String(value);
    }
    case "time": {
      const date = excelSerialToDate(value);
      return date
        ? date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" })
        : String(value);
    }
    case "datetime": {
      const date = excelSerialToDate(value);
      return date ? date.toLocaleString("en-US") : String(value);
    }
    case "fraction": {
      const whole = Math.trunc(value);
      const frac = value - whole;
      if (Math.abs(frac) < 1e-9) return String(whole);
      return `${whole} ${Math.round(frac * 8)}/8`;
    }
    case "text":
      return String(value);
    case "custom":
      return customCode ? String(value) : String(value);
    default:
      return Number.isInteger(value) ? String(value) : String(value);
  }
}

// Human: Convert Excel serial date number to JS Date (1900 date system).
// Agent: USED for date/time display formats.
function excelSerialToDate(serial: number): Date | null {
  if (!Number.isFinite(serial)) return null;
  const utcDays = Math.floor(serial - 25569);
  const utcValue = utcDays * 86400 * 1000;
  const date = new Date(utcValue);
  return Number.isFinite(date.getTime()) ? date : null;
}
