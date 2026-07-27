// Human: Excel ribbon design tokens — Windows Excel title bar + ribbon from real topbar reference.
// Agent: READ by excel-ribbon-primitives, ExcelToolbarTitleBar, ExcelSpreadsheetRibbon.

/** Human: Ownly accent from login-screen variables ($accent-primary). */
export const EXCEL_RIBBON_ACCENT = "#2563EB";

/** Human: Excel brand green (File tab, AutoSave on, title-bar Share). */
export const EXCEL_RIBBON_FILE_TAB = "#107C41";
export const EXCEL_RIBBON_FILE_TAB_HOVER = "#0E6B38";
export const EXCEL_RIBBON_SHARE = "#217346";
export const EXCEL_RIBBON_SHARE_HOVER = "#1A5C38";

/** Human: Office neutral text from real Excel title bar / ribbon controls. */
export const EXCEL_RIBBON_TEXT = "#323130";
export const EXCEL_RIBBON_TEXT_SECONDARY = "#605E5C";
export const EXCEL_RIBBON_TEXT_MUTED = "#888888";

/** Human: Ownly dialog header still uses #1A1A1A / #666666 — ribbon uses Office neutrals above. */
export const EXCEL_RIBBON_OWNLY_TEXT = "#1A1A1A";

/** Human: Soft lavender-gray chrome shared by title bar + tab strip (real Excel topbar). */
export const EXCEL_RIBBON_CHROME_BG = "#F3F0F5";
export const EXCEL_RIBBON_BORDER = "#E1DFDD";
export const EXCEL_RIBBON_GROUP_DIVIDER = "#E1DFDD";

/** Human: Tab strip inherits chrome bg; search field and ribbon content stay white. */
export const EXCEL_RIBBON_TAB_STRIP_BG = EXCEL_RIBBON_CHROME_BG;
export const EXCEL_RIBBON_CONTENT_BG = "#FFFFFF";
export const EXCEL_RIBBON_HOVER = "#E8E4EC";
export const EXCEL_RIBBON_ACTIVE_TAB = "#FFFFFF";
export const EXCEL_RIBBON_SEARCH_BG = "#FFFFFF";
export const EXCEL_RIBBON_SEARCH_BORDER = "#C8C6C4";

/** Human: Optional group caption (hidden in compact layout). */
export const EXCEL_RIBBON_GROUP_LABEL = "#605E5C";

/** Human: Selected tab green underline. */
export const EXCEL_RIBBON_TAB_INDICATOR = "#107C41";

/** Human: Segoe UI stack matching desktop Excel. */
export const EXCEL_RIBBON_FONT = "\"Segoe UI\", Inter, Calibri, Arial, sans-serif";

/** Human: Heights tuned to real Excel title bar + tab row proportions. */
export const EXCEL_RIBBON_TITLE_BAR_HEIGHT_PX = 36;
export const EXCEL_RIBBON_CONTENT_HEIGHT_PX = 96;
export const EXCEL_RIBBON_TAB_HEIGHT_PX = 30;
export const EXCEL_RIBBON_GROUP_HEIGHT_PX = 72;
