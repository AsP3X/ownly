// Human: Office theme + indexed color resolution for xlsx import/export.
// Agent: READS theme1.xml palette; USED by cellStyleFromXlsx and CF OOXML helpers.

// Human: Default Office theme RGB (dk1, lt1, dk2, lt2, accent1–6, hlink, folHlink).
// Agent: FALLBACK when theme1.xml is missing from the package.
const DEFAULT_THEME_RGB = [
  "FFFFFF", // 0 lt1 often white in UI but OOXML maps theme 0 as dk1 — see OFFICE_THEME_ORDER
  "000000",
  "E7E6E6",
  "44546A",
  "4472C4",
  "ED7D31",
  "A5A5A5",
  "FFC000",
  "5B9BD5",
  "70AD47",
  "0563C1",
  "954F72",
] as const;

// Human: OOXML theme index order used by theme="N" on color elements.
// Agent: ALIGNED with a:clrScheme child order in theme1.xml.
const THEME_SCHEME_KEYS = [
  "dk1",
  "lt1",
  "dk2",
  "lt2",
  "accent1",
  "accent2",
  "accent3",
  "accent4",
  "accent5",
  "accent6",
  "hlink",
  "folHlink",
] as const;

// Human: Excel indexed color palette (BIFF/OOXML first 64 + system).
// Agent: INDEXED by indexed="N" when rgb/theme absent.
const INDEXED_RGB: Record<number, string> = {
  0: "000000",
  1: "FFFFFF",
  2: "FF0000",
  3: "00FF00",
  4: "0000FF",
  5: "FFFF00",
  6: "FF00FF",
  7: "00FFFF",
  8: "000000",
  9: "FFFFFF",
  10: "FF0000",
  11: "00FF00",
  12: "0000FF",
  13: "FFFF00",
  14: "FF00FF",
  15: "00FFFF",
  16: "800000",
  17: "008000",
  18: "000080",
  19: "808000",
  20: "800080",
  21: "008080",
  22: "C0C0C0",
  23: "808080",
  24: "9999FF",
  25: "993366",
  26: "FFFFCC",
  27: "CCFFFF",
  28: "660066",
  29: "FF8080",
  30: "0066CC",
  31: "CCCCFF",
  32: "000080",
  33: "FF00FF",
  34: "FFFF00",
  35: "00FFFF",
  36: "800080",
  37: "800000",
  38: "008080",
  39: "0000FF",
  40: "00CCFF",
  41: "CCFFFF",
  42: "CCFFCC",
  43: "FFFF99",
  44: "99CCFF",
  45: "FF99CC",
  46: "CC99FF",
  47: "FFCC99",
  48: "3366FF",
  49: "33CCCC",
  50: "99CC00",
  51: "FFCC00",
  52: "FF9900",
  53: "FF6600",
  54: "666699",
  55: "969696",
  56: "003366",
  57: "339966",
  58: "003300",
  59: "333300",
  60: "993300",
  61: "993366",
  62: "333399",
  63: "333333",
  64: "000000",
  65: "FFFFFF",
};

// Human: Active workbook theme palette (RRGGBB without #) loaded from theme1.xml.
// Agent: SET by parseSpreadsheetBuffer; READ by resolveXlsxColor.
let activeThemeRgb: string[] = [...DEFAULT_THEME_RGB];

