// Human: Map SheetJS per-cell style objects (cellStyles) into our CellStyle model.
// Agent: READS raw.s from XLSX.read({ cellStyles: true }); RETURNS background/font fields.

import { formatCellDisplay } from "@/lib/spreadsheet/cells";
import { resolveXlsxColor } from "@/lib/spreadsheet/excel-theme-colors";
import { numberFormatFromXlsxCode, xlsxFormatCodeFromStyle } from "@/lib/spreadsheet/number-formats";
import type { CellStyle, HorizontalAlign, NumberFormat, SheetCell } from "@/lib/spreadsheet/types";

const CELL_STYLE_KEYS: (keyof CellStyle)[] = [
  "bold",
  "italic",
  "underline",
  "horizontalAlign",
  "verticalAlign",
  "numberFormat",
  "customNumberFormat",
  "backgroundColor",
  "textColor",
  "fontFamily",
  "fontSize",
  "wrapText",
  "borderTop",
  "borderRight",
  "borderBottom",
  "borderLeft",
  "borderColor",
  "isHeaderRow",
  "isTotalRow",
];

type XlsxColor = {
  rgb?: string;
  theme?: number;
  tint?: number;
  indexed?: number;
};

export type XlsxCellStyle = {
  patternType?: string;
  fgColor?: XlsxColor;
  bgColor?: XlsxColor;
  color?: XlsxColor;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  horizontal?: string;
  vertical?: string;
  // Human: SheetJS flat font fields from cellStyles import.
  // Agent: MAPPED to fontFamily/fontSize on CellStyle.
  name?: string;
  sz?: number;
  wrapText?: boolean;
  top?: { style?: string; color?: XlsxColor };
  right?: { style?: string; color?: XlsxColor };
  bottom?: { style?: string; color?: XlsxColor };
  left?: { style?: string; color?: XlsxColor };
};

// Human: Merge ribbon style patches onto an existing cell style object.
// Agent: SPREADS partial patch; USED by format painter full style copy.
export function mergeCellStyle(base: CellStyle | undefined, patch: Partial<CellStyle>): CellStyle {
  return { ...(base ?? {}), ...patch };
}

// Human: Apply a toolbar patch where `undefined` explicitly removes a style property.
// Agent: DELETES keys on undefined; USED by ribbon toggles and clear-formatting.
export function applyCellStylePatch(base: CellStyle | undefined, patch: Partial<CellStyle>): CellStyle {
  const next: CellStyle = { ...(base ?? {}) };
  for (const key of CELL_STYLE_KEYS) {
    if (!(key in patch)) continue;
    const value = patch[key];
    if (value === undefined) {
      delete next[key];
    } else {
      (next as Record<keyof CellStyle, CellStyle[keyof CellStyle]>)[key] = value;
    }
  }
  return next;
}

// Human: Patch that clears every modeled style field from a cell.
// Agent: RETURNS all keys undefined for applyCellStylePatch.
export function clearCellStylePatch(): Partial<CellStyle> {
  return Object.fromEntries(CELL_STYLE_KEYS.map((key) => [key, undefined])) as Partial<CellStyle>;
}

// Human: Apply a ribbon style patch to one cell and refresh its display string.
// Agent: SKIPS display rewrite for formula cells — recalculateWorkbook handles those.
export function applyStylePatchToCell(cell: SheetCell, patch: Partial<CellStyle>): SheetCell {
  const style = applyCellStylePatch(cell.style, patch);
  if (cell.formula) {
    return { ...cell, style };
  }
  return {
    ...cell,
    style,
    display: formatCellDisplay(
      cell.value,
      style.numberFormat ?? "general",
      style.customNumberFormat,
    ),
  };
}

// Human: Replace a cell's entire style (Format Painter) after clearing prior formatting.
// Agent: CLEARS all style keys first; THEN applies copied style snapshot.
export function replaceCellStyleOnCell(cell: SheetCell, style: CellStyle): SheetCell {
  const cleared = applyStylePatchToCell(cell, clearCellStylePatch());
  if (Object.keys(style).length === 0) {
    return { ...cleared, style: undefined };
  }
  return applyStylePatchToCell(cleared, style);
}

