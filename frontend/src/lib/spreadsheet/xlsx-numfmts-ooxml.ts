// Human: Parse xl/styles.xml numFmts table for custom format codes on import.
// Agent: USED by parseSpreadsheetBuffer to enrich cells missing SheetJS z codes.

import { readXlsxZipEntries } from "@/lib/spreadsheet/xlsx-ooxml";

// Human: Read custom numFmtId → formatCode map from styles.xml.
// Agent: RETURNS empty object when styles part is missing.
export async function importNumFmtMapFromXlsx(
  buffer: ArrayBuffer,
): Promise<Record<number, string>> {
  try {
    const entries = await readXlsxZipEntries(buffer);
    const stylesXml = new TextDecoder().decode(entries.get("xl/styles.xml") ?? new Uint8Array());
    if (!stylesXml) return {};
    const map: Record<number, string> = {};
    for (const match of stylesXml.matchAll(/<numFmt\b([^>]*)\/?>/gi)) {
      const attrs = match[1];
      const id = /numFmtId="(\d+)"/i.exec(attrs)?.[1];
      const code = /formatCode="([^"]*)"/i.exec(attrs)?.[1];
      if (id && code) {
        map[Number.parseInt(id, 10)] = code
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&quot;/g, '"')
          .replace(/&amp;/g, "&");
      }
    }
    return map;
  } catch {
    return {};
  }
}
