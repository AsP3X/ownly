// Human: Default Office theme RGB palette for resolving theme/indexed xlsx colors on import.
// Agent: READ by cellStyleFromXlsx when cell.s uses theme/indexed instead of rgb.

const THEME_RGB = [
  "FFFFFF",
  "000000",
  "E7E6E6",
  "44546A",
  "4472C4",
  "ED7D31",
  "A5A5A5",
  "FFC000",
  "5B9BD5",
  "70AD47",
] as const;

const INDEXED_RGB: Record<number, string> = {
  0: "000000",
  1: "FFFFFF",
  2: "FF0000",
  3: "00FF00",
  4: "0000FF",
  5: "FFFF00",
  6: "FF00FF",
  7: "00FFFF",
  64: "000000",
  65: "FFFFFF",
};

// Human: Apply Excel tint factor to a base RGB triplet.
// Agent: USED when fgColor/bgColor/color specify theme + tint.
function applyTint(rgbHex: string, tint: number): string {
  const r = Number.parseInt(rgbHex.slice(0, 2), 16);
  const g = Number.parseInt(rgbHex.slice(2, 4), 16);
  const b = Number.parseInt(rgbHex.slice(4, 6), 16);
  const adjust = (channel: number) => {
    if (tint < 0) return Math.round(channel * (1 + tint));
    return Math.round(channel + (255 - channel) * tint);
  };
  const toHex = (value: number) => value.toString(16).padStart(2, "0").toUpperCase();
  return `${toHex(adjust(r))}${toHex(adjust(g))}${toHex(adjust(b))}`;
}

// Human: Resolve SheetJS/OOXML color object to #RRGGBB for CSS and export.
// Agent: HANDLES rgb, theme+optional tint, and indexed palette entries.
export function resolveXlsxColor(color: {
  rgb?: string;
  theme?: number;
  tint?: number;
  indexed?: number;
} | undefined): string | undefined {
  if (!color) return undefined;
  if (color.rgb) {
    const cleaned = color.rgb.replace(/^#?/, "").toUpperCase();
    if (cleaned.length === 8) return `#${cleaned.slice(2)}`;
    if (cleaned.length === 6) return `#${cleaned}`;
    return undefined;
  }
  if (typeof color.indexed === "number" && INDEXED_RGB[color.indexed]) {
    return `#${INDEXED_RGB[color.indexed]}`;
  }
  if (typeof color.theme === "number" && color.theme >= 0 && color.theme < THEME_RGB.length) {
    const base = THEME_RGB[color.theme];
    const tinted =
      typeof color.tint === "number" && color.tint !== 0 ? applyTint(base, color.tint) : base;
    return `#${tinted}`;
  }
  return undefined;
}
