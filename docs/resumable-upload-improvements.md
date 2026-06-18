# Resumable upload — follow-up improvements

**Date:** 2026-06-18 (pruned — MVP removed)  
**Status:** Web MVP shipped (`029_upload_sessions.sql`). This doc tracks **remaining** work only.  
**Audience:** Maintainers planning the next upload reliability pass.

**Shipped baseline (omitted here):** Web chunked uploads for files > 32 MiB (`POST/GET/PUT/POST /uploads/*`), shared `upload_finalize`, Vitest + integration tests. See git history and [`improvement-roadmap.md`](improvement-roadmap.md) executive summary.

---

## Ownly-specific constraints

Improvements should prioritize:

1. **Large videos** — primary reason users need resume (HLS pipeline after upload).
2. **API container disk** — parts + assemble can briefly use ~2× file size on the API host.
3. **Self-hosted ops** — janitor and expiry must not lose in-flight uploads.
4. **Client parity** — iOS still uses one-shot POST; phone video on LTE is a core scenario.
5. **Nebular boundary** — storage multipart changes belong in [AsP3X/nebular-os](https://github.com/AsP3X/nebular-os); Ownly integration stays in this repo per `nebular-os-vendor.mdc`.

---

## High impact (do first)

### 1. Protect in-progress resumable spools from the temp janitor

**Problem:** Resumable work dirs use `ownly_upload_{session_id}`. `temp_cleanup` protects dirs only when a **video `files` row** exists with HLS ingest queued/processing (`is_protected_upload_spool`). During chunked upload there is **no `files` row yet**, so a slow upload can lose parts after ~2 minutes idle (`TEMP_IDLE_MAX_AGE`).

**Direction:**

- Extend `is_protected_upload_spool` (or add sibling check) to query `upload_sessions` where `id = session_id` and `status IN ('active', 'completing')`.
- Map directory name `ownly_upload_{id}` to session id (same prefix as simple upload, different id semantics).

**Key files:** `backend/src/temp_cleanup.rs`, `backend/src/uploads/store.rs`

**Verification:** Start 100 MiB resumable upload, pause part PUTs for > 2 minutes, resume — parts still on disk, complete succeeds.

---

### 2. Expire stale upload sessions (DB + disk)

**Problem:** Sessions have `expires_at` (72h) but no sweeper marks them aborted or deletes spool dirs. Abandoned uploads consume API disk indefinitely. Handlers reject expired sessions on access only.

**Direction:**

- Background job or extend temp janitor: `UPDATE upload_sessions SET status = 'aborted' WHERE status = 'active' AND expires_at < now()`.
- Delete matching `ownly_upload_{session_id}` directories.
- Audit: `uploads.session.expire` (optional).

**Key files:** `backend/src/temp_cleanup.rs` or `backend/src/jobs/`, `backend/src/uploads/store.rs`

**Verification:** Create session, do not complete, force `expires_at` in test DB, run sweeper — row aborted, dir removed.

---

### 3. iOS resumable upload parity

**Problem:** `ios/Ownly/Core/API/UploadService.swift` still uses single `POST /files/upload` via `UploadSessionCoordinator` multipart body. Mobile video on unstable networks is a primary Ownly use case.

**Direction:**

- Mirror web API: create session, PUT parts, GET status, complete.
- Use `URLSession` with background configuration where possible; persist server `session_id` for retry.
- Align progress phases with web `UploadProgressUpdate` (uploading → processing → storing).

**Key files:** `ios/Ownly/Core/API/UploadService.swift`, `ios/Ownly/Features/Upload/`

**Verification:** Upload > 32 MiB video on device; kill app mid-upload; relaunch and resume (or retry) without restarting from byte zero.

---

## Medium impact (strong fit)

### 4. Always resumable for video, not only > 32 MiB

**Problem:** 20–30 MiB phone clips on bad Wi‑Fi still use one-shot POST. Video is the workload that benefits most from resume.

**Direction:**

- Route `video/*` through chunked upload at a lower threshold (e.g. **5–8 MiB**).
- Keep **32 MiB** threshold for non-video types.

**Key files:** `frontend/src/lib/resumable-upload.ts`, `frontend/src/api/client.ts`, iOS upload routing when implemented.

---

### 5. Append parts instead of parts + full assemble

**Problem:** Each part is stored as `parts/{n}`, then concatenated into `source` at complete — peak disk ≈ **2× file size** on the API host during complete (`backend/src/uploads/assemble.rs`).

**Direction:**

- Append each part directly to `source` as it arrives (or delete part file immediately after append).
- Remove or simplify `uploads/assemble.rs`.

**Key files:** `backend/src/uploads/handlers.rs`, `backend/src/uploads/assemble.rs`

**Verification:** Upload multi-part file; monitor API disk during complete — peak should approach 1× file size, not 2×.

---

### 6. Parallel chunk uploads (bounded concurrency)

**Problem:** Web client uploads parts sequentially (`resumable-upload.ts` loop). Large files are slower than necessary.

**Direction:**

- Upload **2 parts in parallel** (align with `STORAGE_PUT_MAX_CONCURRENT` / upload manager’s `MAX_CONCURRENT_UPLOADS = 2`).
- Preserve part order for append/assemble; idempotent PUTs already support out-of-order arrival if assemble reads by part number.

**Key files:** `frontend/src/lib/resumable-upload.ts`

---

### 7. Persist session id across reload / honest resume UX

**Problem:** Browser cannot resume bytes after full page reload without a `File` handle. `resumableServerSessionId` is persisted in `upload-manager.ts` / localStorage, but there is no **“Re-select file to continue upload”** UX when `localFile` is missing after reload.

**Direction:**

- On restore without `localFile`, show re-select prompt and resume from `GET /uploads/{id}` part list when the user picks the same file again (match name + size).

**Key files:** `frontend/src/lib/upload-manager.ts`, `frontend/src/lib/upload-batch-snapshot.ts`, transfer panel UI.

---

## Larger step (when API disk is the bottleneck)

### 8. Stream parts to Nebular instead of spooling on the API

**Problem:** Bytes land on the API host, then go to object storage. Multi‑GiB uploads stress self-hosted API disk and memory.

**Direction:**

- Client uploads chunks; API validates auth, quota, and session state.
- Bytes go **directly to object storage** (Nebular multipart when exposed upstream, or signed part URLs from Ownly).
- API registers metadata on `complete` only.

**Ownly scope:** `backend/src/storage/`, upload handlers, Compose env.  
**Nebular scope:** multipart API behavior in upstream repo; bump submodule pointer after merge.

---

## Suggested implementation order

```mermaid
flowchart LR
    A["1 Janitor + session expiry"] --> B["2 iOS resumable"]
    B --> C["3 Video threshold + append parts"]
    C --> D["4 Parallel chunks"]
    D --> E["5 Direct-to-Nebular streaming"]
```

| Phase | Focus | Why |
|-------|-------|-----|
| **A** | Janitor protection + session sweeper | Prevents data loss and disk leaks on self-hosted instances |
| **B** | iOS chunked upload | Biggest user-visible gap after web MVP |
| **C** | Video threshold + append-on-write | Faster reliability for core video workload; lower disk peak |
| **D** | Parallel parts | Throughput without changing protocol |
| **E** | Direct-to-storage | Ops scale when API disk becomes limiting |

---

## Deprioritize for now

| Idea | Reason |
|------|--------|
| **TUS protocol** | Custom session API already works; adds dependency without clear win |
| **Resume after reload without re-picking file** | Browser security prevents access to `File` bytes; poor ROI vs iOS + janitor fixes |
| **Lower chunk size globally** | More requests and DB rows; tune only if proxies misbehave |
| **Content-hash dedup at complete** | Tracked in [`storage-disk-improvements.md`](storage-disk-improvements.md) §2 |

---

## Related documents

- [`improvement-roadmap.md`](improvement-roadmap.md) — §1.2 resumable follow-ups summary
- [`storage-disk-improvements.md`](storage-disk-improvements.md) — lazy `export.mp4`, dedup, HLS cleanup (API/Nebular disk pressure)
- [`storage-disk-tuning.md`](storage-disk-tuning.md) — API / Nebular disk pressure
- [`.cursor/rules/nebular-os-vendor.mdc`](../.cursor/rules/nebular-os-vendor.mdc) — Nebular integration boundaries
