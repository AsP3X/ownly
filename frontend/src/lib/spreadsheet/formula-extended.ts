// Human: Extended Excel functions — financial, statistical, and lookup helpers.
// Agent: CALLED from formulas.ts evaluateFunction default branch delegation.

import type { FormulaError } from "@/lib/spreadsheet/formulas";

type Scalar = string | number | boolean | null | FormulaError;

function num(value: Scalar): number {
  if (typeof value === "number") return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (value === null || value === "") return 0;
  if (typeof value === "string" && value.startsWith("#")) return NaN;
  const parsed = Number(String(value).replace(/[$,%\s,]/g, ""));
  return Number.isFinite(parsed) ? parsed : NaN;
}

function nums(args: Scalar[]): number[] {
  return args.map(num).filter((value) => Number.isFinite(value));
}

// Human: Dispatch extended function names not in the core switch.
// Agent: RETURNS computed scalar or FormulaError; null when unknown.
export function evaluateExtendedFunction(
  name: string,
  args: Scalar[],
): string | number | boolean | null | FormulaError | undefined {
  const upper = name.toUpperCase();
  const numericArgs = nums(args);

  switch (upper) {
    case "STDEV":
    case "STDEV.S":
      return stdDev(numericArgs, false);
    case "STDEVP":
    case "STDEV.P":
      return stdDev(numericArgs, true);
    case "VAR":
    case "VAR.S":
      return variance(numericArgs, false);
    case "VARP":
    case "VAR.P":
      return variance(numericArgs, true);
    case "CORREL":
      return correl(nums(args.slice(0, Math.floor(args.length / 2))), nums(args.slice(Math.floor(args.length / 2))));
    case "NPV": {
      const rate = num(args[0]);
      const cashflows = nums(args.slice(1));
      if (!Number.isFinite(rate)) return "#VALUE!" as FormulaError;
      let total = 0;
      cashflows.forEach((cf, index) => {
        total += cf / (1 + rate) ** (index + 1);
      });
      return total;
    }
    case "PMT": {
      const rate = num(args[0]);
      const nper = num(args[1]);
      const pv = num(args[2]);
      if (!Number.isFinite(rate) || !Number.isFinite(nper) || !Number.isFinite(pv)) return "#VALUE!" as FormulaError;
      if (rate === 0) return -pv / nper;
      return (-pv * rate) / (1 - (1 + rate) ** -nper);
    }
    case "FV": {
      const rate = num(args[0]);
      const nper = num(args[1]);
      const pmt = num(args[2]);
      const pv = num(args[3] ?? 0);
      if (!Number.isFinite(rate) || !Number.isFinite(nper)) return "#VALUE!" as FormulaError;
      if (rate === 0) return -(pv + pmt * nper);
      return -(pv * (1 + rate) ** nper + (pmt * ((1 + rate) ** nper - 1)) / rate);
    }
    case "IRR": {
      const cashflows = nums(args);
      return irr(cashflows, num(args[1] ?? 0.1));
    }
    case "POWER":
    case "POW":
      return num(args[0]) ** num(args[1]);
    case "SQRT":
      return Math.sqrt(num(args[0]));
    case "MOD":
      return num(args[0]) % num(args[1]);
    case "INT":
      return Math.trunc(num(args[0]));
    case "CEILING":
      return Math.ceil(num(args[0]));
    case "FLOOR":
      return Math.floor(num(args[0]));
    case "LN":
      return Math.log(num(args[0]));
    case "LOG":
      return Math.log10(num(args[0]));
    case "EXP":
      return Math.exp(num(args[0]));
    case "PI":
      return Math.PI;
    case "RAND":
      return Math.random();
    case "RANDBETWEEN": {
      const low = Math.ceil(num(args[0]));
      const high = Math.floor(num(args[1]));
      return Math.floor(Math.random() * (high - low + 1)) + low;
    }
    case "ISNUMBER":
      return Number.isFinite(num(args[0]));
    case "ISTEXT":
      return typeof args[0] === "string" && !String(args[0]).startsWith("#");
    case "ISERROR":
      return typeof args[0] === "string" && String(args[0]).startsWith("#");
    case "NA":
      return "#N/A" as FormulaError;
    case "CHOOSE": {
      const index = Math.round(num(args[0]));
      const choice = args[index];
      return choice === undefined ? "#VALUE!" as FormulaError : choice;
    }
    case "REPT":
      return String(args[1] ?? "").repeat(Math.max(0, Math.round(num(args[0]))));
    case "FIND": {
      const haystack = String(args[1] ?? "");
      const needle = String(args[0] ?? "");
      const start = Math.max(1, Math.round(num(args[2] ?? 1)));
      const index = haystack.indexOf(needle, start - 1);
      return index < 0 ? ("#VALUE!" as FormulaError) : index + 1;
    }
    case "SEARCH": {
      const haystack = String(args[1] ?? "").toLowerCase();
      const needle = String(args[0] ?? "").toLowerCase();
      const start = Math.max(1, Math.round(num(args[2] ?? 1)));
      const index = haystack.indexOf(needle, start - 1);
      return index < 0 ? ("#VALUE!" as FormulaError) : index + 1;
    }
    case "PROPER":
      return String(args[0] ?? "").replace(/\w\S*/g, (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());
    case "CLEAN": {
      // Human: Strip ASCII control characters (codes 0–31) without a control-char regex.
      // Agent: FILTERS char codes; RETURNS printable string for CLEAN().
      return String(args[0] ?? "")
        .split("")
        .filter((char) => char.charCodeAt(0) >= 32)
        .join("");
    }
    case "VALUE":
      return num(args[0]);
    case "DATEDIF": {
      const start = num(args[0]);
      const end = num(args[1]);
      const unit = String(args[2] ?? "D").toUpperCase();
      const diff = end - start;
      if (unit === "Y") return Math.floor(diff / 365);
      if (unit === "M") return Math.floor(diff / 30);
      return diff;
    }
    case "NETWORKDAYS":
      return Math.max(0, Math.round(num(args[1]) - num(args[0])));
    case "WEEKDAY": {
      const serial = num(args[0]);
      const date = new Date((serial - 25569) * 86400 * 1000);
      const day = date.getUTCDay();
      return day === 0 ? 7 : day;
    }
    case "TEXTJOIN": {
      const delimiter = String(args[0] ?? "");
      const ignoreEmpty = Boolean(args[1]);
      const parts = args.slice(2).map((value) => (value === null ? "" : String(value)));
      return (ignoreEmpty ? parts.filter((part) => part !== "") : parts).join(delimiter);
    }
    case "EXACT":
      return String(args[0] ?? "") === String(args[1] ?? "");
    case "CHAR":
      return String.fromCharCode(Math.round(num(args[0])));
    case "CODE":
      return String(args[0] ?? "").charCodeAt(0) || 0;
    case "SIGN": {
      const value = num(args[0]);
      if (!Number.isFinite(value)) return "#VALUE!" as FormulaError;
      return value === 0 ? 0 : value > 0 ? 1 : -1;
    }
    case "EVEN": {
      const value = Math.ceil(num(args[0]));
      return value % 2 === 0 ? value : value + (value >= 0 ? 1 : -1);
    }
    case "ODD": {
      const value = Math.ceil(num(args[0]));
      return value % 2 !== 0 ? value : value + (value >= 0 ? 1 : -1);
    }
    case "GCD": {
      const values = nums(args).map((value) => Math.abs(Math.round(value)));
      if (values.length === 0) return "#VALUE!" as FormulaError;
      return values.reduce((a, b) => {
        let x = a;
        let y = b;
        while (y) {
          const t = y;
          y = x % y;
          x = t;
        }
        return x;
      });
    }
    case "LCM": {
      const values = nums(args).map((value) => Math.abs(Math.round(value)));
      if (values.length === 0) return "#VALUE!" as FormulaError;
      const gcd = (a: number, b: number): number => {
        while (b) {
          const t = b;
          b = a % b;
          a = t;
        }
        return a;
      };
      return values.reduce((a, b) => (a * b) / (gcd(a, b) || 1));
    }
    case "QUOTIENT":
      return Math.trunc(num(args[0]) / num(args[1]));
    case "PRODUCT":
      return numericArgs.length === 0 ? 0 : numericArgs.reduce((a, b) => a * b, 1);
    case "SUMSQ":
      return numericArgs.reduce((sum, value) => sum + value * value, 0);
    case "AVERAGEA": {
      const values = args.map((value) => {
        if (typeof value === "boolean") return value ? 1 : 0;
        if (typeof value === "string" && value !== "" && !value.startsWith("#")) return 0;
        return num(value);
      }).filter((value) => Number.isFinite(value));
      if (values.length === 0) return "#DIV/0!" as FormulaError;
      return values.reduce((a, b) => a + b, 0) / values.length;
    }
    case "COUNTBLANK":
      return args.filter((value) => value === null || value === "").length;
    case "EOMONTH": {
      const serial = num(args[0]);
      const months = Math.round(num(args[1]));
      const date = new Date((serial - 25569) * 86400 * 1000);
      date.setUTCMonth(date.getUTCMonth() + months + 1, 0);
      return Math.floor(date.getTime() / 86400000 + 25569);
    }
    case "EDATE": {
      const serial = num(args[0]);
      const months = Math.round(num(args[1]));
      const date = new Date((serial - 25569) * 86400 * 1000);
      date.setUTCMonth(date.getUTCMonth() + months);
      return Math.floor(date.getTime() / 86400000 + 25569);
    }
    case "YEARFRAC": {
      const start = num(args[0]);
      const end = num(args[1]);
      return (end - start) / 365;
    }
    case "N":
      return num(args[0]);
    case "T":
      return typeof args[0] === "string" && !String(args[0]).startsWith("#") ? String(args[0]) : "";
    case "TYPE": {
      const value = args[0];
      if (value === null || value === "") return 1;
      if (typeof value === "number") return 1;
      if (typeof value === "string" && value.startsWith("#")) return 16;
      if (typeof value === "string") return 2;
      if (typeof value === "boolean") return 4;
      return 1;
    }
    case "TEXTBEFORE": {
      const text = String(args[0] ?? "");
      const delimiter = String(args[1] ?? "");
      if (!delimiter) return text;
      const index = text.indexOf(delimiter);
      return index < 0 ? text : text.slice(0, index);
    }
    case "TEXTAFTER": {
      const text = String(args[0] ?? "");
      const delimiter = String(args[1] ?? "");
      if (!delimiter) return text;
      const index = text.indexOf(delimiter);
      return index < 0 ? "" : text.slice(index + delimiter.length);
    }
    case "TEXTSPLIT": {
      const text = String(args[0] ?? "");
      const colDelimiter = String(args[1] ?? ",");
      const parts = text.split(colDelimiter);
      return parts[0] ?? "";
    }
    case "REPLACE": {
      const text = String(args[0] ?? "");
      const start = Math.max(1, Math.round(num(args[1])));
      const count = Math.max(0, Math.round(num(args[2])));
      const replacement = String(args[3] ?? "");
      return text.slice(0, start - 1) + replacement + text.slice(start - 1 + count);
    }
    case "DOLLAR": {
      const value = num(args[0]);
      const decimals = args[1] !== undefined ? Math.round(num(args[1])) : 2;
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: Math.max(0, decimals),
        maximumFractionDigits: Math.max(0, decimals),
      }).format(value);
    }
    case "FIXED": {
      const value = num(args[0]);
      const decimals = args[1] !== undefined ? Math.round(num(args[1])) : 2;
      const noCommas = Boolean(args[2]);
      const fixed = value.toFixed(Math.max(0, decimals));
      if (noCommas) return fixed;
      const [whole, frac] = fixed.split(".");
      const withCommas = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
      return frac !== undefined ? `${withCommas}.${frac}` : withCommas;
    }
    case "ROUND": {
      const value = num(args[0]);
      const digits = args[1] !== undefined ? Math.round(num(args[1])) : 0;
      const factor = 10 ** digits;
      return Math.round(value * factor) / factor;
    }
    case "TRUNC": {
      const value = num(args[0]);
      const digits = args[1] !== undefined ? Math.round(num(args[1])) : 0;
      const factor = 10 ** digits;
      return Math.trunc(value * factor) / factor;
    }
    case "MROUND": {
      const value = num(args[0]);
      const multiple = num(args[1]);
      if (multiple === 0) return 0;
      return Math.round(value / multiple) * multiple;
    }
    case "RANK":
    case "RANK.EQ": {
      const target = num(args[0]);
      const values = nums(args.slice(1));
      const order = 0;
      const sorted = [...values].sort((a, b) => (order === 0 ? b - a : a - b));
      const index = sorted.findIndex((value) => value === target);
      return index < 0 ? ("#N/A" as FormulaError) : index + 1;
    }
    case "PERCENTILE":
    case "PERCENTILE.INC": {
      const values = nums(args.slice(0, -1)).sort((a, b) => a - b);
      const k = num(args[args.length - 1]);
      if (values.length === 0 || k < 0 || k > 1) return "#NUM!" as FormulaError;
      const pos = (values.length - 1) * k;
      const base = Math.floor(pos);
      const rest = pos - base;
      if (values[base + 1] === undefined) return values[base];
      return values[base] + rest * (values[base + 1] - values[base]);
    }
    case "LARGE": {
      const values = nums(args.slice(0, -1)).sort((a, b) => b - a);
      const k = Math.round(num(args[args.length - 1]));
      return values[k - 1] ?? ("#NUM!" as FormulaError);
    }
    case "SMALL": {
      const values = nums(args.slice(0, -1)).sort((a, b) => a - b);
      const k = Math.round(num(args[args.length - 1]));
      return values[k - 1] ?? ("#NUM!" as FormulaError);
    }
    case "TRIMMEAN": {
      const values = nums(args.slice(0, -1)).sort((a, b) => a - b);
      const percent = num(args[args.length - 1]);
      if (values.length === 0) return "#DIV/0!" as FormulaError;
      const drop = Math.floor(values.length * percent);
      const trimmed = values.slice(drop, values.length - drop || undefined);
      if (trimmed.length === 0) return "#DIV/0!" as FormulaError;
      return trimmed.reduce((a, b) => a + b, 0) / trimmed.length;
    }
    case "HYPERLINK":
      return String(args[1] ?? args[0] ?? "");
    case "FORMULATEXT":
      return typeof args[0] === "string" && String(args[0]).startsWith("=")
        ? String(args[0])
        : ("#N/A" as FormulaError);
    default:
      return undefined;
  }
}

