// Human: Data validation rule types and cell value checks for spreadsheet editing.
// Agent: READS DataValidationRule; VALIDATES user input before commit.

export type DataValidationRule = {
  type: "list" | "whole" | "decimal" | "textLength" | "custom" | "date";
  values?: string[];
  min?: number;
  max?: number;
  allowBlank?: boolean;
  errorMessage?: string;
  // Human: Custom formula expression for type="custom" (truthy when valid).
  // Agent: EVALUATED lightly in validateCellInput; FULL formula engine optional.
  formula?: string;
};

// Human: Stable map key for per-cell validation overrides.
// Agent: USED by SheetData.cellValidations and commitEdit resolution.
export function cellValidationKey(row: number, col: number): string {
  return `${row}:${col}`;
}

function isBlankInput(raw: string): boolean {
  return raw.trim().length === 0;
}

function parseNumericInput(raw: string): number | null {
  const parsed = Number(raw.replace(/[$,%\s,]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

// Human: Validate a formula-bar or in-cell edit against a column rule.
// Agent: RETURNS valid flag + optional user-facing message for alert().
export function validateCellInput(
  rule: DataValidationRule,
  rawInput: string,
): { valid: boolean; message?: string } {
  const fallback = rule.errorMessage ?? "The value you entered is not valid for this cell.";
  const input = rawInput.trim();

  if (isBlankInput(input)) {
    if (rule.allowBlank !== false) return { valid: true };
    return { valid: false, message: fallback };
  }

  switch (rule.type) {
    case "list": {
      const allowed = (rule.values ?? []).map((value) => value.trim().toLowerCase());
      if (allowed.length === 0) return { valid: true };
      return allowed.includes(input.toLowerCase())
        ? { valid: true }
        : { valid: false, message: fallback };
    }
    case "whole": {
      const numeric = parseNumericInput(input);
      if (numeric === null || !Number.isInteger(numeric)) {
        return { valid: false, message: fallback };
      }
      if (rule.min !== undefined && numeric < rule.min) return { valid: false, message: fallback };
      if (rule.max !== undefined && numeric > rule.max) return { valid: false, message: fallback };
      return { valid: true };
    }
    case "decimal": {
      const numeric = parseNumericInput(input);
      if (numeric === null) return { valid: false, message: fallback };
      if (rule.min !== undefined && numeric < rule.min) return { valid: false, message: fallback };
      if (rule.max !== undefined && numeric > rule.max) return { valid: false, message: fallback };
      return { valid: true };
    }
    case "date": {
      const parsed = Date.parse(input);
      if (!Number.isFinite(parsed)) return { valid: false, message: fallback };
      const serial = parsed / 86400000;
      if (rule.min !== undefined && serial < rule.min) return { valid: false, message: fallback };
      if (rule.max !== undefined && serial > rule.max) return { valid: false, message: fallback };
      return { valid: true };
    }
    case "custom": {
      // Human: Lightweight custom checks — numeric comparisons like =A1>0 or truthy non-empty.
      // Agent: ACCEPTS non-empty input when formula absent; REJECTS blank when formula present.
      if (!rule.formula) return { valid: input.length > 0 };
      const formula = rule.formula.trim();
      const numeric = parseNumericInput(input);
      const gt = />(\s*)(-?\d+(?:\.\d+)?)/.exec(formula);
      if (gt && numeric !== null) {
        return numeric > Number(gt[2]) ? { valid: true } : { valid: false, message: fallback };
      }
      const lt = /<(\s*)(-?\d+(?:\.\d+)?)/.exec(formula);
      if (lt && numeric !== null) {
        return numeric < Number(lt[2]) ? { valid: true } : { valid: false, message: fallback };
      }
      return input.length > 0 ? { valid: true } : { valid: false, message: fallback };
    }
    case "textLength": {
      const length = input.length;
      if (rule.min !== undefined && length < rule.min) return { valid: false, message: fallback };
      if (rule.max !== undefined && length > rule.max) return { valid: false, message: fallback };
      return { valid: true };
    }
    default:
      return { valid: true };
  }
}

// Human: Parse comma-separated list from Data Validation dialog into rule.values.
// Agent: SPLITS on comma; TRIMS entries for list-type rules.
export function parseValidationListInput(raw: string): string[] {
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}
