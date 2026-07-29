// Human: Serialize editor HTML back into RTF so Save writes a real .rtf document, not source markup.
// Agent: WALKS DOM via DOMParser; BUILDS font/color tables; EMITS rtf1 with char and paragraph controls.

type Rgb = { r: number; g: number; b: number };

function parseCssColor(value: string | null | undefined): Rgb | null {
  if (!value) return null;
  const v = value.trim().toLowerCase();
  if (!v || v === "inherit" || v === "transparent" || v === "initial") return null;
  const hex = v.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const h = hex[1]!;
    if (h.length === 3) {
      return {
        r: Number.parseInt(h[0]! + h[0]!, 16),
        g: Number.parseInt(h[1]! + h[1]!, 16),
        b: Number.parseInt(h[2]! + h[2]!, 16),
      };
    }
    return {
      r: Number.parseInt(h.slice(0, 2), 16),
      g: Number.parseInt(h.slice(2, 4), 16),
      b: Number.parseInt(h.slice(4, 6), 16),
    };
  }
  const rgb = v.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (rgb) {
    return {
      r: Number(rgb[1]),
      g: Number(rgb[2]),
      b: Number(rgb[3]),
    };
  }
  return null;
}

function parseFontSizeToHalfPoints(value: string | null | undefined): number | null {
  if (!value) return null;
  const v = value.trim().toLowerCase();
  const pt = v.match(/^([\d.]+)\s*pt$/);
  if (pt) return Math.round(Number(pt[1]) * 2);
  const px = v.match(/^([\d.]+)\s*px$/);
  if (px) return Math.round((Number(px[1]) * 72) / 96 * 2);
  const em = v.match(/^([\d.]+)\s*em$/);
  if (em) return Math.round(Number(em[1]) * 24);
  const num = Number.parseFloat(v);
  if (Number.isFinite(num) && num > 0) return Math.round(num * 2);
  return null;
}

function rtfEscapeText(text: string): string {
  let out = "";
  for (const char of text) {
    if (char === "\\") {
      out += "\\\\";
      continue;
    }
    if (char === "{") {
      out += "\\{";
      continue;
    }
    if (char === "}") {
      out += "\\}";
      continue;
    }
    if (char === "\n") {
      out += "\\par\n";
      continue;
    }
    if (char === "\t") {
      out += "\\tab ";
      continue;
    }
    if (char === "\u00a0") {
      out += "\\~";
      continue;
    }
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x20) continue;
    if (code <= 0x7f) {
      out += char;
      continue;
    }
    // Unicode with ANSI replacement '?'
    let u = code;
    if (u > 32767) u -= 65536;
    out += `\\u${u}?`;
  }
  return out;
}

