// Human: Excel 365 dynamic array functions — FILTER, SORT, UNIQUE, SEQUENCE, SORTBY.
// Agent: RETURNS EvalArray for spill expansion in recalculateSheet.

export type FormulaArrayValue = string | number | boolean | null;

export type EvalArray = {
  values: FormulaArrayValue[];
  spillRows: number;
  spillCols: number;
};

function flattenToNumbers(values: FormulaArrayValue[]): number[] {
  return values
    .map((value) => {
      if (typeof value === "number" && Number.isFinite(value)) return value;
      if (typeof value === "boolean") return value ? 1 : 0;
      const parsed = Number(String(value ?? "").replace(/[$,%\s,]/g, ""));
      return Number.isFinite(parsed) ? parsed : NaN;
    })
    .filter((value) => Number.isFinite(value));
}

// Human: FILTER(array, include) — keep values where include is truthy.
// Agent: PAIRS parallel arrays; RETURNS 1-column spill.
export function evalFilter(
  arrayValues: FormulaArrayValue[],
  includeFlags: FormulaArrayValue[],
): EvalArray {
  const filtered: FormulaArrayValue[] = [];
  const length = Math.min(arrayValues.length, includeFlags.length);
  for (let index = 0; index < length; index += 1) {
    const flag = includeFlags[index];
    const truthy =
      flag === true ||
      flag === 1 ||
      String(flag ?? "").toLowerCase() === "true" ||
      (typeof flag === "number" && flag !== 0);
    if (truthy) filtered.push(arrayValues[index]);
  }
  return { values: filtered, spillRows: filtered.length, spillCols: 1 };
}

// Human: SORT(array) — ascending sort of numeric/text values.
// Agent: RETURNS sorted copy as vertical spill.
export function evalSort(arrayValues: FormulaArrayValue[]): EvalArray {
  const sorted = [...arrayValues].sort((a, b) => {
    const numA = Number(String(a ?? "").replace(/[$,%\s,]/g, ""));
    const numB = Number(String(b ?? "").replace(/[$,%\s,]/g, ""));
    if (Number.isFinite(numA) && Number.isFinite(numB)) return numA - numB;
    return String(a ?? "").localeCompare(String(b ?? ""), undefined, { sensitivity: "base" });
  });
  return { values: sorted, spillRows: sorted.length, spillCols: 1 };
}

// Human: UNIQUE(array) — distinct values preserving first-seen order.
// Agent: RETURNS deduped vertical spill.
export function evalUnique(arrayValues: FormulaArrayValue[]): EvalArray {
  const seen = new Set<string>();
  const unique: FormulaArrayValue[] = [];
  for (const value of arrayValues) {
    const key = String(value ?? "").toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(value);
  }
  return { values: unique, spillRows: unique.length, spillCols: 1 };
}

// Human: SEQUENCE(rows, cols, start, step) — fill a column or grid with a series.
// Agent: RETURNS EvalArray with spillRows × spillCols flat values.
export function evalSequence(
  rows: number,
  cols: number,
  start: number,
  step: number,
): EvalArray {
  const safeRows = Math.max(1, Math.min(Math.round(rows), 1000));
  const safeCols = Math.max(1, Math.min(Math.round(cols), 100));
  const values: FormulaArrayValue[] = [];
  for (let row = 0; row < safeRows; row += 1) {
    for (let col = 0; col < safeCols; col += 1) {
      values.push(start + (row * safeCols + col) * step);
    }
  }
  return { values, spillRows: safeRows, spillCols: safeCols };
}

// Human: SORTBY(array, by_array) — sort array by companion key column.
// Agent: ZIPS pairs; SORTS by numeric/text key.
export function evalSortBy(
  arrayValues: FormulaArrayValue[],
  byValues: FormulaArrayValue[],
): EvalArray {
  const pairs = arrayValues.map((value, index) => ({
    value,
    key: byValues[index] ?? null,
  }));
  pairs.sort((a, b) => {
    const numA = Number(String(a.key ?? "").replace(/[$,%\s,]/g, ""));
    const numB = Number(String(b.key ?? "").replace(/[$,%\s,]/g, ""));
    if (Number.isFinite(numA) && Number.isFinite(numB)) return numA - numB;
    return String(a.key ?? "").localeCompare(String(b.key ?? ""), undefined, { sensitivity: "base" });
  });
  const sorted = pairs.map((pair) => pair.value);
  return { values: sorted, spillRows: sorted.length, spillCols: 1 };
}

export function isEvalArray(value: unknown): value is EvalArray {
  return (
    typeof value === "object" &&
    value !== null &&
    "values" in value &&
    Array.isArray((value as EvalArray).values)
  );
}

export function evalArrayFirstValue(result: EvalArray): FormulaArrayValue {
  return result.values[0] ?? null;
}

export function numericStats(values: FormulaArrayValue[]) {
  const nums = flattenToNumbers(values);
  return { nums, count: nums.length };
}
