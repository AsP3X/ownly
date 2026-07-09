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

// Human: Ensure zip member names stay unique when multiple files share a display name.
// Agent: APPENDS " (N)" before extension on duplicates; PRESERVES first occurrence unchanged.
pub fn dedupe_zip_member_names(entries: Vec<ZipFileEntry>) -> Vec<ZipFileEntry> {
    let mut seen: std::collections::HashMap<String, u32> = std::collections::HashMap::new();
    entries
        .into_iter()
        .map(|mut entry| {
            let base = entry.display_name.clone();
            let count = seen.entry(base.clone()).or_insert(0);
            *count += 1;
            entry.zip_path = if *count == 1 {
                base
            } else {
                disambiguate_filename(&base, *count)
            };
            entry
        })
        .collect()
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


async fn write_storage_object_to_zip(
    storage: &dyn crate::storage::Storage,
    object_key: &str,
    zip: &mut zip::ZipWriter<std::fs::File>,
    member_path: &str,
    options: SimpleFileOptions,
) -> Result<(), String> {
    let (mut stream, _, _) = storage
        .get_stream(object_key)
        .await
        .map_err(|error| format!("open {object_key}: {error}"))?;
    zip.start_file(member_path, options)
        .map_err(|error| format!("zip entry {member_path}: {error}"))?;
    while let Some(chunk) = stream.try_next().await.map_err(|error| error.to_string())? {
        zip.write_all(&chunk)
            .map_err(|error| format!("write zip entry {member_path}: {error}"))?;
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
        let member_path = if entry.zip_path.contains('/') {
            if let Some((dir, file)) = entry.zip_path.rsplit_once('/') {
                let stem = file.rsplit_once('.').map(|(s, _)| s).unwrap_or(file);
                format!("{dir}/{stem}.mp4")
            } else {
                mp4_zip_name(&entry.display_name)
            }
        } else {
            mp4_zip_name(&entry.display_name)
        };
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
                    mark_failed(
                        &state.folder_download_jobs,
                        &registry_key,
                        &archive_name,
                        &message,
                    )
                    .await;
                    let _ = zip.finish();
                    let _ = tokio::fs::remove_dir_all(&work_dir).await;
                    return;
                }
            };

        let options = zip_entry_options(&entry.mime_type, &member_path);
        if let Err(message) =
            write_storage_object_to_zip(state.storage.as_ref(), &object_key, &mut zip, &member_path, options)
                .await
        {
            mark_failed(
                &state.folder_download_jobs,
                &registry_key,
                &archive_name,
                &format!("read {}: {message}", entry.display_name),
            )
            .await;
            let _ = zip.finish();
            let _ = tokio::fs::remove_dir_all(&work_dir).await;
            return;
        }
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
