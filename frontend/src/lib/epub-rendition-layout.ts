// Human: Measure and wait for the epub.js host element before renderTo/resize.
// Agent: READS DOM bounds; RETURNS pixel width/height so paginated layout centers correctly.

/** Waits until the host has non-zero layout dimensions (flex column may settle after paint). */
export async function waitForRenditionHostLayout(node: HTMLElement, attempts = 8): Promise<void> {
  for (let index = 0; index < attempts; index += 1) {
    const { width, height } = node.getBoundingClientRect();
    if (width > 0 && height > 0) return;

    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
    });
  }
}

/** Returns floored pixel dimensions for epub.js renderTo/resize (never zero). */
export function measureRenditionHost(node: HTMLElement): { width: number; height: number } {
  const bounds = node.getBoundingClientRect();
  return {
    width: Math.max(1, Math.floor(bounds.width)),
    height: Math.max(1, Math.floor(bounds.height)),
  };
}
