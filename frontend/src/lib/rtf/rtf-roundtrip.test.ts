// Human: Smoke tests for RTF ↔ HTML conversion used by the rich-text editor.
// Agent: RUNS under vitest; COVERS TextEdit-style sample and basic HTML serialization.

import { describe, expect, it } from "vitest";
import { htmlToRtf } from "@/lib/rtf/html-to-rtf";
import { rtfToHtml } from "@/lib/rtf/rtf-to-html";
import { isRtfPreviewMime, looksLikeRtfContent } from "@/lib/rtf/rtf-detect";

const SAMPLE_RTF = `{\\rtf1\\ansi\\ansicpg1252\\cocoartf2870
\\cocoatextscaling0\\cocoaplatform0{\\fonttbl\\f0\\fswiss\\fcharset0 Helvetica;}
{\\colortbl;\\red255\\green255\\blue255;}
{\\*\\expandedcolortbl;;}
\\paperw11900\\paperh16840\\margl1440\\margr1440\\vieww11520\\viewh8400\\viewkind0
\\pard\\tx720\\tx1440\\tx2160\\tx2880\\tx3600\\tx4320\\tx5040\\tx5760\\tx6480\\tx7200\\tx7920\\tx8640\\pardirnatural\\partightenfactor0

\\f0\\fs24 \\cf0 ll\\'f6jljljljlk}`;

describe("rtf detect", () => {
  it("detects rtf by extension and mime", () => {
    expect(isRtfPreviewMime("application/rtf", "notes.rtf")).toBe(true);
    expect(isRtfPreviewMime("text/plain", "notes.rtf")).toBe(true);
    expect(isRtfPreviewMime("text/plain", "notes.txt")).toBe(false);
    expect(looksLikeRtfContent(SAMPLE_RTF)).toBe(true);
  });
});

describe("rtfToHtml", () => {
  it("renders TextEdit sample body text with ö", () => {
    const html = rtfToHtml(SAMPLE_RTF);
    expect(html).toContain("llöjljljljlk");
    expect(html).not.toContain("\\rtf1");
    expect(html).toContain("<p");
  });
});

describe("htmlToRtf", () => {
  it("emits rtf wrapper and preserves unicode text", () => {
    const rtf = htmlToRtf(`<p style="text-align: left;">llöjljljljlk</p>`);
    expect(rtf.startsWith("{\\rtf1")).toBe(true);
    expect(rtf).toContain("\\u");
    expect(looksLikeRtfContent(rtf)).toBe(true);
  });

  it("round-trips simple bold text content", () => {
    const rtf = htmlToRtf(`<p><strong>Hello</strong> world</p>`);
    const html = rtfToHtml(rtf);
    expect(html.toLowerCase()).toContain("hello");
    expect(html.toLowerCase()).toContain("world");
  });
});
