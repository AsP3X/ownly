# File version history

← [Back to main README](../README.md) · [Documentation index](./README.md)

Editing a file's contents in Ownly never destroys the bytes it replaces. Each content write archives
the previous state as a **version**, which the owner can view, download, or restore.

---

## Why copy-on-write

Ownly stores one blob per distinct content hash per user (migration
`035_files_storage_key_shared_dedup.sql`), so **several `files` rows can point at the same
`storage_key`**. The original content-replace handler wrote over that object in place, which meant:

- Editing one file silently rewrote every other file that shared its blob.
- Anyone with an editable public link could permanently replace the owner's only copy — the recycle
  bin covers deletes, not overwrites.
- `files.content_hash` was never updated, so a later upload of the original bytes deduped onto a blob
  that had since been edited.

Version history fixes all three by never mutating an existing blob. A write allocates a **new** key
and repoints the row; the old key becomes an immutable version.

---

## Storage layout

| Key shape | Holds |
|-----------|-------|
| `users/{uid}/files/{fid}` | Content as originally uploaded, plus derived sidecars (HLS, thumbnails) |
| `users/{uid}/revisions/{uuid}` | Bytes written by a content edit — flat, single object, no sidecars |

The `revisions/` namespace is deliberate. Blob purge deletes by prefix (`{storage_key}/`), and
`file_id_from_storage_key` only matches `users/*/files/*`. Placing a live blob under another row's
file prefix would make it collateral damage when that row is deleted; `revisions/` sits outside every
file's purge scope and routes through the `storage_blob_placements` cache instead.

---

## Lifecycle

**On write** (`PUT /files/{id}/content`, or the public-share edit route):

1. Hash the incoming bytes. Identical to the stored `content_hash`? Return early — no blob write, no
   version, no audit entry. This keeps editor autosave from spamming history.
2. Check the owner's quota for the incoming bytes (versions occupy real disk).
3. PUT the new bytes at a fresh `users/{uid}/revisions/{uuid}` key.
4. In one transaction: insert a `file_versions` row describing the **outgoing** state, then update
   `files` with the new `storage_key`, `size_bytes`, `content_hash`, and `revision`.
   The update is guarded on the previous revision number, so a concurrent save loses and gets `409`.
5. Prune versions beyond the retention cap and invalidate stale document previews.

**On restore:** the current bytes are archived as a new version, then `files` is repointed at the
target version's blob. No bytes are copied — the archived blob is immutable and simply becomes
referenced twice. Restoring is therefore itself undoable.

**On delete:** version blob keys are captured *before* the `DELETE` (the FK cascades `file_versions`
away), then purged — skipping any key still referenced by another row.

---

## Refcounting

`storage_key_still_referenced` and `storage_keys_still_referenced` check **both** `files` and
`file_versions`. A blob is deleted only when neither table points at it. This matters because one key
can legitimately be referenced by a live file and one or more versions at the same time (after a
restore), or by two deduped files (after upload).

If the refcount query fails, purge is skipped. An orphaned blob costs disk; a wrong delete costs data.

---

## API

| Method | Route | Notes |
|--------|-------|-------|
| `GET` | `/api/v1/files/{id}/versions` | Newest first; requires `content.read` |
| `GET` | `/api/v1/files/{id}/versions/{version_id}/content` | Downloads as `name (vN).ext` |
| `POST` | `/api/v1/files/{id}/versions/{version_id}/restore` | Requires `content.write` |

`GET /versions` also returns `current_revision` (the live bytes) and `retention_limit`.

Each archived version records `created_via`: `user`, `public_share` (anonymous link edit — `created_by`
is `NULL`), or `restore`.

---

## Configuration

**Admin console → System Settings → Security → File Version History**, backed by the
`file_version_max_per_file` app setting.

| Value | Effect |
|-------|--------|
| `25` (default) | Keep the 25 most recent versions per file; prune older ones |
| `0` | Keep every version — unbounded growth against user quotas |

Archived versions count toward the owner's storage quota (`quota.rs` sums `file_versions.size_bytes`
alongside live files), including versions created by anonymous public-link editors.

---

## Limitations

- **Only content writes are versioned.** Re-uploading a file with the same name creates a separate
  file rather than a new revision of the existing one.
- **Storage node migration skips revision blobs** — `storage_migration_runs` enumerates
  `files.storage_key` only.
- **No per-version delete** in the UI; retention is enforced only by the cap.
- **The iOS client** does not surface version history.

---

## Related documents

- [Architecture](./architecture.md)
- [Storage / disk tuning](./storage-disk-tuning.md)
- [Improvement roadmap](./improvement-roadmap.md) §1.3
