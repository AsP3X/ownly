# Resumable upload — follow-up improvements

← [Back to main README](../README.md) · [Documentation index](./README.md)

**Date:** 2026-07-24 (B/C/D shipped)  
**Status:** Web + iOS chunked uploads shipped. Content dedup, non-video object-storage staging, expiry audit, and transfer retry UX are **shipped**.  
**Audience:** Maintainers planning the next upload reliability pass.

**Shipped baseline:**

- Web MVP: chunked uploads (`029_upload_sessions.sql`), `POST/GET/PUT/POST /uploads/*`, shared `upload_finalize`, Vitest + integration tests.
- Janitor protection for `ownly_upload_*` while `upload_sessions.status` is `active`/`completing`.
- Session expiry sweeper — abort expired rows, delete spool/staging, **`uploads.session.expire` audit**.
- Append-on-write for **video** spools; **non-video** parts stage under `upload-staging/{session_id}/` in object storage (no multi‑GiB API disk spool).
- Per-user **content_hash dedup** on finalize — share `storage_key`, skip PUT, refcount-safe delete.
- Browser-signed Nebular **PUT** for non-video parts (`direct_upload`, signed-url + confirm) with API body fallback.
- Web: `video/*` threshold **8 MiB**, non-video **32 MiB**; **2** parallel part PUTs; reload **Choose file** + **Retry failed** transfer UX.
- iOS: chunked `POST/PUT/POST /uploads/*` for large/video files, 2 parallel parts, `DELETE /uploads/{id}` on cancel (no background `URLSession` or app-kill resume yet — see remaining work).

See git history and [`improvement-roadmap.md`](improvement-roadmap.md) executive summary.

---

## Ownly-specific constraints

Improvements should preserve:

1. **HLS playback** — video still uses local spool through finalize and video ingest.
2. **Self-hosted ops** — janitor and expiry must not delete in-flight sessions (verify when changing `temp_cleanup.rs`).
3. **Nebular boundary** — signed client→Nebular multipart remains optional future work; Ownly currently **proxies** non-video parts into object storage staging.
4. **Quota honesty** — deduped copies still charge full `size_bytes` per `files` row.
5. **Delete safety** — shared blobs purge only when no `files` row references `storage_key` (including recycle bin).

---

## Browser-signed Nebular part URLs — **SHIPPED**

**Flow (non-video when `direct_upload: true`):**

1. `POST /uploads` → session includes `direct_upload: true` when storage supports presigned PUT (Nebular/Router; not MemoryStorage tests).
2. Per missing part:
   - `POST /uploads/{id}/parts/{n}/signed-url` → short-lived `upload_url` (HMAC PUT, ~30 min TTL).
   - Browser `PUT` to `OBJECT_STORAGE_PUBLIC_URL` (compose: same-origin nginx `/media/` → Nebular).
   - `POST /uploads/{id}/parts/{n}/confirm` → Ownly verifies staged object size, records part.
3. `POST /uploads/{id}/complete` → hash staged parts, dedup or assemble final key (unchanged).

**Fallback:** If signed-url fails or the direct PUT errors (CORS, network), the web client streams the part body through `PUT /uploads/{id}/parts/{n}` as before.

**Ops:** Set `OBJECT_STORAGE_PUBLIC_URL` to the browser-reachable base (same origin preferred so CSP `connect-src 'self'` and no Nebular CORS are required). nginx must proxy PUT on `/media/` with `proxy_request_buffering off`.

**Key files:** `backend/src/storage/{mod,nebula,router,gated}.rs`, `uploads/handlers.rs`, `frontend/src/lib/resumable-upload.ts`, `frontend/nginx.conf.template`

---

## Also shipped (2026-07-24 pass)

| Area | What landed |
|------|-------------|
| **iOS resume** | `UploadPersistence` + `resumableServerSessionId`; re-queue after kill; background `URLSession` part file PUTs |
| **Adaptive web** | Part concurrency (1–4), chunk size (4–16 MiB), **file slots** (1–3) from samples |
| **Transfer UX** | Batch pause, **per-file pause**, ETA, remaining bytes, **Direct/Via API**, folder relative path |
| **Quota** | **Atomic reservation** on session (`quota_reserved_bytes`); released on complete/abort/expire |
| **Client hash** | Optional `content_hash` on create; `dedup_source_file_id` / `recycle_match_file_id` |
| **Confirm** | HEAD `object_size` (no full re-GET); **confirm_token** single-use; optional part SHA-256 |
| **Hygiene** | Failed/cancelled HLS orphans idle > 24h |
| **Multi-node direct** | Staging pinned to `node-primary` |
| **Admin** | `GET /api/v1/admin/uploads/health` — live counters + active sessions + reserved bytes |
| **DnD upload** | Drop OS files onto My Cloud → Upload dialog + same conflict flow |
| **Signed-url RL** | Separate mint rate limit + metrics |

## Shipped (2026-07-29 hardening)

| Area | What landed |
|------|-------------|
| **Instant dedup** | `POST /complete` with session `content_hash` matching library skips all part PUTs |
| **Hash plumbing** | Dialog preflight hash is reused by the upload batch (no double full-file hash) |
| **Bounded hashing** | Parallel hash pool (3) + progress label while preparing large batches |
| **Single-pass finalize** | Staged complete hashes while writing the final object (no second full GET) |
| **Proxy parts** | Stream `Bytes` into storage without `Vec` clone-per-retry |
| **Part checksums** | Proxy path verifies `x-ownly-part-sha256` when sent; confirm re-hashes staged object when `content_sha256` is sent |
| **Session caps** | Max 32 active sessions/user; 24h TTL; 6h idle abort |
| **Honest phases** | Generic files show Indexing/Saving — AES encrypt label only for media/HLS |
| **UX** | Dialog drop zone; hash progress; toast re-pick; multi-file reattach after reload; byte-level progress |

## Remaining work

### 1. iOS full background URLSession lifecycle

**Priority:** P3  

**Problem:** Part PUTs use a background configuration identifier, but the app does not yet implement `handleEventsForBackgroundURLSession` for multi-hour background completion callbacks after process suspension.

**Direction:** Wire `UIApplicationDelegate` background session events; optional BGTaskScheduler for long queues.

---

## Deprioritize for now

| Idea | Reason |
|------|--------|
| **TUS protocol** | Custom session API already works; adds dependency without clear win |
| **Resume after reload without re-picking file** | Browser security prevents access to `File` bytes; web **Choose file** + multi-reattach UX shipped |
| **Lower chunk size globally** | More requests and DB rows; tune only if proxies misbehave |

---

## Related documents

- [`improvement-roadmap.md`](improvement-roadmap.md) — §1.2 resumable follow-ups summary
- [`storage-disk-improvements.md`](storage-disk-improvements.md) — lazy `export.mp4`, HLS cleanup (API/Nebular disk pressure)
- [`storage-disk-tuning.md`](storage-disk-tuning.md) — API / Nebular disk pressure
- [`.cursor/rules/nebular-os-vendor.mdc`](../.cursor/rules/nebular-os-vendor.mdc) — Nebular integration boundaries
