// Human: Excel number format codes and detection for import/export round-trip.
// Agent: MAPS NumberFormat ↔ SheetJS cell.z; FORMATS display strings in grid.

import type { NumberFormat } from "@/lib/spreadsheet/types";

// Human: Excel 365 Home → Number dropdown entries mapped to our NumberFormat enum.
// Agent: READ by ExcelSpreadsheetRibbon RibbonSelect options.
export const RIBBON_NUMBER_FORMAT_OPTIONS: { value: NumberFormat; label: string }[] = [
  { value: "general", label: "General" },
  { value: "number", label: "Number" },
  { value: "currency", label: "Currency" },
  { value: "accounting", label: "Accounting" },
  { value: "date", label: "Short Date" },
  { value: "datetime", label: "Long Date" },
  { value: "time", label: "Time" },
  { value: "percent", label: "Percentage" },
  { value: "fraction", label: "Fraction" },
  { value: "scientific", label: "Scientific" },
  { value: "text", label: "Text" },
  { value: "custom", label: "Custom" },
];

// Human: Built-in Excel numFmtId → format code (subset used when SheetJS omits z).
// Agent: READ by numberFormatFromXlsxNumFmtId; EXTEND as needed for ECMA-376 §18.8.30.
export const BUILTIN_NUMFMT_ID_CODES: Record<number, string> = {
  0: "General",
  1: "0",
  2: "0.00",
  3: "#,##0",
  4: "#,##0.00",
  5: "$#,##0_);($#,##0)",
  6: "$#,##0_);[Red]($#,##0)",
  7: "$#,##0.00_);($#,##0.00)",
  8: "$#,##0.00_);[Red]($#,##0.00)",
  9: "0%",
  10: "0.00%",
  11: "0.00E+00",
  12: "# ?/?",
  13: "# ??/??",
  14: "m/d/yyyy",
  15: "d-mmm-yy",
  16: "d-mmm",
  17: "mmm-yy",
  18: "h:mm AM/PM",
  19: "h:mm:ss AM/PM",
  20: "h:mm",
  21: "h:mm:ss",
  22: "m/d/yyyy h:mm",
  37: "#,##0_);(#,##0)",
  38: "#,##0_);[Red](#,##0)",
  39: "#,##0.00_);(#,##0.00)",
  40: "#,##0.00_);[Red](#,##0.00)",
  45: "mm:ss",
  46: "[h]:mm:ss",
  47: "mmss.0",
  48: "##0.0E+0",
  49: "@",
};

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

// Human: Resolve numFmtId to a format code (custom map first, then built-ins).
// Agent: USED when SheetJS leaves cell.z empty but styles.xml has the code.
export function formatCodeFromNumFmtId(
  numFmtId: number | undefined,
  customMap?: Record<number, string>,
): string | undefined {
  if (numFmtId === undefined || !Number.isFinite(numFmtId)) return undefined;
  if (customMap?.[numFmtId]) return customMap[numFmtId];
  return BUILTIN_NUMFMT_ID_CODES[numFmtId];
}

export function numberFormatFromXlsxNumFmtId(
  numFmtId: number | undefined,
  customMap?: Record<number, string>,
): NumberFormat {
  return numberFormatFromXlsxCode(formatCodeFromNumFmtId(numFmtId, customMap));
}

// Human: Resolve the Excel z-code to write for a cell style on export.
// Agent: PREFERS preserved customNumberFormat from import for exact Excel round-trip.
export function xlsxFormatCodeFromStyle(
  numberFormat: NumberFormat | undefined,
  customNumberFormat?: string,
): string | undefined {
  const preserved = customNumberFormat?.trim();
  if (preserved) return preserved;
  const format = numberFormat ?? "general";
  if (format === "custom") return undefined;
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
      return customCode ? formatWithCustomCode(value, customCode) : String(value);
    default:
      return Number.isInteger(value) ? String(value) : String(value);
  }
}

// Human: Apply a subset of Excel custom format codes for common patterns on display.
// Agent: HANDLES 0/0.00/#,##0, %, simple dates; FALLBACK String(value) for exotic codes.
function formatWithCustomCode(value: number, code: string): string {
  const cleaned = code.trim();
  if (!cleaned || cleaned.toLowerCase() === "general") return String(value);

  // Human: Sectioned formats (positive;negative;zero;text) — use first section for positives.
  // Agent: PICKS section by sign; IGNORES text section for numeric path.
  const sections = cleaned.split(";");
  let pattern = sections[0] ?? cleaned;
  if (value < 0 && sections[1]) pattern = sections[1];
  else if (value === 0 && sections[2]) pattern = sections[2];

  // Human: Strip Excel color/locale wrappers like [Red] or [$-409].
  // Agent: REMOVES bracket tokens before pattern matching.
  pattern = pattern.replace(/\[[^\]]*]/g, "");

  if (pattern.includes("%")) {
    const decimals = (pattern.split(".")[1] ?? "").replace(/[^0#]/g, "").length;
    return new Intl.NumberFormat("en-US", {
      style: "percent",
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(value);
  }

  if (/[ymdhs]/i.test(pattern) && !pattern.includes("#") && !pattern.includes("0")) {
    const date = excelSerialToDate(value);
    if (!date) return String(value);
    if (/h|s/i.test(pattern) && /y|d|m/i.test(pattern)) return date.toLocaleString("en-US");
    if (/h|s/i.test(pattern)) {
      return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" });
    }
    return date.toLocaleDateString("en-US");
  }

  if (pattern.includes("E+") || pattern.includes("e+")) {
    return value.toExponential(2).toUpperCase();
  }

  const hasThousands = pattern.includes("#,##") || pattern.includes("#,") || pattern.includes(",");
  const decimalMatch = /\.(0+|#+)/.exec(pattern);
  const decimals = decimalMatch ? decimalMatch[1].length : 0;
  const abs = Math.abs(value);
  const formatted = new Intl.NumberFormat("en-US", {
    useGrouping: hasThousands,
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(abs);

  // Human: Accounting-style underscore placeholders — approximate with leading space + $.
  // Agent: DETECTS $ or accounting pattern in original code.
  const withCurrency =
    cleaned.includes("$") && !formatted.startsWith("$")
      ? value < 0
        ? `($${formatted})`
        : `$${formatted}`
      : value < 0
        ? `-${formatted}`
        : formatted;
  return withCurrency;
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
