// Human: OOXML import/export for comments, data validation, and defined names.
// Agent: PATCHES xlsx zip via patchXlsxZipEntries; USED by parse.ts on load/save.

import { columnIndexToLetters, parseCellAddressLabel } from "@/lib/spreadsheet/cells";
import type { DataValidationRule } from "@/lib/spreadsheet/data-validation";
import { parseValidationListInput } from "@/lib/spreadsheet/data-validation";
import type { NamedRange } from "@/lib/spreadsheet/named-ranges";
import { definedNameToSqref, parseDefinedNameValue } from "@/lib/spreadsheet/named-ranges";
import { patchXlsxZipEntries, readXlsxZipEntries } from "@/lib/spreadsheet/xlsx-ooxml";
import type { SheetData, SpreadsheetWorkbook } from "@/lib/spreadsheet/types";

function readXmlAttribute(openTag: string, attributeName: string): string | null {
  const pattern = new RegExp(`${attributeName}="([^"]*)"`, "i");
  return pattern.exec(openTag)?.[1] ?? null;
}

function normalizeXlsxEntryPath(target: string): string {
  let path = target.replace(/^\.\//, "");
  if (!path.startsWith("xl/")) path = `xl/${path}`;
  return path;
}

function escapeXmlText(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function decodeXmlText(raw: string): string {
  return raw
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");
}

type SheetLink = {
  name: string;
  sheetPath: string;
  relsPath: string;
};

async function listWorksheetLinks(buffer: ArrayBuffer): Promise<{
  entries: Map<string, Uint8Array>;
  sheets: SheetLink[];
}> {
  const entries = await readXlsxZipEntries(buffer);
  const workbookXml = new TextDecoder().decode(entries.get("xl/workbook.xml") ?? new Uint8Array());
  const relsXml = new TextDecoder().decode(entries.get("xl/_rels/workbook.xml.rels") ?? new Uint8Array());
  const relMap = new Map<string, string>();
  for (const match of relsXml.matchAll(/<Relationship\b([^>]*)\/?>/gi)) {
    const id = readXmlAttribute(match[1], "Id");
    const target = readXmlAttribute(match[1], "Target");
    if (id && target) relMap.set(id, normalizeXlsxEntryPath(target));
  }

  const sheets: SheetLink[] = [];
  for (const sheetMatch of workbookXml.matchAll(/<sheet\b([^>]*)\/?>/gi)) {
    const attrs = sheetMatch[1];
    const name = readXmlAttribute(attrs, "name");
    const relId = readXmlAttribute(attrs, "r:id");
    if (!name || !relId) continue;
    const sheetPath = relMap.get(relId);
    if (!sheetPath) continue;
    const relsPath = sheetPath.replace("xl/worksheets/", "xl/worksheets/_rels/") + ".rels";
    sheets.push({ name, sheetPath, relsPath });
  }

  return { entries, sheets };
}

function nextRelationshipId(relsXml: string): string {
  const ids = [...relsXml.matchAll(/Id="rId(\d+)"/gi)].map((match) => Number.parseInt(match[1], 10));
  const max = ids.length > 0 ? Math.max(...ids) : 0;
  return `rId${max + 1}`;
}

function ensureContentTypeOverride(contentTypesXml: string, partName: string, contentType: string): string {
  if (contentTypesXml.includes(`PartName="/${partName}"`)) return contentTypesXml;
  const override = `<Override PartName="/${partName}" ContentType="${contentType}"/>`;
  return contentTypesXml.replace("</Types>", `${override}</Types>`);
}

function stripDataValidations(sheetXml: string): string {
  return sheetXml.replace(/<dataValidations[\s\S]*?<\/dataValidations>/g, "");
}

function stripDefinedNames(workbookXml: string): string {
  return workbookXml.replace(/<definedNames[\s\S]*?<\/definedNames>/g, "");
}

function extractDefinedNameTags(workbookXml: string): string[] {
  const tags: string[] = [];
  for (const match of workbookXml.matchAll(/<definedName\b[^>]*>[\s\S]*?<\/definedName>/gi)) {
    tags.push(match[0]);
  }
  return tags;
}

function definedNameFromTag(tag: string): string | null {
  const nameMatch = /name="([^"]*)"/i.exec(tag);
  return nameMatch?.[1]?.trim() ?? null;
}