// Human: Install theme colors for the workbook currently being parsed/rendered.
// Agent: ACCEPTS #RRGGBB or RRGGBB; FALLBACK keeps defaults for missing slots.
export function setActiveThemePalette(colors: string[] | null | undefined): void {
  if (!colors || colors.length === 0) {
    activeThemeRgb = [...DEFAULT_THEME_RGB];
    return;
  }
  activeThemeRgb = THEME_SCHEME_KEYS.map((_, index) => {
    const raw = colors[index] ?? DEFAULT_THEME_RGB[index] ?? "000000";
    return raw.replace(/^#/, "").toUpperCase().slice(-6).padStart(6, "0");
  });
}

export function getActiveThemePalette(): string[] {
  return activeThemeRgb.map((hex) => `#${hex}`);
}

export function resetActiveThemePalette(): void {
  activeThemeRgb = [...DEFAULT_THEME_RGB];
}

// Human: Apply Excel OOXML tint (-1…1) to a base RGB hex.
// Agent: MATCHES positive tint as blend toward white; negative darkens.
export function applyThemeTint(rgbHex: string, tint: number): string {
  const cleaned = rgbHex.replace(/^#/, "").toUpperCase();
  if (cleaned.length !== 6 || !Number.isFinite(tint) || tint === 0) return cleaned;
  const r = Number.parseInt(cleaned.slice(0, 2), 16);
  const g = Number.parseInt(cleaned.slice(2, 4), 16);
  const b = Number.parseInt(cleaned.slice(4, 6), 16);
  const adjust = (channel: number) => {
    if (tint < 0) return Math.round(channel * (1 + tint));
    return Math.round(channel * (1 - tint) + 255 * tint);
  };
  const toHex = (value: number) =>
    Math.min(255, Math.max(0, value)).toString(16).padStart(2, "0").toUpperCase();
  return `${toHex(adjust(r))}${toHex(adjust(g))}${toHex(adjust(b))}`;
}

function ooxmlColorToRgb(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  const cleaned = raw.replace(/^#?/, "").toUpperCase();
  if (cleaned.length === 8) return cleaned.slice(2);
  if (cleaned.length === 6) return cleaned;
  return undefined;
}

// Human: Parse xl/theme/theme1.xml clrScheme into RRGGBB slots for theme="N".
// Agent: READS srgbClr val or sysClr lastClr; RETURNS 12-length palette.
export function parseThemePaletteFromXml(themeXml: string): string[] {
  const palette: string[] = [];
  for (const key of THEME_SCHEME_KEYS) {
    const block = new RegExp(`<a:${key}>([\\s\\S]*?)</a:${key}>`, "i").exec(themeXml)?.[1] ?? "";
    const srgb = /<a:srgbClr[^>]*val="([^"]+)"/i.exec(block)?.[1];
    const sysLast = /<a:sysClr[^>]*lastClr="([^"]+)"/i.exec(block)?.[1];
    // Human: Some themes use schemeClr nested under solidFill — rare for clrScheme itself.
    const scheme = /<a:schemeClr[^>]*val="([^"]+)"/i.exec(block)?.[1];
    let rgb = ooxmlColorToRgb(srgb ?? sysLast);
    if (!rgb && scheme) {
      // Map named scheme back to default accent if circular.
      const schemeIndex = THEME_SCHEME_KEYS.indexOf(scheme as (typeof THEME_SCHEME_KEYS)[number]);
      rgb = DEFAULT_THEME_RGB[schemeIndex >= 0 ? schemeIndex : 0];
    }
    palette.push(rgb ?? DEFAULT_THEME_RGB[palette.length] ?? "000000");
  }
  return palette;
}

// Human: Load theme1.xml (or theme/theme1.xml) from an xlsx zip buffer into the active palette.
// Agent: CALLED once per parseSpreadsheetBuffer before cellStyleFromXlsx.
export async function loadThemePaletteFromXlsxBuffer(buffer: ArrayBuffer): Promise<string[]> {
  try {
    const { readXlsxZipEntries } = await import("@/lib/spreadsheet/xlsx-ooxml");
    const entries = await readXlsxZipEntries(buffer);
    const themePath =
      [...entries.keys()].find((path) => /xl\/theme\/theme\d+\.xml$/i.test(path)) ??
      "xl/theme/theme1.xml";
    const bytes = entries.get(themePath);
    if (!bytes) {
      resetActiveThemePalette();
      return getActiveThemePalette();
    }
    const xml = new TextDecoder().decode(bytes);
    const palette = parseThemePaletteFromXml(xml);
    setActiveThemePalette(palette);
    return getActiveThemePalette();
  } catch {
    resetActiveThemePalette();
    return getActiveThemePalette();
  }
}

export type XlsxColorInput = {
  rgb?: string;
  theme?: number;
  tint?: number;
  indexed?: number;
  auto?: number | boolean;
};

// Human: Resolve SheetJS/OOXML color object to #RRGGBB for CSS and export.
// Agent: HANDLES rgb, theme+tint (active palette), indexed, and auto.
export function resolveXlsxColor(color: XlsxColorInput | undefined): string | undefined {
  if (!color) return undefined;

  if (color.rgb) {
    const cleaned = color.rgb.replace(/^#?/, "").toUpperCase();
    if (cleaned.length === 8) return `#${cleaned.slice(2)}`;
    if (cleaned.length === 6) return `#${cleaned}`;
    return undefined;
  }

  if (color.auto === 1 || color.auto === true) {
    return "#000000";
  }

  if (typeof color.indexed === "number") {
    // Human: indexed 64/65 are system window/windowText in some files.
    // Agent: MAPS to black/white when unknown.
    if (INDEXED_RGB[color.indexed]) return `#${INDEXED_RGB[color.indexed]}`;
    if (color.indexed === 64) return "#000000";
    if (color.indexed === 65) return "#FFFFFF";
  }

  if (typeof color.theme === "number" && color.theme >= 0) {
    const base =
      activeThemeRgb[color.theme] ??
      DEFAULT_THEME_RGB[color.theme] ??
      activeThemeRgb[0] ??
      "000000";
    const tinted =
      typeof color.tint === "number" && color.tint !== 0 ? applyThemeTint(base, color.tint) : base;
    return `#${tinted}`;
  }

  return undefined;
}

// Human: Map a CSS #RRGGBB back toward theme index when it matches a theme slot (export helper).
// Agent: RETURNS theme index or null when no exact match (use rgb export).
export function matchThemeIndex(cssHex: string | undefined): number | null {
  if (!cssHex) return null;
  const target = cssHex.replace(/^#/, "").toUpperCase().slice(-6);
  const index = activeThemeRgb.findIndex((entry) => entry === target);
  return index >= 0 ? index : null;
}
