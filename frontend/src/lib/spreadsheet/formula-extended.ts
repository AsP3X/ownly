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
