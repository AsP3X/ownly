// Human: Minimal OOXML zip helpers for reading/writing conditional formatting in .xlsx files.
// Agent: READS/WRITES zip entries via deflate-raw streams; PATCHES worksheet + styles XML.

import type { CellRange, CfOperator, ConditionalFormatRule } from "@/lib/spreadsheet/conditional-formatting";
import { createRuleId, parseSqref } from "@/lib/spreadsheet/conditional-formatting";

type ConditionalFormatStyle = {
  backgroundColor?: string;
  textColor?: string;
  bold?: boolean;
};

// Human: Inflate raw deflate bytes from a zip entry (method 8).
// Agent: CALLS DecompressionStream('deflate-raw'); RETURNS uncompressed Uint8Array.
async function inflateRaw(compressed: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream("deflate-raw");
  const stream = new Blob([compressed as BlobPart]).stream().pipeThrough(ds);
  const buffer = await new Response(stream).arrayBuffer();
  return new Uint8Array(buffer);
}

// Human: Deflate bytes for zip storage (method 8).
// Agent: CALLS CompressionStream('deflate-raw'); RETURNS compressed Uint8Array.
async function deflateRaw(uncompressed: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream("deflate-raw");
  const stream = new Blob([uncompressed as BlobPart]).stream().pipeThrough(cs);
  const buffer = await new Response(stream).arrayBuffer();
  return new Uint8Array(buffer);
}

// Human: Parse a zip archive from an .xlsx ArrayBuffer into named entries.
// Agent: SCANS local file headers; INFLATES deflated entries; RETURNS Map path → bytes.
export async function readXlsxZipEntries(buffer: ArrayBuffer): Promise<Map<string, Uint8Array>> {
  const data = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const entries = new Map<string, Uint8Array>();
  let offset = 0;

  while (offset + 30 <= data.length) {
    if (data[offset] !== 0x50 || data[offset + 1] !== 0x4b || data[offset + 2] !== 0x03 || data[offset + 3] !== 0x04) {
      break;
    }

    const method = view.getUint16(offset + 8, true);
    const compressedSize = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const nameStart = offset + 30;
    const name = new TextDecoder().decode(data.subarray(nameStart, nameStart + nameLength));
    const dataStart = nameStart + nameLength + extraLength;
    const compressed = data.subarray(dataStart, dataStart + compressedSize);

    if (method === 0) {
      entries.set(name, compressed);
    } else if (method === 8) {
      entries.set(name, await inflateRaw(compressed));
    }

    offset = dataStart + compressedSize;
  }

  return entries;
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let index = 0; index < data.length; index += 1) {
    crc ^= data[index];
    for (let bit = 0; bit < 8; bit += 1) {
      const mask = -(crc & 1);
      crc = (crc >>> 1) ^ (0xedb88320 & mask);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// Human: Build a new zip archive from entry map (deflate method 8).
// Agent: WRITES local + central headers; RETURNS ArrayBuffer suitable for .xlsx save.
async function writeXlsxZipEntries(entries: Map<string, Uint8Array>): Promise<ArrayBuffer> {
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  for (const [name, uncompressed] of entries) {
    const compressed = await deflateRaw(uncompressed);
    const nameBytes = new TextEncoder().encode(name);
    const local = new Uint8Array(30 + nameBytes.length + compressed.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(8, 8, true);
    localView.setUint32(14, crc32(uncompressed), true);
    localView.setUint32(18, compressed.length, true);
    localView.setUint32(22, uncompressed.length, true);
    localView.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    local.set(compressed, 30 + nameBytes.length);
    localParts.push(local);

    const central = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(10, 8, true);
    centralView.setUint32(16, crc32(uncompressed), true);
    centralView.setUint32(20, compressed.length, true);
    centralView.setUint32(24, uncompressed.length, true);
    centralView.setUint16(28, nameBytes.length, true);
    centralView.setUint32(42, offset, true);
    central.set(nameBytes, 46);
    centralParts.push(central);

    offset += local.length;
  }

  const centralStart = offset;
  let totalLength = offset;
  for (const part of localParts) totalLength += part.length;
  for (const part of centralParts) totalLength += part.length;
  totalLength += 22;

  const output = new Uint8Array(totalLength);
  let writeOffset = 0;
  for (const part of localParts) {
    output.set(part, writeOffset);
    writeOffset += part.length;
  }
  for (const part of centralParts) {
    output.set(part, writeOffset);
    writeOffset += part.length;
  }

  const endView = new DataView(output.buffer, writeOffset, 22);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, entries.size, true);
  endView.setUint16(10, entries.size, true);
  endView.setUint32(12, centralParts.reduce((sum, part) => sum + part.length, 0), true);
  endView.setUint32(16, centralStart, true);

  return output.buffer;
}

function ooxmlColorToHex(raw: string | null): string | undefined {
  if (!raw) return undefined;
  const cleaned = raw.replace(/^#?/, "").toUpperCase();
  if (cleaned.length === 8) return `#${cleaned.slice(2)}`;
  if (cleaned.length === 6) return `#${cleaned}`;
  return undefined;
}

function parseDxfStyles(stylesXml: string): ConditionalFormatStyle[] {
  const styles: ConditionalFormatStyle[] = [];
  const dxfMatches = stylesXml.matchAll(/<dxf>([\s\S]*?)<\/dxf>/g);
  for (const match of dxfMatches) {
    const block = match[1];
    const fgMatch = /<fgColor[^>]*rgb="([^"]+)"/i.exec(block);
    const fontMatch = /<font>[\s\S]*?<color[^>]*rgb="([^"]+)"/i.exec(block);
    const bold = /<b\s*\/>|<b>/.test(block);
    styles.push({
      backgroundColor: ooxmlColorToHex(fgMatch?.[1] ?? null),
      textColor: ooxmlColorToHex(fontMatch?.[1] ?? null),
      bold,
    });
  }
  return styles;
}

