// Human: Compute SHA-256 digests for browser File objects before upload duplicate checks.
// Agent: READS file slices in chunks; RETURNS lowercase hex matching backend content_hash.

import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

const HASH_CHUNK_BYTES = 4 * 1024 * 1024;

// Human: Stream a File through SHA-256 without loading multi-gigabyte uploads into memory.
// Agent: UPDATES noble hasher per slice; RETURNS 64-char lowercase hex digest.
export async function computeFileContentHash(file: File): Promise<string> {
  const hasher = sha256.create();
  let offset = 0;

  while (offset < file.size) {
    const chunk = file.slice(offset, offset + HASH_CHUNK_BYTES);
    const buffer = new Uint8Array(await chunk.arrayBuffer());
    hasher.update(buffer);
    offset += HASH_CHUNK_BYTES;
  }

  return bytesToHex(hasher.digest());
}

// Human: Hash every pending upload row in parallel for the preflight duplicate API.
// Agent: CALLS computeFileContentHash per File; RETURNS name, size_bytes, and content_hash.
export async function buildUploadCheckCandidates(
  files: File[],
): Promise<Array<{ name: string; size_bytes: number; content_hash: string }>> {
  return Promise.all(
    files.map(async (file) => ({
      name: file.name,
      size_bytes: Math.max(0, Math.floor(Number(file.size) || 0)),
      content_hash: await computeFileContentHash(file),
    })),
  );
}
