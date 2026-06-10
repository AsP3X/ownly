// Human: Merge generated sheetData into original worksheet XML without dropping drawings/tables.
// Agent: EXTRACTS <sheetData> from SheetJS output; SPLICES into source worksheet shell.

// Human: Pull the sheetData block from a worksheet XML string.
// Agent: RETURNS full <sheetData>...</sheetData> element or null when absent.
export function extractSheetDataBlock(worksheetXml: string): string | null {
  const match = /<sheetData\b[^>]*>[\s\S]*?<\/sheetData>/i.exec(worksheetXml);
  return match?.[0] ?? null;
}

// Human: Replace or insert sheetData in a worksheet while preserving all other child elements.
// Agent: KEEPS drawing, tableParts, conditionalFormatting, mergeCells, etc. outside sheetData.
export function replaceSheetDataInWorksheet(worksheetXml: string, sheetDataBlock: string): string {
  if (/<sheetData\b[^>]*>[\s\S]*?<\/sheetData>/i.test(worksheetXml)) {
    return worksheetXml.replace(/<sheetData\b[^>]*>[\s\S]*?<\/sheetData>/i, sheetDataBlock);
  }

  if (/<sheetData\b/i.test(worksheetXml)) {
    return worksheetXml;
  }

  if (/<\/sheetData>/i.test(worksheetXml)) {
    return worksheetXml;
  }

  const mergeCellsMatch = /<mergeCells\b/i.exec(worksheetXml);
  if (mergeCellsMatch && mergeCellsMatch.index !== undefined) {
    return `${worksheetXml.slice(0, mergeCellsMatch.index)}${sheetDataBlock}${worksheetXml.slice(mergeCellsMatch.index)}`;
  }

  if (/<\/worksheet>/i.test(worksheetXml)) {
    return worksheetXml.replace(/<\/worksheet>/i, `${sheetDataBlock}</worksheet>`);
  }

  return `${worksheetXml}${sheetDataBlock}`;
}