function mapOperator(raw: string | null): CfOperator | undefined {
  switch (raw) {
    case "greaterThan":
    case "lessThan":
    case "equal":
    case "notEqual":
    case "between":
    case "containsText":
      return raw === "containsText" ? "textContains" : raw;
    default:
      return undefined;
  }
}

function parseFormulaValue(formula: string): number | string {
  const trimmed = formula.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1);
  }
  const numeric = Number(trimmed);
  return Number.isFinite(numeric) ? numeric : trimmed;
}

function parseWorksheetConditionalRules(sheetXml: string, dxfStyles: ConditionalFormatStyle[]): ConditionalFormatRule[] {
  const rules: ConditionalFormatRule[] = [];
  const blocks = sheetXml.matchAll(/<conditionalFormatting[^>]*sqref="([^"]+)"[^>]*>([\s\S]*?)<\/conditionalFormatting>/g);

  for (const block of blocks) {
    const sqref = block[1];
    const inner = block[2];
    const ranges = parseSqref(sqref);
    if (ranges.length === 0) continue;
    const range = ranges[0];

    const ruleMatches = inner.matchAll(
      /<cfRule[^>]*type="([^"]+)"(?:[^>]*operator="([^"]+)")?[^>]*priority="(\d+)"[^>]*>([\s\S]*?)<\/cfRule>/g,
    );

    for (const ruleMatch of ruleMatches) {
      const type = ruleMatch[1];
      const operator = mapOperator(ruleMatch[2] ?? null);
      const priority = Number.parseInt(ruleMatch[3], 10);
      const body = ruleMatch[4];
      const formulaMatch = /<formula>([\s\S]*?)<\/formula>/.exec(body);
      const formula = formulaMatch?.[1]?.trim() ?? "";
      const dxfMatch = /dxfId="(\d+)"/.exec(ruleMatch[0]);
      const dxfId = dxfMatch ? Number.parseInt(dxfMatch[1], 10) : null;

      if (type === "colorScale") {
        const colors = [...body.matchAll(/<rgb[^>]*rgb="([^"]+)"/g)]
          .map((match) => ooxmlColorToHex(match[1]))
          .filter((color): color is string => Boolean(color));
        if (colors.length >= 2) {
          rules.push({
            id: createRuleId(),
            priority: Number.isFinite(priority) ? priority : rules.length + 1,
            range,
            type: "colorScale",
            colorScale: { minColor: colors[0], maxColor: colors[colors.length - 1] },
          });
        }
        continue;
      }

      if (type === "dataBar") {
        const colorMatch = /<rgb[^>]*rgb="([^"]+)"/.exec(body);
        rules.push({
          id: createRuleId(),
          priority: Number.isFinite(priority) ? priority : rules.length + 1,
          range,
          type: "dataBar",
          dataBar: { color: ooxmlColorToHex(colorMatch?.[1] ?? null) ?? "#2563EB" },
        });
        continue;
      }

      const style = dxfId !== null ? dxfStyles[dxfId] : undefined;
      const cfType = type === "containsText" ? "text" : "cellIs";
      const value = parseFormulaValue(formula);
      const formulas = [...body.matchAll(/<formula>([\s\S]*?)<\/formula>/g)].map((match) =>
        parseFormulaValue(match[1]),
      );

      rules.push({
        id: createRuleId(),
        priority: Number.isFinite(priority) ? priority : rules.length + 1,
        range,
        type: cfType,
        operator: operator ?? "equal",
        value: formulas[0] ?? value,
        value2: typeof formulas[1] === "number" ? formulas[1] : undefined,
        style,
      });
    }
  }

  return rules;
}

