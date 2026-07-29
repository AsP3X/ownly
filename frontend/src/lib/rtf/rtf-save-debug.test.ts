import { describe, expect, it } from "vitest";
import { isEffectivelyEmptyHtml } from "@/components/drive/rtf/RtfEditorSurface";
import { htmlToRtf } from "@/lib/rtf/html-to-rtf";
import { rtfToHtml } from "@/lib/rtf/rtf-to-html";

const SAMPLE = `{\\rtf1\\ansi\\ansicpg1252\\cocoartf2870
\\cocoatextscaling0\\cocoaplatform0{\\fonttbl\\f0\\fswiss\\fcharset0 Helvetica;}
{\\colortbl;\\red255\\green255\\blue255;}
{\\*\\expandedcolortbl;;}
\\pard\\tx720\\pardirnatural\\partightenfactor0
\\f0\\fs24 \\cf0 ll\\'f6jljljljlk}`;

describe("rtf save round-trip", () => {
  it("preserves sample body across rtf→html→rtf→html", () => {
    const html1 = rtfToHtml(SAMPLE);
    expect(html1).toContain("llöjljljljlk");
    const rtf2 = htmlToRtf(html1);
    expect(rtf2.length).toBeGreaterThan(40);
    expect(rtf2).toContain("\\rtf1");
    const html2 = rtfToHtml(rtf2);
    expect(html2).toContain("llö");
    expect(html2.toLowerCase()).toContain("jljljljlk");
  });

  it.each([
    ["<p>hello world</p>", "hello world"],
    ["<div>hello world</div>", "hello world"],
    ["hello world", "hello world"],
    [
      '<p><span style="font-family: Helvetica; font-size: 12pt;">llöjljljljlk</span></p>',
      "llöjljljljlk",
    ],
    [
      '<p style="text-align: left; margin: 0 0 0.75em;"><span style="font-family: &quot;Helvetica&quot;; font-size: 12pt;">llöjljljljlk</span></p>',
      "llöjljljljlk",
    ],
  ])("preserves text for %s", (html, expected) => {
    const rtf = htmlToRtf(html);
    const back = rtfToHtml(rtf);
    expect(back).toContain(expected);
  });

  it("detects empty editor HTML that must not overwrite a document", () => {
    expect(isEffectivelyEmptyHtml("<p><br></p>")).toBe(true);
    expect(isEffectivelyEmptyHtml("<p></p>")).toBe(true);
    expect(isEffectivelyEmptyHtml("")).toBe(true);
    expect(isEffectivelyEmptyHtml("<p>hello</p>")).toBe(false);
  });
});
