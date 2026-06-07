// Human: Detect animated GIFs so the preview pipeline can skip canvas downscale (which keeps only frame 1).
// Agent: READS GIF header + Graphic Control Extension markers; RETURNS true when multiple frames are likely.

const GIF_SCAN_BYTES = 512 * 1024;

// Human: Scan raw bytes for GIF89a/87a header and more than one animation frame marker.
// Agent: READS Uint8Array slice; RETURNS true when 0x21 0xF9 (Graphic Control Extension) appears twice+.
export function isAnimatedGifBytes(bytes: Uint8Array): boolean {
  if (bytes.length < 6) return false;

  const isGifHeader =
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38 &&
    (bytes[4] === 0x37 || bytes[4] === 0x39) &&
    bytes[5] === 0x61;
  if (!isGifHeader) return false;

  let graphicControlExtensions = 0;
  for (let index = 0; index < bytes.length - 1; index += 1) {
    if (bytes[index] === 0x21 && bytes[index + 1] === 0xf9) {
      graphicControlExtensions += 1;
      if (graphicControlExtensions > 1) return true;
    }
  }

  return false;
}

// Human: Async wrapper for blob sources — reads only the first chunk to keep detection cheap.
// Agent: READS source.slice; CALLS isAnimatedGifBytes; safe when mime type is missing or generic.
export async function isAnimatedGifBlob(source: Blob): Promise<boolean> {
  const scanLength = Math.min(source.size, GIF_SCAN_BYTES);
  if (scanLength < 6) return false;

  const buffer = await source.slice(0, scanLength).arrayBuffer();
  return isAnimatedGifBytes(new Uint8Array(buffer));
}

// Human: First-frame dimensions for letterbox layout without re-encoding the GIF.
// Agent: USES createImageBitmap; CLOSES bitmap; RETURNS 0×0 on decode failure.
export async function readImageNaturalDimensions(
  source: Blob,
): Promise<{ naturalWidth: number; naturalHeight: number }> {
  try {
    const bitmap = await createImageBitmap(source);
    try {
      return { naturalWidth: bitmap.width, naturalHeight: bitmap.height };
    } finally {
      bitmap.close();
    }
  } catch {
    return { naturalWidth: 0, naturalHeight: 0 };
  }
}