function rangeToSqref(range: CellRange): string {
  const colToLetters = (index: number): string => {
    let value = index + 1;
    let label = "";
    while (value > 0) {
      const remainder = (value - 1) % 26;
      label = String.fromCharCode(65 + remainder) + label;
      value = Math.floor((value - 1) / 26);
    }
    return label;
  };

  const start = `${colToLetters(range.startCol)}${range.startRow + 1}`;
  const end = `${colToLetters(range.endCol)}${range.endRow + 1}`;
  return start === end ? start : `${start}:${end}`;
}

function hexToOoxmlArgb(hex: string): string {
  const cleaned = hex.replace("#", "").toUpperCase();
  return cleaned.length === 6 ? `FF${cleaned}` : cleaned;
}

function buildDxfXml(style: ConditionalFormatStyle): string {
  const parts: string[] = ["<dxf>"];
  if (style.backgroundColor) {
    parts.push(
      `<fill><patternFill patternType="solid"><fgColor rgb="${hexToOoxmlArgb(style.backgroundColor)}"/></patternFill></fill>`,
    );
  }
  if (style.textColor || style.bold) {
    parts.push("<font>");
    if (style.bold) parts.push("<b/>");
    if (style.textColor) {
      parts.push(`<color rgb="${hexToOoxmlArgb(style.textColor)}"/>`);
    }
    parts.push("</font>");
  }
  parts.push("</dxf>");
  return parts.join("");
}

function buildConditionalFormattingXml(
  rules: ConditionalFormatRule[],
  dxfOffset: number,
): { xml: string; dxfs: string[] } {
  const grouped = new Map<string, ConditionalFormatRule[]>();
  for (const rule of rules) {
    const key = rangeToSqref(rule.range);
    const list = grouped.get(key) ?? [];
    list.push(rule);
    grouped.set(key, list);
  }

  const dxfs: string[] = [];
  const blocks: string[] = [];
  let dxfIndex = dxfOffset;

  for (const [sqref, rangeRules] of grouped) {
    const ruleXml: string[] = [];
    for (const rule of rangeRules.sort((left, right) => left.priority - right.priority)) {
      if (rule.type === "colorScale" && rule.colorScale) {
        ruleXml.push(
          `<cfRule type="colorScale" priority="${rule.priority}"><colorScale><cfvo type="min"/><cfvo type="max"/><color rgb="${hexToOoxmlArgb(rule.colorScale.minColor)}"/><color rgb="${hexToOoxmlArgb(rule.colorScale.maxColor)}"/></colorScale></cfRule>`,
        );
        continue;
      }
      if (rule.type === "dataBar" && rule.dataBar) {
        ruleXml.push(
          `<cfRule type="dataBar" priority="${rule.priority}"><dataBar><color rgb="${hexToOoxmlArgb(rule.dataBar.color)}"/></dataBar></cfRule>`,
        );
        continue;
      }

      const operator = rule.operator === "textContains" ? "containsText" : rule.operator ?? "equal";
      const cfType = rule.type === "text" ? "containsText" : "cellIs";
      const formulas: string[] = [];
      if (typeof rule.value === "string") {
        formulas.push(`"${rule.value.replace(/"/g, '""')}"`);
      } else if (typeof rule.value === "number") {
        formulas.push(String(rule.value));
      }
      if (typeof rule.value2 === "number") formulas.push(String(rule.value2));

      let dxfAttr = "";
      if (rule.style) {
        dxfs.push(buildDxfXml(rule.style));
        dxfAttr = ` dxfId="${dxfIndex}"`;
        dxfIndex += 1;
      }

      ruleXml.push(
        `<cfRule type="${cfType}" operator="${operator}" priority="${rule.priority}"${dxfAttr}>${formulas.map((formula) => `<formula>${formula}</formula>`).join("")}</cfRule>`,
      );
    }
    blocks.push(`<conditionalFormatting sqref="${sqref}">${ruleXml.join("")}</conditionalFormatting>`);
  }

  return { xml: blocks.join(""), dxfs };
}

function stripExistingConditionalFormatting(sheetXml: string): string {
  return sheetXml.replace(/<conditionalFormatting[\s\S]*?<\/conditionalFormatting>/g, "");
}

