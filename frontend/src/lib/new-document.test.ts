// Human: Unit tests for new-document naming and the empty-file builders.
import { describe, expect, it } from "vitest";
import {
  buildNewDocumentFile,
  NEW_DOCUMENT_TEMPLATES,
  uniqueDocumentName,
  type NewDocumentKind,
} from "@/lib/new-document";

function template(kind: NewDocumentKind) {
  const found = NEW_DOCUMENT_TEMPLATES.find((entry) => entry.kind === kind);
  if (!found) throw new Error(`missing template ${kind}`);
  return found;
}

// Human: jsdom's Blob has no text()/arrayBuffer(), so read through FileReader instead.
function readBlob(blob: Blob, as: "text"): Promise<string>;
function readBlob(blob: Blob, as: "buffer"): Promise<ArrayBuffer>;
function readBlob(blob: Blob, as: "text" | "buffer"): Promise<string | ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(reader.result as string | ArrayBuffer);
    if (as === "text") reader.readAsText(blob);
    else reader.readAsArrayBuffer(blob);
  });
}

describe("uniqueDocumentName", () => {
  it("uses the plain name when the folder is empty", () => {
    expect(uniqueDocumentName("Untitled", ".txt", [])).toBe("Untitled.txt");
  });

  it("counts up past names already in the folder", () => {
    expect(uniqueDocumentName("Untitled", ".txt", ["Untitled.txt"])).toBe("Untitled 2.txt");
    expect(uniqueDocumentName("Untitled", ".txt", ["Untitled.txt", "Untitled 2.txt"])).toBe(
      "Untitled 3.txt",
    );
  });

  it("ignores case and surrounding whitespace, like the server's collision check", () => {
    expect(uniqueDocumentName("Untitled", ".txt", ["  UNTITLED.TXT  "])).toBe("Untitled 2.txt");
  });

  it("leaves gaps alone rather than reusing a freed number", () => {
    // Human: "Untitled 2" is gone, so the next create takes it back — that is the expected behaviour.
    expect(uniqueDocumentName("Untitled", ".txt", ["Untitled.txt", "Untitled 3.txt"])).toBe(
      "Untitled 2.txt",
    );
  });

  it("does not collide with a different extension", () => {
    expect(uniqueDocumentName("Untitled", ".txt", ["Untitled.rtf"])).toBe("Untitled.txt");
  });
});

describe("buildNewDocumentFile", () => {
  it("creates an empty text file the editor can open", async () => {
    const file = await buildNewDocumentFile(template("text"), "Notes.txt");
    expect(file.name).toBe("Notes.txt");
    expect(file.type).toBe("text/plain");
    expect(file.size).toBe(0);
  });

  it("creates a valid, non-empty RTF document", async () => {
    const file = await buildNewDocumentFile(template("rich-text"), "Letter.rtf");
    const text = await readBlob(file, "text");
    // Human: An RTF reader rejects anything that does not open with the version header.
    expect(text.startsWith("{\\rtf1")).toBe(true);
    expect(file.type).toBe("application/rtf");
  });

  it("creates a workbook with the xlsx zip signature", async () => {
    const file = await buildNewDocumentFile(template("spreadsheet"), "Budget.xlsx");
    const header = new Uint8Array(await readBlob(file.slice(0, 2), "buffer"));
    // Human: "PK" — every .xlsx is a zip container.
    expect([...header]).toEqual([0x50, 0x4b]);
    expect(file.size).toBeGreaterThan(0);
  });
});
