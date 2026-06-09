// Human: Canonical Nebular-OS compression and Ownly ingest copy for public specs pages.
// Agent: READ by StorageSpecsPage, NebularOsSpecsPage; DESCRIBES NOSI env knobs wired via Compose.

/** Human: Two-phase zstd model plus optional NOSI block tuning. */
export const NEBULAR_ZSTD_PHASE_ROWS = [
  {
    phase: "Upload (PUT)",
    env: "NOS_ZSTD_LEVEL_UPLOAD",
    level: "3 (default)",
    note: "Fast path — new blobs written as NOSI with upload level",
  },
  {
    phase: "Background / recompress",
    env: "NOS_ZSTD_LEVEL",
    level: "22 (default)",
    note: "Migrates legacy formats to NOSI and upgrades low-level blobs when smaller",
  },
  {
    phase: "Optional dictionary",
    env: "NOS_ZSTD_DICT_ENABLED",
    level: "off (default)",
    note: "Trains a global zstd dict under the blob data directory",
  },
  {
    phase: "Optional dedup",
    env: "NOS_DEDUP_ENABLED",
    level: "off (default)",
    note: "Unified block dedup with content-addressed .blocks/ store",
  },
] as const;

/** Human: On-disk blob headers Nebular reads transparently on GET. */
export const NEBULAR_ON_DISK_FORMAT_ROWS = [
  {
    magic: "NOSI",
    detail: "Current indexed block layout — checksums, optional dedup refs, per-block zstd or raw",
  },
  {
    magic: "NOSB",
    detail: "Legacy block-compressed header — still readable; recompress can migrate to NOSI",
  },
  {
    magic: "NOS2",
    detail: "Legacy tiered header — still readable; recompress can upgrade",
  },
  {
    magic: "raw",
    detail: "Uncompressed blob — eligible for first NOSI pass via upload or recompress",
  },
] as const;

/** Human: How Ownly uses Nebular vs Postgres encryption (honest operator summary). */
export const OWNLY_STORAGE_ENCRYPTION_SUMMARY =
  "Drive uploads send plaintext bytes to Nebular so zstd can compress documents, images, and source files. " +
  "Only HLS streaming segments are AES-128-CBC encrypted before PUT; ciphertext rarely shrinks under indexed zstd. " +
  "Per-file content keys and AES-256-GCM wrapping live in Postgres, not inside every blob.";

/** Human: Folder zip exports — deflate only, not Nebular blob format. */
export const OWNLY_FOLDER_ZIP_NOTE =
  "Multi-file folder downloads use server-side ZIP with deflate level 9 — export size only, not stored blobs.";