function normalizeFontFamily(family: string | null | undefined): string {
  if (!family) return "Helvetica";
  const first = family.split(",")[0]?.trim().replace(/^["']|["']$/g, "");
  return first || "Helvetica";
}

type CharFmt = {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  superScript: boolean;
  subScript: boolean;
  font: string;
  fontSizeHalfPoints: number;
  color: Rgb | null;
  highlight: Rgb | null;
};

const DEFAULT_FMT: CharFmt = {
  bold: false,
  italic: false,
  underline: false,
  strike: false,
  superScript: false,
  subScript: false,
  font: "Helvetica",
  fontSizeHalfPoints: 24,
  color: null,
  highlight: null,
};

function colorKey(c: Rgb | null): string {
  if (!c) return "";
  return `${c.r},${c.g},${c.b}`;
}

// Human: Turn editor HTML into a standard RTF 1.0 document with font and color tables.
// Agent: USES DOMParser in browser; FALLS BACK to escaped plaintext when DOM is unavailable.
export function htmlToRtf(html: string): string {
  if (typeof DOMParser === "undefined") {
    return wrapPlainRtf(html.replace(/<[^>]+>/g, ""));
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(
    `<div id="ownly-rtf-root">${html || "<p><br></p>"}</div>`,
    "text/html",
  );
  const root = doc.getElementById("ownly-rtf-root");
  if (!root) return wrapPlainRtf("");

  const fonts: string[] = ["Helvetica"];
  const colors: Rgb[] = [{ r: 0, g: 0, b: 0 }];
  const fontIndex = new Map<string, number>([["Helvetica", 0]]);
  const colorIndex = new Map<string, number>([["0,0,0", 0]]);

  const ensureFont = (name: string) => {
    const key = name || "Helvetica";
    const existing = fontIndex.get(key);
    if (existing !== undefined) return existing;
    const idx = fonts.length;
    fonts.push(key);
    fontIndex.set(key, idx);
    return idx;
  };

  const ensureColor = (color: Rgb | null) => {
    if (!color) return 0;
    const key = colorKey(color);
    const existing = colorIndex.get(key);
    if (existing !== undefined) return existing;
    const idx = colors.length;
    colors.push(color);
    colorIndex.set(key, idx);
    return idx;
  };

  let body = "";

  const emitRun = (text: string, fmt: CharFmt) => {
    if (!text) return;
    const f = ensureFont(fmt.font);
    const cf = ensureColor(fmt.color);
    const cb = ensureColor(fmt.highlight);
    let prefix = `\\f${f}\\fs${fmt.fontSizeHalfPoints}`;
    prefix += fmt.bold ? "\\b" : "\\b0";
    prefix += fmt.italic ? "\\i" : "\\i0";
    prefix += fmt.underline ? "\\ul" : "\\ulnone";
    prefix += fmt.strike ? "\\strike" : "\\strike0";
    if (fmt.superScript) prefix += "\\super";
    else if (fmt.subScript) prefix += "\\sub";
    else prefix += "\\nosupersub";
    if (cf > 0) prefix += `\\cf${cf}`;
    else prefix += "\\cf0";
    if (cb > 0) prefix += `\\highlight${cb}`;
    body += `{${prefix} ${rtfEscapeText(text)}}`;
  };

  const styleOf = (el: Element): CSSStyleDeclaration | null => {
    // jsdom / browser both expose style on HTMLElement
    return (el as HTMLElement).style ?? null;
  };

  const mergeFmt = (base: CharFmt, el: Element): CharFmt => {
    const next = { ...base };
    const tag = el.tagName.toLowerCase();
    const style = styleOf(el);

    if (tag === "strong" || tag === "b") next.bold = true;
    if (tag === "em" || tag === "i") next.italic = true;
    if (tag === "u") next.underline = true;
    if (tag === "s" || tag === "strike" || tag === "del") next.strike = true;
    if (tag === "sup") next.superScript = true;
    if (tag === "sub") next.subScript = true;

    if (style) {
      const weight = style.fontWeight;
      if (weight === "bold" || weight === "700" || Number(weight) >= 600) next.bold = true;
      if (style.fontStyle === "italic" || style.fontStyle === "oblique") next.italic = true;
      const deco = style.textDecorationLine || style.textDecoration;
      if (deco?.includes("underline")) next.underline = true;
      if (deco?.includes("line-through")) next.strike = true;
      if (style.fontFamily) next.font = normalizeFontFamily(style.fontFamily);
      const size = parseFontSizeToHalfPoints(style.fontSize);
      if (size) next.fontSizeHalfPoints = size;
      const color = parseCssColor(style.color);
      if (color) next.color = color;
      const bg = parseCssColor(style.backgroundColor);
      if (bg) next.highlight = bg;
      if (style.verticalAlign === "super") next.superScript = true;
      if (style.verticalAlign === "sub") next.subScript = true;
    }

    if (tag === "font") {
      const face = el.getAttribute("face");
      if (face) next.font = normalizeFontFamily(face);
      const sizeAttr = el.getAttribute("size");
      if (sizeAttr) {
        const map: Record<string, number> = {
          "1": 16,
          "2": 20,
          "3": 24,
          "4": 28,
          "5": 36,
          "6": 48,
          "7": 72,
        };
        next.fontSizeHalfPoints = map[sizeAttr] ?? next.fontSizeHalfPoints;
      }
      const colorAttr = parseCssColor(el.getAttribute("color"));
      if (colorAttr) next.color = colorAttr;
    }

    return next;
  };

  const alignControl = (el: Element): string => {
    const style = styleOf(el);
    const align =
      style?.textAlign ||
      el.getAttribute("align") ||
      "";
    switch (align) {
      case "center":
        return "\\qc";
      case "right":
        return "\\qr";
      case "justify":
        return "\\qj";
      default:
        return "\\ql";
    }
  };

  const walk = (node: Node, fmt: CharFmt) => {
    if (node.nodeType === Node.TEXT_NODE) {
      emitRun(node.textContent ?? "", fmt);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as Element;
    const tag = el.tagName.toLowerCase();

    if (tag === "br") {
      body += "\\line\n";
      return;
    }

    if (tag === "p" || tag === "div" || tag === "h1" || tag === "h2" || tag === "h3" || tag === "h4" || tag === "li") {
      const nextFmt = mergeFmt(fmt, el);
      if (tag.startsWith("h")) {
        nextFmt.bold = true;
        if (tag === "h1") nextFmt.fontSizeHalfPoints = 36;
        if (tag === "h2") nextFmt.fontSizeHalfPoints = 32;
        if (tag === "h3") nextFmt.fontSizeHalfPoints = 28;
      }
      body += `\\pard${alignControl(el)} `;
      el.childNodes.forEach((child) => walk(child, nextFmt));
      body += "\\par\n";
      return;
    }

    if (tag === "ul" || tag === "ol") {
      el.childNodes.forEach((child) => walk(child, fmt));
      return;
    }

    if (tag === "span" || tag === "font" || tag === "strong" || tag === "b" || tag === "em" || tag === "i" || tag === "u" || tag === "s" || tag === "strike" || tag === "del" || tag === "sup" || tag === "sub" || tag === "a") {
      const nextFmt = mergeFmt(fmt, el);
      el.childNodes.forEach((child) => walk(child, nextFmt));
      return;
    }

    // Generic container
    const nextFmt = mergeFmt(fmt, el);
    el.childNodes.forEach((child) => walk(child, nextFmt));
  };

  root.childNodes.forEach((child) => walk(child, { ...DEFAULT_FMT }));
  if (!body.trim()) {
    body = "\\pard\\ql \\par\n";
  }

  const fonttbl = fonts
    .map((name, index) => `{\\f${index}\\fswiss\\fcharset0 ${name};}`)
    .join("");
  const colortbl =
    ";" +
    colors
      .slice(1)
      .map((c) => `\\red${c.r}\\green${c.g}\\blue${c.b};`)
      .join("");

  return `{\\rtf1\\ansi\\ansicpg1252\\deff0{\\fonttbl${fonttbl}}{\\colortbl${colortbl}}\n${body}\n}`;
}

function wrapPlainRtf(text: string): string {
  return `{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0\\fswiss Helvetica;}}\\f0\\fs24 ${rtfEscapeText(text)}\\par}`;
}
