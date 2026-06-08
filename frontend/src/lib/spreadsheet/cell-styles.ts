// Human: Map SheetJS per-cell style objects (cellStyles) into our CellStyle model.
// Agent: READS raw.s from XLSX.read({ cellStyles: true }); RETURNS background/font fields.

import { numberFormatFromXlsxCode, xlsxFormatCodeFromStyle } from "@/lib/spreadsheet/number-formats";
import type { CellStyle, NumberFormat } from "@/lib/spreadsheet/types";

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
  top?: { style?: string; color?: XlsxColor };
  right?: { style?: string; color?: XlsxColor };
  bottom?: { style?: string; color?: XlsxColor };
  left?: { style?: string; color?: XlsxColor };
};

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
  return argbToDisplayHex(fgColor?.rgb) ?? argbToDisplayHex(bgColor?.rgb);
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
  return argbToDisplayHex(side?.color?.rgb);
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
  const style: CellStyle = {
    ...rowDefaults,
    numberFormat: resolvedFormat,
    customNumberFormat: resolvedFormat === "custom" ? zCode : undefined,
  };

  if (!sheetStyle || typeof sheetStyle !== "object") return style;

  const xlsxStyle = sheetStyle as XlsxCellStyle;

  if (xlsxStyle.patternType && xlsxStyle.patternType !== "none") {
    const fill = resolveFillColor(xlsxStyle.fgColor, xlsxStyle.bgColor);
    if (fill) style.backgroundColor = fill;
  }

  const textColor = argbToDisplayHex(xlsxStyle.color?.rgb);
  if (textColor) style.textColor = textColor;
  if (xlsxStyle.bold) style.bold = true;
  if (xlsxStyle.italic) style.italic = true;
  if (xlsxStyle.underline) style.underline = true;
  if (xlsxStyle.horizontal) style.horizontalAlign = mapHorizontalAlign(xlsxStyle.horizontal);
  if (xlsxStyle.vertical) style.verticalAlign = mapVerticalAlign(xlsxStyle.vertical);

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
