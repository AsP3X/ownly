// Human: epub.js needs binary input — blob URLs without a .epub suffix are treated as unpacked folders.
// Agent: READS Blob bytes; OPENS Book via ArrayBuffer + openAs binary; no object URL required.

import ePub, { type Book } from "epubjs";

/** Opens an EPUB archive from downloaded bytes (not a directory URL). */
export async function openEpubBookFromBlob(blob: Blob): Promise<Book> {
  const buffer = await blob.arrayBuffer();
  const book = ePub(buffer, { openAs: "binary" });
  // Human: Rendition waits on book.opened (includes archived asset replacement), not just book.ready.
  // Agent: AWAITS book.ready then book.opened before renderTo so book.package exists when start() runs.
  await book.ready;
  await book.opened;
  // Human: CSS replacement and spine indexing can still finish after opened resolves.
  // Agent: AWAITS loaded.* promises so renderTo/start never races archive parsing workers.
  await Promise.all([
    book.loaded.metadata,
    book.loaded.navigation,
    book.loaded.spine,
    book.loaded.resources,
  ]);

  const bookWithPackage = book as Book & { package?: unknown };
  if (!bookWithPackage.package) {
    throw new Error("EPUB package metadata failed to load.");
  }

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
