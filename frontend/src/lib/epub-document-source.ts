// Human: epub.js loads from object URLs — revoke when preview closes to free memory.
// Agent: CREATE via URL.createObjectURL(blob); REVOKE when preview closes or the source file changes.

export function createEpubBlobObjectUrl(blob: Blob): string {
  return URL.createObjectURL(blob);
}

export function revokeEpubBlobObjectUrl(url: string | null | undefined): void {
  if (url) URL.revokeObjectURL(url);
}
