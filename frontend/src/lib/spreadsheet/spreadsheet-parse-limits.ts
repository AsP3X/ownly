// Human: Guardrails for untrusted spreadsheet bytes before SheetJS parsing runs.
// Agent: ENFORCES max byte budgets and parse timeouts for editor vs thumbnail paths.

export const SPREADSHEET_EDITOR_PARSE_MAX_BYTES = 32 * 1024 * 1024;
export const SPREADSHEET_THUMBNAIL_PARSE_MAX_BYTES = 8 * 1024 * 1024;
export const SPREADSHEET_EDITOR_PARSE_TIMEOUT_MS = 30_000;
export const SPREADSHEET_THUMBNAIL_PARSE_TIMEOUT_MS = 10_000;

export class SpreadsheetParseLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SpreadsheetParseLimitError";
  }
}

// Human: Reject oversized uploads before handing bytes to SheetJS.
// Agent: THROWS SpreadsheetParseLimitError when buffer exceeds the caller budget.
export function assertSpreadsheetBufferWithinLimit(
  buffer: ArrayBuffer,
  maxBytes: number,
): void {
  if (buffer.byteLength > maxBytes) {
    const maxMb = Math.round(maxBytes / (1024 * 1024));
    throw new SpreadsheetParseLimitError(
      `Spreadsheet exceeds the ${maxMb} MB client parsing limit.`,
    );
  }
}
