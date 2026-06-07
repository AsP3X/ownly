// Human: Detect animated GIFs so the preview pipeline can skip canvas downscale (which keeps only frame 1).
// Agent: READS GIF block structure; RETURNS true when multiple image descriptors or NETSCAPE2.0 loop is present.

const GIF_SCAN_BYTES = 512 * 1024;

function isGifHeaderBytes(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 6 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38 &&
    (bytes[4] === 0x37 || bytes[4] === 0x39) &&
    bytes[5] === 0x61
  );
}

function hasNetscapeLoopExtension(bytes: Uint8Array): boolean {
  for (let index = 0; index < bytes.length - 13; index += 1) {
    if (bytes[index] !== 0x21 || bytes[index + 1] !== 0xff || bytes[index + 2] !== 0x0b) {
      continue;
    }
    const label = String.fromCharCode(
      bytes[index + 3] ?? 0,
      bytes[index + 4] ?? 0,
      bytes[index + 5] ?? 0,
      bytes[index + 6] ?? 0,
      bytes[index + 7] ?? 0,
      bytes[index + 8] ?? 0,
      bytes[index + 9] ?? 0,
      bytes[index + 10] ?? 0,
      bytes[index + 11] ?? 0,
      bytes[index + 12] ?? 0,
      bytes[index + 13] ?? 0,
    );
    if (label === "NETSCAPE2.0") return true;
  }
  return false;
}

// Human: Walk GIF blocks and count image descriptors — reliable across encoders (not just GCE byte pairs).
// Agent: READS logical screen + extensions + 0x2C frames; RETURNS true when frames > 1.
export function isAnimatedGifBytes(bytes: Uint8Array): boolean {
  if (!isGifHeaderBytes(bytes) || bytes.length < 13) return false;
  if (hasNetscapeLoopExtension(bytes)) return true;

  const packed = bytes[10] ?? 0;
  let offset = 13;
  if (packed & 0x80) {
    offset += 3 * (2 << (packed & 0x07));
  }

  let frames = 0;
  while (offset < bytes.length) {
    const blockType = bytes[offset];
    if (blockType === undefined) break;
    offset += 1;

    switch (blockType) {
      case 0x21: {
        if (offset >= bytes.length) return frames > 1;
        const label = bytes[offset];
        offset += 1;

        if (label === 0xff) {
          if (offset >= bytes.length) return frames > 1;
          const blockSize = bytes[offset] ?? 0;
          offset += 1 + blockSize;
          while (offset < bytes.length && bytes[offset] !== 0x00) {
            const size = bytes[offset] ?? 0;
            offset += 1 + size;
          }
          if (offset < bytes.length) offset += 1;
        } else if (label === 0xf9) {
          offset += 5;
        } else if (label === 0xfe || label === 0x01) {
          if (label === 0x01) offset += 12;
          while (offset < bytes.length && bytes[offset] !== 0x00) {
            const size = bytes[offset] ?? 0;
            offset += 1 + size;
          }
          if (offset < bytes.length) offset += 1;
        } else {
          return frames > 1;
        }
        break;
      }
      case 0x2c: {
        frames += 1;
        if (frames > 1) return true;
        if (offset + 8 >= bytes.length) return false;
        offset += 9;
        const localPacked = bytes[offset] ?? 0;
        offset += 1;
        if (localPacked & 0x80) {
          offset += 3 * (2 << (localPacked & 0x07));
        }
        if (offset >= bytes.length) return false;
        offset += 1;
        while (offset < bytes.length && bytes[offset] !== 0x00) {
          const size = bytes[offset] ?? 0;
          offset += 1 + size;
        }
        if (offset < bytes.length) offset += 1;
        break;
      }
      case 0x3b:
        return frames > 1;
      default:
        return frames > 1;
    }
  }

  return frames > 1;
}

// Human: True when the blob should keep original GIF bytes (mime or magic header).
// Agent: READS source.type and GIF signature; used to skip canvas resize even if frame parse fails.
export function isGifBlob(source: Blob): boolean {
  return isGifMimeType(source.type);
}

export function isGifMimeType(mimeType: string): boolean {
  return mimeType.toLowerCase().includes("gif");
}

// Human: True when the drive row should use the GIF preview path (mime or .gif extension).
// Agent: READS FileItem.mime_type + name; used to skip mobile downscale and pick stream URLs.
export function isGifPreviewFile(file: {
  mime_type?: string | null;
  name?: string | null;
}): boolean {
  if (isGifMimeType(file.mime_type ?? "")) return true;
  return (file.name ?? "").toLowerCase().endsWith(".gif");
}

// Human: iOS Safari freezes animated <img> inside modals — canvas playback is required there.
// Agent: READS userAgent + maxTouchPoints; RETURNS true for iPhone/iPad/iPadOS desktop UA.
export function shouldUseGifCanvasPlayback(): boolean {
  if (typeof navigator === "undefined") return false;

  const ua = navigator.userAgent;
  const isAppleMobile = /iPad|iPhone|iPod/.test(ua);
  const isIpadDesktopUa =
    navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;

  return isAppleMobile || isIpadDesktopUa;
}

// Human: Async wrapper — scans the full file when small, otherwise the first chunk then full file if inconclusive.
// Agent: READS source bytes; CALLS isAnimatedGifBytes; handles missing mime types via magic header.
export async function isAnimatedGifBlob(source: Blob): Promise<boolean> {
  if (isGifBlob(source)) return true;

  const headerBuffer = await source.slice(0, 6).arrayBuffer();
  if (!isGifHeaderBytes(new Uint8Array(headerBuffer))) return false;

  if (source.size <= GIF_SCAN_BYTES) {
    const buffer = await source.arrayBuffer();
    return isAnimatedGifBytes(new Uint8Array(buffer));
  }

  const partialBuffer = await source.slice(0, GIF_SCAN_BYTES).arrayBuffer();
  const partialBytes = new Uint8Array(partialBuffer);
  if (isAnimatedGifBytes(partialBytes)) return true;

  const fullBuffer = await source.arrayBuffer();
  return isAnimatedGifBytes(new Uint8Array(fullBuffer));
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
