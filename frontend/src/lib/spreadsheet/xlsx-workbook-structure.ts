// Human: Merge workbook.xml, rels, and content types when tabs are added/renamed/reordered.
// Agent: KEEPS chart/drawing relationships from source; ADDS new worksheet parts from generated.

import type { SpreadsheetWorkbook } from "@/lib/spreadsheet/types";
import type { WorksheetCatalogEntry } from "@/lib/spreadsheet/xlsx-sheet-links";

function escapeXmlAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function worksheetRelsPath(sheetPath: string): string {
  return sheetPath.replace("xl/worksheets/", "xl/worksheets/_rels/") + ".rels";
}

function rebuildWorkbookSheets(workbookXml: string, sheetTags: string[]): string {
  const block = `<sheets count="${sheetTags.length}">${sheetTags.join("")}</sheets>`;
  if (/<sheets\b[\s\S]*?<\/sheets>/i.test(workbookXml)) {
    return workbookXml.replace(/<sheets\b[\s\S]*?<\/sheets>/i, block);
  }
  return workbookXml.replace("</workbook>", `${block}</workbook>`);
}

function mergeWorkbookRelationships(
  sourceRelsXml: string,
  generatedRelsXml: string,
  newEntries: WorksheetCatalogEntry[],
): string {
  let rels = sourceRelsXml;
  for (const entry of newEntries) {
    if (rels.includes(`Id="${entry.relId}"`)) continue;
    const generatedRel = new RegExp(
      `<Relationship\\b[^>]*Id="${entry.relId}"[^>]*\\/?>`,
      "i",
    ).exec(generatedRelsXml)?.[0];
    if (!generatedRel) continue;
    if (rels.includes("</Relationships>")) {
      rels = rels.replace("</Relationships>", `${generatedRel}</Relationships>`);
    } else {
      rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${generatedRel}</Relationships>`;
    }
  }
  return rels;
}

function mergeContentTypesXml(sourceXml: string, generatedXml: string, newWorksheetPaths: string[]): string {
  let merged = sourceXml;
  for (const sheetPath of newWorksheetPaths) {
    const partName = `/${sheetPath}`;
    if (merged.includes(`PartName="${partName}"`)) continue;
    const override = new RegExp(
      `<Override\\b[^>]*PartName="${partName.replace(/\//g, "\\/")}"[^>]*\\/?>`,
      "i",
    ).exec(generatedXml)?.[0];
    if (!override) continue;
    if (merged.includes("</Types>")) {
      merged = merged.replace("</Types>", `${override}</Types>`);
    }
  }
  return merged;
}

// Human: Rebuild workbook package metadata for the current sheet tab model.
// Agent: WRITES workbook.xml/rels/content types; COPIES new worksheet parts from generated zip.
export function applyWorkbookStructureMerge(
  merged: Map<string, Uint8Array>,
  sourceEntries: Map<string, Uint8Array>,
  generatedEntries: Map<string, Uint8Array>,
  workbook: SpreadsheetWorkbook,
  sourceCatalog: WorksheetCatalogEntry[],
  generatedCatalog: WorksheetCatalogEntry[],
): void {
  const sourceBySheetId = new Map(sourceCatalog.map((entry) => [entry.sheetId, entry]));
  const generatedByName = new Map(generatedCatalog.map((entry) => [entry.name, entry]));

  const sheetTags: string[] = [];
  const newSheets: WorksheetCatalogEntry[] = [];

  for (const sheet of workbook.sheets) {
    const sourceEntry =
      sheet.sourceSheetId && sourceBySheetId.has(sheet.sourceSheetId)
        ? sourceBySheetId.get(sheet.sourceSheetId)
        : undefined;
    const generatedEntry = generatedByName.get(sheet.name);

    const entry = sourceEntry ?? generatedEntry;
    if (!entry) continue;

    const escapedName = escapeXmlAttribute(sheet.name);
    sheetTags.push(
      `<sheet name="${escapedName}" sheetId="${entry.sheetId}" r:id="${entry.relId}"/>`,
    );

    if (!sourceEntry && generatedEntry) {
      newSheets.push(generatedEntry);
      const worksheetBytes = generatedEntries.get(generatedEntry.sheetPath);
      if (worksheetBytes) merged.set(generatedEntry.sheetPath, worksheetBytes);
      const relsPath = worksheetRelsPath(generatedEntry.sheetPath);
      const relsBytes = generatedEntries.get(relsPath);
      if (relsBytes) merged.set(relsPath, relsBytes);
    }
  }

  const sourceWorkbookXml = new TextDecoder().decode(
    sourceEntries.get("xl/workbook.xml") ?? new Uint8Array(),
  );
  const rebuiltWorkbook = rebuildWorkbookSheets(sourceWorkbookXml, sheetTags);
  merged.set("xl/workbook.xml", new TextEncoder().encode(rebuiltWorkbook));

  const sourceRelsXml = new TextDecoder().decode(
    sourceEntries.get("xl/_rels/workbook.xml.rels") ?? new Uint8Array(),
  );
  const generatedRelsXml = new TextDecoder().decode(
    generatedEntries.get("xl/_rels/workbook.xml.rels") ?? new Uint8Array(),
  );
  const mergedRels = mergeWorkbookRelationships(sourceRelsXml, generatedRelsXml, newSheets);
  merged.set("xl/_rels/workbook.xml.rels", new TextEncoder().encode(mergedRels));

  const sourceContentTypes = new TextDecoder().decode(
    sourceEntries.get("[Content_Types].xml") ?? new Uint8Array(),
  );
  const generatedContentTypes = new TextDecoder().decode(
    generatedEntries.get("[Content_Types].xml") ?? new Uint8Array(),
  );
  const mergedContentTypes = mergeContentTypesXml(
    sourceContentTypes,
    generatedContentTypes,
    newSheets.map((entry) => entry.sheetPath),
  );
  merged.set("[Content_Types].xml", new TextEncoder().encode(mergedContentTypes));
}
