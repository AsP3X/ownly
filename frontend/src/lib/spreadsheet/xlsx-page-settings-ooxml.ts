// Human: OOXML import/export for print areas and page margins.
// Agent: PATCHES xlsx zip; READS _xlnm.Print_Area defined names; WRITES pageMargins on worksheets.

import { columnIndexToLetters } from "@/lib/spreadsheet/cells";
import { parseDefinedNameValue } from "@/lib/spreadsheet/named-ranges";
import { patchXlsxZipEntries, readXlsxZipEntries } from "@/lib/spreadsheet/xlsx-ooxml";
import type { PageMargins, SheetData, SheetPrintArea } from "@/lib/spreadsheet/types";

function readXmlAttribute(openTag: string, attributeName: string): string | null {
  const pattern = new RegExp(`${attributeName}="([^"]*)"`, "i");
  return pattern.exec(openTag)?.[1] ?? null;
}

function normalizeXlsxEntryPath(target: string): string {
  let path = target.replace(/^\.\//, "");
  if (!path.startsWith("xl/")) path = `xl/${path}`;
  return path;
}

function isPrintAreaDefinedName(name: string): boolean {
  const normalized = name.trim().toLowerCase();
  return normalized === "_xlnm.print_area" || normalized === "print_area";
}

function printAreaFromDefinedName(name: string, value: string): SheetPrintArea | null {
  if (!isPrintAreaDefinedName(name)) return null;
  const parsed = parseDefinedNameValue(name, value);
  if (!parsed) return null;
  return {
    startRow: parsed.startRow,
    startCol: parsed.startCol,
    endRow: parsed.endRow,
    endCol: parsed.endCol,
  };
}

function parsePageMarginsXml(worksheetXml: string): PageMargins | null {
  const match = /<pageMargins\b([^>]*)\/?>/i.exec(worksheetXml);
  if (!match) return null;
  const attrs = match[1];
  const left = Number(readXmlAttribute(attrs, "left"));
  const right = Number(readXmlAttribute(attrs, "right"));
  const top = Number(readXmlAttribute(attrs, "top"));
  const bottom = Number(readXmlAttribute(attrs, "bottom"));
  const header = Number(readXmlAttribute(attrs, "header"));
  const footer = Number(readXmlAttribute(attrs, "footer"));
  if (![left, right, top, bottom].every(Number.isFinite)) return null;
  return {
    left,
    right,
    top,
    bottom,
    header: Number.isFinite(header) ? header : undefined,
    footer: Number.isFinite(footer) ? footer : undefined,
  };
}

function printAreaToSqref(sheetName: string, area: SheetPrintArea): string {
  const sheetPrefix = /[\s']/.test(sheetName) ? `'${sheetName.replace(/'/g, "''")}'` : sheetName;
  const start = `$${columnIndexToLetters(area.startCol)}$${area.startRow + 1}`;
  const end = `$${columnIndexToLetters(area.endCol)}$${area.endRow + 1}`;
  return `${sheetPrefix}!${start}:${end}`;
}

function buildPageMarginsXml(margins: PageMargins): string {
  const header = margins.header ?? 0.3;
  const footer = margins.footer ?? 0.3;
  return `<pageMargins left="${margins.left}" right="${margins.right}" top="${margins.top}" bottom="${margins.bottom}" header="${header}" footer="${footer}"/>`;
}

function upsertPageMargins(worksheetXml: string, margins: PageMargins): string {
  const block = buildPageMarginsXml(margins);
  if (/<pageMargins\b/i.test(worksheetXml)) {
    return worksheetXml.replace(/<pageMargins\b[^>]*\/?>/i, block);
  }
  if (worksheetXml.includes("</worksheet>")) {
    return worksheetXml.replace("</worksheet>", `${block}</worksheet>`);
  }
  return worksheetXml;
}

function stripPrintAreaDefinedNames(workbookXml: string): string {
  return workbookXml.replace(/<definedName\b[^>]*name="(?:_xlnm\.)?Print_Area"[^>]*>[\s\S]*?<\/definedName>/gi, "");
}

// Human: Import per-sheet print areas from workbook defined names.
// Agent: READS _xlnm.Print_Area entries; RETURNS map keyed by sheet name.
export async function importPrintAreasFromXlsx(
  buffer: ArrayBuffer,
  sheetNames: string[],
): Promise<Map<string, SheetPrintArea>> {
  const entries = await readXlsxZipEntries(buffer);
  const workbookXml = new TextDecoder().decode(entries.get("xl/workbook.xml") ?? new Uint8Array());
  const result = new Map<string, SheetPrintArea>();

  for (const match of workbookXml.matchAll(/<definedName\b([^>]*)>([\s\S]*?)<\/definedName>/gi)) {
    const name = readXmlAttribute(match[1], "name");
    const value = match[2].trim();
    if (!name || !value) continue;
    const area = printAreaFromDefinedName(name, value);
    if (!area) continue;
    const parsed = parseDefinedNameValue(name, value);
    if (parsed?.sheetName) {
      result.set(parsed.sheetName, area);
    }
  }

  // Human: Fallback when print area name lacks sheet prefix — bind to first sheet.
  if (result.size === 0 && sheetNames.length > 0) {
    for (const match of workbookXml.matchAll(/<definedName\b([^>]*)>([\s\S]*?)<\/definedName>/gi)) {
      const name = readXmlAttribute(match[1], "name");
      const value = match[2].trim();
      if (!name || !value || !isPrintAreaDefinedName(name)) continue;
      const localSheetId = readXmlAttribute(match[1], "localSheetId");
      if (localSheetId) {
        const sheetIndex = Number.parseInt(localSheetId, 10);
        const sheetName = sheetNames[sheetIndex];
        const parsed = parseDefinedNameValue("_xlnm.Print_Area", `${sheetName}!${value}`);
        if (sheetName && parsed) {
          result.set(sheetName, {
            startRow: parsed.startRow,
            startCol: parsed.startCol,
            endRow: parsed.endRow,
            endCol: parsed.endCol,
          });
        }
      }
    }
  }

  return result;
}

// Human: Import page margins from each worksheet OOXML.
// Agent: READS pageMargins element; RETURNS map keyed by sheet name.
export async function importPageMarginsFromXlsx(buffer: ArrayBuffer): Promise<Map<string, PageMargins>> {
  const entries = await readXlsxZipEntries(buffer);
  const workbookXml = new TextDecoder().decode(entries.get("xl/workbook.xml") ?? new Uint8Array());
  const relsXml = new TextDecoder().decode(entries.get("xl/_rels/workbook.xml.rels") ?? new Uint8Array());
  const relMap = new Map<string, string>();
  for (const match of relsXml.matchAll(/<Relationship\b([^>]*)\/?>/gi)) {
    const id = readXmlAttribute(match[1], "Id");
    const target = readXmlAttribute(match[1], "Target");
    if (id && target) relMap.set(id, normalizeXlsxEntryPath(target));
  }

  const result = new Map<string, PageMargins>();
  for (const sheetMatch of workbookXml.matchAll(/<sheet\b([^>]*)\/?>/gi)) {
    const name = readXmlAttribute(sheetMatch[1], "name");
    const relId = readXmlAttribute(sheetMatch[1], "r:id");
    if (!name || !relId) continue;
    const sheetPath = relMap.get(relId);
    if (!sheetPath) continue;
    const worksheetXml = new TextDecoder().decode(entries.get(sheetPath) ?? new Uint8Array());
    const margins = parsePageMarginsXml(worksheetXml);
    if (margins) result.set(name, margins);
  }

  return result;
}

// Human: Export print areas and page margins back into xlsx OOXML.
// Agent: PATCHES workbook definedNames and worksheet pageMargins.
export async function exportPageSettingsToXlsx(
  buffer: ArrayBuffer,
  sheets: SheetData[],
): Promise<ArrayBuffer> {
  const hasPrintAreas = sheets.some((sheet) => sheet.printArea);
  const hasMargins = sheets.some((sheet) => sheet.pageMargins);
  if (!hasPrintAreas && !hasMargins) return buffer;

  return patchXlsxZipEntries(buffer, (entries) => {
    const workbookXmlRaw = new TextDecoder().decode(entries.get("xl/workbook.xml") ?? new Uint8Array());
    const relsXml = new TextDecoder().decode(entries.get("xl/_rels/workbook.xml.rels") ?? new Uint8Array());
    const relMap = new Map<string, string>();
    for (const match of relsXml.matchAll(/<Relationship\b([^>]*)\/?>/gi)) {
      const id = readXmlAttribute(match[1], "Id");
      const target = readXmlAttribute(match[1], "Target");
      if (id && target) relMap.set(id, normalizeXlsxEntryPath(target));
    }

    if (hasPrintAreas) {
      let workbookXml = stripPrintAreaDefinedNames(workbookXmlRaw);
      const printNames = sheets
        .map((sheet, sheetIndex) => {
          if (!sheet.printArea) return "";
          const sqref = printAreaToSqref(sheet.name, sheet.printArea);
          return `<definedName name="_xlnm.Print_Area" localSheetId="${sheetIndex}">${sqref}</definedName>`;
        })
        .filter(Boolean)
        .join("");

      if (printNames) {
        if (workbookXml.includes("<definedNames")) {
          workbookXml = workbookXml.replace(
            /<definedNames\b[^>]*>/i,
            (tag) => `${tag}${printNames}`,
          );
        } else {
          workbookXml = workbookXml.replace(
            "</workbook>",
            `<definedNames>${printNames}</definedNames></workbook>`,
          );
        }
      }
      entries.set("xl/workbook.xml", new TextEncoder().encode(workbookXml));
    }

    if (hasMargins) {
      for (const sheet of sheets) {
        if (!sheet.pageMargins) continue;
        const sheetMatch = [...workbookXmlRaw.matchAll(/<sheet\b([^>]*)\/?>/gi)].find(
          (match) => readXmlAttribute(match[1], "name") === sheet.name,
        );
        if (!sheetMatch) continue;
        const relId = readXmlAttribute(sheetMatch[1], "r:id");
        const sheetPath = relId ? relMap.get(relId) : undefined;
        if (!sheetPath) continue;
        const original = new TextDecoder().decode(entries.get(sheetPath) ?? new Uint8Array());
        const patched = upsertPageMargins(original, sheet.pageMargins);
        entries.set(sheetPath, new TextEncoder().encode(patched));
      }
    }
  });
}
