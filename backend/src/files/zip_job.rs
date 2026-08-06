// Human: Shared zip archive builder for folder and multi-file bulk downloads.
// Agent: READS storage blobs; WRITES deflate zip; UPDATES in-memory download job registry.

use std::collections::HashMap;
use std::io::Write;
use std::path::PathBuf;
use std::pin::Pin;
use std::sync::Arc;
use std::task::{Context, Poll};

use axum::{
    body::Body,
    http::header,
    response::Response,
};
use futures_util::{Stream, TryStreamExt};
use serde::Serialize;
use tokio::sync::RwLock;
use tokio_util::io::ReaderStream;
use zip::write::SimpleFileOptions;
use zip::CompressionMethod;

use crate::{
    error::AppError,
    hls::export_job::run_hls_export_job,
    AppState,
};

const EXPORT_OBJECT_SUFFIX: &str = "export.mp4";

#[derive(Debug, Clone)]
pub struct FolderDownloadJob {
    pub status: String,
    pub progress: i32,
    pub ready: bool,
    pub error: Option<String>,
    pub archive_name: String,
    pub size_bytes: Option<i64>,
    pub archive_path: Option<PathBuf>,
    pub cancelled: bool,
    /// Human: Members written to the archive so far — drives "12 of 40 files" in the tray.
    /// Agent: INCREMENTED after each member is written, not before; 0 until compression starts.
    pub files_done: i32,
    /// Human: Total members this archive will contain. 0 while the entry list is still being built.
    pub files_total: i32,
    /// Human: Names of members that could not be read and were left out of the archive.
    /// Agent: EMPTY on success; a ready job with entries here is a PARTIAL archive.
    pub skipped_files: Vec<String>,
}

impl FolderDownloadJob {
    /// Human: A fresh queued job — the state every entry point starts from.
    /// Agent: Callers override the fields they care about; keeps the 9 construction sites honest
    ///        about file counts instead of each inventing its own defaults.
    pub fn queued(archive_name: impl Into<String>) -> Self {
        Self {
            status: "queued".to_string(),
            progress: 0,
            ready: false,
            error: None,
            archive_name: archive_name.into(),
            size_bytes: None,
            archive_path: None,
            cancelled: false,
            files_done: 0,
            files_total: 0,
            skipped_files: Vec::new(),
        }
    }
}

#[derive(Clone, Default)]
pub struct FolderDownloadRegistry {
    inner: Arc<RwLock<HashMap<String, FolderDownloadJob>>>,
}

impl FolderDownloadRegistry {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    pub fn folder_job_key(user_id: &str, folder_id: &str) -> String {
        format!("{user_id}:{folder_id}")
    }

    pub fn bulk_job_key(user_id: &str, job_id: &str) -> String {
        format!("{user_id}:bulk:{job_id}")
    }

    // Human: Registry key for anonymous public-share zip jobs (token-scoped, no user id).
    // Agent: USED by POST /public/shares/:token/download-archive polling + archive stream.
    pub fn public_share_job_key(token: &str, job_id: &str) -> String {
        format!("public-share:{token}:{job_id}")
    }

    pub async fn get(&self, key: &str) -> Option<FolderDownloadJob> {
        self.inner.read().await.get(key).cloned()
    }

    pub async fn set(&self, key: String, job: FolderDownloadJob) {
        self.inner.write().await.insert(key, job);
    }

    pub async fn remove(&self, key: &str) {
        self.inner.write().await.remove(key);
    }

    // Human: True when a zip scratch dir must survive the temp janitor until download completes.
    // Agent: MATCHES mv_bulk_zip_*, mv_folder_zip_*, mv_public_share_zip_* against active registry jobs.
    pub async fn protects_scratch_dir_name(&self, dir_name: &str) -> bool {
        let jobs = self.inner.read().await;
        jobs.iter().any(|(key, job)| {
            if job.cancelled || job.status == "failed" {
                return false;
            }
            if let Some(ref archive_path) = job.archive_path {
                if archive_path
                    .parent()
                    .and_then(|parent| parent.file_name())
                    .and_then(|name| name.to_str())
                    == Some(dir_name)
                {
                    return true;
                }
            }
            if let Some(job_id) = key.rsplit(":bulk:").nth(1) {
                if dir_name == format!("mv_bulk_zip_{job_id}") {
                    return true;
                }
            }
            if key.starts_with("public-share:") {
                if let Some(job_id) = key.rsplit(':').next() {
                    if dir_name == format!("mv_public_share_zip_{job_id}") {
                        return true;
                    }
                }
            }
            if !key.contains(":bulk:") && !key.starts_with("public-share:") {
                if let Some((_, folder_id)) = key.rsplit_once(':') {
                    if dir_name == format!("mv_folder_zip_{folder_id}") {
                        return true;
                    }
                }
            }
            false
        })
    }
}