function injectDxfs(stylesXml: string, dxfs: string[]): string {
  if (dxfs.length === 0) return stylesXml;
  const dxfBlock = `<dxfs count="${dxfs.length}">${dxfs.join("")}</dxfs>`;

  if (/<dxfs[\s\S]*?<\/dxfs>/.test(stylesXml)) {
    return stylesXml.replace(/<dxfs[\s\S]*?<\/dxfs>/, dxfBlock);
  }
  return stylesXml.replace("</styleSheet>", `${dxfBlock}</styleSheet>`);
}

function countExistingDxfs(stylesXml: string): number {
  const match = /<dxfs[^>]*count="(\d+)"/.exec(stylesXml);
  return match ? Number.parseInt(match[1], 10) : 0;
}

// Human: Import conditional formatting rules from raw .xlsx bytes per worksheet tab.
// Agent: READS zip XML parts; RETURNS map sheetName → ConditionalFormatRule[].
export async function importConditionalFormatsFromXlsx(
  buffer: ArrayBuffer,
  sheetNames: string[],
): Promise<Map<string, ConditionalFormatRule[]>> {
  const entries = await readXlsxZipEntries(buffer);
  const workbookXml = new TextDecoder().decode(entries.get("xl/workbook.xml") ?? new Uint8Array());
  const stylesXml = new TextDecoder().decode(entries.get("xl/styles.xml") ?? new Uint8Array());
  const dxfStyles = parseDxfStyles(stylesXml);
  const result = new Map<string, ConditionalFormatRule[]>();

  const relsXml = new TextDecoder().decode(entries.get("xl/_rels/workbook.xml.rels") ?? new Uint8Array());
  const relMap = new Map<string, string>();
  for (const match of relsXml.matchAll(/Id="([^"]+)"[^>]*Target="([^"]+)"/g)) {
    relMap.set(match[1], match[2].replace(/^\.\//, "xl/"));
  }

  const sheetMatches = [...workbookXml.matchAll(/<sheet[^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g)];
  for (const sheetMatch of sheetMatches) {
    const name = sheetMatch[1];
    if (!sheetNames.includes(name)) continue;
    const target = relMap.get(sheetMatch[2]);
    if (!target) continue;
    const sheetXml = new TextDecoder().decode(entries.get(target) ?? new Uint8Array());
    const rules = parseWorksheetConditionalRules(sheetXml, dxfStyles);
    if (rules.length > 0) result.set(name, rules);
  }

  return result;
}

// Human: Patch a serialized .xlsx buffer with conditional formatting rules before upload.
// Agent: REWRITES worksheet + styles XML inside zip; RETURNS patched ArrayBuffer.
export async function exportConditionalFormatsToXlsx(
  buffer: ArrayBuffer,
  sheets: { name: string; conditionalFormats?: ConditionalFormatRule[] }[],
): Promise<ArrayBuffer> {
  const hasRules = sheets.some((sheet) => (sheet.conditionalFormats?.length ?? 0) > 0);
  if (!hasRules) return buffer;

  const entries = await readXlsxZipEntries(buffer);
  const workbookXml = new TextDecoder().decode(entries.get("xl/workbook.xml") ?? new Uint8Array());
  const stylesXml = new TextDecoder().decode(entries.get("xl/styles.xml") ?? new Uint8Array());
  const relsXml = new TextDecoder().decode(entries.get("xl/_rels/workbook.xml.rels") ?? new Uint8Array());
  const relMap = new Map<string, string>();
  for (const match of relsXml.matchAll(/Id="([^"]+)"[^>]*Target="([^"]+)"/g)) {
    relMap.set(match[1], match[2].replace(/^\.\//, "xl/"));
  }

  const dxfOffset = countExistingDxfs(stylesXml);
  const allDxfs: string[] = [];
  const sheetMatches = [...workbookXml.matchAll(/<sheet[^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g)];

  for (const sheetMatch of sheetMatches) {
    const name = sheetMatch[1];
    const sheet = sheets.find((entry) => entry.name === name);
    if (!sheet?.conditionalFormats?.length) continue;

    const target = relMap.get(sheetMatch[2]);
    if (!target) continue;

    const original = new TextDecoder().decode(entries.get(target) ?? new Uint8Array());
    const stripped = stripExistingConditionalFormatting(original);
    const { xml, dxfs } = buildConditionalFormattingXml(sheet.conditionalFormats, dxfOffset + allDxfs.length);
    allDxfs.push(...dxfs);
    const patched = stripped.replace("</worksheet>", `${xml}</worksheet>`);
    entries.set(target, new TextEncoder().encode(patched));
  }

  if (allDxfs.length > 0) {
    const patchedStyles = injectDxfs(stylesXml, allDxfs);
    entries.set("xl/styles.xml", new TextEncoder().encode(patchedStyles));
  }

  return writeXlsxZipEntries(entries);
}
