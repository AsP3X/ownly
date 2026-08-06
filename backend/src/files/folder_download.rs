// Human: Background folder archive — recursively zips a folder tree with maximum deflate compression.
// Agent: READS folders/files tables + storage; WRITES temp zip; IN-MEMORY job registry for progress polling.

use std::path::Path;
use std::sync::Arc;

use axum::{
    extract::{Path as AxumPath, State},
    http::HeaderMap,
    response::Response,
    Extension, Json,
};
use serde::Serialize;

use crate::{
    audit,
    auth::handlers::Claims,
    error::AppError,
    files::{
        access,
        zip_job::{
            zip_archive_stream_response, zip_status_json, FolderDownloadJob, FolderDownloadRegistry,
            ZipFileEntry,
        },
    },
    AppState,
};

#[derive(Debug, Serialize)]
pub struct FolderDownloadStatusResponse {
    status: String,
    progress: i32,
    ready: bool,
    archive_name: String,
    size_bytes: Option<i64>,
    error: Option<String>,
    /// Human: Members compressed so far / in total — the tray renders "12 of 40 files".
    files_done: i32,
    files_total: i32,
    /// Human: Files left out because they could not be read — a non-empty list means the
    /// archive is partial, not that the job failed.
    skipped_files: Vec<String>,
}

fn folder_status_json(job: &FolderDownloadJob) -> FolderDownloadStatusResponse {
    let status = zip_status_json(job);
    FolderDownloadStatusResponse {
        status: status.status,
        progress: status.progress,
        ready: status.ready,
        archive_name: status.archive_name,
        size_bytes: status.size_bytes,
        error: status.error,
        files_done: status.files_done,
        files_total: status.files_total,
        skipped_files: status.skipped_files,
    }
}

// Human: Build a filesystem-safe zip filename from the folder label and current local time.
// Agent: REPLACES path separators in folder name; FORMATS timestamp as YYYY-MM-DD HH-MM-SS.
fn archive_filename(folder_name: &str) -> String {
    let safe_name = folder_name
        .chars()
        .map(|ch| match ch {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            other => other,
        })
        .collect::<String>()
        .trim()
        .to_string();
    let label = if safe_name.is_empty() {
        "folder".to_string()
    } else {
        safe_name
    };
    let stamp = chrono::Local::now().format("%Y-%m-%d %H-%M-%S");
    format!("{label} {stamp}.zip")
}

/// Human: Ceiling on folder nesting the archive walk will follow.
/// Agent: Guards the recursive CTE against a parent_id cycle looping forever. Well beyond any
///        real tree, so hitting it means the data is malformed, not that the folder is deep.
const MAX_FOLDER_DEPTH: i32 = 64;

type FolderFileRow = (
    String,
    String,
    String,
    String,
    Option<String>,
    bool,
    bool,
    Option<i32>,
);

/// Human: Everything an archive needs from a folder tree — its files and its directory skeleton.
/// Agent: `directories` carries EVERY folder in the tree, so empty ones survive into the zip.
pub struct FolderZipContents {
    pub entries: Vec<ZipFileEntry>,
    pub directories: Vec<String>,
}

