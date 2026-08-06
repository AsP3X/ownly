// Human: Unit tests for the client-side mirror of the API's name rules.
import { describe, expect, it } from "vitest";
import {
  MAX_RESOURCE_NAME_BYTES,
  resourceNameByteLength,
  splitRenameSelection,
  validateResourceName,
} from "@/lib/resource-name";

describe("splitRenameSelection", () => {
  it("keeps the extension out of the preselected stem for files", () => {
    expect(splitRenameSelection("report-final.pdf", "file")).toEqual({
      stem: "report-final",
      extension: ".pdf",
    });
  });

  it("treats a dotfile as all stem — there is no extension to protect", () => {
    expect(splitRenameSelection(".gitignore", "file")).toEqual({
      stem: ".gitignore",
      extension: "",
    });
  });

  it("selects the whole name for folders", () => {
    expect(splitRenameSelection("Tax Archives 2025", "folder")).toEqual({
      stem: "Tax Archives 2025",
      extension: "",
    });
  });
});

describe("validateResourceName", () => {
  it("accepts an ordinary rename", () => {
    expect(validateResourceName({ name: "notes.txt", kind: "file" })).toBe("");
  });

  it("rejects empty and whitespace-only names", () => {
    expect(validateResourceName({ name: "   ", kind: "file" })).toBe("File name is required.");
    expect(validateResourceName({ name: "", kind: "folder" })).toBe(
      "Folder name is required.",
    );
  });

  it("rejects path separators the API would refuse", () => {
    expect(validateResourceName({ name: "a/b.txt", kind: "file" })).toBe(
      "File name cannot contain / or \\.",
    );
    expect(validateResourceName({ name: "a\\b", kind: "folder" })).toBe(
      "Folder name cannot contain / or \\.",
    );
  });

  it("rejects the directory-relative names", () => {
    expect(validateResourceName({ name: "..", kind: "folder" })).toBe(
      "“..” is not a valid folder name.",
    );
  });

  it("rejects control characters that survive a paste", () => {
    expect(validateResourceName({ name: "bad\u0007name.txt", kind: "file" })).toBe(
      "File name cannot contain control characters.",
    );
  });

  it("measures the length limit in bytes, like the server", () => {
    const asciiAtLimit = "a".repeat(MAX_RESOURCE_NAME_BYTES);
    expect(validateResourceName({ name: asciiAtLimit, kind: "file" })).toBe("");

    // Human: 64 four-byte emoji = 256 bytes, but only 64 code points — a char count would pass this.
    const emojiOverLimit = "😀".repeat(64);
    expect(resourceNameByteLength(emojiOverLimit)).toBe(256);
    expect(validateResourceName({ name: emojiOverLimit, kind: "file" })).toBe(
      "File name must be 255 bytes or fewer.",
    );
  });

  it("catches a duplicate before the request, ignoring case", () => {
    expect(
      validateResourceName({
        name: "Report.pdf",
        kind: "file",
        siblingNames: ["notes.txt", "report.pdf"],
      }),
    ).toBe("A file named “Report.pdf” already exists here.");
  });

  it("allows a name that only collides with the item being renamed", () => {
    expect(
      validateResourceName({ name: "report.pdf", kind: "file", siblingNames: ["notes.txt"] }),
    ).toBe("");
  });
});
