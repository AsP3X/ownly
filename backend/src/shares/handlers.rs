// Human: HTTP handlers for creating/revoking shares and anonymous scoped access.
// Agent: PROTECTED /api/v1/shares* requires Claims; PUBLIC /api/v1/public/shares/{token}* validates token scope.

use axum::{
    body::Body,
    extract::{Path, Query, State},
    http::{header, HeaderMap},
    response::{IntoResponse, Response},
    Extension, Json,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use uuid::Uuid;

use crate::{
    audit,
    auth::handlers::Claims,
    error::AppError,
    files::{
        folders::FolderDto,
        handlers::{FileDto, FILE_COLUMNS},
    },
    hls::handlers::{
        build_playlist_for_playback, open_hls_segment, resolve_hls_aes_key, HlsPlaybackRow,
    },
    rate_limit,
    shares::store::{
        ensure_browse_folder_in_share, ensure_file_owned_for_share, ensure_folder_owned_for_share,
        ensure_shared_file_ready, generate_share_token, list_share_folder_files,
        load_file_in_share_scope, resolve_active_share, ShareRecord,
    },
    AppState,
};

const EXPORT_OBJECT_SUFFIX: &str = "export.mp4";

// Human: True when the vault keeps an HLS bundle (no standalone original blob).
fn is_hls_stored_video(mime_type: &Option<String>, hls_ready: bool) -> bool {
    mime_type
        .as_deref()
        .is_some_and(|m| m.starts_with("video/"))
        && hls_ready
}

// Human: Download filename for remuxed exports — preserve stem, force .mp4 extension.
fn mp4_download_name(name: &str) -> String {
    if name.to_lowercase().ends_with(".mp4") {
        return name.to_string();
    }
    match name.rsplit_once('.') {
        Some((stem, _)) => format!("{stem}.mp4"),
        None => format!("{name}.mp4"),
    }
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct ShareDto {
    pub id: String,
    pub token: String,
    pub resource_type: String,
    pub resource_id: String,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Deserialize)]
pub struct CreateShareRequest {
    pub resource_type: String,
    pub resource_id: String,
}

#[derive(Debug, Serialize)]
pub struct CreateShareResponse {
    pub share: ShareDto,
}

#[derive(Debug, Deserialize)]
pub struct ShareLookupQuery {
    pub file_id: Option<String>,
    pub folder_id: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ShareLookupResponse {
    pub share: Option<ShareDto>,
}

#[derive(Debug, Deserialize)]
pub struct ShareStatusRequest {
    pub file_ids: Option<Vec<String>>,
    pub folder_ids: Option<Vec<String>>,
}

#[derive(Debug, Serialize, Clone)]
pub struct ShareFlags {
    pub public: bool,
    pub users: bool,
}

#[derive(Debug, Serialize)]
pub struct ShareStatusResponse {
    pub files: std::collections::HashMap<String, ShareFlags>,
    pub folders: std::collections::HashMap<String, ShareFlags>,
}

#[derive(Debug, Deserialize)]
pub struct ResourceSharesQuery {
    pub file_id: Option<String>,
    pub folder_id: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ResourceSharesResponse {
    pub public_share: Option<ShareDto>,
    pub user_shares: Vec<serde_json::Value>,
}

const MAX_SHARE_STATUS_IDS: usize = 500;

// Human: Return which visible files/folders have active public links (user shares reserved for later).
// Agent: POST body file_ids/folder_ids; READS public_shares; RETURNS per-id ShareFlags maps.
pub async fn share_status_bulk(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Json(body): Json<ShareStatusRequest>,
) -> Result<Json<ShareStatusResponse>, AppError> {
    let file_ids: Vec<String> = body
        .file_ids
        .unwrap_or_default()
        .into_iter()
        .take(MAX_SHARE_STATUS_IDS)
        .collect();
    let folder_ids: Vec<String> = body
        .folder_ids
        .unwrap_or_default()
        .into_iter()
        .take(MAX_SHARE_STATUS_IDS)
        .collect();

    let mut files = std::collections::HashMap::new();
    for id in &file_ids {
        files.insert(
            id.clone(),
            ShareFlags {
                public: false,
                users: false,
            },
        );
    }
    let mut folders = std::collections::HashMap::new();
    for id in &folder_ids {
        folders.insert(
            id.clone(),
            ShareFlags {
                public: false,
                users: false,
            },
        );
    }

    if !file_ids.is_empty() {
        let rows: Vec<(String,)> = sqlx::query_as(
            "SELECT resource_id FROM public_shares \
             WHERE user_id = $1 AND resource_type = 'file' AND revoked_at IS NULL \
             AND resource_id = ANY($2)",
        )
        .bind(&claims.sub)
        .bind(&file_ids)
        .fetch_all(&state.pool)
        .await?;

        for (resource_id,) in rows {
            if let Some(flags) = files.get_mut(&resource_id) {
                flags.public = true;
            }
        }
    }

    if !folder_ids.is_empty() {
        let rows: Vec<(String,)> = sqlx::query_as(
            "SELECT resource_id FROM public_shares \
             WHERE user_id = $1 AND resource_type = 'folder' AND revoked_at IS NULL \
             AND resource_id = ANY($2)",
        )
        .bind(&claims.sub)
        .bind(&folder_ids)
        .fetch_all(&state.pool)
        .await?;

        for (resource_id,) in rows {
            if let Some(flags) = folders.get_mut(&resource_id) {
                flags.public = true;
            }
        }
    }

    Ok(Json(ShareStatusResponse { files, folders }))
}

// Human: List all share links for one file or folder (public + future user shares).
// Agent: GET with file_id or folder_id; RETURNS public_share row and empty user_shares until implemented.
pub async fn resource_shares(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Query(query): Query<ResourceSharesQuery>,
) -> Result<Json<ResourceSharesResponse>, AppError> {
    let (resource_type, resource_id) = match (&query.file_id, &query.folder_id) {
        (Some(file_id), None) => ("file", file_id.as_str()),
        (None, Some(folder_id)) => ("folder", folder_id.as_str()),
        _ => {
            return Err(AppError::BadRequest(
                "provide exactly one of file_id or folder_id".into(),
            ));
        }
    };

    if resource_type == "file" {
        ensure_file_owned_for_share(&state.pool, &claims.sub, resource_id).await?;
    } else {
        ensure_folder_owned_for_share(&state.pool, &claims.sub, resource_id).await?;
    }

    let public_share: Option<ShareDto> = sqlx::query_as(
        "SELECT id, token, resource_type, resource_id, created_at \
         FROM public_shares \
         WHERE user_id = $1 AND resource_type = $2 AND resource_id = $3 AND revoked_at IS NULL",
    )
    .bind(&claims.sub)
    .bind(resource_type)
    .bind(resource_id)
    .fetch_optional(&state.pool)
    .await?;

    Ok(Json(ResourceSharesResponse {
        public_share,
        user_shares: Vec::new(),
    }))
}

#[derive(Debug, Serialize)]
pub struct PublicShareOverview {
    pub resource_type: String,
    pub resource_id: String,
    pub name: String,
    pub mime_type: Option<String>,
    pub size_bytes: Option<i64>,
    pub hls_ready: Option<bool>,
}

#[derive(Debug, Serialize)]
pub struct PublicShareOverviewResponse {
    pub share: PublicShareOverview,
}

#[derive(Debug, Deserialize)]
pub struct PublicContentsQuery {
    pub folder_id: Option<String>,
}

// Human: Create or reuse a public link for one owned file or folder.
// Agent: UPSERT public_shares; AUDIT shares.create; RETURNS token for /s/{token} UI.
pub async fn create_share(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    headers: HeaderMap,
    Json(body): Json<CreateShareRequest>,
) -> Result<Json<CreateShareResponse>, AppError> {
    let resource_type = body.resource_type.trim().to_lowercase();
    if resource_type != "file" && resource_type != "folder" {
        return Err(AppError::BadRequest(
            "resource_type must be \"file\" or \"folder\"".into(),
        ));
    }

    if resource_type == "file" {
        ensure_file_owned_for_share(&state.pool, &claims.sub, &body.resource_id).await?;
    } else {
        ensure_folder_owned_for_share(&state.pool, &claims.sub, &body.resource_id).await?;
    }

    let existing: Option<ShareDto> = sqlx::query_as(
        "SELECT id, token, resource_type, resource_id, created_at \
         FROM public_shares \
         WHERE user_id = $1 AND resource_type = $2 AND resource_id = $3 AND revoked_at IS NULL",
    )
    .bind(&claims.sub)
    .bind(&resource_type)
    .bind(&body.resource_id)
    .fetch_optional(&state.pool)
    .await?;

    if let Some(share) = existing {
        return Ok(Json(CreateShareResponse { share }));
    }

    let share_id = Uuid::new_v4().to_string();
    let token = generate_share_token();

    let share: ShareDto = match sqlx::query_as(
        "INSERT INTO public_shares (id, token, user_id, resource_type, resource_id) \
         VALUES ($1, $2, $3, $4, $5) \
         ON CONFLICT (user_id, resource_type, resource_id) DO UPDATE \
         SET token = EXCLUDED.token, revoked_at = NULL, created_at = now() \
         RETURNING id, token, resource_type, resource_id, created_at",
    )
    .bind(&share_id)
    .bind(&token)
    .bind(&claims.sub)
    .bind(&resource_type)
    .bind(&body.resource_id)
    .fetch_one(&state.pool)
    .await
    {
        Ok(row) => row,
        Err(sqlx::Error::Database(db_err)) if db_err.code() == Some("23505".into()) => {
            let share: ShareDto = sqlx::query_as(
                "SELECT id, token, resource_type, resource_id, created_at \
                 FROM public_shares \
                 WHERE user_id = $1 AND resource_type = $2 AND resource_id = $3 AND revoked_at IS NULL",
            )
            .bind(&claims.sub)
            .bind(&resource_type)
            .bind(&body.resource_id)
            .fetch_one(&state.pool)
            .await?;
            return Ok(Json(CreateShareResponse { share }));
        }
        Err(error) => return Err(error.into()),
    };

    audit::write_audit(
        &state.pool,
        Some(&claims.sub),
        "shares.create",
        Some(&resource_type),
        Some(&body.resource_id),
        Some(serde_json::json!({ "share_id": share.id })),
        &headers,
    )
    .await
    .ok();

    Ok(Json(CreateShareResponse { share }))
}

// Human: Look up an existing active share for a file or folder owned by the caller.
// Agent: READS public_shares; EXACTLY ONE of file_id or folder_id required.
pub async fn lookup_share(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Query(query): Query<ShareLookupQuery>,
) -> Result<Json<ShareLookupResponse>, AppError> {
    let (resource_type, resource_id) = match (&query.file_id, &query.folder_id) {
        (Some(file_id), None) => ("file", file_id.as_str()),
        (None, Some(folder_id)) => ("folder", folder_id.as_str()),
        _ => {
            return Err(AppError::BadRequest(
                "provide exactly one of file_id or folder_id".into(),
            ));
        }
    };

    let share: Option<ShareDto> = sqlx::query_as(
        "SELECT id, token, resource_type, resource_id, created_at \
         FROM public_shares \
         WHERE user_id = $1 AND resource_type = $2 AND resource_id = $3 AND revoked_at IS NULL",
    )
    .bind(&claims.sub)
    .bind(resource_type)
    .bind(resource_id)
    .fetch_optional(&state.pool)
    .await?;

    Ok(Json(ShareLookupResponse { share }))
}

// Human: Revoke a public link so the token stops working immediately.
// Agent: SET revoked_at; AUDIT shares.revoke; REQUIRES owner match.
pub async fn revoke_share(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    let updated = sqlx::query(
        "UPDATE public_shares SET revoked_at = now() \
         WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL",
    )
    .bind(&id)
    .bind(&claims.sub)
    .execute(&state.pool)
    .await?;

    if updated.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }

    audit::write_audit(
        &state.pool,
        Some(&claims.sub),
        "shares.revoke",
        Some("share"),
        Some(&id),
        None,
        &headers,
    )
    .await
    .ok();

    Ok(Json(serde_json::json!({ "ok": true })))
}

// Human: Build the public overview payload for a share token (no auth).
// Agent: READS share + file/folder metadata; NO user_id in response.
async fn public_overview_for_share(
    pool: &sqlx::PgPool,
    share: &ShareRecord,
) -> Result<PublicShareOverview, AppError> {
    if share.resource_type == "file" {
        let row: Option<(String, Option<String>, i64, bool)> = sqlx::query_as(
            "SELECT name, mime_type, size_bytes, hls_ready FROM files WHERE id = $1 AND user_id = $2",
        )
        .bind(&share.resource_id)
        .bind(&share.user_id)
        .fetch_optional(pool)
        .await?;

        let (name, mime_type, size_bytes, hls_ready) = row.ok_or(AppError::NotFound)?;
        return Ok(PublicShareOverview {
            resource_type: "file".into(),
            resource_id: share.resource_id.clone(),
            name,
            mime_type,
            size_bytes: Some(size_bytes),
            hls_ready: Some(hls_ready),
        });
    }

    let row: Option<(String,)> = sqlx::query_as(
        "SELECT name FROM folders WHERE id = $1 AND user_id = $2",
    )
    .bind(&share.resource_id)
    .bind(&share.user_id)
    .fetch_optional(pool)
    .await?;

    let (name,) = row.ok_or(AppError::NotFound)?;
    Ok(PublicShareOverview {
        resource_type: "folder".into(),
        resource_id: share.resource_id.clone(),
        name,
        mime_type: None,
        size_bytes: None,
        hls_ready: None,
    })
}

// Human: Anonymous metadata probe for a public share link.
// Agent: resolve_active_share; RETURNS resource name/type only.
pub async fn public_share_overview(
    State(state): State<Arc<AppState>>,
    Path(token): Path<String>,
) -> Result<Json<PublicShareOverviewResponse>, AppError> {
    let share = resolve_active_share(&state.pool, &token).await?;
    let overview = public_overview_for_share(&state.pool, &share).await?;
    Ok(Json(PublicShareOverviewResponse { share: overview }))
}

// Human: List files and subfolders visible inside a folder-type public share.
// Agent: SCOPES queries to share.user_id + validated folder_id (defaults to shared root).
pub async fn public_share_contents(
    State(state): State<Arc<AppState>>,
    Path(token): Path<String>,
    Query(query): Query<PublicContentsQuery>,
) -> Result<Json<serde_json::Value>, AppError> {
    let share = resolve_active_share(&state.pool, &token).await?;
    ensure_browse_folder_in_share(&state.pool, &share, query.folder_id.as_deref()).await?;

    let browse_folder_id = query
        .folder_id
        .as_deref()
        .unwrap_or(&share.resource_id);

    let files = list_share_folder_files(&state.pool, &share, browse_folder_id).await?;
    let total_bytes: i64 = files.iter().map(|f| f.size_bytes).sum();
    let file_count = files.len() as i64;

    let folders: Vec<FolderDto> = sqlx::query_as(
        "SELECT id, name, parent_id, created_at, updated_at \
         FROM folders \
         WHERE user_id = $1 AND parent_id = $2 \
         ORDER BY name ASC",
    )
    .bind(&share.user_id)
    .bind(browse_folder_id)
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(serde_json::json!({
        "files": files,
        "folders": folders,
        "total_bytes": total_bytes,
        "file_count": file_count,
        "current_folder_id": browse_folder_id,
        "root_folder_id": share.resource_id,
    })))
}

// Human: Stream one shared file through the API for anonymous download.
// Agent: load_file_in_share_scope; SAME disposition rules as authenticated download.
pub async fn public_share_download(
    State(state): State<Arc<AppState>>,
    Path((token, file_id)): Path<(String, String)>,
) -> Result<Response, AppError> {
    let share = resolve_active_share(&state.pool, &token).await?;
    let row = load_file_in_share_scope(&state.pool, &share, &file_id).await?;
    ensure_shared_file_ready(&row)?;

    let object_key = if is_hls_stored_video(&row.mime_type, row.hls_ready) {
        if !row.download_export_ready {
            return Err(AppError::Conflict(
                "video export is not ready yet — try again shortly".into(),
            ));
        }
        format!("{}/{EXPORT_OBJECT_SUFFIX}", row.storage_key)
    } else {
        row.storage_key.clone()
    };

    let (stream, _len, content_type) = state
        .storage
        .get_stream(&object_key)
        .await
        .map_err(|e| AppError::Storage(e.to_string()))?;

    let body = Body::from_stream(stream);
    let download_name = if is_hls_stored_video(&row.mime_type, row.hls_ready) {
        mp4_download_name(&row.name)
    } else {
        row.name.clone()
    };
    let disposition = format!("attachment; filename=\"{}\"", download_name.replace('"', ""));

    let resolved_type = if is_hls_stored_video(&row.mime_type, row.hls_ready) {
        "video/mp4".to_string()
    } else {
        row.mime_type.unwrap_or(content_type)
    };

    Ok((
        [
            (header::CONTENT_TYPE, resolved_type),
            (header::CONTENT_DISPOSITION, disposition),
        ],
        body,
    )
        .into_response())
}

// Human: Return HLS playlist URL for a video inside a public share (when ready).
// Agent: PUBLIC path prefix includes share token so segments stay scoped.
pub async fn public_share_stream_url(
    State(state): State<Arc<AppState>>,
    Path((token, file_id)): Path<(String, String)>,
) -> Result<Json<serde_json::Value>, AppError> {
    let share = resolve_active_share(&state.pool, &token).await?;
    load_file_in_share_scope(&state.pool, &share, &file_id).await?;

    type StreamUrlRow = (Option<bool>, Option<i32>, Option<String>, Option<String>);
    let row: Option<StreamUrlRow> = sqlx::query_as(
        "SELECT hls_ready, conversion_progress, hls_encode_status, hls_encode_error \
         FROM files WHERE id = $1 AND user_id = $2",
    )
    .bind(&file_id)
    .bind(&share.user_id)
    .fetch_optional(&state.pool)
    .await?;

    let (hls_ready, conversion_progress, hls_encode_status, hls_encode_error) =
        row.ok_or(AppError::NotFound)?;

    if hls_ready.unwrap_or(false) {
        let playlist_url =
            format!("/api/v1/public/shares/{token}/files/{file_id}/playlist");
        return Ok(Json(serde_json::json!({
            "url": playlist_url,
            "hls_ready": true,
            "conversion_progress": conversion_progress.unwrap_or(100),
            "hls_encode_status": hls_encode_status,
        })));
    }

    Ok(Json(serde_json::json!({
        "url": null,
        "hls_ready": false,
        "conversion_progress": conversion_progress.unwrap_or(0),
        "hls_encode_status": hls_encode_status,
        "hls_encode_error": hls_encode_error,
    })))
}

// Human: Serve an AES key for HLS playback on a shared video file.
// Agent: load_file_in_share_scope; READS hls_key_store by file id.
pub async fn public_share_key(
    State(state): State<Arc<AppState>>,
    Path((token, file_id)): Path<(String, String)>,
) -> Result<Response, AppError> {
    let share = resolve_active_share(&state.pool, &token).await?;
    let row = load_file_in_share_scope(&state.pool, &share, &file_id).await?;

    let key = resolve_hls_aes_key(
        state.storage.as_ref(),
        &state.hls_key_store,
        &row.storage_key,
        &file_id,
    )
    .await?;

    Ok((
        [
            (header::CONTENT_TYPE, "application/octet-stream"),
            (header::CACHE_CONTROL, "no-store, no-cache, must-revalidate"),
        ],
        key.to_vec(),
    )
        .into_response())
}

// Human: Dynamic HLS playlist for anonymous viewers of a shared video.
// Agent: Segment URLs stay under /public/shares/{token}/files/{file_id}/segments/*.
pub async fn public_share_playlist(
    State(state): State<Arc<AppState>>,
    Path((token, file_id)): Path<(String, String)>,
) -> Result<Response, AppError> {
    let share = resolve_active_share(&state.pool, &token).await?;
    load_file_in_share_scope(&state.pool, &share, &file_id).await?;

    let row: Option<HlsPlaybackRow> = sqlx::query_as(
        "SELECT storage_key, hls_ready, segment_count, size_bytes FROM files WHERE id = $1 AND user_id = $2",
    )
    .bind(&file_id)
    .bind(&share.user_id)
    .fetch_optional(&state.pool)
    .await?;

    let (storage_key, hls_ready, segment_count, size_bytes) = row.ok_or(AppError::NotFound)?;
    if !hls_ready.unwrap_or(false) {
        return Err(AppError::BadRequest(
            "video is not ready for HLS playback yet".into(),
        ));
    }

    let base_url = format!("/api/v1/public/shares/{token}/files/{file_id}");
    let key_uri = format!("{base_url}/key");
    let init_uri = format!("{base_url}/init");

    let count = segment_count.unwrap_or(0) as usize;
    let source_size = size_bytes.unwrap_or(0).max(0) as u64;
    let playlist = build_playlist_for_playback(
        state.storage.as_ref(),
        &storage_key,
        &base_url,
        &key_uri,
        &init_uri,
        count,
        source_size,
    )
    .await?;

    Ok((
        [
            (header::CONTENT_TYPE, "application/vnd.apple.mpegurl"),
            (header::CACHE_CONTROL, "no-store, no-cache, must-revalidate"),
        ],
        playlist,
    )
        .into_response())
}

// Human: Proxy one HLS segment for anonymous shared video playback.
// Agent: RATE LIMIT by token+file; READS storage under {storage_key}/segments/{name}.
pub async fn public_share_segment(
    State(state): State<Arc<AppState>>,
    Path((token, file_id, segment_name)): Path<(String, String, String)>,
) -> Result<Response, AppError> {
    let share = resolve_active_share(&state.pool, &token).await?;
    let row = load_file_in_share_scope(&state.pool, &share, &file_id).await?;

    if !row.hls_ready {
        return Err(AppError::NotFound);
    }

    let rl_key = format!("public:{token}:{file_id}");
    rate_limit::enforce(&state.hls_segment_rl, &rl_key)?;

    if !segment_name
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '.')
    {
        return Err(AppError::BadRequest("invalid segment name".into()));
    }

    let (stream, size, resolved_name) = open_hls_segment(
        state.storage.as_ref(),
        &row.storage_key,
        &segment_name,
    )
    .await?;

    Ok(crate::hls::handlers::segment_media_response(
        stream,
        size,
        &resolved_name,
    ))
}