function cellRefFromIndices(row: number, col: number): string {
  return `${columnIndexToLetters(col)}${row + 1}`;
}

function sqrefColumnRange(sheetName: string, colIndex: number, rowCount: number): string {
  const col = columnIndexToLetters(colIndex);
  const endRow = Math.max(2, rowCount);
  return `'${sheetName.replace(/'/g, "''")}'!$${col}$2:$${col}$${endRow}`;
}

function parseValidationRule(openTag: string, body: string): DataValidationRule | null {
  const type = readXmlAttribute(openTag, "type") ?? "list";
  const formula1 = /<formula1>([\s\S]*?)<\/formula1>/i.exec(body)?.[1]?.trim() ?? "";
  const formula2 = /<formula2>([\s\S]*?)<\/formula2>/i.exec(body)?.[1]?.trim() ?? "";

  if (type === "list") {
    const listRaw = formula1.replace(/^="/, "").replace(/"$/, "").replace(/^'/, "").replace(/'$/, "");
    const values = parseValidationListInput(listRaw);
    if (values.length === 0) return null;
    return { type: "list", values, allowBlank: true };
  }

  if (type === "whole" || type === "decimal" || type === "textLength") {
    const min = formula1 ? Number(formula1) : undefined;
    const max = formula2 ? Number(formula2) : undefined;
    return {
      type,
      min: Number.isFinite(min) ? min : undefined,
      max: Number.isFinite(max) ? max : undefined,
      allowBlank: true,
    };
  }

  return null;
}

function columnIndexFromSqref(sqref: string): number | null {
  const token = sqref.trim().split(/\s+/)[0]?.split(":")[0]?.replace(/^[^!]*!/i, "") ?? "";
  const address = parseCellAddressLabel(token.replace(/\$/g, ""));
  return address?.col ?? null;
}

function buildValidationXml(sheetName: string, sheet: SheetData): string {
  const validations = sheet.columnValidations ?? {};
  const entries = Object.entries(validations);
  if (entries.length === 0) return "";

  const rowCount = sheet.rows.length;
  const blocks = entries
    .map(([colIndexRaw, rule]) => {
      const colIndex = Number(colIndexRaw);
      const sqref = sqrefColumnRange(sheetName, colIndex, rowCount);
      if (rule.type === "list" && rule.values?.length) {
        const source = `"${rule.values.join(",")}"`;
        return `<dataValidation type="list" allowBlank="1" showInputMessage="1" showErrorMessage="1" sqref="${sqref}"><formula1>${escapeXmlText(source)}</formula1></dataValidation>`;
      }
      if (rule.type === "whole" || rule.type === "decimal" || rule.type === "textLength") {
        const formulas = [
          rule.min !== undefined ? `<formula1>${rule.min}</formula1>` : "",
          rule.max !== undefined ? `<formula2>${rule.max}</formula2>` : "",
        ].join("");
        return `<dataValidation type="${rule.type}" operator="between" allowBlank="1" showInputMessage="1" showErrorMessage="1" sqref="${sqref}">${formulas}</dataValidation>`;
      }
      return "";
    })
    .filter(Boolean);

  if (blocks.length === 0) return "";
  return `<dataValidations count="${blocks.length}">${blocks.join("")}</dataValidations>`;
}

