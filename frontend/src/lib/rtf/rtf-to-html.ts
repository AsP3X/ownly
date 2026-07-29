// Human: Convert RTF source into HTML for the WYSIWYG rich-text editor surface.
// Agent: TOKENIZES RTF; TRACKS font/color/char/paragraph state; RETURNS sanitized HTML string.

type CharState = {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  superScript: boolean;
  subScript: boolean;
  fontIndex: number;
  fontSizeHalfPoints: number;
  colorIndex: number;
  highlightIndex: number;
};

type ParaState = {
  align: "left" | "center" | "right" | "justify";
};

type Color = { r: number; g: number; b: number };

const DEFAULT_CHAR: CharState = {
  bold: false,
  italic: false,
  underline: false,
  strike: false,
  superScript: false,
  subScript: false,
  fontIndex: 0,
  fontSizeHalfPoints: 24,
  colorIndex: 0,
  highlightIndex: 0,
};

const DEFAULT_PARA: ParaState = { align: "left" };

function cloneChar(state: CharState): CharState {
  return { ...state };
}

function clonePara(state: ParaState): ParaState {
  return { ...state };
}

function hexByte(input: string): number {
  return Number.parseInt(input, 16);
}

// Human: Decode RTF \'hh hex escapes using the document code page (default Windows-1252-ish).
// Agent: READS two hex digits; RETURNS a JS string character.
function decodeHexEscape(hex: string): string {
  const code = hexByte(hex);
  if (!Number.isFinite(code)) return "";
  // Human: Latin-1 / Windows-1252 overlap for the common TextEdit range used in Ownly samples.
  if (code >= 0x80 && code <= 0x9f) {
    // Windows-1252 C1 range approximations for frequent chars.
    const map: Record<number, string> = {
      0x80: "€",
      0x82: "‚",
      0x83: "ƒ",
      0x84: "„",
      0x85: "…",
      0x86: "†",
      0x87: "‡",
      0x88: "ˆ",
      0x89: "‰",
      0x8a: "Š",
      0x8b: "‹",
      0x8c: "Œ",
      0x8e: "Ž",
      0x91: "‘",
      0x92: "’",
      0x93: "“",
      0x94: "”",
      0x95: "•",
      0x96: "–",
      0x97: "—",
      0x98: "˜",
      0x99: "™",
      0x9a: "š",
      0x9b: "›",
      0x9c: "œ",
      0x9e: "ž",
      0x9f: "Ÿ",
    };
    return map[code] ?? String.fromCharCode(code);
  }
  return String.fromCharCode(code);
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function colorCss(color: Color | undefined): string | null {
  if (!color) return null;
  return `rgb(${color.r}, ${color.g}, ${color.b})`;
}

function sanitizeCssFontName(font: string | undefined): string {
  const cleaned = (font ?? "Helvetica").replace(/[;"'<>\\]/g, "").trim();
  return cleaned || "Helvetica";
}

function isNearWhite(color: Color | undefined): boolean {
  if (!color) return false;
  return color.r >= 250 && color.g >= 250 && color.b >= 250;
}

function openSpan(char: CharState, fonts: string[], colors: Color[]): string {
  const styles: string[] = [];
  // Human: Never nest double-quotes inside style="..." — that truncates the attribute and can hide text in the editor.
  // Agent: USES unquoted sanitized family list so contenteditable innerHTML stays valid HTML.
  styles.push(`font-family: ${sanitizeCssFontName(fonts[char.fontIndex])}, sans-serif`);
  styles.push(`font-size: ${Math.max(8, char.fontSizeHalfPoints / 2)}pt`);
  if (char.bold) styles.push("font-weight: 700");
  if (char.italic) styles.push("font-style: italic");
  const decorations: string[] = [];
  if (char.underline) decorations.push("underline");
  if (char.strike) decorations.push("line-through");
  if (decorations.length) styles.push(`text-decoration: ${decorations.join(" ")}`);
  if (char.superScript) styles.push("vertical-align: super", "font-size: 0.75em");
  if (char.subScript) styles.push("vertical-align: sub", "font-size: 0.75em");
  const fgColor = colors[char.colorIndex];
  const fg = colorCss(fgColor);
  // Human: Skip near-white text colors (common TextEdit auto color tables) so text stays visible on white paper.
  if (fg && char.colorIndex > 0 && !isNearWhite(fgColor)) styles.push(`color: ${fg}`);
  const bgColor = colors[char.highlightIndex];
  const bg = colorCss(bgColor);
  if (bg && char.highlightIndex > 0 && !isNearWhite(bgColor)) styles.push(`background-color: ${bg}`);
  return `<span style="${styles.join("; ")}">`;
}

// Human: Parse RTF into semantic HTML paragraphs for contenteditable editing.
// Agent: STACK-based RTF reader; SKIPS binary/pict destinations; EMITS <p> + styled <span> HTML.
export function rtfToHtml(rtf: string): string {
  if (!rtf || !rtf.includes("\\rtf")) {
    return `<p>${escapeHtml(rtf)}</p>`;
  }

  const fonts: string[] = ["Helvetica"];
  const colors: Color[] = [{ r: 0, g: 0, b: 0 }];
  let i = 0;
  const len = rtf.length;

  type Frame = {
    destination: string | null;
    skip: boolean;
    char: CharState;
    para: ParaState;
  };

  const stack: Frame[] = [
    {
      destination: null,
      skip: false,
      char: cloneChar(DEFAULT_CHAR),
      para: clonePara(DEFAULT_PARA),
    },
  ];

  let html = "";
  let paraOpen = false;
  let spanOpen = false;
  let currentSpanKey = "";
  let ucSkip = 1;
  let pendingUnicodeSkip = 0;

  const top = () => stack[stack.length - 1]!;

  const ensurePara = () => {
    if (paraOpen) return;
    const align = top().para.align;
    html += `<p style="text-align: ${align}; margin: 0 0 0.75em;">`;
    paraOpen = true;
    spanOpen = false;
    currentSpanKey = "";
  };

  const closeSpan = () => {
    if (spanOpen) {
      html += "</span>";
      spanOpen = false;
      currentSpanKey = "";
    }
  };

  const closePara = () => {
    closeSpan();
    if (paraOpen) {
      html += "</p>";
      paraOpen = false;
    }
  };

  const spanKey = (char: CharState) =>
    [
      char.bold,
      char.italic,
      char.underline,
      char.strike,
      char.superScript,
      char.subScript,
      char.fontIndex,
      char.fontSizeHalfPoints,
      char.colorIndex,
      char.highlightIndex,
    ].join("|");

  const emitText = (text: string) => {
    if (!text || top().skip) return;
    ensurePara();
    const key = spanKey(top().char);
    if (!spanOpen || key !== currentSpanKey) {
      closeSpan();
      html += openSpan(top().char, fonts, colors);
      spanOpen = true;
      currentSpanKey = key;
    }
    html += escapeHtml(text);
  };

  const parseControl = (): { name: string; param: number | null; delimiter?: string } => {
    // Human: After backslash — control word or symbol.
    let name = "";
    let param: number | null = null;
    if (i >= len) return { name: "", param: null };
    const first = rtf[i]!;
    if (!/[a-zA-Z]/.test(first)) {
      // Symbol control like \{ \} \\ \'
      name = first;
      i += 1;
      return { name, param: null };
    }
    while (i < len && /[a-zA-Z]/.test(rtf[i]!)) {
      name += rtf[i]!;
      i += 1;
    }
    if (i < len && (rtf[i] === "-" || /[0-9]/.test(rtf[i]!))) {
      let num = "";
      if (rtf[i] === "-") {
        num = "-";
        i += 1;
      }
      while (i < len && /[0-9]/.test(rtf[i]!)) {
        num += rtf[i]!;
        i += 1;
      }
      param = Number.parseInt(num, 10);
    }
    // Optional space delimiter after control word
    if (i < len && rtf[i] === " ") i += 1;
    return { name: name.toLowerCase(), param };
  };

  // Destination helpers for font/color tables
  let inFonttbl = false;
  let inColortbl = false;
  let fontBuffer = "";
  let currentFontIndex = 0;
  let colorBuilding: Partial<Color> = {};

  const flushFont = () => {
    if (!inFonttbl) return;
    const cleaned = fontBuffer.replace(/;$/, "").trim();
    if (cleaned) {
      fonts[currentFontIndex] = cleaned.replace(/^['"]|['"]$/g, "") || "Helvetica";
    }
    fontBuffer = "";
  };

  const flushColor = () => {
    if (!inColortbl) return;
    colors.push({
      r: colorBuilding.r ?? 0,
      g: colorBuilding.g ?? 0,
      b: colorBuilding.b ?? 0,
    });
    colorBuilding = {};
  };

  while (i < len) {
    const ch = rtf[i]!;

    if (pendingUnicodeSkip > 0 && ch !== "\\" && ch !== "{" && ch !== "}") {
      // Skip replacement chars after \uN
      pendingUnicodeSkip -= 1;
      i += 1;
      continue;
    }

    if (ch === "{") {
      const parent = top();
      stack.push({
        destination: parent.destination,
        skip: parent.skip,
        char: cloneChar(parent.char),
        para: clonePara(parent.para),
      });
      i += 1;
      continue;
    }

    if (ch === "}") {
      if (inFonttbl && stack.length <= 2) {
        flushFont();
      }
      if (stack.length > 1) stack.pop();
      // Reset table flags when leaving destinations
      if (stack.every((frame) => frame.destination !== "fonttbl")) inFonttbl = false;
      if (stack.every((frame) => frame.destination !== "colortbl")) inColortbl = false;
      i += 1;
      continue;
    }

    if (ch === "\\") {
      i += 1;
      if (i >= len) break;

      // Hex escape \'hh
      if (rtf[i] === "'") {
        const hex = rtf.slice(i + 1, i + 3);
        i += 3;
        if (inFonttbl) {
          fontBuffer += decodeHexEscape(hex);
        } else {
          emitText(decodeHexEscape(hex));
        }
        continue;
      }

      const { name, param } = parseControl();
      if (!name) continue;

      // Destinations
      if (
        name === "fonttbl" ||
        name === "colortbl" ||
        name === "stylesheet" ||
        name === "info" ||
        name === "pict" ||
        name === "object" ||
        name === "header" ||
        name === "footer" ||
        name === "footnote" ||
        name === "nonshppict" ||
        name === "listtable" ||
        name === "listoverridetable" ||
        name === "*\expandedcolortbl" ||
        name === "filetbl" ||
        name === "xmlnstbl"
      ) {
        top().destination = name;
        top().skip = name !== "fonttbl" && name !== "colortbl";
        if (name === "fonttbl") inFonttbl = true;
        if (name === "colortbl") {
          inColortbl = true;
          colors.length = 0;
          colors.push({ r: 0, g: 0, b: 0 });
        }
        continue;
      }

      if (name === "*" ) {
        // Ignorable destination — mark next destination skip if unknown
        continue;
      }

      if (top().skip && name !== "f" && !inFonttbl && !inColortbl) {
        continue;
      }

      if (inFonttbl) {
        if (name === "f" && param !== null) {
          flushFont();
          currentFontIndex = param;
          fonts[param] = fonts[param] ?? "Helvetica";
          continue;
        }
        // Skip font family class controls
        if (
          name === "fnil" ||
          name === "froman" ||
          name === "fswiss" ||
          name === "fmodern" ||
          name === "fscript" ||
          name === "fdecor" ||
          name === "ftech" ||
          name === "fbidi" ||
          name === "fcharset" ||
          name === "fprq" ||
          name === "cpg"
        ) {
          continue;
        }
      }

      if (inColortbl) {
        if (name === "red" && param !== null) colorBuilding.r = param;
        else if (name === "green" && param !== null) colorBuilding.g = param;
        else if (name === "blue" && param !== null) colorBuilding.b = param;
        continue;
      }

      switch (name) {
        case "par":
        case "line":
          closePara();
          ensurePara();
          break;
        case "pard":
          top().para = clonePara(DEFAULT_PARA);
          break;
        case "plain":
          top().char = cloneChar(DEFAULT_CHAR);
          break;
        case "b":
          top().char.bold = param === null || param !== 0;
          break;
        case "i":
          top().char.italic = param === null || param !== 0;
          break;
        case "ul":
          top().char.underline = param === null || param !== 0;
          break;
        case "ulnone":
          top().char.underline = false;
          break;
        case "strike":
          top().char.strike = param === null || param !== 0;
          break;
        case "super":
          top().char.superScript = true;
          top().char.subScript = false;
          break;
        case "sub":
          top().char.subScript = true;
          top().char.superScript = false;
          break;
        case "nosupersub":
          top().char.superScript = false;
          top().char.subScript = false;
          break;
        case "fs":
          if (param !== null) top().char.fontSizeHalfPoints = param;
          break;
        case "f":
          if (param !== null) top().char.fontIndex = param;
          break;
        case "cf":
          if (param !== null) top().char.colorIndex = param;
          break;
        case "cb":
        case "highlight":
          if (param !== null) top().char.highlightIndex = param;
          break;
        case "ql":
          top().para.align = "left";
          break;
        case "qc":
          top().para.align = "center";
          break;
        case "qr":
          top().para.align = "right";
          break;
        case "qj":
          top().para.align = "justify";
          break;
        case "tab":
          emitText("\t");
          break;
        case "emdash":
          emitText("—");
          break;
        case "endash":
          emitText("–");
          break;
        case "lquote":
          emitText("‘");
          break;
        case "rquote":
          emitText("’");
          break;
        case "ldblquote":
          emitText("“");
          break;
        case "rdblquote":
          emitText("”");
          break;
        case "bullet":
          emitText("•");
          break;
        case "u":
          if (param !== null) {
            let code = param;
            if (code < 0) code += 65536;
            emitText(String.fromCharCode(code));
            pendingUnicodeSkip = ucSkip;
          }
          break;
        case "uc":
          if (param !== null) ucSkip = param;
          break;
        case "{":
        case "}":
        case "\\":
          emitText(name);
          break;
        case "~":
          emitText("\u00a0");
          break;
        case "-":
        case "_":
          // Optional hyphen / non-breaking hyphen
          break;
        default:
          // Ignore unknown controls (page size, cocoartf, etc.)
          break;
      }
      continue;
    }

    // Plain text
    if (ch === "\r") {
      i += 1;
      continue;
    }
    if (ch === "\n") {
      i += 1;
      continue;
    }
    if (inFonttbl) {
      if (ch === ";") {
        flushFont();
        i += 1;
        continue;
      }
      fontBuffer += ch;
      i += 1;
      continue;
    }
    if (inColortbl) {
      if (ch === ";") {
        flushColor();
        i += 1;
        continue;
      }
      i += 1;
      continue;
    }
    if (!top().skip) {
      emitText(ch);
    }
    i += 1;
  }

  closePara();
  if (!html.trim()) {
    return "<p><br></p>";
  }
  return html;
}
