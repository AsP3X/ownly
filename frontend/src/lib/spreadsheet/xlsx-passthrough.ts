// Human: Passthrough xlsx save — preserve unmodeled OOXML parts (charts, drawings, macros).
// Agent: MERGES SheetJS-generated cell data into the original zip instead of full rewrite.

import type { SpreadsheetWorkbook } from "@/lib/spreadsheet/types";
import { readXlsxZipEntries, writeXlsxZipEntries } from "@/lib/spreadsheet/xlsx-ooxml";
import {
  listWorksheetCatalog,
  listWorksheetLinksByName,
} from "@/lib/spreadsheet/xlsx-sheet-links";
import { applyWorkbookStructureMerge } from "@/lib/spreadsheet/xlsx-workbook-structure";
import { mergeStylesXml, remapSheetDataStyleIndices } from "@/lib/spreadsheet/xlsx-styles-merge";
import {
  extractSheetDataBlock,
  replaceSheetDataInWorksheet,
} from "@/lib/spreadsheet/xlsx-worksheet-merge";

const PRESERVE_ENTRY_PATTERNS: RegExp[] = [
  /^xl\/drawings\//,
  /^xl\/charts\//,
  /^xl\/pivotTables\//,
  /^xl\/pivotCache\//,
  /^xl\/tables\//,
  /^xl\/externalLinks\//,
  /^xl\/printerSettings\//,
  /^xl\/vbaProject/i,
  /^xl\/activeX\//,
  /^xl\/ctrlProps\//,
  /^xl\/embeddings\//,
  /^xl\/media\//,
  /^xl\/threadedComments\//,
  /^xl\/richData\//,
  /^xl\/calcChain\.xml$/,
  /^xl\/metadata\//,
  /^xl\/persons\//,
  /^xl\/slicerCaches\//,
  /^xl\/timelineCaches\//,
  /^docProps\//,
  /^customXml\//,
  /^xl\/worksheets\/_rels\//,
];

function readXmlAttribute(openTag: string, attributeName: string): string | null {
  const pattern = new RegExp(`${attributeName}="([^"]*)"`, "i");
  return pattern.exec(openTag)?.[1] ?? null;
}

// Human: Decide whether a zip entry from the original file must survive save.
// Agent: MATCHES chart/drawing/pivot/macro paths and worksheet relationship files.
function shouldPreserveSourceEntry(path: string): boolean {
  return PRESERVE_ENTRY_PATTERNS.some((pattern) => pattern.test(path));
}

// Human: Read ordered sheet tab names from workbook.xml.
// Agent: USED to detect add/rename/remove before choosing workbook.xml source.
function sheetNamesFromWorkbookXml(workbookXml: string): string[] {
  const names: string[] = [];
  for (const match of workbookXml.matchAll(/<sheet\b([^>]*)\/?>/gi)) {
    const name = readXmlAttribute(match[1], "name");
    if (name) names.push(name);
  }
  return names;
}

// Human: Compare model sheet tabs with the original workbook.xml tab list.
// Agent: RETURNS true when tabs were added, removed, or renamed.
export function workbookSheetStructureChanged(
  sourceEntries: Map<string, Uint8Array>,
  workbook: SpreadsheetWorkbook,
): boolean {
  const workbookXml = new TextDecoder().decode(sourceEntries.get("xl/workbook.xml") ?? new Uint8Array());
  const sourceNames = sheetNamesFromWorkbookXml(workbookXml);
  const modelNames = workbook.sheets.map((sheet) => sheet.name);
  if (sourceNames.length !== modelNames.length) return true;
  return sourceNames.some((name, index) => name !== modelNames[index]);
}

// Human: Merge SheetJS output into the original xlsx zip for non-destructive save.
// Agent: BASE zip from generated cell payload; OVERLAY preserved source parts; MERGE worksheet shells.
export async function mergePassthroughXlsx(
  sourceBuffer: ArrayBuffer,
  generatedBuffer: ArrayBuffer,
  workbook: SpreadsheetWorkbook,
): Promise<ArrayBuffer> {
  const sourceEntries = await readXlsxZipEntries(sourceBuffer);
  const generatedEntries = await readXlsxZipEntries(generatedBuffer);
  const merged = new Map<string, Uint8Array>(generatedEntries);

  for (const [path, bytes] of sourceEntries) {
    if (shouldPreserveSourceEntry(path)) {
      merged.set(path, bytes);
    }
  }

  const sourceStylesBytes = sourceEntries.get("xl/styles.xml");
  const generatedStylesBytes = generatedEntries.get("xl/styles.xml");
  let cellXfsRemap = new Map<number, number>();
  if (sourceStylesBytes && generatedStylesBytes) {
    const { mergedXml, cellXfsRemap: remap } = mergeStylesXml(
      new TextDecoder().decode(sourceStylesBytes),
      new TextDecoder().decode(generatedStylesBytes),
    );
    merged.set("xl/styles.xml", new TextEncoder().encode(mergedXml));
    cellXfsRemap = remap;
  } else if (sourceStylesBytes) {
    merged.set("xl/styles.xml", sourceStylesBytes);
  }

  const sourceCatalog = await listWorksheetCatalog(sourceBuffer);
  const generatedCatalog = await listWorksheetCatalog(generatedBuffer);
  applyWorkbookStructureMerge(
    merged,
    sourceEntries,
    generatedEntries,
    workbook,
    sourceCatalog,
    generatedCatalog,
  );

  const generatedLinks = await listWorksheetLinksByName(generatedBuffer);

  for (const sheet of workbook.sheets) {
    const generatedLink = generatedLinks.get(sheet.name);
    if (!generatedLink) continue;

    const generatedBytes = generatedEntries.get(generatedLink.sheetPath);
    if (!generatedBytes) continue;

    const generatedXml = new TextDecoder().decode(generatedBytes);
    let sheetData = extractSheetDataBlock(generatedXml);
    if (!sheetData) continue;

    if (cellXfsRemap.size > 0) {
      sheetData = remapSheetDataStyleIndices(sheetData, cellXfsRemap);
    }

    const targetPath = sheet.sourceWorksheetPath ?? generatedLink.sheetPath;
    const shellBytes =
      sheet.sourceWorksheetPath !== undefined
        ? (sourceEntries.get(sheet.sourceWorksheetPath) ?? merged.get(sheet.sourceWorksheetPath))
        : (merged.get(generatedLink.sheetPath) ?? generatedBytes);

    if (!shellBytes) continue;

    const shellXml = new TextDecoder().decode(shellBytes);
    const patchedXml = replaceSheetDataInWorksheet(shellXml, sheetData);
    merged.set(targetPath, new TextEncoder().encode(patchedXml));
  }

  return writeXlsxZipEntries(merged);
}
