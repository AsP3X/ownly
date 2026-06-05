// Human: Light and dark chrome palettes for the in-browser code editor dialog.
// Agent: READS theme id; RETURNS Tailwind class tokens for shell, panels, and syntax colors.

import type { SyntaxTokenStyle } from "@/lib/text-code-editor/highlight";

export type EditorThemeId = "light" | "dark";

export type EditorThemePreference = EditorThemeId | "auto";

export type EditorTheme = {
  id: EditorThemeId;
  overlay: string;
  shell: string;
  header: string;
  tabActive: string;
  tabInactive: string;
  tabTextActive: string;
  tabTextInactive: string;
  tabCloseActive: string;
  tabCloseInactive: string;
  tabCloseHover: string;
  toolbarIcon: string;
  toolbarIconActive: string;
  surface: string;
  lineNumber: string;
  plainText: string;
  caret: string;
  statusBar: string;
  statusText: string;
  closeButton: string;
  panel: string;
  panelTitle: string;
  panelText: string;
  panelInputBorder: string;
  panelInputBorderFocus: string;
  panelInputBg: string;
  panelInputText: string;
  panelInputTextMuted: string;
  panelInputPlaceholder: string;
  panelChipActive: string;
  panelChipInactive: string;
  panelCheckbox: string;
  loadingText: string;
  syntax: Record<SyntaxTokenStyle, string>;
  searchActive: string;
  searchInactive: string;
  tabIconInactive: string;
  tabIconJs: string;
  tabIconCss: string;
  tabIconJson: string;
};

const LIGHT_SYNTAX: Record<SyntaxTokenStyle, string> = {
  keyword: "text-[#A626A4]",
  plain: "text-[#383A42]",
  function: "text-[#0184BC]",
  string: "text-[#50A14F]",
  class: "text-[#C18401]",
  variable: "text-[#E45649]",
  property: "text-[#986801]",
  number: "text-[#986801]",
  comment: "text-[#A0A1A7]",
  punctuation: "text-[#383A42]",
};

const DARK_SYNTAX: Record<SyntaxTokenStyle, string> = {
  keyword: "text-[#C678DD]",
  plain: "text-[#ABB2BF]",
  function: "text-[#61AFEF]",
  string: "text-[#98C379]",
  class: "text-[#E5C07B]",
  variable: "text-[#E06C75]",
  property: "text-[#D19A66]",
  number: "text-[#D19A66]",
  comment: "text-[#5C6370]",
  punctuation: "text-[#ABB2BF]",
};

