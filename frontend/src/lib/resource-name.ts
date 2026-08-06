// Human: Client-side mirror of the API's file and folder name rules, used by the rename dialog.
// Agent: PURE; MIRRORS backend normalize_upload_filename + normalize_folder_name — keep the two in step.

import { splitFilenameExtension } from "@/lib/explorer-grid-filename";

export type ResourceKind = "file" | "folder";

/** Human: Longest name the API accepts, counted in UTF-8 bytes exactly like the server does. */
export const MAX_RESOURCE_NAME_BYTES = 255;

/** Human: Names the API rejects outright because they address a directory, not a resource. */
const RESERVED_NAMES = new Set([".", ".."]);

// Human: Byte length, not character count — an emoji costs four of the server's 255.
export function resourceNameByteLength(name: string): number {
  return new TextEncoder().encode(name).length;
}

/**
 * Human: Which part of the name the rename field should preselect.
 * Agent: FILES preselect the stem so the extension survives a straight retype; FOLDERS select all.
 */
export function splitRenameSelection(
  name: string,
  kind: ResourceKind,
): { stem: string; extension: string } {
  if (kind === "folder") {
    return { stem: name, extension: "" };
  }
  const { base, extension } = splitFilenameExtension(name);
  return { stem: base, extension };
}

/**
 * Human: Why the API would reject this name, or "" when it would accept it.
 * Agent: CHECKED before the request so the user sees the problem inline, not as a page banner.
 */
export function validateResourceName(input: {
  name: string;
  kind: ResourceKind;
  /** Human: Names already used in this folder, excluding the item being renamed. */
  siblingNames?: readonly string[];
}): string {
  const { name, kind, siblingNames = [] } = input;
  const trimmed = name.trim();
  const label = kind === "folder" ? "Folder" : "File";

  if (trimmed.length === 0) {
    return `${label} name is required.`;
  }
  if (RESERVED_NAMES.has(trimmed)) {
    return `“${trimmed}” is not a valid ${kind} name.`;
  }
  if (trimmed.includes("/") || trimmed.includes("\\")) {
    return `${label} name cannot contain / or \\.`;
  }
  // Human: Control characters survive a paste from a terminal or spreadsheet and the API rejects them.
  if ([...trimmed].some((character) => (character.codePointAt(0) ?? 0) < 32)) {
    return `${label} name cannot contain control characters.`;
  }
  if (resourceNameByteLength(trimmed) > MAX_RESOURCE_NAME_BYTES) {
    return `${label} name must be ${MAX_RESOURCE_NAME_BYTES} bytes or fewer.`;
  }
  const collides = siblingNames.some(
    (sibling) => sibling.trim().toLowerCase() === trimmed.toLowerCase(),
  );
  if (collides) {
    return `A ${kind} named “${trimmed}” already exists here.`;
  }
  return "";
}
