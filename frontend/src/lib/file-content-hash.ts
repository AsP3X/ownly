// Human: Compute SHA-256 digests for browser File objects before upload duplicate checks.
// Agent: READS file slices in chunks; RETURNS lowercase hex matching backend content_hash.

import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

const HASH_CHUNK_BYTES = 4 * 1024 * 1024;

/** Human: Bound parallel SHA-256 work so large folder picks do not freeze the tab. */
export const HASH_CONCURRENCY = 3;

// Human: Stream a File through SHA-256 without loading multi-gigabyte uploads into memory.
// Agent: UPDATES noble hasher per slice; RETURNS 64-char lowercase hex digest.
export async function computeFileContentHash(
  file: File,
  options?: { signal?: AbortSignal },
): Promise<string> {
  const hasher = sha256.create();
  let offset = 0;

  while (offset < file.size) {
    if (options?.signal?.aborted) {
      throw new DOMException("Hashing cancelled", "AbortError");
    }
    const chunk = file.slice(offset, offset + HASH_CHUNK_BYTES);
    const buffer = new Uint8Array(await chunk.arrayBuffer());
    hasher.update(buffer);
    offset += HASH_CHUNK_BYTES;
  }

  return bytesToHex(hasher.digest());
}

export type UploadCheckCandidate = {
  name: string;
  size_bytes: number;
  content_hash: string;
};

export type HashProgress = {
  completed: number;
  total: number;
  currentName?: string;
};

// Human: Hash pending upload rows with bounded concurrency and optional progress callbacks.
// Agent: WORKER pool of HASH_CONCURRENCY; CALLS onProgress after each file; SUPPORTS AbortSignal.
export async function buildUploadCheckCandidates(
  files: File[],
  options?: {
    concurrency?: number;
    signal?: AbortSignal;
    onProgress?: (progress: HashProgress) => void;
  },
): Promise<UploadCheckCandidate[]> {
  const total = files.length;
  if (total === 0) return [];

  const concurrency = Math.max(1, Math.min(options?.concurrency ?? HASH_CONCURRENCY, total));
  const results: UploadCheckCandidate[] = new Array(total);
  let nextIndex = 0;
  let completed = 0;

  async function worker() {
    while (nextIndex < total) {
      if (options?.signal?.aborted) {
        throw new DOMException("Hashing cancelled", "AbortError");
      }
      const index = nextIndex;
      nextIndex += 1;
      const file = files[index]!;
      options?.onProgress?.({
        completed,
        total,
        currentName: file.name,
      });
      const content_hash = await computeFileContentHash(file, { signal: options?.signal });
      results[index] = {
        name: file.name,
        size_bytes: Math.max(0, Math.floor(Number(file.size) || 0)),
        content_hash,
      };
      completed += 1;
      options?.onProgress?.({
        completed,
        total,
        currentName: file.name,
      });
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return results;
}
