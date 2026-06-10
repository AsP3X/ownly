// Human: Resolve worksheet XML paths from workbook.xml + rels (not sheet index).
// Agent: READS xlsx zip; RETURNS sheet name → path map for OOXML patchers.

import { readXlsxZipEntries } from "@/lib/spreadsheet/xlsx-ooxml";

function readXmlAttribute(openTag: string, attributeName: string): string | null {
  const pattern = new RegExp(`${attributeName}="([^"]*)"`, "i");
  return pattern.exec(openTag)?.[1] ?? null;
}

function normalizeXlsxEntryPath(target: string): string {
  let path = target.replace(/^\.\//, "");
  if (!path.startsWith("xl/")) path = `xl/${path}`;
  return path;
}

export type WorksheetLink = {
  name: string;
  sheetPath: string;
  sheetId?: string;
  relId?: string;
};

export type WorksheetCatalogEntry = WorksheetLink & {
  sheetId: string;
  relId: string;
};

// Human: Parse workbook.xml + rels into an ordered worksheet catalog.
// Agent: RETURNS sheetId/relId/path for rename/reorder passthrough save.
export async function listWorksheetCatalog(buffer: ArrayBuffer): Promise<WorksheetCatalogEntry[]> {
  const entries = await readXlsxZipEntries(buffer);
  const workbookXml = new TextDecoder().decode(entries.get("xl/workbook.xml") ?? new Uint8Array());
  const relsXml = new TextDecoder().decode(entries.get("xl/_rels/workbook.xml.rels") ?? new Uint8Array());
  const relMap = new Map<string, string>();
  for (const match of relsXml.matchAll(/<Relationship\b([^>]*)\/?>/gi)) {
    const id = readXmlAttribute(match[1], "Id");
    const target = readXmlAttribute(match[1], "Target");
    if (id && target) relMap.set(id, normalizeXlsxEntryPath(target));
  }

  const catalog: WorksheetCatalogEntry[] = [];
  for (const sheetMatch of workbookXml.matchAll(/<sheet\b([^>]*)\/?>/gi)) {
    const attrs = sheetMatch[1];
    const name = readXmlAttribute(attrs, "name");
    const relId = readXmlAttribute(attrs, "r:id");
    const sheetId = readXmlAttribute(attrs, "sheetId") ?? String(catalog.length + 1);
    if (!name || !relId) continue;
    const sheetPath = relMap.get(relId);
    if (!sheetPath) continue;
    catalog.push({ name, sheetPath, sheetId, relId });
  }
  return catalog;
}

// Human: Map each workbook sheet name to its xl/worksheets/*.xml path.
// Agent: USED by merge/dimension exporters so reordered sheets still round-trip.
export async function listWorksheetLinksByName(buffer: ArrayBuffer): Promise<Map<string, WorksheetLink>> {
  const catalog = await listWorksheetCatalog(buffer);
  const result = new Map<string, WorksheetLink>();
  for (const entry of catalog) {
    result.set(entry.name, entry);
  }
  return result;
}
