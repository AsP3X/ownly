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
    case "PV": {
      const rate = num(args[0]);
      const nper = num(args[1]);
      const pmt = num(args[2]);
      const fv = num(args[3] ?? 0);
      if (!Number.isFinite(rate) || !Number.isFinite(nper)) return "#VALUE!" as FormulaError;
      if (rate === 0) return -(fv + pmt * nper);
      return -(fv + pmt * ((1 + rate) ** nper - 1) / rate) / (1 + rate) ** nper;
    }
    case "NPER": {
      const rate = num(args[0]);
      const pmt = num(args[1]);
      const pv = num(args[2]);
      const fv = num(args[3] ?? 0);
      if (!Number.isFinite(rate) || !Number.isFinite(pmt) || !Number.isFinite(pv)) return "#VALUE!" as FormulaError;
      if (rate === 0) return -(pv + fv) / pmt;
      return Math.log((pmt - fv * rate) / (pmt + pv * rate)) / Math.log(1 + rate);
    }
    case "RATE": {
      // Human: Newton-Raphson RATE for loan-style cashflows.
      // Agent: USES PV/PMT/NPER relationship; RETURNS approx annual period rate.
      const nper = num(args[0]);
      const pmt = num(args[1]);
      const pv = num(args[2]);
      const fv = num(args[3] ?? 0);
      let rate = 0.1;
      for (let i = 0; i < 40; i += 1) {
        const f =
          pv * (1 + rate) ** nper +
          pmt * ((1 + rate) ** nper - 1) / rate +
          fv;
        const df =
          nper * pv * (1 + rate) ** (nper - 1) +
          pmt * (nper * (1 + rate) ** (nper - 1) * rate - ((1 + rate) ** nper - 1)) / (rate * rate);
        if (Math.abs(df) < 1e-12) break;
        const next = rate - f / df;
        if (!Number.isFinite(next)) break;
        if (Math.abs(next - rate) < 1e-8) {
          rate = next;
          break;
        }
        rate = next;
      }
      return rate;
    }
    case "IPMT": {
      const rate = num(args[0]);
      const per = Math.round(num(args[1]));
      const nper = num(args[2]);
      const pv = num(args[3]);
      const pmt =
        rate === 0
          ? -pv / nper
          : (-pv * rate) / (1 - (1 + rate) ** -nper);
      const balance = pv * (1 + rate) ** (per - 1) + pmt * (((1 + rate) ** (per - 1) - 1) / rate);
      return -balance * rate;
    }
    case "PPMT": {
      const rate = num(args[0]);
      const per = Math.round(num(args[1]));
      const nper = num(args[2]);
      const pv = num(args[3]);
      const pmt =
        rate === 0
          ? -pv / nper
          : (-pv * rate) / (1 - (1 + rate) ** -nper);
      const balance =
        rate === 0
          ? pv + pmt * (per - 1)
          : pv * (1 + rate) ** (per - 1) + pmt * (((1 + rate) ** (per - 1) - 1) / rate);
      const ipmt = -balance * rate;
      return pmt - ipmt;
    }
    case "IRR": {
      const cashflows = nums(args);
      return irr(cashflows, num(args[1] ?? 0.1));
    }
    case "MIRR": {
      const values = nums(args.slice(0, -2));
      const financeRate = num(args[args.length - 2]);
      const reinvestRate = num(args[args.length - 1]);
      if (values.length < 2) return "#DIV/0!" as FormulaError;
      let neg = 0;
      let pos = 0;
      values.forEach((cf, index) => {
        if (cf < 0) neg += cf / (1 + financeRate) ** index;
        else pos += cf * (1 + reinvestRate) ** (values.length - 1 - index);
      });
      if (neg === 0 || pos === 0) return "#DIV/0!" as FormulaError;
      return (pos / -neg) ** (1 / (values.length - 1)) - 1;
    }
    case "SLN": {
      const cost = num(args[0]);
      const salvage = num(args[1]);
      const life = num(args[2]);
      if (life === 0) return "#DIV/0!" as FormulaError;
      return (cost - salvage) / life;
    }
    case "SYD": {
      const cost = num(args[0]);
      const salvage = num(args[1]);
      const life = num(args[2]);
      const per = num(args[3]);
      return ((cost - salvage) * (life - per + 1) * 2) / (life * (life + 1));
    }
    case "DB": {
      const cost = num(args[0]);
      const salvage = num(args[1]);
      const life = num(args[2]);
      const period = Math.round(num(args[3]));
      const rate = 1 - (salvage / cost) ** (1 / life);
      let book = cost;
      let dep = 0;
      for (let i = 1; i <= period; i += 1) {
        dep = book * rate;
        book -= dep;
      }
      return dep;
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
    // —— Math / trig ——
    case "SIN":
      return Math.sin(num(args[0]));
    case "COS":
      return Math.cos(num(args[0]));
    case "TAN":
      return Math.tan(num(args[0]));
    case "ASIN":
      return Math.asin(num(args[0]));
    case "ACOS":
      return Math.acos(num(args[0]));
    case "ATAN":
      return Math.atan(num(args[0]));
    case "ATAN2":
      return Math.atan2(num(args[1]), num(args[0]));
    case "SINH":
      return Math.sinh(num(args[0]));
    case "COSH":
      return Math.cosh(num(args[0]));
    case "TANH":
      return Math.tanh(num(args[0]));
    case "DEGREES":
      return (num(args[0]) * 180) / Math.PI;
    case "RADIANS":
      return (num(args[0]) * Math.PI) / 180;
    case "ABS":
      return Math.abs(num(args[0]));
    case "FACT": {
      const n = Math.floor(num(args[0]));
      if (n < 0) return "#NUM!" as FormulaError;
      if (n > 170) return "#NUM!" as FormulaError;
      let result = 1;
      for (let i = 2; i <= n; i += 1) result *= i;
      return result;
    }
    case "COMBIN": {
      const n = Math.floor(num(args[0]));
      const k = Math.floor(num(args[1]));
      if (n < 0 || k < 0 || k > n) return "#NUM!" as FormulaError;
      let result = 1;
      for (let i = 1; i <= k; i += 1) result = (result * (n - k + i)) / i;
      return Math.round(result);
    }
    case "PERMUT": {
      const n = Math.floor(num(args[0]));
      const k = Math.floor(num(args[1]));
      if (n < 0 || k < 0 || k > n) return "#NUM!" as FormulaError;
      let result = 1;
      for (let i = 0; i < k; i += 1) result *= n - i;
      return result;
    }
    case "BASE": {
      const value = Math.floor(num(args[0]));
      const radix = Math.round(num(args[1]));
      const minLength = args[2] !== undefined ? Math.round(num(args[2])) : 0;
      if (radix < 2 || radix > 36) return "#NUM!" as FormulaError;
      let text = Math.abs(value).toString(radix).toUpperCase();
      if (minLength > text.length) text = text.padStart(minLength, "0");
      return value < 0 ? `-${text}` : text;
    }
    case "DECIMAL": {
      const text = String(args[0] ?? "");
      const radix = Math.round(num(args[1]));
      if (radix < 2 || radix > 36) return "#NUM!" as FormulaError;
      const parsed = Number.parseInt(text, radix);
      return Number.isFinite(parsed) ? parsed : ("#NUM!" as FormulaError);
    }
    case "ROMAN": {
      const n = Math.round(num(args[0]));
      if (n < 1 || n > 3999) return "#VALUE!" as FormulaError;
      const map: Array<[number, string]> = [
        [1000, "M"], [900, "CM"], [500, "D"], [400, "CD"],
        [100, "C"], [90, "XC"], [50, "L"], [40, "XL"],
        [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"],
      ];
      let remaining = n;
      let out = "";
      for (const [value, glyph] of map) {
        while (remaining >= value) {
          out += glyph;
          remaining -= value;
        }
      }
      return out;
    }
    case "ARABIC": {
      const text = String(args[0] ?? "").toUpperCase();
      const map: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
      let total = 0;
      for (let i = 0; i < text.length; i += 1) {
        const cur = map[text[i]] ?? 0;
        const next = map[text[i + 1]] ?? 0;
        total += cur < next ? -cur : cur;
      }
      return total;
    }
    // —— Date ——
    case "DAYS":
      return Math.round(num(args[0]) - num(args[1]));
    case "WEEKNUM": {
      const serial = num(args[0]);
      const date = new Date((serial - 25569) * 86400 * 1000);
      const start = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
      const day = Math.floor((date.getTime() - start.getTime()) / 86400000);
      return Math.floor(day / 7) + 1;
    }
    case "ISOWEEKNUM": {
      const serial = num(args[0]);
      const date = new Date((serial - 25569) * 86400 * 1000);
      const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
      const dayNum = target.getUTCDay() || 7;
      target.setUTCDate(target.getUTCDate() + 4 - dayNum);
      const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
      return Math.ceil(((target.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
    }
    case "WORKDAY": {
      let serial = Math.floor(num(args[0]));
      let days = Math.round(num(args[1]));
      const step = days >= 0 ? 1 : -1;
      days = Math.abs(days);
      while (days > 0) {
        serial += step;
        const date = new Date((serial - 25569) * 86400 * 1000);
        const dow = date.getUTCDay();
        if (dow !== 0 && dow !== 6) days -= 1;
      }
      return serial;
    }
    case "HOUR": {
      const serial = num(args[0]);
      const fraction = serial - Math.floor(serial);
      return Math.floor(fraction * 24);
    }
    case "MINUTE": {
      const serial = num(args[0]);
      const fraction = serial - Math.floor(serial);
      return Math.floor((fraction * 1440) % 60);
    }
    case "SECOND": {
      const serial = num(args[0]);
      const fraction = serial - Math.floor(serial);
      return Math.floor((fraction * 86400) % 60);
    }
    case "TIME": {
      const h = num(args[0]);
      const m = num(args[1]);
      const s = num(args[2]);
      return (h * 3600 + m * 60 + s) / 86400;
    }
    // —— Info ——
    case "ISEVEN":
      return Math.floor(num(args[0])) % 2 === 0;
    case "ISODD":
      return Math.floor(num(args[0])) % 2 !== 0;
    case "ISLOGICAL":
      return typeof args[0] === "boolean";
    case "ISNONTEXT":
      return typeof args[0] !== "string" || String(args[0]).startsWith("#");
    case "ISREF":
      return false;
    case "ISEMPTY":
    case "ISBLANK":
      return args[0] === null || args[0] === "";
    // —— Text ——
    case "NUMBERVALUE": {
      const text = String(args[0] ?? "").replace(/,/g, "");
      const parsed = Number(text);
      return Number.isFinite(parsed) ? parsed : ("#VALUE!" as FormulaError);
    }
    case "UNICHAR":
      return String.fromCodePoint(Math.round(num(args[0])));
    case "UNICODE":
      return String(args[0] ?? "").codePointAt(0) ?? 0;
    // —— Stats ——
    case "GEOMEAN": {
      if (numericArgs.length === 0) return "#NUM!" as FormulaError;
      if (numericArgs.some((value) => value <= 0)) return "#NUM!" as FormulaError;
      const logSum = numericArgs.reduce((sum, value) => sum + Math.log(value), 0);
      return Math.exp(logSum / numericArgs.length);
    }
    case "HARMEAN": {
      if (numericArgs.length === 0) return "#N/A" as FormulaError;
      if (numericArgs.some((value) => value <= 0)) return "#N/A" as FormulaError;
      const inv = numericArgs.reduce((sum, value) => sum + 1 / value, 0);
      return numericArgs.length / inv;
    }
    case "MODE":
    case "MODE.SNGL": {
      if (numericArgs.length === 0) return "#N/A" as FormulaError;
      const counts = new Map<number, number>();
      for (const value of numericArgs) counts.set(value, (counts.get(value) ?? 0) + 1);
      let best = numericArgs[0];
      let bestCount = 0;
      for (const [value, count] of counts) {
        if (count > bestCount) {
          best = value;
          bestCount = count;
        }
      }
      return bestCount < 2 ? ("#N/A" as FormulaError) : best;
    }
    case "QUARTILE":
    case "QUARTILE.INC": {
      const values = [...numericArgs].sort((a, b) => a - b);
      const q = Math.round(num(args[args.length - 1]));
      if (values.length === 0 || q < 0 || q > 4) return "#NUM!" as FormulaError;
      const k = q / 4;
      const pos = (values.length - 1) * k;
      const base = Math.floor(pos);
      const rest = pos - base;
      if (values[base + 1] === undefined) return values[base];
      return values[base] + rest * (values[base + 1] - values[base]);
    }
    case "AVEDEV": {
      if (numericArgs.length === 0) return "#NUM!" as FormulaError;
      const mean = numericArgs.reduce((a, b) => a + b, 0) / numericArgs.length;
      return numericArgs.reduce((sum, value) => sum + Math.abs(value - mean), 0) / numericArgs.length;
    }
    case "DEVSQ": {
      if (numericArgs.length === 0) return "#DIV/0!" as FormulaError;
      const mean = numericArgs.reduce((a, b) => a + b, 0) / numericArgs.length;
      return numericArgs.reduce((sum, value) => sum + (value - mean) ** 2, 0);
    }
    case "FISHER": {
      const x = num(args[0]);
      if (x <= -1 || x >= 1) return "#NUM!" as FormulaError;
      return 0.5 * Math.log((1 + x) / (1 - x));
    }
    case "FISHERINV": {
      const y = num(args[0]);
      const e = Math.exp(2 * y);
      return (e - 1) / (e + 1);
    }
    case "NORM.S.DIST":
    case "NORMSDIST": {
      const z = num(args[0]);
      // Standard normal CDF approximation
      const t = 1 / (1 + 0.2316419 * Math.abs(z));
      const d = 0.3989423 * Math.exp((-z * z) / 2);
      const p =
        d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
      return z > 0 ? 1 - p : p;
    }
    case "PHI": {
      const z = num(args[0]);
      return Math.exp((-z * z) / 2) / Math.sqrt(2 * Math.PI);
    }
    case "TRUE":
      return true;
    case "FALSE":
      return false;
    // —— More math ——
    case "CEILING.MATH":
    case "CEILING.PRECISE": {
      const value = num(args[0]);
      const significance = args[1] !== undefined ? Math.abs(num(args[1])) : 1;
      if (significance === 0) return 0;
      return Math.ceil(value / significance) * significance;
    }
    case "FLOOR.MATH":
    case "FLOOR.PRECISE": {
      const value = num(args[0]);
      const significance = args[1] !== undefined ? Math.abs(num(args[1])) : 1;
      if (significance === 0) return 0;
      return Math.floor(value / significance) * significance;
    }
    case "ROUNDUP": {
      const value = num(args[0]);
      const digits = args[1] !== undefined ? Math.round(num(args[1])) : 0;
      const factor = 10 ** digits;
      return value >= 0 ? Math.ceil(value * factor) / factor : Math.floor(value * factor) / factor;
    }
    case "ROUNDDOWN": {
      const value = num(args[0]);
      const digits = args[1] !== undefined ? Math.round(num(args[1])) : 0;
      const factor = 10 ** digits;
      return value >= 0 ? Math.floor(value * factor) / factor : Math.ceil(value * factor) / factor;
    }
    case "SERIESSUM": {
      const x = num(args[0]);
      const n = num(args[1]);
      const m = num(args[2]);
      const coeffs = nums(args.slice(3));
      return coeffs.reduce((sum, a, i) => sum + a * x ** (n + i * m), 0);
    }
    case "SQRTPI":
      return Math.sqrt(num(args[0]) * Math.PI);
    case "SUMX2MY2": {
      const half = Math.floor(args.length / 2);
      const a = nums(args.slice(0, half));
      const b = nums(args.slice(half));
      const len = Math.min(a.length, b.length);
      let total = 0;
      for (let i = 0; i < len; i += 1) total += a[i] ** 2 - b[i] ** 2;
      return total;
    }
    case "SUMX2PY2": {
      const half = Math.floor(args.length / 2);
      const a = nums(args.slice(0, half));
      const b = nums(args.slice(half));
      const len = Math.min(a.length, b.length);
      let total = 0;
      for (let i = 0; i < len; i += 1) total += a[i] ** 2 + b[i] ** 2;
      return total;
    }
    case "SUMXMY2": {
      const half = Math.floor(args.length / 2);
      const a = nums(args.slice(0, half));
      const b = nums(args.slice(half));
      const len = Math.min(a.length, b.length);
      let total = 0;
      for (let i = 0; i < len; i += 1) total += (a[i] - b[i]) ** 2;
      return total;
    }
    // —— More text ——
    case "BAHTTEXT":
      return String(num(args[0]));
    case "ASC":
    case "DBCS":
    case "JIS":
      return String(args[0] ?? "");
    case "PHONETIC":
      return String(args[0] ?? "");
    case "WIDECHAR":
      return String(args[0] ?? "");
    case "FINDB":
    case "SEARCHB":
    case "LEFTB":
    case "RIGHTB":
    case "MIDB":
    case "LENB":
    case "REPLACEB":
      // Human: DBCS text functions — treat as UTF-16 code units (same as non-B forms).
      // Agent: FALLTHROUGH aliases; FIND/SEARCH/LEFT/etc. already handled above or in core.
      if (upper === "FINDB") {
        const haystack = String(args[1] ?? "");
        const needle = String(args[0] ?? "");
        const start = Math.max(1, Math.round(num(args[2] ?? 1)));
        const index = haystack.indexOf(needle, start - 1);
        return index < 0 ? ("#VALUE!" as FormulaError) : index + 1;
      }
      if (upper === "SEARCHB") {
        const haystack = String(args[1] ?? "").toLowerCase();
        const needle = String(args[0] ?? "").toLowerCase();
        const start = Math.max(1, Math.round(num(args[2] ?? 1)));
        const index = haystack.indexOf(needle, start - 1);
        return index < 0 ? ("#VALUE!" as FormulaError) : index + 1;
      }
      if (upper === "LEFTB") {
        const text = String(args[0] ?? "");
        return text.slice(0, Math.max(0, Math.round(num(args[1] ?? 1))));
      }
      if (upper === "RIGHTB") {
        const text = String(args[0] ?? "");
        const count = Math.max(0, Math.round(num(args[1] ?? 1)));
        return text.slice(Math.max(0, text.length - count));
      }
      if (upper === "MIDB") {
        const text = String(args[0] ?? "");
        const start = Math.max(1, Math.round(num(args[1])));
        const length = Math.max(0, Math.round(num(args[2] ?? 0)));
        return text.slice(start - 1, start - 1 + length);
      }
      if (upper === "LENB") return String(args[0] ?? "").length;
      {
        const text = String(args[0] ?? "");
        const start = Math.max(1, Math.round(num(args[1])));
        const count = Math.max(0, Math.round(num(args[2])));
        const replacement = String(args[3] ?? "");
        return text.slice(0, start - 1) + replacement + text.slice(start - 1 + count);
      }
    case "TEXT": {
      const value = num(args[0]);
      const format = String(args[1] ?? "0");
      if (format.includes("%")) return `${(value * 100).toFixed(0)}%`;
      if (format.includes("0.00") || format.includes("#,##0.00")) {
        return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      }
      return String(value);
    }
    // —— Engineering (light) ——
    case "BIN2DEC": {
      const text = String(args[0] ?? "");
      const parsed = Number.parseInt(text, 2);
      return Number.isFinite(parsed) ? parsed : ("#NUM!" as FormulaError);
    }
    case "DEC2BIN": {
      const value = Math.floor(num(args[0]));
      if (value < -512 || value > 511) return "#NUM!" as FormulaError;
      const unsigned = value < 0 ? value + 1024 : value;
      return unsigned.toString(2);
    }
    case "HEX2DEC": {
      const text = String(args[0] ?? "");
      const parsed = Number.parseInt(text, 16);
      return Number.isFinite(parsed) ? parsed : ("#NUM!" as FormulaError);
    }
    case "DEC2HEX": {
      const value = Math.floor(num(args[0]));
      return (value >>> 0).toString(16).toUpperCase();
    }
    case "OCT2DEC": {
      const text = String(args[0] ?? "");
      const parsed = Number.parseInt(text, 8);
      return Number.isFinite(parsed) ? parsed : ("#NUM!" as FormulaError);
    }
    case "DEC2OCT": {
      const value = Math.floor(num(args[0]));
      return (value >>> 0).toString(8);
    }
    case "BITAND":
      return Math.floor(num(args[0])) & Math.floor(num(args[1]));
    case "BITOR":
      return Math.floor(num(args[0])) | Math.floor(num(args[1]));
    case "BITXOR":
      return Math.floor(num(args[0])) ^ Math.floor(num(args[1]));
    case "BITLSHIFT":
      return Math.floor(num(args[0])) << Math.floor(num(args[1]));
    case "BITRSHIFT":
      return Math.floor(num(args[0])) >> Math.floor(num(args[1]));
    case "DELTA":
      return Math.abs(num(args[0]) - num(args[1] ?? 0)) < 1e-12 ? 1 : 0;
    case "GESTEP":
      return num(args[0]) >= num(args[1] ?? 0) ? 1 : 0;
    case "COMPLEX":
      return `${num(args[0])}+${num(args[1])}i`;
    case "IMREAL": {
      const text = String(args[0] ?? "");
      const match = /^([+-]?\d*\.?\d+)/.exec(text);
      return match ? Number(match[1]) : 0;
    }
    case "IMAGINARY": {
      const text = String(args[0] ?? "");
      const match = /([+-]?\d*\.?\d+)i$/i.exec(text);
      return match ? Number(match[1]) : 0;
    }
    // —— Compatibility aliases ——
    case "STDEVA":
      return evaluateExtendedFunction("STDEV", args);
    case "VARA":
      return evaluateExtendedFunction("VAR", args);
    case "MAXA":
      return numericArgs.length === 0 ? 0 : Math.max(...numericArgs);
    case "MINA":
      return numericArgs.length === 0 ? 0 : Math.min(...numericArgs);
    // —— More common Excel functions ——
    case "SUBTOTAL": {
      // Human: SUBTOTAL(fn, …) — support common fn codes 1–11 (ignore hidden not modeled).
      // Agent: MAPS 1=AVERAGE, 2=COUNT, 3=COUNTA, 4=MAX, 5=MIN, 9=SUM.
      const code = Math.round(num(args[0]));
      const values = nums(args.slice(1));
      switch (code % 100) {
        case 1:
          return values.length === 0
            ? ("#DIV/0!" as FormulaError)
            : values.reduce((a, b) => a + b, 0) / values.length;
        case 2:
          return values.length;
        case 3:
          return args.slice(1).filter((v) => v !== null && v !== "").length;
        case 4:
          return values.length === 0 ? 0 : Math.max(...values);
        case 5:
          return values.length === 0 ? 0 : Math.min(...values);
        case 9:
          return values.reduce((a, b) => a + b, 0);
        default:
          return values.reduce((a, b) => a + b, 0);
      }
    }
    case "AGGREGATE": {
      // Human: AGGREGATE(fn, options, …) — simplified; options ignored.
      // Agent: DELEGATES to SUBTOTAL-like mapping for fn 1–5, 9.
      return evaluateExtendedFunction("SUBTOTAL", [args[0], ...args.slice(2)]);
    }
    case "CONVERT": {
      // Human: Minimal unit conversion (common mass/length pairs).
      // Agent: RETURNS #N/A for unsupported units.
      const value = num(args[0]);
      const from = String(args[1] ?? "").toLowerCase();
      const to = String(args[2] ?? "").toLowerCase();
      const factors: Record<string, number> = {
        m: 1,
        km: 1000,
        cm: 0.01,
        mm: 0.001,
        in: 0.0254,
        ft: 0.3048,
        yd: 0.9144,
        g: 0.001,
        kg: 1,
        lbm: 0.45359237,
      };
      const a = factors[from];
      const b = factors[to];
      if (a === undefined || b === undefined) return "#N/A" as FormulaError;
      const mass = new Set(["g", "kg", "lbm"]);
      if (mass.has(from) !== mass.has(to)) return "#N/A" as FormulaError;
      return (value * a) / b;
    }
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
