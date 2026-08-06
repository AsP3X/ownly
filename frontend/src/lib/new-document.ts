// Human: Create empty documents in the drive so the built-in editors have something to open.
// Agent: BUILDS bytes client-side and hands them to the normal upload path — no new API endpoint.

export type NewDocumentKind = "text" | "rich-text" | "spreadsheet";

export type NewDocumentTemplate = {
  kind: NewDocumentKind;
  label: string;
  /** Human: One line under the label in the picker — what the editor is good for. */
  description: string;
  extension: string;
  mimeType: string;
  defaultBaseName: string;
};

export const NEW_DOCUMENT_TEMPLATES: readonly NewDocumentTemplate[] = [
  {
    kind: "text",
    label: "Text document",
    description: "Plain text and source code, with syntax highlighting.",
    extension: ".txt",
    mimeType: "text/plain",
    defaultBaseName: "Untitled",
  },
  {
    kind: "rich-text",
    label: "Rich text document",
    description: "Formatted writing, editable together in real time.",
    extension: ".rtf",
    mimeType: "application/rtf",
    defaultBaseName: "Untitled",
  },
  {
    kind: "spreadsheet",
    label: "Spreadsheet",
    description: "Rows, formulas and charts in the workbook editor.",
    extension: ".xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    defaultBaseName: "Untitled",
  },
];

/** Human: Stop runaway loops if a folder somehow holds thousands of "Untitled" files. */
const MAX_NAME_ATTEMPTS = 200;

/**
 * Human: "Untitled.txt", then "Untitled 2.txt", … so creating twice never collides.
 * Agent: PURE; case-insensitive like the server's sibling check.
 */
export function uniqueDocumentName(
  baseName: string,
  extension: string,
  existingNames: readonly string[],
): string {
  const taken = new Set(existingNames.map((name) => name.trim().toLowerCase()));
  for (let attempt = 1; attempt <= MAX_NAME_ATTEMPTS; attempt += 1) {
    const candidate = attempt === 1 ? `${baseName}${extension}` : `${baseName} ${attempt}${extension}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  // Human: Fall back to a timestamp rather than overwriting or failing the create.
  return `${baseName} ${Date.now()}${extension}`;
}

/**
 * Human: The empty file for a template, ready to upload.
 * Agent: DYNAMIC imports keep the RTF and XLSX writers out of the drive's main chunk.
 */
export async function buildNewDocumentFile(
  template: NewDocumentTemplate,
  name: string,
): Promise<File> {
  const options = { type: template.mimeType };

  if (template.kind === "text") {
    return new File([""], name, options);
  }

  if (template.kind === "rich-text") {
    // Human: One empty paragraph — the same seed the RTF editor starts a blank document with.
    const { htmlToRtf } = await import("@/lib/rtf/html-to-rtf");
    return new File([htmlToRtf("<p><br></p>")], name, options);
  }

  const XLSX = await import("xlsx");
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([[]]), "Sheet1");
  const bytes = XLSX.write(workbook, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
  return new File([bytes], name, options);
}
