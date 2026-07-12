# EPUB Grid Thumbnails Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans.

**Goal:** Ship server-generated EPUB cover thumbnails in the file browser grid, matching the existing PDF document sidecar pipeline (`grid-thumbnail.jpg` + `document_thumbnail_*` fields + shimmer/poll + `ExplorerDocumentThumbnail`).

**Architecture:** Extend the existing `DocumentThumbnail` worker — no new job kind. On upload (and via migration for existing rows), EPUB files enqueue the same job. Worker extracts cover image from the EPUB ZIP/OPF, resizes to `DOCUMENT_PREVIEW_MAX_EDGE`, stores JPEG sidecar. Frontend reuses `ExplorerDocumentThumbnail` and `loadExplorerDocumentThumbnailBlob`.

**Tech Stack:** Rust (`zip`, `quick-xml`, `image`), existing background jobs, React explorer grid.

**Out of scope:** Client-side epub.js tile rendering; new API endpoints; EPUB reader changes.

---

## Task 1: Backend EPUB MIME + cover extraction

**Files:**
- `backend/Cargo.toml` — add `quick-xml` dependency (direct)
- `backend/src/document/mime.rs` — add `is_epub_mime`; include in `qualifies_for_document_grid_thumbnail`
- `backend/src/document/epub_cover.rs` — **new** — extract cover image bytes from EPUB archive
- `backend/src/document/thumbnail.rs` — dispatch EPUB to cover → JPEG path
- `backend/src/document/mod.rs` — export `epub_cover` module
- `backend/src/document/epub_cover.rs` `#[cfg(test)]` — unit tests with in-memory minimal EPUB fixture

**Requirements:**
- `is_epub_mime` matches frontend `isEpubMime`: `application/epub+zip`, `application/epub`, `.epub` extension fallback
- Cover resolution order (EPUB 2/3):
  1. Manifest item with `properties` containing `cover-image`
  2. `<meta name="cover" content="…"/>` pointing at manifest id
  3. First manifest item whose `media-type` starts with `image/`
- Decode cover with `image` crate; resize with `resize_to_max_edge`; encode JPEG via existing `encode_jpeg` at `DOCUMENT_PREVIEW_JPEG_QUALITY`
- If no cover found, return clear error string (job marks `document_thumbnail_status = failed`)
- Inline comments per project rules (`// Human:` + `// Agent:` on non-trivial logic)

**Verification:**
```bash
cd backend && cargo test document::epub_cover document::mime -- --nocapture
cd backend && cargo clippy -p ownly-backend -- -D warnings
```

---

## Task 2: Migration + recovery + delete alignment

**Files:**
- `backend/migrations/postgres/031_epub_grid_thumbnails.sql` — **new** — queue existing EPUB files for thumbnail generation
- `backend/src/jobs/recovery.rs` — extend orphaned document thumbnail SQL to include EPUB mime/extension
- `backend/src/files/file_delete.rs` — include EPUB in `should_skip_prefix_listing` (deterministic sidecar keys)

**Requirements:**
- Migration sets `document_thumbnail_ready = false`, `document_thumbnail_status = 'queued'`, clears error for non-deleted EPUB rows (`application/epub%` or name `%.epub`)
- Recovery query OR-clause includes EPUB (mirror migration predicates)
- Do **not** edit prior migration files

**Verification:**
```bash
cd backend && cargo test
cd backend && cargo clippy -p ownly-backend -- -D warnings
```

---

## Task 3: Frontend grid thumbnail wiring

**Files:**
- `frontend/src/lib/file-processing.ts` — include EPUB in `explorerThumbnailPollState` via `isEpubMime`
- `frontend/src/lib/explorer-thumbnail-prefetch.ts` — prefetch/touch EPUB document sidecars
- `frontend/src/components/drive/ExplorerGridTiles.tsx` — `showDocumentPreview` includes EPUB
- `frontend/src/components/drive/ExplorerDocumentThumbnail.tsx` — EPUB layout (object-contain cover, `BookOpen` fallback icon) + `isEpubMime`
- `frontend/src/lib/utils-app.test.ts` — no change unless needed
- `frontend/src/lib/file-processing.test.ts` — **add** tests for EPUB poll/shimmer state if file exists, else extend nearest test file

**Requirements:**
- EPUB tiles show shimmer while `document_thumbnail_status` is queued/processing (same as PDF)
- When ready, tile shows cover JPEG from `/grid-thumbnail` via existing `ExplorerDocumentThumbnail`
- Cover framing: `object-contain` centered on white (book cover portrait — like PDF page, not spreadsheet crop)
- Failed state: `BookOpen` icon with accent tint
- Inline comments per project rules

**Verification:**
```bash
cd frontend && npm run test
cd frontend && npm run build
cd frontend && npm run lint
```

---

## Task 4: Final verification

**Requirements:**
- Full backend test suite + clippy green
- Frontend test + build + lint green
- Confirm upload_finalize already enqueues document thumbnail for qualifying mime (EPUB now qualifies via Task 1)
- No git commit unless user requests

**Verification:**
```bash
cd backend && cargo test -p ownly-backend && cargo clippy -p ownly-backend -- -D warnings
cd frontend && npm run test && npm run build && npm run lint
```