#[derive(Debug, Serialize)]
pub struct ZipDownloadStatusResponse {
    pub status: String,
    pub progress: i32,
    pub ready: bool,
    pub archive_name: String,
    pub size_bytes: Option<i64>,
    pub error: Option<String>,
    /// Human: Members compressed so far, for "12 of 40 files" in the download tray.
    pub files_done: i32,
    /// Human: Total members in the archive; 0 while the entry list is still being resolved.
    pub files_total: i32,
    /// Human: Files left out because they could not be read. Non-empty means a partial archive.
    pub skipped_files: Vec<String>,
}

// Human: Serialize registry job state for download tray polling endpoints.
pub fn zip_status_json(job: &FolderDownloadJob) -> ZipDownloadStatusResponse {
    ZipDownloadStatusResponse {
        status: job.status.clone(),
        progress: if job.ready { 100 } else { job.progress },
        ready: job.ready,
        archive_name: job.archive_name.clone(),
        size_bytes: job.size_bytes,
        error: job.error.clone(),
        // Human: A finished archive reads "40 of 40" rather than "39 of 40" from a missed final
        // tick — but only when nothing was skipped. Rounding up a partial archive would hide
        // exactly the fact the user needs to see.
        files_done: if job.ready && job.skipped_files.is_empty() {
            job.files_total.max(job.files_done)
        } else {
            job.files_done
        },
        files_total: job.files_total,
        skipped_files: job.skipped_files.clone(),
    }
}

#[derive(Debug, Clone)]
pub struct ZipFileEntry {
    pub zip_path: String,
    pub file_id: String,
    pub storage_key: String,
    pub display_name: String,
    pub mime_type: Option<String>,
    pub hls_ready: bool,
    pub export_ready: bool,
    pub segment_count: i32,
}

// Human: True when the vault keeps an HLS bundle instead of a standalone original blob.
pub fn is_hls_stored_video(mime_type: &Option<String>, hls_ready: bool) -> bool {
    mime_type
        .as_deref()
        .is_some_and(|m| m.starts_with("video/"))
        && hls_ready
}

// Human: Normalize a video filename to .mp4 inside zip archives.
pub fn mp4_zip_name(name: &str) -> String {
    if name.to_lowercase().ends_with(".mp4") {
        return name.to_string();
    }
    let dot = name.rfind('.').unwrap_or(name.len());
    if dot > 0 {
        format!("{}.mp4", &name[..dot])
    } else {
        format!("{name}.mp4")
    }
}

/// Human: The name this entry will actually carry inside the archive.
/// Agent: APPLIES the HLS .mp4 rename; PRESERVES any directory prefix. This is the only name that
///        matters for uniqueness — dedupe against anything else and the archive can still collide.
pub fn effective_zip_member_path(entry: &ZipFileEntry) -> String {
    if !is_hls_stored_video(&entry.mime_type, entry.hls_ready) {
        return entry.zip_path.clone();
    }
    match entry.zip_path.rsplit_once('/') {
        Some((dir, file)) => format!("{dir}/{}", mp4_zip_name(file)),
        None => mp4_zip_name(&entry.zip_path),
    }
}

// Human: Ensure zip member names stay unique once the .mp4 rename has been applied.
// Agent: APPENDS " (N)" before the extension on duplicates; PRESERVES first occurrence unchanged.
//
// Human: This used to key on `display_name`, the pre-rename filename, while the .mp4 rewrite for
// HLS videos happened later in resolve_object_key. So `clip.webm` and `clip.mp4` in one folder
// both landed on `clip.mp4` after dedupe had already declared them unique, and the archive failed
// to open with "Duplicate filename". Keying on the post-rename path is what actually prevents it.
//
// Agent: The key is the FULL path, not the bare filename — `a/report.pdf` and `b/report.pdf` are
//        distinct members and must not be renamed into `report (2).pdf`.
pub fn dedupe_zip_member_names(entries: Vec<ZipFileEntry>) -> Vec<ZipFileEntry> {
    let mut seen: std::collections::HashMap<String, u32> = std::collections::HashMap::new();
    entries
        .into_iter()
        .map(|mut entry| {
            let effective = effective_zip_member_path(&entry);
            let count = seen.entry(effective.clone()).or_insert(0);
            *count += 1;
            entry.zip_path = if *count == 1 {
                effective
            } else {
                disambiguate_path(&effective, *count)
            };
            entry
        })
        .collect()
}