function buildCommentsXml(comments: Array<{ ref: string; text: string }>): string {
  const items = comments
    .map(
      (entry) =>
        `<comment ref="${entry.ref}" authorId="0"><text><r><t xml:space="preserve">${escapeXmlText(entry.text)}</t></r></text></comment>`,
    )
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><comments xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><authors><author>Ownly</author></authors><commentList>${items}</commentList></comments>`;
}

// Human: Legacy Excel VML drawing so comment indicators show in Excel Desktop.
// Agent: WRITTEN as xl/drawings/vmlDrawingN.vml + sheet relationship; paired with commentsN.xml.
function buildCommentsVml(comments: Array<{ ref: string; text: string }>): string {
  const shapes = comments
    .map((entry, index) => {
      const id = `_x0000_s${1025 + index}`;
      return `<v:shape id="${id}" type="#_x0000_t202" style="position:absolute;margin-left:59.25pt;margin-top:1.5pt;width:108pt;height:59.25pt;z-index:1;visibility:hidden" fillcolor="#ffffe1" o:insetmode="auto"><v:fill color2="#ffffe1"/><v:shadow on="t" color="black" obscured="t"/><v:path o:connecttype="none"/><v:textbox style="mso-direction-alt:auto"><div style="text-align:left"></div></v:textbox><x:ClientData ObjectType="Note"><x:MoveWithCells/><x:SizeWithCells/><x:AutoFill>False</x:AutoFill><x:Row>${Math.max(0, Number.parseInt(entry.ref.replace(/^[A-Z]+/i, ""), 10) - 1)}</x:Row><x:Column>${Math.max(0, entry.ref.replace(/\d+/g, "").toUpperCase().split("").reduce((n, c) => n * 26 + (c.charCodeAt(0) - 64), 0) - 1)}</x:Column></x:ClientData></v:shape>`;
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?><xml xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><o:shapelayout v:ext="edit"><o:idmap v:ext="edit" data="1"/></o:shapelayout><v:shapetype id="_x0000_t202" coordsize="21600,21600" o:spt="202" path="m,l,21600r21600,l21600,xe"><v:stroke joinstyle="miter"/><v:path gradientshapeok="t" o:connecttype="rect"/></v:shapetype>${shapes}</xml>`;
}

function applyCommentsToRows(rows: SheetData["rows"], comments: Map<string, string>): SheetData["rows"] {
  if (comments.size === 0) return rows;
  return rows.map((row, rowIndex) =>
    row.map((cell, colIndex) => {
      const ref = cellRefFromIndices(rowIndex, colIndex);
      const comment = comments.get(ref);
      return comment ? { ...cell, comment } : cell;
    }),
  );
}

export async function importCommentsFromXlsx(
  buffer: ArrayBuffer,
  sheetNames: string[],
): Promise<Map<string, Map<string, string>>> {
  const { entries, sheets } = await listWorksheetLinks(buffer);
  const result = new Map<string, Map<string, string>>();

  for (const sheet of sheets) {
    if (!sheetNames.includes(sheet.name)) continue;
    const relsXml = new TextDecoder().decode(entries.get(sheet.relsPath) ?? new Uint8Array());
    const commentRel = [...relsXml.matchAll(/<Relationship\b([^>]*)\/?>/gi)].find((match) =>
      (readXmlAttribute(match[1], "Type") ?? "").includes("/comments"),
    );
    if (!commentRel) continue;

    const target = readXmlAttribute(commentRel[1], "Target");
    if (!target) continue;
    const commentsPath = normalizeXlsxEntryPath(target.startsWith("../") ? `xl/${target.slice(3)}` : target);
    const commentsXml = new TextDecoder().decode(entries.get(commentsPath) ?? new Uint8Array());
    const byRef = new Map<string, string>();

    for (const match of commentsXml.matchAll(/<comment\b([^>]*)>([\s\S]*?)<\/comment>/gi)) {
      const ref = readXmlAttribute(match[1], "ref");
      if (!ref) continue;
      const textMatch = /<t[^>]*>([\s\S]*?)<\/t>/i.exec(match[2]);
      const text = decodeXmlText(textMatch?.[1]?.replace(/\s+/g, " ").trim() ?? "");
      if (text) byRef.set(ref, text);
    }

    if (byRef.size > 0) result.set(sheet.name, byRef);
  }

  return result;
}

export function mergeCommentsIntoSheet(sheet: SheetData, comments: Map<string, string> | undefined): SheetData {
  if (!comments || comments.size === 0) return sheet;
  return { ...sheet, rows: applyCommentsToRows(sheet.rows, comments) };
}