// Human: Collect a folder subtree — every file with its zip-relative path, plus the directory
// skeleton so empty folders survive into the archive.
// Agent: TWO queries total (recursive CTE for the tree, one IN-list for the files). The previous
//        BFS issued two round trips PER FOLDER, so a deep tree cost hundreds of queries.
pub async fn collect_zip_entries_for_folder(
    pool: &sqlx::PgPool,
    actor_id: &str,
    root_folder_id: &str,
) -> Result<FolderZipContents, AppError> {
    access::ensure_folder_access(
        pool,
        actor_id,
        root_folder_id,
        crate::authz::Permission::ContentRead,
    )
    .await?;

    let owner_row: Option<(String,)> = sqlx::query_as(
        "SELECT user_id FROM folders WHERE id = $1 AND deleted_at IS NULL",
    )
    .bind(root_folder_id)
    .fetch_optional(pool)
    .await?;
    let (owner_id,) = owner_row.ok_or(AppError::NotFound)?;

    // Human: `prefix` is each folder's own path RELATIVE to the root, so the root itself is ''
    // and its name never appears inside the archive — the zip filename already carries it.
    // Agent: depth guard stops a parent_id cycle from recursing forever.
    let folders: Vec<(String, String)> = sqlx::query_as(
        "WITH RECURSIVE tree AS ( \
             SELECT id, ''::text AS prefix, 0 AS depth \
               FROM folders \
              WHERE id = $2 AND user_id = $1 AND deleted_at IS NULL \
             UNION ALL \
             SELECT child.id, \
                    CASE WHEN parent.prefix = '' THEN child.name \
                         ELSE parent.prefix || '/' || child.name END, \
                    parent.depth + 1 \
               FROM folders child \
               JOIN tree parent ON child.parent_id = parent.id \
              WHERE child.user_id = $1 \
                AND child.deleted_at IS NULL \
                AND parent.depth < $3 \
         ) \
         SELECT id, prefix FROM tree ORDER BY prefix ASC",
    )
    .bind(&owner_id)
    .bind(root_folder_id)
    .bind(MAX_FOLDER_DEPTH)
    .fetch_all(pool)
    .await?;

    let folder_ids: Vec<String> = folders.iter().map(|(id, _)| id.clone()).collect();
    let prefix_by_id: std::collections::HashMap<&str, &str> = folders
        .iter()
        .map(|(id, prefix)| (id.as_str(), prefix.as_str()))
        .collect();

    // Human: Every folder below the root becomes an explicit directory member. Without this an
    // empty folder simply vanishes from the archive, because zip infers directories only from
    // the paths of the files inside them.
    let mut directories = Vec::new();
    for (_, prefix) in &folders {
        if prefix.is_empty() {
            continue;
        }
        directories.push(crate::files::zip_job::sanitize_zip_entry_path(prefix)?);
    }

    let rows: Vec<FolderFileRow> = sqlx::query_as(
        "SELECT folder_id, id, name, storage_key, mime_type, hls_ready, download_export_ready, \
                segment_count \
           FROM files \
          WHERE user_id = $1 AND folder_id = ANY($2) AND deleted_at IS NULL \
          ORDER BY name ASC",
    )
    .bind(&owner_id)
    .bind(&folder_ids)
    .fetch_all(pool)
    .await?;

    let mut entries = Vec::with_capacity(rows.len());
    for (
        folder_id,
        file_id,
        name,
        storage_key,
        mime_type,
        hls_ready,
        export_ready,
        segment_count,
    ) in rows
    {
        let prefix = prefix_by_id.get(folder_id.as_str()).copied().unwrap_or("");
        let raw_zip_path = if prefix.is_empty() {
            name.clone()
        } else {
            format!("{prefix}/{name}")
        };
        let zip_path = crate::files::zip_job::sanitize_zip_entry_path(&raw_zip_path)?;
        entries.push(ZipFileEntry {
            zip_path,
            file_id,
            storage_key,
            display_name: name,
            mime_type,
            hls_ready,
            export_ready,
            segment_count: segment_count.unwrap_or(0),
        });
    }

    // Human: Folder trees looked safe because paths are unique per directory, but HLS videos are
    // renamed to .mp4 on the way into the archive — so `clip.webm` and `clip.mp4` sitting in the
    // same folder collide and the zip fails to open. Dedupe against the post-rename path.
    Ok(FolderZipContents {
        entries: crate::files::zip_job::dedupe_zip_member_names(entries),
        directories,
    })
}

// Human: Start (or re-use) a background zip job for the selected folder.
// Agent: POST /folders/:id/download; AUDIT folders.download.start; SPAWNS tokio job when idle.
pub async fn post_folder_download(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    headers: HeaderMap,
    AxumPath(folder_id): AxumPath<String>,
) -> Result<Json<FolderDownloadStatusResponse>, AppError> {
    access::ensure_folder_access(
        &state.pool,
        &claims.sub,
        &folder_id,
        crate::authz::Permission::ContentRead,
    )
    .await?;

    let folder = access::load_folder_if_readable(&state.pool, &claims.sub, &folder_id).await?;
    let folder_name = folder.name;

    let key = FolderDownloadRegistry::folder_job_key(&claims.sub, &folder_id);
    if let Some(existing) = state.folder_download_jobs.get(&key).await {
        if existing.status == "queued"
            || existing.status == "compressing"
            || existing.status == "processing"
        {
            return Ok(Json(folder_status_json(&existing)));
        }
        if existing.ready {
            return Ok(Json(folder_status_json(&existing)));
        }
    }

    let archive_name = archive_filename(&folder_name);
    let job = FolderDownloadJob {
        status: "queued".to_string(),
        progress: 0,
        ready: false,
        error: None,
        archive_name: archive_name.clone(),
        size_bytes: None,
        archive_path: None,
        cancelled: false,
        files_done: 0,
        files_total: 0,
        skipped_files: Vec::new(),
    };
    state
        .folder_download_jobs
        .set(key.clone(), job.clone())
        .await;

    audit::write_audit(
        &state.pool,
        Some(&claims.sub),
        "folders.download.start",
        Some("folder"),
        Some(&folder_id),
        Some(serde_json::json!({ "archive_name": archive_name })),
        &headers,
    )
    .await
    .ok();

    let work_dir = std::env::temp_dir().join(format!("mv_folder_zip_{folder_id}"));
    let payload = crate::jobs::model::ZipFolderPayload {
        folder_id: folder_id.clone(),
        folder_name: folder_name.clone(),
        registry_key: key.clone(),
        work_dir: work_dir.to_string_lossy().to_string(),
        archive_name: archive_name.clone(),
    };

    let _background_job_id = crate::jobs::enqueue_job(
        &state.pool,
        &claims.sub,
        crate::jobs::JobKind::ZipFolder,
        &folder_name,
        Some("folder"),
        Some(&folder_id),
        serde_json::to_value(payload).map_err(|e| AppError::Internal(anyhow::anyhow!("{e}")))?,
    )
    .await?;

    Ok(Json(folder_status_json(&job)))
}