/// Human: Disambiguate the filename portion only, leaving any directory prefix untouched.
/// Agent: SPLITS on the last '/' so `docs/report.pdf` becomes `docs/report (2).pdf`.
fn disambiguate_path(path: &str, index: u32) -> String {
    match path.rsplit_once('/') {
        Some((dir, file)) => format!("{dir}/{}", disambiguate_filename(file, index)),
        None => disambiguate_filename(path, index),
    }
}

// Human: Insert a numeric suffix before the file extension (e.g. report (2).pdf).
fn disambiguate_filename(name: &str, index: u32) -> String {
    if let Some((stem, ext)) = name.rsplit_once('.') {
        if !ext.contains('/') && !ext.contains('\\') {
            return format!("{stem} ({index}).{ext}");
        }
    }
    format!("{name} ({index})")
}


/// Human: Whether a failed member left anything behind in the archive.
/// Agent: Decides skip-vs-abort. Getting this wrong ships a corrupt zip, so the variant is
///        chosen by WHERE the failure happened, never by what kind of error it was.
#[derive(Debug)]
pub enum MemberWriteError {
    /// Human: Failed before the entry header was written — the archive is untouched and this
    /// member can be skipped. Covers the common case of a missing or unreadable object.
    Untouched(String),
    /// Human: Failed after start_file, so a header and possibly some bytes are already in the
    /// archive. There is no way to retract them, so the whole job must fail.
    Partial(String),
}

impl MemberWriteError {
    pub fn message(&self) -> &str {
        match self {
            Self::Untouched(message) | Self::Partial(message) => message,
        }
    }
}

async fn write_storage_object_to_zip(
    storage: &dyn crate::storage::Storage,
    object_key: &str,
    zip: &mut zip::ZipWriter<std::fs::File>,
    member_path: &str,
    options: SimpleFileOptions,
) -> Result<(), MemberWriteError> {
    // Human: Opening the stream first is what makes skipping safe — a missing blob fails here,
    // before the archive has been touched. Do not reorder this past start_file.
    let (mut stream, _, _) = storage.get_stream(object_key).await.map_err(|error| {
        MemberWriteError::Untouched(format!("open {object_key}: {error}"))
    })?;
    // Human: start_file is a thin header write — fine on the async runtime.
    zip.start_file(member_path, options).map_err(|error| {
        MemberWriteError::Untouched(format!("zip entry {member_path}: {error}"))
    })?;
    while let Some(chunk) = stream
        .try_next()
        .await
        .map_err(|error| MemberWriteError::Partial(error.to_string()))?
    {
        // Human: Deflate compression is CPU-bound — move off the async worker thread.
        // Agent: block_in_place lets the runtime schedule other tasks while we compress.
        tokio::task::block_in_place(|| {
            zip.write_all(&chunk).map_err(|error| {
                MemberWriteError::Partial(format!("write zip entry {member_path}: {error}"))
            })
        })?;
    }
    Ok(())
}

// Human: Pick deflate for compressible files; store pre-compressed media as-is to save CPU and RAM.
// Agent: USES Stored for video/audio and common archive/image extensions.
fn zip_member_is_precompressed(mime_type: &Option<String>, member_path: &str) -> bool {
    let lower = member_path.to_lowercase();
    mime_type.as_deref().is_some_and(|mime| {
        mime.starts_with("video/")
            || mime.starts_with("audio/")
            || mime.contains("zip")
            || mime.contains("jpeg")
            || mime.contains("png")
            || mime.contains("webp")
            || mime.contains("gif")
    }) || lower.ends_with(".mp4")
        || lower.ends_with(".m4v")
        || lower.ends_with(".mov")
        || lower.ends_with(".mkv")
        || lower.ends_with(".webm")
        || lower.ends_with(".jpg")
        || lower.ends_with(".jpeg")
        || lower.ends_with(".png")
        || lower.ends_with(".zip")
}

fn zip_entry_options(mime_type: &Option<String>, member_path: &str) -> SimpleFileOptions {
    if zip_member_is_precompressed(mime_type, member_path) {
        SimpleFileOptions::default().compression_method(CompressionMethod::Stored)
    } else {
        SimpleFileOptions::default()
            .compression_method(CompressionMethod::Deflated)
            .compression_level(Some(9))
    }
}

