// Human: Persisted EPUB reader display settings (font, theme, line spacing) per browser.
// Agent: READ/WRITE localStorage JSON; DEFAULT medium font, light theme, comfortable spacing.

export const EPUB_READER_PREFERENCES_STORAGE_KEY = "ownly:epub-reader-preferences";

export type EpubReaderFontSize = "small" | "medium" | "large";
export type EpubReaderTheme = "light" | "dark" | "sepia";
export type EpubReaderLineSpacing = "compact" | "comfortable" | "relaxed";

export type EpubReaderPreferences = {
  fontSize: EpubReaderFontSize;
  theme: EpubReaderTheme;
  lineSpacing: EpubReaderLineSpacing;
};

// Human: First-run defaults before the user opens the settings sheet.
// Agent: USED when localStorage is empty or contains invalid values.
export const EPUB_READER_DEFAULT_PREFERENCES: EpubReaderPreferences = {
  fontSize: "medium",
  theme: "light",
  lineSpacing: "comfortable",
};

const FONT_SIZES = new Set<EpubReaderFontSize>(["small", "medium", "large"]);
const THEMES = new Set<EpubReaderTheme>(["light", "dark", "sepia"]);
const LINE_SPACINGS = new Set<EpubReaderLineSpacing>(["compact", "comfortable", "relaxed"]);

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

// Human: Coerce unknown JSON into a valid preference object, falling back field-by-field.
// Agent: READS partial/invalid stored object; RETURNS merged defaults for bad keys.
function normalizeEpubReaderPreferences(value: unknown): EpubReaderPreferences {
  if (!value || typeof value !== "object") {
    return { ...EPUB_READER_DEFAULT_PREFERENCES };
  }

  const record = value as Record<string, unknown>;
  const fontSize = record.fontSize;
  const theme = record.theme;
  const lineSpacing = record.lineSpacing;

  return {
    fontSize:
      typeof fontSize === "string" && FONT_SIZES.has(fontSize as EpubReaderFontSize)
        ? (fontSize as EpubReaderFontSize)
        : EPUB_READER_DEFAULT_PREFERENCES.fontSize,
    theme:
      typeof theme === "string" && THEMES.has(theme as EpubReaderTheme)
        ? (theme as EpubReaderTheme)
        : EPUB_READER_DEFAULT_PREFERENCES.theme,
    lineSpacing:
      typeof lineSpacing === "string" &&
      LINE_SPACINGS.has(lineSpacing as EpubReaderLineSpacing)
        ? (lineSpacing as EpubReaderLineSpacing)
        : EPUB_READER_DEFAULT_PREFERENCES.lineSpacing,
  };
}

// Human: Load saved reader settings for the next EPUB preview session.
// Agent: READS localStorage JSON; RETURNS defaults when unset or corrupt.
export function readEpubReaderPreferences(): EpubReaderPreferences {
  const raw = readStorageValue(EPUB_READER_PREFERENCES_STORAGE_KEY);
  if (!raw) return { ...EPUB_READER_DEFAULT_PREFERENCES };

  try {
    return normalizeEpubReaderPreferences(JSON.parse(raw) as unknown);
  } catch {
    return { ...EPUB_READER_DEFAULT_PREFERENCES };
  }
}

// Human: Remember reader settings after the user adjusts font, theme, or spacing.
// Agent: WRITES JSON blob to localStorage.
export function writeEpubReaderPreferences(preferences: EpubReaderPreferences): void {
  const normalized = normalizeEpubReaderPreferences(preferences);
  writeStorageValue(EPUB_READER_PREFERENCES_STORAGE_KEY, JSON.stringify(normalized));
}
