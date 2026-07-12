// Human: epub.js needs binary input — blob URLs without a .epub suffix are treated as unpacked folders.
// Agent: READS Blob bytes; OPENS Book via ArrayBuffer + openAs binary; no object URL required.

import ePub, { type Book } from "epubjs";

/** Opens an EPUB archive from downloaded bytes (not a directory URL). */
export async function openEpubBookFromBlob(blob: Blob): Promise<Book> {
  const buffer = await blob.arrayBuffer();
  const book = ePub(buffer, { openAs: "binary" });
  await book.ready;
  return book;
}

// Human: Legacy object-URL helpers kept for callers that still revoke blob URLs on close.
// Agent: CREATE via URL.createObjectURL(blob); REVOKE when preview closes or the source file changes.
export function createEpubBlobObjectUrl(blob: Blob): string {
  return URL.createObjectURL(blob);
}

export function revokeEpubBlobObjectUrl(url: string | null | undefined): void {
  if (url) URL.revokeObjectURL(url);
}