type ExportStatusRow = (bool, Option<String>, Option<String>);

async fn load_export_status(
    pool: &sqlx::PgPool,
    file_id: &str,
) -> Result<ExportStatusRow, String> {
    sqlx::query_as(
        "SELECT download_export_ready, download_export_status, download_export_error \
         FROM files WHERE id = $1",
    )
    .bind(file_id)
    .fetch_optional(pool)
    .await
    .map_err(|error| error.to_string())?
    .ok_or_else(|| "file not found".to_string())
}

async fn ensure_hls_export_ready(
    pool: &sqlx::PgPool,
    storage: Arc<dyn crate::storage::Storage>,
    key_store: crate::hls::key_store::KeyStore,
    entry: &ZipFileEntry,
) -> Result<(), String> {
    if !is_hls_stored_video(&entry.mime_type, entry.hls_ready) {
        return Ok(());
    }

    const EXPORT_POLL_MS: u64 = 500;
    const EXPORT_WAIT_PER_VIDEO: std::time::Duration = std::time::Duration::from_secs(2 * 60 * 60);
    let deadline = std::time::Instant::now() + EXPORT_WAIT_PER_VIDEO;
    let mut started = entry.export_ready;

    loop {
        let (export_ready, export_status, export_error) = load_export_status(pool, &entry.file_id).await?;
        if export_ready {
            return Ok(());
        }
        if export_status.as_deref() == Some("failed") {
            return Err(export_error.unwrap_or_else(|| {
                format!("video export failed for {}", entry.display_name)
            }));
        }
        if export_status.as_deref() == Some("processing") || export_status.as_deref() == Some("queued")
        {
            if std::time::Instant::now() >= deadline {
                return Err(format!(
                    "video export timed out for {}",
                    entry.display_name
                ));
            }
            tokio::time::sleep(std::time::Duration::from_millis(EXPORT_POLL_MS)).await;
            continue;
        }

        if !started {
            run_hls_export_job(
                pool.clone(),
                storage.clone(),
                key_store.clone(),
                entry.file_id.clone(),
                entry.storage_key.clone(),
                entry.segment_count,
            )
            .await;
            started = true;
            continue;
        }

        return Err(format!(
            "video export failed for {}",
            entry.display_name
        ));
    }
}

// Human: Reject zip-slip paths before writing archive members (SEC-030).
// Agent: NORMALIZES slashes; REJECTS absolute paths and `..` segments.
pub fn sanitize_zip_entry_path(path: &str) -> Result<String, AppError> {
    let normalized = path.replace('\\', "/");
    if normalized.starts_with('/') || normalized.contains(":/") {
        return Err(AppError::BadRequest(
            "invalid zip entry path".into(),
        ));
    }
    for component in normalized.split('/') {
        if component == ".." {
            return Err(AppError::BadRequest(
                "invalid zip entry path".into(),
            ));
        }
    }
    Ok(normalized)
}

async fn resolve_object_key(
    pool: &sqlx::PgPool,
    storage: Arc<dyn crate::storage::Storage>,
    key_store: crate::hls::key_store::KeyStore,
    entry: &ZipFileEntry,
) -> Result<(String, String), String> {
    if is_hls_stored_video(&entry.mime_type, entry.hls_ready) {
        ensure_hls_export_ready(pool, storage, key_store, entry).await?;
        // Human: zip_path is already the final member name — dedupe_zip_member_names applied the
        // .mp4 rename and any " (N)" suffix. Re-deriving it here would drop that suffix and
        // reintroduce the collision this path used to cause.
        let member_path = sanitize_zip_entry_path(&entry.zip_path)
            .map_err(|error| error.to_string())?;
        Ok((
            format!("{}/{EXPORT_OBJECT_SUFFIX}", entry.storage_key),
            member_path,
        ))
    } else {
        let member_path = sanitize_zip_entry_path(&entry.zip_path)
            .map_err(|error| error.to_string())?;
        Ok((entry.storage_key.clone(), member_path))
    }
}

async fn mark_failed(
    registry: &FolderDownloadRegistry,
    key: &str,
    archive_name: &str,
    message: &str,
) {
    registry
        .set(
            key.to_string(),
            FolderDownloadJob {
                status: "failed".to_string(),
                progress: 0,
                ready: false,
                error: Some(message.to_string()),
                archive_name: archive_name.to_string(),
                size_bytes: None,
                archive_path: None,
                cancelled: false,
                files_done: 0,
                files_total: 0,
                skipped_files: Vec::new(),
            },
        )
        .await;
}