// Human: Poll zip job progress for the download tray.
// Agent: GET /folders/:id/download; READ-ONLY registry lookup.
pub async fn get_folder_download_status(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    AxumPath(folder_id): AxumPath<String>,
) -> Result<Json<FolderDownloadStatusResponse>, AppError> {
    access::ensure_folder_access(
        &state.pool,
        &claims.sub,
        &folder_id,
        crate::authz::Permission::ContentRead,
    )
    .await?;

    let key = FolderDownloadRegistry::folder_job_key(&claims.sub, &folder_id);
    let job = state
        .folder_download_jobs
        .get(&key)
        .await
        .ok_or(AppError::NotFound)?;

    Ok(Json(folder_status_json(&job)))
}

// Human: Stream the finished zip archive to the browser once the job is ready.
// Agent: GET /folders/:id/download/archive; REMOVES temp work dir after streaming starts.
pub async fn get_folder_download_archive(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    headers: HeaderMap,
    AxumPath(folder_id): AxumPath<String>,
) -> Result<Response, AppError> {
    access::ensure_folder_access(
        &state.pool,
        &claims.sub,
        &folder_id,
        crate::authz::Permission::ContentRead,
    )
    .await?;

    let key = FolderDownloadRegistry::folder_job_key(&claims.sub, &folder_id);
    let job = state
        .folder_download_jobs
        .get(&key)
        .await
        .ok_or(AppError::NotFound)?;

    if !job.ready {
        return Err(AppError::Conflict(
            "folder archive is not ready — poll /download and retry".into(),
        ));
    }

    let archive_path = job
        .archive_path
        .clone()
        .ok_or(AppError::Internal(anyhow::anyhow!("missing archive path")))?;
    let archive_name = job.archive_name.clone();
    let work_dir = archive_path
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(std::env::temp_dir);

    audit::write_audit(
        &state.pool,
        Some(&claims.sub),
        "folders.download.complete",
        Some("folder"),
        Some(&folder_id),
        Some(serde_json::json!({
            "archive_name": archive_name,
            "size_bytes": job.size_bytes,
        })),
        &headers,
    )
    .await
    .ok();

    state.folder_download_jobs.remove(&key).await;

    zip_archive_stream_response(archive_path, &archive_name, job.size_bytes, work_dir).await
}

// Human: Cancel an in-flight folder zip job and remove scratch files.
// Agent: DELETE /folders/:id/download; WRITES cancelled flag; REMOVES registry entry.
pub async fn delete_folder_download_job(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    AxumPath(folder_id): AxumPath<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    access::ensure_folder_access(
        &state.pool,
        &claims.sub,
        &folder_id,
        crate::authz::Permission::ContentRead,
    )
    .await?;

    let key = FolderDownloadRegistry::folder_job_key(&claims.sub, &folder_id);
    if let Some(mut job) = state.folder_download_jobs.get(&key).await {
        job.cancelled = true;
        state.folder_download_jobs.set(key.clone(), job).await;
        let _ = crate::jobs::cancel_job_by_resource(
            &state.pool,
            &claims.sub,
            crate::jobs::JobKind::ZipFolder,
            "folder",
            &folder_id,
        )
        .await;
        let work_dir = std::env::temp_dir().join(format!("mv_folder_zip_{folder_id}"));
        let _ = tokio::fs::remove_dir_all(&work_dir).await;
        state.folder_download_jobs.remove(&key).await;
    }

    Ok(Json(serde_json::json!({ "ok": true })))
}
