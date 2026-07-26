import { describe, expect, it, afterEach } from "vitest";
import {
  applyThemeTint,
  getActiveThemePalette,
  parseThemePaletteFromXml,
  resetActiveThemePalette,
  resolveXlsxColor,
  setActiveThemePalette,
  matchThemeIndex,
} from "@/lib/spreadsheet/excel-theme-colors";

afterEach(() => {
  resetActiveThemePalette();
});

describe("excel-theme-colors", () => {
  it("parses theme1 clrScheme srgb and sysClr values", () => {
    const xml = `<?xml version="1.0"?>
    <a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
      <a:themeElements><a:clrScheme name="Office">
        <a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1>
        <a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>
        <a:dk2><a:srgbClr val="44546A"/></a:dk2>
        <a:lt2><a:srgbClr val="E7E6E6"/></a:lt2>
        <a:accent1><a:srgbClr val="4472C4"/></a:accent1>
        <a:accent2><a:srgbClr val="ED7D31"/></a:accent2>
        <a:accent3><a:srgbClr val="A5A5A5"/></a:accent3>
        <a:accent4><a:srgbClr val="FFC000"/></a:accent4>
        <a:accent5><a:srgbClr val="5B9BD5"/></a:accent5>
        <a:accent6><a:srgbClr val="70AD47"/></a:accent6>
        <a:hlink><a:srgbClr val="0563C1"/></a:hlink>
        <a:folHlink><a:srgbClr val="954F72"/></a:folHlink>
      </a:clrScheme></a:themeElements>
    </a:theme>`;
    const palette = parseThemePaletteFromXml(xml);
    expect(palette[0]).toBe("000000");
    expect(palette[1]).toBe("FFFFFF");
    expect(palette[4]).toBe("4472C4");
    setActiveThemePalette(palette);
    expect(resolveXlsxColor({ theme: 4 })).toBe("#4472C4");
    expect(resolveXlsxColor({ theme: 4, tint: 0.5 })).toMatch(/^#[0-9A-F]{6}$/);
  });

  it("applies positive tint toward white", () => {
    const tinted = applyThemeTint("0000FF", 0.5);
    // halfway toward white → 8080FF-ish
    expect(tinted.startsWith("80") || tinted.startsWith("7F") || tinted.startsWith("81")).toBe(true);
  });

  it("resolves indexed colors and matches theme export helper", () => {
    expect(resolveXlsxColor({ indexed: 2 })).toBe("#FF0000");
    setActiveThemePalette(["112233", "FFFFFF", "000000", "111111", "4472C4"]);
    expect(matchThemeIndex("#4472C4")).toBe(4);
    expect(getActiveThemePalette()[0]).toBe("#112233");
  });
});
