// Human: Canonical Nebular-OS compression and Ownly ingest copy for public specs pages.
// Agent: READ by StorageSpecsPage, NebularOsSpecsPage; DESCRIBES NOSB block-compression env knobs wired via Compose.

/** Human: Block-compression tuning env vars (feat/block-compression). */
export const NEBULAR_ZSTD_PHASE_ROWS = [
  {
    phase: "Block writes (PUT)",
    env: "NOS_ZSTD_LEVEL",
    level: "3 in Compose (22 upstream default)",
    note: "Single zstd level for NOSB block compression — lower is faster",
  },
  {
    phase: "Minimum size",
    env: "NOS_COMPRESS_MIN_SIZE",
    level: "4096 (default)",
    note: "Objects smaller than this stay raw on disk",
  },
  {
    phase: "Block size",
    env: "NOS_COMPRESS_BLOCK_SIZE",
    level: "1048576 (default)",
    note: "Uncompressed bytes per NOSB block before independent zstd/raw choice",
  },
  {
    phase: "Background recompress",
    env: "NOS_RECOMPRESS_INTERVAL_SECS",
    level: "3600 in Compose",
    note: "Periodic scan rewrites raw blobs as NOSB when smaller",
  },
] as const;

/** Human: On-disk blob headers Nebular reads transparently on GET. */
export const NEBULAR_ON_DISK_FORMAT_ROWS = [
  {
    magic: "NOSB",
    detail: "Current block-compressed layout — header, per-block index, zstd or raw blocks",
  },
  {
    magic: "NOS2",
    detail: "Legacy pre-block-compression header — not readable after upgrade; re-upload required",
  },
  {
    magic: "NOSZ",
    detail: "Legacy v1 whole-object zstd — not readable after upgrade; re-upload required",
  },
  {
    magic: "raw",
    detail: "Uncompressed blob — eligible for first NOSB pass via upload or recompress",
  },
] as const;

/** Human: How Ownly uses Nebular vs Postgres encryption (honest operator summary). */
export const OWNLY_STORAGE_ENCRYPTION_SUMMARY =
  "Drive uploads send plaintext bytes to Nebular so zstd can compress documents, images, and source files. " +
  "Only HLS streaming segments are AES-128-CBC encrypted before PUT; ciphertext rarely shrinks under block zstd. " +
  "Per-file content keys and AES-256-GCM wrapping live in Postgres, not inside every blob.";

/** Human: Folder zip exports — deflate only, not Nebular blob format. */
export const OWNLY_FOLDER_ZIP_NOTE =
  "Multi-file folder downloads use server-side ZIP with deflate level 9 — export size only, not stored blobs.";