function stdDev(values: number[], population: boolean): number | FormulaError {
  if (values.length < (population ? 1 : 2)) return "#DIV/0!" as FormulaError;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const varianceValue =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
    (population ? values.length : values.length - 1);
  return Math.sqrt(varianceValue);
}

function variance(values: number[], population: boolean): number | FormulaError {
  if (values.length < (population ? 1 : 2)) return "#DIV/0!" as FormulaError;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return (
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
    (population ? values.length : values.length - 1)
  );
}

function correl(xs: number[], ys: number[]): number | FormulaError {
  const length = Math.min(xs.length, ys.length);
  if (length < 2) return "#DIV/0!" as FormulaError;
  const meanX = xs.slice(0, length).reduce((sum, value) => sum + value, 0) / length;
  const meanY = ys.slice(0, length).reduce((sum, value) => sum + value, 0) / length;
  let num = 0;
  let denX = 0;
  let denY = 0;
  for (let index = 0; index < length; index += 1) {
    const dx = xs[index] - meanX;
    const dy = ys[index] - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }
  if (denX === 0 || denY === 0) return "#DIV/0!" as FormulaError;
  return num / Math.sqrt(denX * denY);
}

function irr(cashflows: number[], guess: number): number | FormulaError {
  if (cashflows.length < 2) return "#NUM!" as FormulaError;
  let rate = Number.isFinite(guess) ? guess : 0.1;
  for (let iteration = 0; iteration < 50; iteration += 1) {
    let npv = 0;
    let derivative = 0;
    cashflows.forEach((cf, index) => {
      const factor = (1 + rate) ** index;
      npv += cf / factor;
      derivative -= (index * cf) / ((1 + rate) ** (index + 1));
    });
    if (Math.abs(derivative) < 1e-12) break;
    const next = rate - npv / derivative;
    if (!Number.isFinite(next)) return "#NUM!" as FormulaError;
    if (Math.abs(next - rate) < 1e-8) return next;
    rate = next;
  }
  return rate;
}