// Human: Resolve effective horizontal alignment like Excel (explicit style beats type defaults).
// Agent: RETURNS left for text, right for numbers, center when set on style.
export function resolveHorizontalAlign(cell: SheetCell): HorizontalAlign {
  if (cell.style?.horizontalAlign) return cell.style.horizontalAlign;
  if (typeof cell.value === "number") return "right";
  return "left";
}

// Human: Tailwind flex alignment class for the cell container vertical position.
// Agent: MAPS verticalAlign to items-start/center/end; DEFAULT middle like Excel.
export function verticalAlignItemsClass(style: CellStyle | undefined): string {
  switch (style?.verticalAlign) {
    case "top":
      return "items-start";
    case "bottom":
      return "items-end";
    default:
      return "items-center";
  }
}

// Human: Tailwind justify class for cell content horizontal position.
// Agent: MAPS resolveHorizontalAlign to justify-start/center/end.
export function horizontalAlignJustifyClass(cell: SheetCell): string {
  switch (resolveHorizontalAlign(cell)) {
    case "center":
      return "justify-center";
    case "right":
      return "justify-end";
    default:
      return "justify-start";
  }
}

// Human: Effective bold weight — explicit false overrides header-row default bold.
// Agent: USED by grid text and dimension auto-fit measurements.
export function resolveFontWeight(
  style: CellStyle | undefined,
  options?: { headerRow?: boolean; conditionalBold?: boolean },
): number | undefined {
  if (style?.bold === true || options?.conditionalBold) return 700;
  if (style?.bold === false) return 400;
  if (options?.headerRow && style?.bold !== false) return 700;
  return undefined;
}