// Human: fMP4 init segment (EXT-X-MAP) for anonymous shared video playback.
// Agent: READS {storage_key}/init.mp4; RATE LIMIT by token+file like media segments.
pub async fn public_share_init(
    State(state): State<Arc<AppState>>,
    Path((token, file_id)): Path<(String, String)>,
) -> Result<Response, AppError> {
    let share = resolve_active_share(&state.pool, &token).await?;
    let row = load_file_in_share_scope(&state.pool, &share, &file_id).await?;

    if !row.hls_ready {
        return Err(AppError::NotFound);
    }

    let rl_key = format!("public:{token}:{file_id}");
    rate_limit::enforce(&state.hls_segment_rl, &rl_key)?;

    let key = format!("{}/{}", row.storage_key, crate::hls::playlist::HLS_INIT_FILENAME);
    let (stream, size, _) = state
        .storage
        .get_stream(&key)
        .await
        .map_err(|_| AppError::NotFound)?;

    Ok(crate::hls::handlers::segment_media_response(
        stream,
        size,
        crate::hls::playlist::HLS_INIT_FILENAME,
    ))
}

// Human: Fetch one shared file row for inline preview pages (scoped by token).
// Agent: load_file_in_share_scope + FileDto SELECT; RETURNS minimal file JSON.
pub async fn public_share_file(
    State(state): State<Arc<AppState>>,
    Path((token, file_id)): Path<(String, String)>,
) -> Result<Json<serde_json::Value>, AppError> {
    let share = resolve_active_share(&state.pool, &token).await?;
    load_file_in_share_scope(&state.pool, &share, &file_id).await?;

    let file: Option<FileDto> = sqlx::query_as(&format!(
        "SELECT {FILE_COLUMNS} FROM files WHERE id = $1 AND user_id = $2"
    ))
    .bind(&file_id)
    .bind(&share.user_id)
    .fetch_optional(&state.pool)
    .await?;

    let file = file.ok_or(AppError::NotFound)?;
    Ok(Json(serde_json::json!({ "file": file })))
}