export async function importDataValidationsFromXlsx(
  buffer: ArrayBuffer,
  sheetNames: string[],
): Promise<Map<string, Record<number, DataValidationRule>>> {
  const { entries, sheets } = await listWorksheetLinks(buffer);
  const result = new Map<string, Record<number, DataValidationRule>>();

  for (const sheet of sheets) {
    if (!sheetNames.includes(sheet.name)) continue;
    const sheetXml = new TextDecoder().decode(entries.get(sheet.sheetPath) ?? new Uint8Array());
    const columnValidations: Record<number, DataValidationRule> = {};

    for (const match of sheetXml.matchAll(/<dataValidation\b([^>]*)>([\s\S]*?)<\/dataValidation>/gi)) {
      const sqref = readXmlAttribute(match[1], "sqref");
      if (!sqref) continue;
      const colIndex = columnIndexFromSqref(sqref);
      const rule = parseValidationRule(match[1], match[2]);
      if (colIndex === null || !rule) continue;
      columnValidations[colIndex] = rule;
    }

    if (Object.keys(columnValidations).length > 0) result.set(sheet.name, columnValidations);
  }

  return result;
}

export async function importNamedRangesFromXlsx(buffer: ArrayBuffer): Promise<NamedRange[]> {
  const entries = await readXlsxZipEntries(buffer);
  const workbookXml = new TextDecoder().decode(entries.get("xl/workbook.xml") ?? new Uint8Array());
  const ranges: NamedRange[] = [];

  for (const match of workbookXml.matchAll(/<definedName\b([^>]*)>([\s\S]*?)<\/definedName>/gi)) {
    const name = readXmlAttribute(match[1], "name");
    const value = match[2].trim();
    if (!name || !value) continue;
    const normalizedName = name.trim().toLowerCase();
    if (normalizedName === "_xlnm.print_area" || normalizedName === "print_area") continue;
    const parsed = parseDefinedNameValue(name, value);
    if (parsed) ranges.push(parsed);
  }

  return ranges;
}

