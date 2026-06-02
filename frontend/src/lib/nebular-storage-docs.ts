// Human: Canonical Nebular-OS compression and Ownly ingest copy for public specs pages.
// Agent: READ by StorageSpecsPage, NebularOsSpecsPage; DESCRIBES env knobs Ownly wires via Compose — not size-tier fiction.

/** Human: Two-phase zstd model shipped in Nebular (upload vs maintenance). */
export const NEBULAR_ZSTD_PHASE_ROWS = [
  {
    phase: "Upload (PUT)",
    env: "NOS_ZSTD_LEVEL_UPLOAD",
    level: "3 (default)",
    note: "Fast path — new blobs written as NOS2 with upload level",
  },
  {
    phase: "Background / recompress",
    env: "NOS_ZSTD_LEVEL",
    level: "22 (default)",
    note: "Upgrades legacy raw, NOSZ, and low-level NOS2 when smaller",
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
    note: "Block manifests (NOSD) for large repetitive payloads",
  },
] as const;

/** Human: On-disk blob headers Nebular reads transparently on GET. */
export const NEBULAR_ON_DISK_FORMAT_ROWS = [
  {
    magic: "NOS2",
    detail: "Current format — logical size, optional dict id, stored zstd level",
  },
  {
    magic: "NOSZ",
    detail: "Legacy v1 header — still readable; recompress can upgrade",
  },
  {
    magic: "NOSD",
    detail: "Dedup manifest when NOS_DEDUP_ENABLED",
  },
  {
    magic: "raw",
    detail: "Uncompressed blob — eligible for first compression pass",
  },
] as const;

/** Human: How Ownly uses Nebular vs Postgres encryption (honest operator summary). */
export const OWNLY_STORAGE_ENCRYPTION_SUMMARY =
  "Drive uploads send plaintext bytes to Nebular so zstd can compress documents, images, and source files. " +
  "Only HLS streaming segments are AES-128-CBC encrypted before PUT; ciphertext rarely shrinks under zstd. " +
  "Per-file content keys and AES-256-GCM wrapping live in Postgres, not inside every blob.";

/** Human: Folder zip exports — deflate only, not Nebular blob format. */
export const OWNLY_FOLDER_ZIP_NOTE =
  "Multi-file folder downloads use server-side ZIP with deflate level 9 — export size only, not stored blobs.";
