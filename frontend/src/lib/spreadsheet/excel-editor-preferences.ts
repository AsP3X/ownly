// Human: Persisted Excel dialog UI preferences (AutoSave toggle) across sessions.
// Agent: READ/WRITE localStorage; USED by ExcelSpreadsheetDialog on mount and toggle change.

export const EXCEL_AUTOSAVE_STORAGE_KEY = "ownly-excel-autosave-enabled";

function readStorageValue(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorageValue(key: string, value: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // localStorage may be unavailable in private mode or some test runners.
  }
}

// Human: Load whether AutoSave was last enabled in the Excel editor.
// Agent: READS localStorage; DEFAULT true when unset (matches first-run behavior).
export function readExcelAutoSaveEnabled(): boolean {
  const stored = readStorageValue(EXCEL_AUTOSAVE_STORAGE_KEY);
  if (stored === "false") return false;
  if (stored === "true") return true;
  return true;
}

// Human: Remember AutoSave toggle for the next spreadsheet dialog open.
// Agent: WRITES "true" | "false" string to localStorage.
export function writeExcelAutoSaveEnabled(enabled: boolean): void {
  writeStorageValue(EXCEL_AUTOSAVE_STORAGE_KEY, enabled ? "true" : "false");
}
