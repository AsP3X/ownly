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

function isTruthyFlag(flag: FormulaArrayValue): boolean {
  return (
    flag === true ||
    flag === 1 ||
    String(flag ?? "").toLowerCase() === "true" ||
    (typeof flag === "number" && flag !== 0)
  );
}

function compareValues(a: FormulaArrayValue, b: FormulaArrayValue, order: number): number {
  const numA = Number(String(a ?? "").replace(/[$,%\s,]/g, ""));
  const numB = Number(String(b ?? "").replace(/[$,%\s,]/g, ""));
  let cmp = 0;
  if (Number.isFinite(numA) && Number.isFinite(numB)) cmp = numA - numB;
  else cmp = String(a ?? "").localeCompare(String(b ?? ""), undefined, { sensitivity: "base" });
  return order < 0 ? -cmp : cmp;
}

// Human: FILTER(array, include) — keep rows where include is truthy; supports multi-column arrays.
// Agent: TREATS include as one flag per row; RETURNS spillRows × spillCols grid.
export function evalFilter(
  arrayValues: FormulaArrayValue[],
  includeFlags: FormulaArrayValue[],
  spillCols = 1,
): EvalArray {
  const cols = Math.max(1, spillCols);
  const rowCount = Math.ceil(arrayValues.length / cols);
  const filtered: FormulaArrayValue[] = [];
  for (let row = 0; row < rowCount; row += 1) {
    const flag = includeFlags[row] ?? includeFlags[row * cols] ?? null;
    if (!isTruthyFlag(flag)) continue;
    for (let col = 0; col < cols; col += 1) {
      filtered.push(arrayValues[row * cols + col] ?? null);
    }
  }
  const spillRows = cols > 0 ? Math.floor(filtered.length / cols) : 0;
  return { values: filtered, spillRows, spillCols: cols };
}

// Human: SORT(array, [sort_index], [sort_order]) — sort rows; multi-column aware.
// Agent: sort_index is 1-based column within each row; sort_order 1 asc / -1 desc.
export function evalSort(
  arrayValues: FormulaArrayValue[],
  spillCols = 1,
  sortIndex = 1,
  sortOrder = 1,
): EvalArray {
  const cols = Math.max(1, spillCols);
  const rowCount = Math.ceil(arrayValues.length / cols);
  const rows: FormulaArrayValue[][] = [];
  for (let row = 0; row < rowCount; row += 1) {
    const entry: FormulaArrayValue[] = [];
    for (let col = 0; col < cols; col += 1) {
      entry.push(arrayValues[row * cols + col] ?? null);
    }
    rows.push(entry);
  }
  const keyCol = Math.min(cols, Math.max(1, sortIndex)) - 1;
  rows.sort((a, b) => compareValues(a[keyCol], b[keyCol], sortOrder));
  const values = rows.flat();
  return { values, spillRows: rows.length, spillCols: cols };
}

// Human: UNIQUE(array) — distinct rows preserving first-seen order (multi-col row identity).
// Agent: KEYS entire row when spillCols > 1.
export function evalUnique(arrayValues: FormulaArrayValue[], spillCols = 1): EvalArray {
  const cols = Math.max(1, spillCols);
  const rowCount = Math.ceil(arrayValues.length / cols);
  const seen = new Set<string>();
  const unique: FormulaArrayValue[] = [];
  let spillRows = 0;
  for (let row = 0; row < rowCount; row += 1) {
    const rowValues: FormulaArrayValue[] = [];
    for (let col = 0; col < cols; col += 1) {
      rowValues.push(arrayValues[row * cols + col] ?? null);
    }
    const key = rowValues.map((value) => String(value ?? "").toLowerCase()).join("\u0001");
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(...rowValues);
    spillRows += 1;
  }
  return { values: unique, spillRows, spillCols: cols };
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