// Human: Build a deflate level-9 zip on disk and update job progress after each member file.
// Agent: WRITES archive_path; UPDATES registry progress; SYNCs background_jobs progress when job id provided.
pub async fn run_zip_entries_job(
    state: Arc<AppState>,
    registry_key: String,
    work_dir: PathBuf,
    archive_name: String,
    entries: Vec<ZipFileEntry>,
    // Human: Explicit directory members, so folders with no files in them still appear in the
    // archive. Empty for flat jobs (bulk selections, public shares) which have no tree.
    directories: Vec<String>,
    log_context: &str,
    background_job_id: Option<String>,
) {
    let archive_path = work_dir.join(&archive_name);

    if let Err(error) = tokio::fs::create_dir_all(&work_dir).await {
        mark_failed(
            &state.folder_download_jobs,
            &registry_key,
            &archive_name,
            &format!("create work dir: {error}"),
        )
        .await;
        return;
    }

    let total = entries.len().max(1);

    // Human: Publish the denominator before the first member is written, so the tray can show
    // "0 of 40 files" immediately instead of an unqualified spinner while the archive warms up.
    // Agent: entries.len(), not `total` — the .max(1) floor is for the percentage maths only and
    //        would otherwise report "of 1" for a genuinely empty selection.
    if let Some(mut job) = state.folder_download_jobs.get(&registry_key).await {
        job.files_total = entries.len() as i32;
        job.files_done = 0;
        state
            .folder_download_jobs
            .set(registry_key.clone(), job)
            .await;
    }

    let zip_file = match std::fs::File::create(&archive_path) {
        Ok(file) => file,
        Err(error) => {
            mark_failed(
                &state.folder_download_jobs,
                &registry_key,
                &archive_name,
                &format!("create zip file: {error}"),
            )
            .await;
            let _ = tokio::fs::remove_dir_all(&work_dir).await;
            return;
        }
    };

    let mut zip = zip::ZipWriter::new(zip_file);

    // Human: Directory members go in first so the archive mirrors the tree even where a folder
    // holds no files — zip otherwise infers directories purely from member paths, so an empty
    // one disappears entirely.
    // Agent: add_directory appends the trailing '/' itself; a failure here is not fatal because
    //        every folder that DOES contain files is still implied by those file paths.
    let dir_options = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
    for directory in &directories {
        if let Err(error) = zip.add_directory(directory, dir_options) {
            tracing::warn!(
                context = log_context,
                directory = %directory,
                %error,
                "could not add directory entry to archive"
            );
        }
    }

    // Human: Members that could not be read. The archive still ships; these are reported so the
    // user knows the download is incomplete rather than silently short.
    let mut skipped: Vec<String> = Vec::new();
    let mut written: usize = 0;

    for (index, entry) in entries.iter().enumerate() {
        if state
            .folder_download_jobs
            .get(&registry_key)
            .await
            .is_some_and(|job| job.cancelled)
        {
            let _ = zip.finish();
            let _ = tokio::fs::remove_dir_all(&work_dir).await;
            state.folder_download_jobs.remove(&registry_key).await;
            return;
        }

        let pct = ((index as f64 / total as f64) * 90.0).round() as i32;
        if let Some(mut job) = state.folder_download_jobs.get(&registry_key).await {
            job.progress = pct.max(5);
            job.status = "compressing".to_string();
            // Human: `index` members are finished at this point — the one at `index` is about to
            // start. Reporting index+1 here would claim a file was compressed before it was.
            job.files_done = index as i32;
            job.files_total = total as i32;
            state
                .folder_download_jobs
                .set(registry_key.clone(), job)
                .await;
        }
        if let Some(ref job_id) = background_job_id {
            let _ = crate::jobs::store::set_job_progress(&state.pool, job_id, pct.max(5)).await;
        }

        let (object_key, member_path) =
            match resolve_object_key(
                &state.pool,
                state.storage.clone(),
                state.hls_key_store.clone(),
                entry,
            )
            .await
            {
                Ok(keys) => keys,
                Err(message) => {
                    // Human: Nothing written yet — drop this member and keep the archive.
                    tracing::warn!(
                        context = log_context,
                        file = %entry.display_name,
                        reason = %message,
                        "skipping zip member"
                    );
                    skipped.push(entry.display_name.clone());
                    continue;
                }
            };

        let options = zip_entry_options(&entry.mime_type, &member_path);
        match write_storage_object_to_zip(
            state.storage.as_ref(),
            &object_key,
            &mut zip,
            &member_path,
            options,
        )
        .await
        {
            Ok(()) => {}
            // Human: One unreadable file used to discard the whole archive — every other file
            // already compressed was thrown away with it. A missing blob is exactly the failure
            // an operator hits after storage drift, and losing the other 39 files helps nobody.
            Err(error @ MemberWriteError::Untouched(_)) => {
                tracing::warn!(
                    context = log_context,
                    file = %entry.display_name,
                    reason = %error.message(),
                    "skipping zip member"
                );
                skipped.push(entry.display_name.clone());
                continue;
            }
            // Human: A header and possibly bytes are already in the archive and cannot be
            // retracted, so continuing here would hand the user a corrupt zip.
            Err(error @ MemberWriteError::Partial(_)) => {
                mark_failed(
                    &state.folder_download_jobs,
                    &registry_key,
                    &archive_name,
                    &format!("read {}: {}", entry.display_name, error.message()),
                )
                .await;
                let _ = zip.finish();
                let _ = tokio::fs::remove_dir_all(&work_dir).await;
                return;
            }
        }
        written += 1;
    }

    // Human: Everything failed — an empty archive is not a useful download, so report the
    // failure rather than handing over a zip with nothing in it.
    if written == 0 && !entries.is_empty() {
        mark_failed(
            &state.folder_download_jobs,
            &registry_key,
            &archive_name,
            &format!(
                "no files could be read ({} skipped)",
                skipped.len()
            ),
        )
        .await;
        let _ = zip.finish();
        let _ = tokio::fs::remove_dir_all(&work_dir).await;
        return;
    }

    if let Err(error) = zip.finish() {
        mark_failed(
            &state.folder_download_jobs,
            &registry_key,
            &archive_name,
            &format!("finalize zip: {error}"),
        )
        .await;
        let _ = tokio::fs::remove_dir_all(&work_dir).await;
        return;
    }

    let size_bytes = match tokio::fs::metadata(&archive_path).await {
        Ok(meta) => meta.len() as i64,
        Err(error) => {
            mark_failed(
                &state.folder_download_jobs,
                &registry_key,
                &archive_name,
                &format!("stat zip: {error}"),
            )
            .await;
            let _ = tokio::fs::remove_dir_all(&work_dir).await;
            return;
        }
    };

    state
        .folder_download_jobs
        .set(
            registry_key,
            FolderDownloadJob {
                status: "ready".to_string(),
                progress: 100,
                ready: true,
                error: None,
                archive_name: archive_name.clone(),
                size_bytes: Some(size_bytes),
                archive_path: Some(archive_path),
                cancelled: false,
                // Human: Report what actually landed in the archive. When members were skipped
                // this reads "38 of 40", which together with skipped_files tells the user the
                // download is short and exactly which files are missing.
                files_done: written as i32,
                files_total: entries.len() as i32,
                skipped_files: skipped.clone(),
            },
        )
        .await;

    if let Some(ref job_id) = background_job_id {
        let _ = crate::jobs::store::set_job_progress(&state.pool, job_id, 100).await;
    }

    tracing::info!(
        context = log_context,
        file_count = entries.len(),
        archive_bytes = size_bytes,
        archive_name = %archive_name,
        "zip archive ready"
    );
}

