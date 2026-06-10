// Human: Unit tests for persisted Excel editor preferences.
// Agent: ASSERTS read/write round-trip for AutoSave via mocked localStorage.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  EXCEL_AUTOSAVE_STORAGE_KEY,
  readExcelAutoSaveEnabled,
  writeExcelAutoSaveEnabled,
} from "@/lib/spreadsheet/excel-editor-preferences";

describe("excel editor preferences", () => {
  const store = new Map<string, string>();

  beforeEach(() => {
    store.clear();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("defaults AutoSave to enabled when storage is empty", () => {
    expect(readExcelAutoSaveEnabled()).toBe(true);
  });

  it("persists disabled AutoSave across reads", () => {
    writeExcelAutoSaveEnabled(false);
    expect(store.get(EXCEL_AUTOSAVE_STORAGE_KEY)).toBe("false");
    expect(readExcelAutoSaveEnabled()).toBe(false);
  });

  it("persists enabled AutoSave across reads", () => {
    writeExcelAutoSaveEnabled(true);
    expect(readExcelAutoSaveEnabled()).toBe(true);
  });
});