export const EDITOR_THEMES: Record<EditorThemeId, EditorTheme> = {
  light: {
    id: "light",
    overlay: "bg-black/30 backdrop-blur-[2px]",
    shell:
      "rounded-2xl border border-[#E5E7EB] bg-[#FFFFFF] shadow-[0_12px_32px_rgba(0,0,0,0.08)]",
    header: "bg-[#F7F8FA]",
    tabActive: "bg-[#FFFFFF]",
    tabInactive: "bg-[#F0F1F4]",
    tabTextActive: "font-medium text-[#1A1A1A]",
    tabTextInactive: "font-normal text-[#888888]",
    tabCloseActive: "text-[#888888]",
    tabCloseInactive: "text-[#BBBBBB]",
    tabCloseHover: "hover:bg-black/5",
    toolbarIcon: "text-[#666666] transition-colors hover:text-[#1A1A1A]",
    toolbarIconActive: "text-[#2563EB]",
    surface: "bg-[#FFFFFF]",
    lineNumber: "text-[#888888]",
    plainText: "text-[#383A42]",
    caret: "caret-[#1A1A1A]",
    statusBar: "border-t border-[#E5E7EB] bg-[#F7F8FA]",
    statusText: "text-[#666666]",
    closeButton:
      "rounded-lg border border-[#E5E7EB] px-3 py-1.5 text-xs font-medium text-[#666666] transition-colors hover:bg-black/5",
    panel:
      "rounded-lg border border-[#E5E7EB] bg-[#FFFFFF] shadow-[0_4px_12px_rgba(0,0,0,0.1)]",
    panelTitle: "text-[#888888]",
    panelText: "text-[#666666]",
    panelInputBorder: "border-[#E5E7EB]",
    panelInputBorderFocus: "border-[#2563EB]",
    panelInputBg: "bg-[#FFFFFF]",
    panelInputText: "text-[#1A1A1A]",
    panelInputTextMuted: "text-[#666666]",
    panelInputPlaceholder: "placeholder:text-[#888888]",
    panelChipActive: "bg-[#2563EB] font-semibold text-white",
    panelChipInactive: "bg-[#F7F8FA] text-[#666666] hover:bg-[#EEF0F3]",
    panelCheckbox: "border-[#E5E7EB] bg-[#FFFFFF] accent-[#2563EB]",
    loadingText: "text-[#666666]",
    syntax: LIGHT_SYNTAX,
    searchActive: "rounded-sm bg-[#FF9100]/35 text-[#9A6700] ring-1 ring-[#FF9100]/50",
    searchInactive: "rounded-sm bg-[#FEF3C7] text-[#92400E] ring-1 ring-[#FCD34D]/80",
    tabIconInactive: "text-[#888888]",
    tabIconJs: "text-[#C18401]",
    tabIconCss: "text-[#0184BC]",
    tabIconJson: "text-[#50A14F]",
  },
  dark: {
    id: "dark",
    overlay: "bg-[#0B0F19]/60 backdrop-blur-[2px]",
    shell:
      "rounded-2xl border border-[#313244] bg-[#1E1E2E] shadow-[0_12px_32px_rgba(0,0,0,0.1)]",
    header: "bg-[#151521]",
    tabActive: "bg-[#1E1E2E]",
    tabInactive: "bg-[#14141F]",
    tabTextActive: "font-medium text-[#CDD6F4]",
    tabTextInactive: "font-normal text-[#565F89]",
    tabCloseActive: "text-[#7F848E]",
    tabCloseInactive: "text-[#3F445B]",
    tabCloseHover: "hover:bg-white/5",
    toolbarIcon: "text-[#A6ADC8] transition-colors hover:text-[#CDD6F4]",
    toolbarIconActive: "text-[#2563EB]",
    surface: "bg-[#1E1E2E]",
    lineNumber: "text-[#565F89]",
    plainText: "text-[#ABB2BF]",
    caret: "caret-[#CDD6F4]",
    statusBar: "border-t border-[#262637] bg-[#151521]",
    statusText: "text-[#A6ADC8]",
    closeButton:
      "rounded-lg border border-[#313244] px-3 py-1.5 text-xs font-medium text-[#A6ADC8] transition-colors hover:bg-white/5",
    panel:
      "rounded-lg border border-[#313244] bg-[#151521] shadow-[0_4px_12px_rgba(0,0,0,0.25)]",
    panelTitle: "text-[#565F89]",
    panelText: "text-[#A6ADC8]",
    panelInputBorder: "border-[#313244]",
    panelInputBorderFocus: "border-[#2563EB]",
    panelInputBg: "bg-[#11111B]",
    panelInputText: "text-[#CDD6F4]",
    panelInputTextMuted: "text-[#A6ADC8]",
    panelInputPlaceholder: "placeholder:text-[#565F89]",
    panelChipActive: "bg-[#2563EB] font-semibold text-white",
    panelChipInactive: "bg-[#11111B] text-[#A6ADC8] hover:bg-[#1E1E2E]",
    panelCheckbox: "border-[#313244] bg-[#11111B] accent-[#2563EB]",
    loadingText: "text-[#A6ADC8]",
    syntax: DARK_SYNTAX,
    searchActive: "rounded-sm bg-[#FF9100]/50 text-[#FFE082] ring-1 ring-[#FF9100]/75",
    searchInactive: "rounded-sm bg-[#FFE082]/33 text-[#FFE082] ring-1 ring-[#FFE082]/55",
    tabIconInactive: "text-[#565F89]",
    tabIconJs: "text-[#E5C07B]",
    tabIconCss: "text-[#61AFEF]",
    tabIconJson: "text-[#98C379]",
  },
};

export const EDITOR_THEME_STORAGE_KEY = "ownly-code-editor-theme";

// Human: Resolve persisted preference — auto follows the app root `.dark` class when unset.
// Agent: READS preference + documentElement; RETURNS concrete light or dark theme id.
export function resolveEditorThemeId(preference: EditorThemePreference): EditorThemeId {
  if (preference === "light" || preference === "dark") return preference;
  if (typeof document === "undefined") return "light";
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

export function getEditorTheme(themeId: EditorThemeId): EditorTheme {
  return EDITOR_THEMES[themeId];
}

// Human: Load saved editor theme preference from localStorage.
// Agent: READS EDITOR_THEME_STORAGE_KEY; RETURNS auto when missing or invalid.
export function readEditorThemePreference(): EditorThemePreference {
  if (typeof window === "undefined") return "auto";
  const stored = window.localStorage.getItem(EDITOR_THEME_STORAGE_KEY);
  if (stored === "light" || stored === "dark" || stored === "auto") return stored;
  return "auto";
}

// Human: Persist editor theme preference for the next dialog open.
// Agent: WRITES EDITOR_THEME_STORAGE_KEY; auto clears the key so app theme wins.
export function writeEditorThemePreference(preference: EditorThemePreference): void {
  if (typeof window === "undefined") return;
  if (preference === "auto") {
    window.localStorage.removeItem(EDITOR_THEME_STORAGE_KEY);
    return;
  }
  window.localStorage.setItem(EDITOR_THEME_STORAGE_KEY, preference);
}
