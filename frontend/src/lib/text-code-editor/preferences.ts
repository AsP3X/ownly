// Human: Persist modern editor preferences (font, wrap, minimap, indent) across sessions.
// Agent: READS/WRITES localStorage JSON; MERGES with defaults when partial or invalid.

export const EDITOR_PREFERENCES_STORAGE_KEY = "ownly-code-editor-preferences.v1";

export type EditorRenderWhitespace = "none" | "boundary" | "selection" | "trailing" | "all";

export type EditorPreferences = {
  tabSize: number;
  insertSpaces: boolean;
  wordWrap: boolean;
  minimap: boolean;
  fontSize: number;
  lineNumbers: boolean;
  stickyScroll: boolean;
  bracketPairColorization: boolean;
  renderWhitespace: EditorRenderWhitespace;
  smoothScrolling: boolean;
  cursorBlinking: "blink" | "smooth" | "phase" | "expand" | "solid";
  formatOnPaste: boolean;
  formatOnType: boolean;
};

export const DEFAULT_EDITOR_PREFERENCES: EditorPreferences = {
  tabSize: 2,
  insertSpaces: true,
  wordWrap: false,
  minimap: true,
  fontSize: 14,
  lineNumbers: true,
  stickyScroll: true,
  bracketPairColorization: true,
  renderWhitespace: "selection",
  smoothScrolling: true,
  cursorBlinking: "smooth",
  formatOnPaste: true,
  formatOnType: false,
};

const FONT_SIZE_MIN = 10;
const FONT_SIZE_MAX = 28;

function clampFontSize(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_EDITOR_PREFERENCES.fontSize;
  return Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, Math.round(value)));
}

function clampTabSize(value: number): number {
  if (value === 4 || value === 8) return value;
  return 2;
}

function isRenderWhitespace(value: unknown): value is EditorRenderWhitespace {
  return (
    value === "none" ||
    value === "boundary" ||
    value === "selection" ||
    value === "trailing" ||
    value === "all"
  );
}

// Human: Load saved editor preferences with safe defaults for missing keys.
// Agent: READS localStorage; RETURNS merged EditorPreferences.
export function readEditorPreferences(): EditorPreferences {
  if (typeof window === "undefined") return { ...DEFAULT_EDITOR_PREFERENCES };
  try {
    const raw = window.localStorage.getItem(EDITOR_PREFERENCES_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_EDITOR_PREFERENCES };
    const parsed = JSON.parse(raw) as Partial<EditorPreferences>;
    return {
      tabSize: clampTabSize(typeof parsed.tabSize === "number" ? parsed.tabSize : 2),
      insertSpaces:
        typeof parsed.insertSpaces === "boolean"
          ? parsed.insertSpaces
          : DEFAULT_EDITOR_PREFERENCES.insertSpaces,
      wordWrap:
        typeof parsed.wordWrap === "boolean"
          ? parsed.wordWrap
          : DEFAULT_EDITOR_PREFERENCES.wordWrap,
      minimap:
        typeof parsed.minimap === "boolean"
          ? parsed.minimap
          : DEFAULT_EDITOR_PREFERENCES.minimap,
      fontSize: clampFontSize(
        typeof parsed.fontSize === "number"
          ? parsed.fontSize
          : DEFAULT_EDITOR_PREFERENCES.fontSize,
      ),
      lineNumbers:
        typeof parsed.lineNumbers === "boolean"
          ? parsed.lineNumbers
          : DEFAULT_EDITOR_PREFERENCES.lineNumbers,
      stickyScroll:
        typeof parsed.stickyScroll === "boolean"
          ? parsed.stickyScroll
          : DEFAULT_EDITOR_PREFERENCES.stickyScroll,
      bracketPairColorization:
        typeof parsed.bracketPairColorization === "boolean"
          ? parsed.bracketPairColorization
          : DEFAULT_EDITOR_PREFERENCES.bracketPairColorization,
      renderWhitespace: isRenderWhitespace(parsed.renderWhitespace)
        ? parsed.renderWhitespace
        : DEFAULT_EDITOR_PREFERENCES.renderWhitespace,
      smoothScrolling:
        typeof parsed.smoothScrolling === "boolean"
          ? parsed.smoothScrolling
          : DEFAULT_EDITOR_PREFERENCES.smoothScrolling,
      cursorBlinking:
        parsed.cursorBlinking === "blink" ||
        parsed.cursorBlinking === "smooth" ||
        parsed.cursorBlinking === "phase" ||
        parsed.cursorBlinking === "expand" ||
        parsed.cursorBlinking === "solid"
          ? parsed.cursorBlinking
          : DEFAULT_EDITOR_PREFERENCES.cursorBlinking,
      formatOnPaste:
        typeof parsed.formatOnPaste === "boolean"
          ? parsed.formatOnPaste
          : DEFAULT_EDITOR_PREFERENCES.formatOnPaste,
      formatOnType:
        typeof parsed.formatOnType === "boolean"
          ? parsed.formatOnType
          : DEFAULT_EDITOR_PREFERENCES.formatOnType,
    };
  } catch {
    return { ...DEFAULT_EDITOR_PREFERENCES };
  }
}

// Human: Persist editor preferences after settings or toolbar changes.
// Agent: WRITES localStorage; SWALLOWS quota / private-mode errors.
export function writeEditorPreferences(preferences: EditorPreferences): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      EDITOR_PREFERENCES_STORAGE_KEY,
      JSON.stringify({
        ...preferences,
        tabSize: clampTabSize(preferences.tabSize),
        fontSize: clampFontSize(preferences.fontSize),
      }),
    );
  } catch {
    // Human: Private mode or full quota — editor still works without persistence.
  }
}

export { FONT_SIZE_MIN, FONT_SIZE_MAX, clampFontSize };