// Human: Convert OOXML/SheetJS ARGB or RGB hex into #RRGGBB for CSS.
// Agent: STRIPS alpha prefix when present; RETURNS undefined for empty input.
export function argbToDisplayHex(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const cleaned = raw.replace(/^#?/, "").toUpperCase();
  if (cleaned.length === 8) return `#${cleaned.slice(2)}`;
  if (cleaned.length === 6) return `#${cleaned}`;
  return undefined;
}

function resolveFillColor(fgColor?: XlsxColor, bgColor?: XlsxColor): string | undefined {
  return resolveXlsxColor(fgColor) ?? resolveXlsxColor(bgColor);
}

function mapHorizontalAlign(raw: string | undefined): CellStyle["horizontalAlign"] {
  switch (raw) {
    case "center":
      return "center";
    case "right":
      return "right";
    default:
      return "left";
  }
}

function mapVerticalAlign(raw: string | undefined): CellStyle["verticalAlign"] {
  switch (raw) {
    case "center":
      return "middle";
    case "bottom":
      return "bottom";
    default:
      return "top";
  }
}

function hasBorderSide(side: { style?: string } | undefined): boolean {
  return Boolean(side?.style && side.style !== "none");
}

function borderSideColor(side: { color?: XlsxColor } | undefined): string | undefined {
  return resolveXlsxColor(side?.color);
}

// Human: Build CellStyle from SheetJS cell.s plus optional number format hint.
// Agent: MERGES imported fill/font with row-level header defaults from parse.ts.
export function cellStyleFromXlsx(
  sheetStyle: XlsxCellStyle | Record<string, unknown> | undefined,
  numberFormat: NumberFormat,
  rowDefaults: Pick<CellStyle, "bold" | "isHeaderRow" | "isTotalRow">,
  zCode?: string,
): CellStyle {
  const resolvedFormat = zCode ? numberFormatFromXlsxCode(zCode) : numberFormat;
  const preservedFormat =
    zCode && zCode.trim().toLowerCase() !== "general" ? zCode.trim() : undefined;
  const style: CellStyle = {
    ...rowDefaults,
    numberFormat: resolvedFormat,
    customNumberFormat: preservedFormat ?? (resolvedFormat === "custom" ? zCode : undefined),
  };

  if (!sheetStyle || typeof sheetStyle !== "object") return style;

  const xlsxStyle = sheetStyle as XlsxCellStyle;

  if (xlsxStyle.patternType && xlsxStyle.patternType !== "none") {
    const fill = resolveFillColor(xlsxStyle.fgColor, xlsxStyle.bgColor);
    if (fill) style.backgroundColor = fill;
  }

  const textColor = resolveXlsxColor(xlsxStyle.color);
  if (textColor) style.textColor = textColor;
  if (xlsxStyle.bold) style.bold = true;
  if (xlsxStyle.italic) style.italic = true;
  if (xlsxStyle.underline) style.underline = true;
  if (xlsxStyle.horizontal) style.horizontalAlign = mapHorizontalAlign(xlsxStyle.horizontal);
  if (xlsxStyle.vertical) style.verticalAlign = mapVerticalAlign(xlsxStyle.vertical);
  if (typeof xlsxStyle.name === "string" && xlsxStyle.name.trim()) {
    style.fontFamily = xlsxStyle.name.trim();
  }
  if (typeof xlsxStyle.sz === "number" && Number.isFinite(xlsxStyle.sz)) {
    style.fontSize = xlsxStyle.sz;
  }
  if (xlsxStyle.wrapText) style.wrapText = true;

  if (hasBorderSide(xlsxStyle.top)) style.borderTop = true;
  if (hasBorderSide(xlsxStyle.right)) style.borderRight = true;
  if (hasBorderSide(xlsxStyle.bottom)) style.borderBottom = true;
  if (hasBorderSide(xlsxStyle.left)) style.borderLeft = true;
  const borderColor =
    borderSideColor(xlsxStyle.top) ??
    borderSideColor(xlsxStyle.right) ??
    borderSideColor(xlsxStyle.bottom) ??
    borderSideColor(xlsxStyle.left);
  if (borderColor) style.borderColor = borderColor;

  return style;
}

// Human: Convert CellStyle back to SheetJS-compatible style object for xlsx export.
// Agent: WRITES font/fill/alignment fields consumed by XLSX cell.s on serialize.
export function cellStyleToXlsx(style: CellStyle | undefined): Record<string, unknown> | undefined {
  if (!style) return undefined;

  const xlsx: Record<string, unknown> = {};

  if (style.bold) xlsx.bold = true;
  if (style.italic) xlsx.italic = true;
  if (style.underline) xlsx.underline = true;
  if (style.horizontalAlign) xlsx.horizontal = style.horizontalAlign;
  if (style.verticalAlign) {
    xlsx.vertical = style.verticalAlign === "middle" ? "center" : style.verticalAlign;
  }
  if (style.fontFamily) xlsx.name = style.fontFamily;
  if (typeof style.fontSize === "number") xlsx.sz = style.fontSize;
  if (style.wrapText) xlsx.wrapText = true;
  if (style.textColor) {
    const hex = style.textColor.replace("#", "").toUpperCase();
    xlsx.color = { rgb: hex.length === 6 ? `FF${hex}` : hex };
  }
  if (style.backgroundColor) {
    const hex = style.backgroundColor.replace("#", "").toUpperCase();
    xlsx.patternType = "solid";
    xlsx.fgColor = { rgb: hex.length === 6 ? `FF${hex}` : hex };
  }

  const borderHex = (style.borderColor ?? "#1A1A1A").replace("#", "").toUpperCase();
  const borderSide = { style: "thin", color: { rgb: borderHex.length === 6 ? `FF${borderHex}` : borderHex } };
  if (style.borderTop) xlsx.top = borderSide;
  if (style.borderRight) xlsx.right = borderSide;
  if (style.borderBottom) xlsx.bottom = borderSide;
  if (style.borderLeft) xlsx.left = borderSide;

  return Object.keys(xlsx).length > 0 ? xlsx : undefined;
}

// Human: Build SheetJS cell export payload with style + number format code.
// Agent: MERGES cellStyleToXlsx with z property for round-trip.
export function cellExportPayload(style: CellStyle | undefined): {
  s?: Record<string, unknown>;
  z?: string;
} {
  const s = cellStyleToXlsx(style);
  const z = xlsxFormatCodeFromStyle(style?.numberFormat, style?.customNumberFormat);
  return { s, z };
}