export async function exportWorkbookMetadataToXlsx(
  buffer: ArrayBuffer,
  workbook: SpreadsheetWorkbook,
): Promise<ArrayBuffer> {
  const hasComments = workbook.sheets.some((sheet) =>
    sheet.rows.some((row) => row.some((cell) => Boolean(cell.comment?.trim()))),
  );
  const hasValidations = workbook.sheets.some(
    (sheet) => sheet.columnValidations && Object.keys(sheet.columnValidations).length > 0,
  );
  const hasNames = (workbook.namedRanges?.length ?? 0) > 0;
  if (!hasComments && !hasValidations && !hasNames) return buffer;

  return patchXlsxZipEntries(buffer, (entries) => {
    let contentTypes = new TextDecoder().decode(entries.get("[Content_Types].xml") ?? new Uint8Array());
    const workbookXmlRaw = new TextDecoder().decode(entries.get("xl/workbook.xml") ?? new Uint8Array());

    const relsXml = new TextDecoder().decode(entries.get("xl/_rels/workbook.xml.rels") ?? new Uint8Array());
    const relMap = new Map<string, string>();
    for (const match of relsXml.matchAll(/<Relationship\b([^>]*)\/?>/gi)) {
      const id = readXmlAttribute(match[1], "Id");
      const target = readXmlAttribute(match[1], "Target");
      if (id && target) relMap.set(id, normalizeXlsxEntryPath(target));
    }

    let commentIndex = 1;
    for (const sheet of workbook.sheets) {
      const sheetMatch = [...workbookXmlRaw.matchAll(/<sheet\b([^>]*)\/?>/gi)].find(
        (match) => readXmlAttribute(match[1], "name") === sheet.name,
      );
      if (!sheetMatch) continue;
      const relId = readXmlAttribute(sheetMatch[1], "r:id");
      const sheetPath = relId ? relMap.get(relId) : undefined;
      if (!sheetPath) continue;
      const relsPath = sheetPath.replace("xl/worksheets/", "xl/worksheets/_rels/") + ".rels";

      const comments: Array<{ ref: string; text: string }> = [];
      sheet.rows.forEach((row, rowIndex) => {
        row.forEach((cell, colIndex) => {
          if (cell.comment?.trim()) {
            comments.push({ ref: cellRefFromIndices(rowIndex, colIndex), text: cell.comment.trim() });
          }
        });
      });

      if (comments.length > 0) {
        const commentsPath = `xl/comments${commentIndex}.xml`;
        const vmlPath = `xl/drawings/vmlDrawing${commentIndex}.vml`;
        entries.set(commentsPath, new TextEncoder().encode(buildCommentsXml(comments)));
        entries.set(vmlPath, new TextEncoder().encode(buildCommentsVml(comments)));
        contentTypes = ensureContentTypeOverride(
          contentTypes,
          commentsPath,
          "application/vnd.openxmlformats-officedocument.spreadsheetml.comments+xml",
        );
        if (!contentTypes.includes('Extension="vml"')) {
          contentTypes = contentTypes.includes("</Types>")
            ? contentTypes.replace(
                "</Types>",
                `<Default Extension="vml" ContentType="application/vnd.openxmlformats-officedocument.vmlDrawing"/></Types>`,
              )
            : contentTypes;
        }

        let sheetRels = new TextDecoder().decode(entries.get(relsPath) ?? new Uint8Array());
        const relParts: string[] = [];
        if (!sheetRels.includes("/comments")) {
          const relIdNext = nextRelationshipId(sheetRels + relParts.join(""));
          relParts.push(
            `<Relationship Id="${relIdNext}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="../comments${commentIndex}.xml"/>`,
          );
        }
        if (!sheetRels.includes("vmlDrawing")) {
          const relIdVml = nextRelationshipId(sheetRels + relParts.join(""));
          relParts.push(
            `<Relationship Id="${relIdVml}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/vmlDrawing" Target="../drawings/vmlDrawing${commentIndex}.vml"/>`,
          );
        }
        if (relParts.length > 0) {
          if (sheetRels.includes("</Relationships>")) {
            sheetRels = sheetRels.replace("</Relationships>", `${relParts.join("")}</Relationships>`);
          } else {
            sheetRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relParts.join("")}</Relationships>`;
          }
          entries.set(relsPath, new TextEncoder().encode(sheetRels));
        }

        // Human: Legacy Excel needs legacyDrawing on the worksheet for red comment indicators.
        // Agent: INJECTS r:id of vmlDrawing when missing.
        let sheetXml = new TextDecoder().decode(entries.get(sheetPath) ?? new Uint8Array());
        if (!sheetXml.includes("legacyDrawing") && sheetXml.includes("</worksheet>")) {
          const vmlRelMatch = /Id="(rId\d+)"[^>]*vmlDrawing/i.exec(
            new TextDecoder().decode(entries.get(relsPath) ?? new Uint8Array()),
          );
          const vmlRelId = vmlRelMatch?.[1] ?? "rIdVml";
          sheetXml = sheetXml.replace(
            "</worksheet>",
            `<legacyDrawing r:id="${vmlRelId}"/></worksheet>`,
          );
          entries.set(sheetPath, new TextEncoder().encode(sheetXml));
        }
        commentIndex += 1;
      }

      if (sheet.columnValidations && Object.keys(sheet.columnValidations).length > 0) {
        const original = new TextDecoder().decode(entries.get(sheetPath) ?? new Uint8Array());
        const stripped = stripDataValidations(original);
        const validationXml = buildValidationXml(sheet.name, sheet);
        const patched = stripped.replace("</worksheet>", `${validationXml}</worksheet>`);
        entries.set(sheetPath, new TextEncoder().encode(patched));
      }
    }

    if (hasNames && workbook.namedRanges) {
      const stripped = stripDefinedNames(workbookXmlRaw);
      const managedNames = new Set(workbook.namedRanges.map((range) => range.name.trim().toLowerCase()));
      const preserved = extractDefinedNameTags(workbookXmlRaw).filter((tag) => {
        const name = definedNameFromTag(tag);
        if (!name) return false;
        const normalized = name.toLowerCase();
        if (normalized === "_xlnm.print_area" || normalized === "print_area") return true;
        return !managedNames.has(normalized);
      });
      const modelTags = workbook.namedRanges.map(
        (range) =>
          `<definedName name="${escapeXmlText(range.name)}">${definedNameToSqref(range)}</definedName>`,
      );
      const allTags = [...preserved, ...modelTags];
      const namesXml = allTags.join("");
      const patchedWorkbook = stripped.replace(
        "</workbook>",
        `<definedNames count="${allTags.length}">${namesXml}</definedNames></workbook>`,
      );
      entries.set("xl/workbook.xml", new TextEncoder().encode(patchedWorkbook));
    }

    entries.set("[Content_Types].xml", new TextEncoder().encode(contentTypes));
  });
}
