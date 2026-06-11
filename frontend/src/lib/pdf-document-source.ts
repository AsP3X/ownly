// Human: pdf.js may detach ArrayBuffer passed to its worker — object URLs survive React re-renders.
// Agent: CREATE via URL.createObjectURL(blob); REVOKE when preview closes or the source file changes.

export function createPdfBlobObjectUrl(blob: Blob): string {
  return URL.createObjectURL(blob);
}

export function revokePdfBlobObjectUrl(url: string | null | undefined): void {
  if (url) URL.revokeObjectURL(url);
}
