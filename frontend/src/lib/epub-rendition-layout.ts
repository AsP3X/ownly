// Human: Measure and wait for the epub.js host element before renderTo/resize.
// Agent: READS DOM bounds; RETURNS pixel width/height so layout centers correctly.

const MIN_HOST_WIDTH_PX = 160;
const MIN_HOST_HEIGHT_PX = 160;

/** Waits until the host has stable, usable layout dimensions. */
export async function waitForRenditionHostLayout(node: HTMLElement, attempts = 16): Promise<void> {
  let lastWidth = 0;
  let lastHeight = 0;
  let stableFrames = 0;

  for (let index = 0; index < attempts; index += 1) {
    const { width, height } = node.getBoundingClientRect();
    const usable = width >= MIN_HOST_WIDTH_PX && height >= MIN_HOST_HEIGHT_PX;

    if (usable && width === lastWidth && height === lastHeight) {
      stableFrames += 1;
      if (stableFrames >= 2) return;
    } else {
      stableFrames = 0;
    }

    lastWidth = width;
    lastHeight = height;

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

/** Re-measures after paint so resize runs with settled flex layout. */
export async function nextFrame(): Promise<void> {
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}
