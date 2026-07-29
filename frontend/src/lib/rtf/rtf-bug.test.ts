import { describe, expect, it } from "vitest";
import { isEffectivelyEmptyHtml } from "@/components/drive/rtf/RtfEditorSurface";
import { htmlToRtf } from "@/lib/rtf/html-to-rtf";
import { rtfToHtml } from "@/lib/rtf/rtf-to-html";

describe("production-like save", () => {
  it("full formatting html survives round trip", () => {
    const html = `<p style="text-align: left; margin: 0 0 0.75em;"><span style="font-family: Helvetica; font-size: 12pt; font-weight: 700;">llö typed more text</span></p>`;
    const rtf = htmlToRtf(html);
    // eslint-disable-next-line no-console
    console.log("RTF", rtf, "LEN", rtf.length);
    const back = rtfToHtml(rtf);
    // eslint-disable-next-line no-console
    console.log("BACK", back);
    expect(isEffectivelyEmptyHtml(back)).toBe(false);
    expect(back).toMatch(/typed more text/i);
  });

  it("broken quoted font-family style still round-trips text", () => {
    const bad = `<p><span style="font-family: "Helvetica"; font-size: 12pt">visible text</span></p>`;
    const rtf = htmlToRtf(bad);
    const back = rtfToHtml(rtf);
    // eslint-disable-next-line no-console
    console.log("bad→rtf→back", back, rtf);
    expect(isEffectivelyEmptyHtml(back)).toBe(false);
    expect(back.toLowerCase()).toContain("visible");
  });

  it("openSpan-style output from rtfToHtml can be re-applied", () => {
    const first = rtfToHtml(
      "{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0\\fswiss Helvetica;}}\\f0\\fs24 hello world\\par}",
    );
    // eslint-disable-next-line no-console
    console.log("FIRST", first);
    expect(first).toContain("hello world");
    // Human: Valid style attribute must not nest double-quotes.
    expect(first).not.toContain('font-family: "');
    expect(first).toContain("font-family: Helvetica");
    // Simulate putting that HTML back into htmlToRtf after save
    const rtf2 = htmlToRtf(first);
    const second = rtfToHtml(rtf2);
    // eslint-disable-next-line no-console
    console.log("SECOND", second);
    expect(second).toContain("hello world");
  });
});