// Human: Load zip member rows for file ids the caller may read (owned or granted).
// Agent: CALLS ensure_file_access ContentRead per id; REJECTS unknown or forbidden ids.
pub async fn collect_zip_entries_for_file_ids(
    pool: &sqlx::PgPool,
    user_id: &str,
    file_ids: &[String],
) -> Result<Vec<ZipFileEntry>, AppError> {
    type FileRow = (
        String,
        String,
        String,
        Option<String>,
        bool,
        bool,
        Option<i32>,
    );

    crate::files::access::ensure_each_file_access(
        pool,
        user_id,
        file_ids,
        crate::authz::Permission::ContentRead,
    )
    .await?;

    let mut entries = Vec::with_capacity(file_ids.len());
    for file_id in file_ids {
        let row: Option<FileRow> = sqlx::query_as(
            "SELECT id, name, storage_key, mime_type, hls_ready, download_export_ready, segment_count \
             FROM files WHERE id = $1 AND deleted_at IS NULL",
        )
        .bind(file_id)
        .fetch_optional(pool)
        .await?;

        let (
            id,
            name,
            storage_key,
            mime_type,
            hls_ready,
            export_ready,
            segment_count,
        ) = row.ok_or_else(|| AppError::BadRequest("one or more files were not found".into()))?;

        entries.push(ZipFileEntry {
            zip_path: name.clone(),
            file_id: id,
            storage_key,
            display_name: name,
            mime_type,
            hls_ready,
            export_ready,
            segment_count: segment_count.unwrap_or(0),
        });
    }

    Ok(dedupe_zip_member_names(entries))
}

