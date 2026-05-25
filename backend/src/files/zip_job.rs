// Human: Shared zip archive builder for folder and multi-file bulk downloads.
// Agent: READS storage blobs; WRITES deflate zip; UPDATES in-memory download job registry.

use std::collections::HashMap;
use std::io::Write;
use std::path::PathBuf;
use std::sync::Arc;

use futures_util::TryStreamExt;
use serde::Serialize;
use tokio::sync::RwLock;
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

    pub async fn get(&self, key: &str) -> Option<FolderDownloadJob> {
        self.inner.read().await.get(key).cloned()
    }

    pub async fn set(&self, key: String, job: FolderDownloadJob) {
        self.inner.write().await.insert(key, job);
    }

    pub async fn remove(&self, key: &str) {
        self.inner.write().await.remove(key);
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

async fn read_storage_bytes(
    storage: &dyn crate::storage::Storage,
    key: &str,
) -> anyhow::Result<Vec<u8>> {
    let (mut stream, _, _) = storage.get_stream(key).await?;
    let mut out = Vec::new();
    while let Some(chunk) = stream.try_next().await? {
        out.extend_from_slice(&chunk);
    }
    Ok(out)
}

async fn ensure_hls_export_ready(
    pool: &sqlx::PgPool,
    storage: Arc<dyn crate::storage::Storage>,
    entry: &ZipFileEntry,
) -> Result<(), String> {
    if !is_hls_stored_video(&entry.mime_type, entry.hls_ready) {
        return Ok(());
    }
    if entry.export_ready {
        return Ok(());
    }

    run_hls_export_job(
        pool.clone(),
        storage,
        entry.file_id.clone(),
        entry.storage_key.clone(),
        entry.segment_count,
    )
    .await;

    let ready: Option<(bool,)> =
        sqlx::query_as("SELECT download_export_ready FROM files WHERE id = $1")
            .bind(&entry.file_id)
            .fetch_optional(pool)
            .await
            .map_err(|e| e.to_string())?;

    match ready {
        Some((true,)) => Ok(()),
        _ => Err(format!(
            "video export failed for {}",
            entry.display_name
        )),
    }
}

async fn resolve_object_key(
    pool: &sqlx::PgPool,
    storage: Arc<dyn crate::storage::Storage>,
    entry: &ZipFileEntry,
) -> Result<(String, String), String> {
    if is_hls_stored_video(&entry.mime_type, entry.hls_ready) {
        ensure_hls_export_ready(pool, storage, entry).await?;
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
        Ok((entry.storage_key.clone(), entry.zip_path.clone()))
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
    let options = SimpleFileOptions::default()
        .compression_method(CompressionMethod::Deflated)
        .compression_level(Some(9));

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
            match resolve_object_key(&state.pool, state.storage.clone(), entry).await {
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

        let bytes = match read_storage_bytes(state.storage.as_ref(), &object_key).await {
            Ok(data) => data,
            Err(error) => {
                mark_failed(
                    &state.folder_download_jobs,
                    &registry_key,
                    &archive_name,
                    &format!("read {}: {error}", entry.display_name),
                )
                .await;
                let _ = zip.finish();
                let _ = tokio::fs::remove_dir_all(&work_dir).await;
                return;
            }
        };

        if let Err(error) = zip.start_file(&member_path, options) {
            mark_failed(
                &state.folder_download_jobs,
                &registry_key,
                &archive_name,
                &format!("zip entry {member_path}: {error}"),
            )
            .await;
            let _ = zip.finish();
            let _ = tokio::fs::remove_dir_all(&work_dir).await;
            return;
        }
        if let Err(error) = zip.write_all(&bytes) {
            mark_failed(
                &state.folder_download_jobs,
                &registry_key,
                &archive_name,
                &format!("write zip entry {member_path}: {error}"),
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

// Human: Load zip member rows for explicit file ids owned by the authenticated user.
// Agent: READS files table; REJECTS unknown ids; DEDUPES member names for flat archives.
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

    let mut entries = Vec::with_capacity(file_ids.len());
    for file_id in file_ids {
        let row: Option<FileRow> = sqlx::query_as(
            "SELECT id, name, storage_key, mime_type, hls_ready, download_export_ready, segment_count \
             FROM files WHERE id = $1 AND user_id = $2",
        )
        .bind(file_id)
        .bind(user_id)
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
