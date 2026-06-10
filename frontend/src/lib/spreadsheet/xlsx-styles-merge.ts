// Human: Merge SheetJS styles.xml into the original without dropping theme dxfs.
// Agent: APPENDS new fonts/fills/borders/xfs; REMAPS cell s= indices in sheetData.

const SECTION_CHILD_TAG: Record<string, string> = {
  numFmts: "numFmt",
  fonts: "font",
  fills: "fill",
  borders: "border",
  cellStyleXfs: "xf",
  cellXfs: "xf",
};

function extractSectionItems(stylesXml: string, section: string): string[] {
  const childTag = SECTION_CHILD_TAG[section];
  const block = new RegExp(`<${section}\\b[^>]*>([\\s\\S]*?)</${section}>`, "i").exec(stylesXml);
  if (!block) return [];
  const pattern = new RegExp(`<${childTag}\\b[^>]*(?:/>|>[\\s\\S]*?</${childTag}>)`, "gi");
  return [...block[1].matchAll(pattern)].map((match) => match[0]);
}

function replaceSection(stylesXml: string, section: string, items: string[]): string {
  const block = `<${section} count="${items.length}">${items.join("")}</${section}>`;
  if (new RegExp(`<${section}\\b[\\s\\S]*?</${section}>`, "i").test(stylesXml)) {
    return stylesXml.replace(new RegExp(`<${section}\\b[\\s\\S]*?</${section}>`, "i"), block);
  }
  return stylesXml.replace("</styleSheet>", `${block}</styleSheet>`);
}

function mergeIndexedSection(
  mergedXml: string,
  generatedXml: string,
  section: string,
): { xml: string; remap: Map<number, number> } {
  const sourceItems = extractSectionItems(mergedXml, section);
  const generatedItems = extractSectionItems(generatedXml, section);
  const nextItems = [...sourceItems];
  const remap = new Map<number, number>();

  generatedItems.forEach((item, generatedIndex) => {
    const existingIndex = nextItems.findIndex((entry) => entry === item);
    if (existingIndex >= 0) {
      remap.set(generatedIndex, existingIndex);
      return;
    }
    const appendedIndex = nextItems.length;
    nextItems.push(item);
    remap.set(generatedIndex, appendedIndex);
  });

  const xml =
    sourceItems.length > 0 || generatedItems.length > 0
      ? replaceSection(mergedXml, section, nextItems)
      : mergedXml;
  return { xml, remap };
}

function mergeNumFmts(mergedXml: string, generatedXml: string): string {
  const sourceItems = extractSectionItems(mergedXml, "numFmts");
  const generatedItems = extractSectionItems(generatedXml, "numFmts");
  const knownIds = new Set(
    sourceItems
      .map((item) => /numFmtId="(\d+)"/i.exec(item)?.[1])
      .filter((value): value is string => Boolean(value)),
  );
  const nextItems = [...sourceItems];
  for (const item of generatedItems) {
    const id = /numFmtId="(\d+)"/i.exec(item)?.[1];
    if (id && knownIds.has(id)) continue;
    if (id) knownIds.add(id);
    nextItems.push(item);
  }
  if (nextItems.length === 0) return mergedXml;
  return replaceSection(mergedXml, "numFmts", nextItems);
}

function remapXfReferences(
  xfXml: string,
  fontRemap: Map<number, number>,
  fillRemap: Map<number, number>,
  borderRemap: Map<number, number>,
): string {
  return xfXml
    .replace(/\bfontId="(\d+)"/gi, (_match, raw) => {
      const mapped = fontRemap.get(Number.parseInt(raw, 10));
      return mapped === undefined ? _match : `fontId="${mapped}"`;
    })
    .replace(/\bfillId="(\d+)"/gi, (_match, raw) => {
      const mapped = fillRemap.get(Number.parseInt(raw, 10));
      return mapped === undefined ? _match : `fillId="${mapped}"`;
    })
    .replace(/\bborderId="(\d+)"/gi, (_match, raw) => {
      const mapped = borderRemap.get(Number.parseInt(raw, 10));
      return mapped === undefined ? _match : `borderId="${mapped}"`;
    });
}

function mergeCellXfsSection(
  mergedXml: string,
  generatedXml: string,
  fontRemap: Map<number, number>,
  fillRemap: Map<number, number>,
  borderRemap: Map<number, number>,
): { xml: string; remap: Map<number, number> } {
  const sourceItems = extractSectionItems(mergedXml, "cellXfs");
  const generatedItems = extractSectionItems(generatedXml, "cellXfs");
  const nextItems = [...sourceItems];
  const remap = new Map<number, number>();

  generatedItems.forEach((item, generatedIndex) => {
    const remappedItem = remapXfReferences(item, fontRemap, fillRemap, borderRemap);
    const existingIndex = nextItems.findIndex((entry) => entry === remappedItem);
    if (existingIndex >= 0) {
      remap.set(generatedIndex, existingIndex);
      return;
    }
    const appendedIndex = nextItems.length;
    nextItems.push(remappedItem);
    remap.set(generatedIndex, appendedIndex);
  });

  const xml =
    sourceItems.length > 0 || generatedItems.length > 0
      ? replaceSection(mergedXml, "cellXfs", nextItems)
      : mergedXml;
  return { xml, remap };
}

// Human: Combine original styles.xml with SheetJS output and map generated xfs indices.
// Agent: PRESERVES source dxfs/theme; RETURNS merged styles + cellXfs remap table.
export function mergeStylesXml(
  sourceXml: string,
  generatedXml: string,
): { mergedXml: string; cellXfsRemap: Map<number, number> } {
  let merged = sourceXml;
  merged = mergeNumFmts(merged, generatedXml);

  const fonts = mergeIndexedSection(merged, generatedXml, "fonts");
  merged = fonts.xml;
  const fills = mergeIndexedSection(merged, generatedXml, "fills");
  merged = fills.xml;
  const borders = mergeIndexedSection(merged, generatedXml, "borders");
  merged = borders.xml;

  const cellXfs = mergeCellXfsSection(merged, generatedXml, fonts.remap, fills.remap, borders.remap);
  merged = cellXfs.xml;

  return { mergedXml: merged, cellXfsRemap: cellXfs.remap };
}

// Human: Rewrite s="N" attributes in sheetData after styles.xml merge.
// Agent: MAPS generated cellXfs indices to merged stylesheet indices.
export function remapSheetDataStyleIndices(sheetDataXml: string, remap: Map<number, number>): string {
  if (remap.size === 0) return sheetDataXml;
  return sheetDataXml.replace(/<c\b([^>]*?)(\/?)>/gi, (full, attrs: string, selfClose: string) => {
    const styleMatch = /\bs="(\d+)"/i.exec(attrs);
    if (!styleMatch) return full;
    const mapped = remap.get(Number.parseInt(styleMatch[1], 10));
    if (mapped === undefined) return full;
    const nextAttrs = attrs.replace(/\bs="\d+"/i, `s="${mapped}"`);
    return `<c${nextAttrs}${selfClose}>`;
  });
}