struct ZipArchiveCleanup {
    work_dir: PathBuf,
}

impl Drop for ZipArchiveCleanup {
    fn drop(&mut self) {
        let work_dir = self.work_dir.clone();
        tokio::spawn(async move {
            let _ = tokio::fs::remove_dir_all(&work_dir).await;
        });
    }
}

struct ZipArchiveDownloadStream {
    inner: ReaderStream<tokio::fs::File>,
    _cleanup: ZipArchiveCleanup,
}

impl Stream for ZipArchiveDownloadStream {
    type Item = Result<axum::body::Bytes, std::io::Error>;

    fn poll_next(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Option<Self::Item>> {
        Pin::new(&mut self.inner).poll_next(cx)
    }
}

// Human: Stream a finished zip archive to the client without buffering the whole file in RAM.
// Agent: OPENS archive_path; REMOVES work_dir after the stream is dropped; SETS Content-Length when known.
pub async fn zip_archive_stream_response(
    archive_path: PathBuf,
    archive_name: &str,
    size_bytes: Option<i64>,
    work_dir: PathBuf,
) -> Result<Response, crate::error::AppError> {
    let file = tokio::fs::File::open(&archive_path).await.map_err(|error| {
        crate::error::AppError::Internal(anyhow::anyhow!("open zip archive: {error}"))
    })?;
    let stream = ZipArchiveDownloadStream {
        inner: ReaderStream::new(file),
        _cleanup: ZipArchiveCleanup { work_dir },
    };
    let body = Body::from_stream(stream);
    let disposition = format!(
        "attachment; filename=\"{}\"",
        archive_name.replace('"', "")
    );

    let mut builder = Response::builder()
        .header(header::CONTENT_TYPE, "application/zip")
        .header(header::CONTENT_DISPOSITION, disposition);
    if let Some(size) = size_bytes.filter(|size| *size > 0) {
        builder = builder.header(header::CONTENT_LENGTH, size.to_string());
    }

    builder.body(body).map_err(|error| {
        crate::error::AppError::Internal(anyhow::anyhow!("zip archive response: {error}"))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(zip_path: &str, name: &str, mime: &str, hls_ready: bool) -> ZipFileEntry {
        ZipFileEntry {
            zip_path: zip_path.into(),
            file_id: format!("id-{name}"),
            storage_key: format!("users/u/files/id-{name}"),
            display_name: name.into(),
            mime_type: Some(mime.into()),
            hls_ready,
            export_ready: true,
            segment_count: 4,
        }
    }

    fn paths(entries: &[ZipFileEntry]) -> Vec<String> {
        entries.iter().map(|e| e.zip_path.clone()).collect()
    }

    #[test]
    fn transcoded_video_and_real_mp4_do_not_collide() {
        // Human: The reported failure — "zip entry webm_hm.mp4: Duplicate filename". Both files
        // become webm_hm.mp4 once the HLS rename runs, so dedupe must see the POST-rename name.
        let out = dedupe_zip_member_names(vec![
            entry("webm_hm.webm", "webm_hm.webm", "video/webm", true),
            entry("webm_hm.mp4", "webm_hm.mp4", "video/mp4", true),
        ]);
        assert_eq!(paths(&out), vec!["webm_hm.mp4", "webm_hm (2).mp4"]);
    }

    #[test]
    fn collision_inside_a_folder_keeps_the_directory_prefix() {
        // Human: The folder-download path, which previously did not dedupe at all.
        let out = dedupe_zip_member_names(vec![
            entry("clips/webm_hm.webm", "webm_hm.webm", "video/webm", true),
            entry("clips/webm_hm.mp4", "webm_hm.mp4", "video/mp4", true),
        ]);
        assert_eq!(
            paths(&out),
            vec!["clips/webm_hm.mp4", "clips/webm_hm (2).mp4"]
        );
    }

    #[test]
    fn same_name_in_different_folders_is_not_renamed() {
        // Human: Distinct members. Keying on the bare filename would corrupt the tree by
        // renaming the second one for no reason.
        let out = dedupe_zip_member_names(vec![
            entry("a/report.pdf", "report.pdf", "application/pdf", false),
            entry("b/report.pdf", "report.pdf", "application/pdf", false),
        ]);
        assert_eq!(paths(&out), vec!["a/report.pdf", "b/report.pdf"]);
    }

    #[test]
    fn three_way_collision_numbers_sequentially() {
        let out = dedupe_zip_member_names(vec![
            entry("v.mkv", "v.mkv", "video/x-matroska", true),
            entry("v.webm", "v.webm", "video/webm", true),
            entry("v.mp4", "v.mp4", "video/mp4", true),
        ]);
        assert_eq!(paths(&out), vec!["v.mp4", "v (2).mp4", "v (3).mp4"]);
    }

    #[test]
    fn non_video_duplicates_still_dedupe() {
        let out = dedupe_zip_member_names(vec![
            entry("notes.txt", "notes.txt", "text/plain", false),
            entry("notes.txt", "notes.txt", "text/plain", false),
        ]);
        assert_eq!(paths(&out), vec!["notes.txt", "notes (2).txt"]);
    }

    #[test]
    fn video_without_hls_keeps_its_original_extension() {
        // Human: Only HLS-stored videos are remuxed to mp4; a plain stored .webm is served as-is,
        // so renaming it here would hand the user a file that is not what it claims to be.
        let out = dedupe_zip_member_names(vec![entry(
            "raw.webm",
            "raw.webm",
            "video/webm",
            false,
        )]);
        assert_eq!(paths(&out), vec!["raw.webm"]);
    }

    #[test]
    fn every_member_path_is_unique_after_dedupe() {
        let out = dedupe_zip_member_names(vec![
            entry("clips/v.webm", "v.webm", "video/webm", true),
            entry("clips/v.mp4", "v.mp4", "video/mp4", true),
            entry("clips/v.mkv", "v.mkv", "video/x-matroska", true),
            entry("other/v.webm", "v.webm", "video/webm", true),
        ]);
        let unique: std::collections::HashSet<String> = paths(&out).into_iter().collect();
        assert_eq!(unique.len(), out.len(), "zip member paths must be unique");
    }

    #[test]
    fn zip_entry_options_store_video_without_deflate() {
        assert!(zip_member_is_precompressed(&Some("video/mp4".into()), "clip.mp4"));
    }

    #[test]
    fn zip_entry_options_deflate_text_documents() {
        assert!(!zip_member_is_precompressed(&Some("text/plain".into()), "notes.txt"));
    }

    #[tokio::test]
    async fn protects_active_bulk_zip_scratch_dir() {
        let registry = FolderDownloadRegistry::new();
        let job_id = "job-123";
        let key = FolderDownloadRegistry::bulk_job_key("user-1", job_id);
        registry
            .set(
                key,
                FolderDownloadJob {
                    status: "ready".to_string(),
                    progress: 100,
                    ready: true,
                    error: None,
                    archive_name: "files.zip".into(),
                    size_bytes: Some(1024),
                    archive_path: Some(std::env::temp_dir().join(format!(
                        "mv_bulk_zip_{job_id}/files.zip"
                    ))),
                    cancelled: false,
                    files_done: 0,
                    files_total: 0,
                    skipped_files: Vec::new(),
                },
            )
            .await;

        assert!(
            registry
                .protects_scratch_dir_name(&format!("mv_bulk_zip_{job_id}"))
                .await
        );
    }

    #[tokio::test]
    async fn does_not_protect_failed_zip_scratch_dir() {
        let registry = FolderDownloadRegistry::new();
        let job_id = "job-failed";
        let key = FolderDownloadRegistry::bulk_job_key("user-1", job_id);
        registry
            .set(
                key,
                FolderDownloadJob {
                    status: "failed".to_string(),
                    progress: 0,
                    ready: false,
                    error: Some("boom".into()),
                    archive_name: "files.zip".into(),
                    size_bytes: None,
                    archive_path: None,
                    cancelled: false,
                    files_done: 0,
                    files_total: 0,
                    skipped_files: Vec::new(),
                },
            )
            .await;

        assert!(
            !registry
                .protects_scratch_dir_name(&format!("mv_bulk_zip_{job_id}"))
                .await
        );
    }
}
