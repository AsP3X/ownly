// Human: Unit tests for persisted EPUB reader display preferences.
// Agent: ASSERTS read/write round-trip, defaults, and invalid storage recovery.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  EPUB_READER_DEFAULT_PREFERENCES,
  EPUB_READER_PREFERENCES_STORAGE_KEY,
  readEpubReaderPreferences,
  writeEpubReaderPreferences,
} from "@/lib/epub-reader-preference";

describe("epub reader preferences", () => {
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

  it("defaults to medium font, light theme, and comfortable spacing when storage is empty", () => {
    expect(readEpubReaderPreferences()).toEqual(EPUB_READER_DEFAULT_PREFERENCES);
  });

  it("persists preferences across reads", () => {
    writeEpubReaderPreferences({
      fontSize: "large",
      theme: "sepia",
      lineSpacing: "relaxed",
    });

    expect(store.get(EPUB_READER_PREFERENCES_STORAGE_KEY)).toBe(
      JSON.stringify({
        fontSize: "large",
        theme: "sepia",
        lineSpacing: "relaxed",
      }),
    );
    expect(readEpubReaderPreferences()).toEqual({
      fontSize: "large",
      theme: "sepia",
      lineSpacing: "relaxed",
    });
  });

  it("falls back to defaults for invalid stored values", () => {
    store.set(
      EPUB_READER_PREFERENCES_STORAGE_KEY,
      JSON.stringify({
        fontSize: "huge",
        theme: "neon",
        lineSpacing: "wide",
      }),
    );

    expect(readEpubReaderPreferences()).toEqual(EPUB_READER_DEFAULT_PREFERENCES);
  });

  it("merges valid fields and defaults invalid fields from partial storage", () => {
    store.set(
      EPUB_READER_PREFERENCES_STORAGE_KEY,
      JSON.stringify({
        fontSize: "small",
        theme: "invalid",
        lineSpacing: "compact",
      }),
    );

    expect(readEpubReaderPreferences()).toEqual({
      fontSize: "small",
      theme: "light",
      lineSpacing: "compact",
    });
  });

  it("returns defaults when stored JSON is corrupt", () => {
    store.set(EPUB_READER_PREFERENCES_STORAGE_KEY, "{not-json");

    expect(readEpubReaderPreferences()).toEqual(EPUB_READER_DEFAULT_PREFERENCES);
  });
});
