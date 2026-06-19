// Human: HTTP handlers for creating/revoking shares and anonymous scoped access.
// Agent: PROTECTED /api/v1/shares* requires Claims; PUBLIC /api/v1/public/shares/{token}* validates token scope.

use axum::{
    body::Body,
    extract::{Path, Query, State},
    http::{header, HeaderMap, Method, StatusCode},
    response::{IntoResponse, Response},
    Extension, Json,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use uuid::Uuid;

use crate::{
    audit,
    auth::handlers::{hash_password, Claims},
    error::AppError,
    files::{
        file_copy::{copy_storage_artifacts, unique_name_in_folder, CopyFileSourceRow},
        folders::{ensure_folder_owned, FolderDto},
        gif_preview::{self, qualifies_for_animated_preview},
        handlers::{FileDto, FILE_COLUMNS},
        processing::ensure_file_not_processing,
        zip_job::{
            dedupe_zip_member_names, run_zip_entries_job, zip_status_json, FolderDownloadJob,
            FolderDownloadRegistry, ZipDownloadStatusResponse, ZipFileEntry,
        },
    },
    hls::handlers::{
        build_playlist_for_playback, encode_query_component, open_hls_segment,
        resolve_hls_aes_key, HlsPlaybackRow,
    },
    rate_limit,
    shares::store::{
        compute_share_tree_stats, ensure_browse_folder_in_share, ensure_file_ids_in_share,
        ensure_file_owned_for_share, ensure_folder_owned_for_share, ensure_share_download_allowed,
        ensure_shared_file_ready, generate_share_token, list_all_files_in_share,
        list_all_folders_in_share, list_share_folder_files, load_file_in_share_scope,
        resolve_active_share, sharer_email,
        verify_share_password, ShareRecord, SHARE_RECORD_COLUMNS,
    },
    stream_ticket,
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

#[derive(Debug, Serialize)]
pub struct ShareDto {
    pub id: String,
    pub token: String,
    pub resource_type: String,
    pub resource_id: String,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub requires_password: bool,
    pub expires_at: Option<chrono::DateTime<chrono::Utc>>,
    pub block_download: bool,
}

#[derive(Debug, Deserialize)]
pub struct UpdateShareRequest {
    pub requires_password: Option<bool>,
    pub password: Option<String>,
    pub expires_at: Option<Option<chrono::DateTime<chrono::Utc>>>,
    pub block_download: Option<bool>,
}

#[derive(Debug, Serialize)]
pub struct UpdateShareResponse {
    pub share: ShareDto,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct UserShareDto {
    pub id: String,
    pub grantee_user_id: String,
    pub grantee_email: String,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Deserialize)]
pub struct CreateUserShareRequest {
    pub resource_type: String,
    pub resource_id: String,
    pub email: String,
    /// Human: Atomic content permission to grant (defaults to content.read).
    /// Agent: VALIDATED against Permission catalog; UPSERTed into permission_grants.
    pub permission: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct CreateUserShareResponse {
    pub user_share: UserShareDto,
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
    pub user_shares: Vec<UserShareDto>,
}

const MAX_SHARE_STATUS_IDS: usize = 500;

// Human: Map a DB share row to the owner-facing API shape without exposing password hashes.
// Agent: DERIVES requires_password from password_hash presence; USED by create/lookup/update handlers.
fn share_dto_from_record(record: ShareRecord) -> ShareDto {
    ShareDto {
        id: record.id,
        token: record.token,
        resource_type: record.resource_type,
        resource_id: record.resource_id,
        created_at: record.created_at,
        requires_password: record.password_hash.is_some(),
        expires_at: record.expires_at,
        block_download: record.block_download,
    }
}

// Human: Read the optional visitor password header sent by the public share page.
// Agent: HEADER x-share-password; RETURNS None when absent.
fn share_password_header(headers: &HeaderMap) -> Option<String> {
    headers
        .get("x-share-password")
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned)
}

// Human: True when verify_share_password failed due to a wrong guess (not a missing header).
// Agent: USED to apply share_password_rl only on brute-force attempts (SEC-009).
fn is_incorrect_share_password(err: &AppError) -> bool {
    matches!(
        err,
        AppError::Forbidden(message) if message == "incorrect share password"
    )
}

// Human: Resolve a token and enforce password protection before serving share content.
// Agent: CALLS resolve_active_share + verify_share_password; RATE-LIMITS wrong guesses (SEC-009).
async fn resolve_public_share(
    state: &AppState,
    token: &str,
    headers: &HeaderMap,
) -> Result<ShareRecord, AppError> {
    let share = resolve_active_share(&state.pool, token).await?;
    if let Err(err) = verify_share_password(&share, share_password_header(headers).as_deref()) {
        if is_incorrect_share_password(&err) {
            let ip = rate_limit::client_ip_from_headers(headers, state.trust_proxy_headers);
            let rl_key = format!("share-pw:{token}:{ip}");
            rate_limit::enforce(&state.share_password_rl, &rl_key)?;
        }
        return Err(err);
    }
    Ok(share)
}

// Human: Load one active public share owned by the authenticated user.
// Agent: READS public_shares by id + user_id; RETURNS NotFound when missing or revoked.
async fn load_owned_share(
    pool: &sqlx::PgPool,
    user_id: &str,
    share_id: &str,
) -> Result<ShareRecord, AppError> {
    let share: Option<ShareRecord> = sqlx::query_as(&format!(
        "SELECT {SHARE_RECORD_COLUMNS} FROM public_shares \
         WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL",
    ))
    .bind(share_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await?;

    share.ok_or(AppError::NotFound)
}

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

    if !file_ids.is_empty() {
        let rows: Vec<(String,)> = sqlx::query_as(
            "SELECT resource_id FROM resource_user_shares \
             WHERE owner_user_id = $1 AND resource_type = 'file' AND resource_id = ANY($2)",
        )
        .bind(&claims.sub)
        .bind(&file_ids)
        .fetch_all(&state.pool)
        .await?;

        for (resource_id,) in rows {
            if let Some(flags) = files.get_mut(&resource_id) {
                flags.users = true;
            }
        }
    }

    if !folder_ids.is_empty() {
        let rows: Vec<(String,)> = sqlx::query_as(
            "SELECT resource_id FROM resource_user_shares \
             WHERE owner_user_id = $1 AND resource_type = 'folder' AND resource_id = ANY($2)",
        )
        .bind(&claims.sub)
        .bind(&folder_ids)
        .fetch_all(&state.pool)
        .await?;

        for (resource_id,) in rows {
            if let Some(flags) = folders.get_mut(&resource_id) {
                flags.users = true;
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

    let public_share: Option<ShareRecord> = sqlx::query_as(&format!(
        "SELECT {SHARE_RECORD_COLUMNS} \
         FROM public_shares \
         WHERE user_id = $1 AND resource_type = $2 AND resource_id = $3 AND revoked_at IS NULL",
    ))
    .bind(&claims.sub)
    .bind(resource_type)
    .bind(resource_id)
    .fetch_optional(&state.pool)
    .await?;

    let user_shares: Vec<UserShareDto> = sqlx::query_as(
        "SELECT rus.id, rus.grantee_user_id, u.email AS grantee_email, rus.created_at \
         FROM resource_user_shares rus \
         INNER JOIN users u ON u.id = rus.grantee_user_id \
         WHERE rus.owner_user_id = $1 AND rus.resource_type = $2 AND rus.resource_id = $3 \
         ORDER BY rus.created_at ASC",
    )
    .bind(&claims.sub)
    .bind(resource_type)
    .bind(resource_id)
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(ResourceSharesResponse {
        public_share: public_share.map(share_dto_from_record),
        user_shares,
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
    pub requires_password: bool,
    pub block_download: bool,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub expires_at: Option<chrono::DateTime<chrono::Utc>>,
    pub shared_by_email: String,
    pub total_file_count: i64,
    pub total_folder_count: i64,
    pub total_bytes: i64,
}

#[derive(Debug, Serialize)]
pub struct PublicShareAllFilesResponse {
    pub files: Vec<FileDto>,
    pub folders: Vec<FolderDto>,
}

#[derive(Debug, Deserialize)]
pub struct PublicShareDownloadArchiveRequest {
    pub file_ids: Option<Vec<String>>,
}

#[derive(Debug, Serialize)]
pub struct PublicShareDownloadArchiveResponse {
    pub job_id: String,
    #[serde(flatten)]
    pub status: ZipDownloadStatusResponse,
    pub single_file_id: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct SaveFromPublicShareRequest {
    pub token: String,
    pub file_ids: Option<Vec<String>>,
    pub folder_id: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct SaveFromPublicShareResponse {
    pub saved_count: usize,
    pub files: Vec<FileDto>,
}

const MAX_PUBLIC_SHARE_ZIP_FILES: usize = 500;
const MAX_PUBLIC_SHARE_SAVE_FILES: usize = 200;

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

    let existing: Option<ShareRecord> = sqlx::query_as(&format!(
        "SELECT {SHARE_RECORD_COLUMNS} \
         FROM public_shares \
         WHERE user_id = $1 AND resource_type = $2 AND resource_id = $3 AND revoked_at IS NULL",
    ))
    .bind(&claims.sub)
    .bind(&resource_type)
    .bind(&body.resource_id)
    .fetch_optional(&state.pool)
    .await?;

    if let Some(share) = existing {
        return Ok(Json(CreateShareResponse {
            share: share_dto_from_record(share),
        }));
    }

    let share_id = Uuid::new_v4().to_string();
    let token = generate_share_token();

    let share: ShareRecord = match sqlx::query_as(&format!(
        "INSERT INTO public_shares (id, token, user_id, resource_type, resource_id) \
         VALUES ($1, $2, $3, $4, $5) \
         ON CONFLICT (user_id, resource_type, resource_id) DO UPDATE \
         SET token = EXCLUDED.token, revoked_at = NULL, created_at = now() \
         RETURNING {SHARE_RECORD_COLUMNS}",
    ))
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
            let share: ShareRecord = sqlx::query_as(&format!(
                "SELECT {SHARE_RECORD_COLUMNS} \
                 FROM public_shares \
                 WHERE user_id = $1 AND resource_type = $2 AND resource_id = $3 AND revoked_at IS NULL",
            ))
            .bind(&claims.sub)
            .bind(&resource_type)
            .bind(&body.resource_id)
            .fetch_one(&state.pool)
            .await?;
            return Ok(Json(CreateShareResponse {
                share: share_dto_from_record(share),
            }));
        }
        Err(error) => return Err(error.into()),
    };

    audit::write_audit_logged(
        &state.pool,
        Some(&claims.sub),
        "shares.create",
        Some(&resource_type),
        Some(&body.resource_id),
        Some(serde_json::json!({ "share_id": share.id })),
        &headers,
    )
    .await;

    Ok(Json(CreateShareResponse {
        share: share_dto_from_record(share),
    }))
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

    let share: Option<ShareRecord> = sqlx::query_as(&format!(
        "SELECT {SHARE_RECORD_COLUMNS} \
         FROM public_shares \
         WHERE user_id = $1 AND resource_type = $2 AND resource_id = $3 AND revoked_at IS NULL",
    ))
    .bind(&claims.sub)
    .bind(resource_type)
    .bind(resource_id)
    .fetch_optional(&state.pool)
    .await?;

    Ok(Json(ShareLookupResponse {
        share: share.map(share_dto_from_record),
    }))
}

// Human: Revoke a public link so the token stops working immediately.
// Agent: SET revoked_at; AUDIT shares.revoke; REQUIRES owner match.
pub async fn revoke_share(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    let mut tx = state.pool.begin().await?;

    let updated = sqlx::query(
        "UPDATE public_shares SET revoked_at = now() \
         WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL",
    )
    .bind(&id)
    .bind(&claims.sub)
    .execute(&mut *tx)
    .await?;

    if updated.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }

    audit::write_audit_required_in_tx(
        &mut tx,
        Some(&claims.sub),
        "shares.revoke",
        Some("share"),
        Some(&id),
        None,
        &headers,
    )
    .await?;

    tx.commit().await?;

    Ok(Json(serde_json::json!({ "ok": true })))
}

// Human: Update protection settings on an active public share link owned by the caller.
// Agent: PATCH password/expiration/download flags; AUDIT shares.update; RETURNS ShareDto.
pub async fn update_share(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<UpdateShareRequest>,
) -> Result<Json<UpdateShareResponse>, AppError> {
    let mut share = load_owned_share(&state.pool, &claims.sub, &id).await?;

    if let Some(requires_password) = body.requires_password {
        if requires_password {
            if let Some(password) = body.password.as_deref().map(str::trim).filter(|value| !value.is_empty()) {
                if password.len() < 4 {
                    return Err(AppError::BadRequest(
                        "share password must be at least 4 characters".into(),
                    ));
                }
                share.password_hash = Some(
                    hash_password(password).map_err(|e| AppError::Internal(anyhow::anyhow!(e)))?,
                );
            } else if share.password_hash.is_none() {
                return Err(AppError::BadRequest(
                    "password is required when enabling password protection".into(),
                ));
            }
        } else {
            share.password_hash = None;
        }
    } else if let Some(password) = body.password.as_deref().map(str::trim) {
        if password.is_empty() {
            share.password_hash = None;
        } else if share.password_hash.is_some() {
            if password.len() < 4 {
                return Err(AppError::BadRequest(
                    "share password must be at least 4 characters".into(),
                ));
            }
            share.password_hash = Some(
                hash_password(password).map_err(|e| AppError::Internal(anyhow::anyhow!(e)))?,
            );
        }
    }

    if let Some(expires_at) = body.expires_at {
        share.expires_at = expires_at;
    }

    if let Some(block_download) = body.block_download {
        share.block_download = block_download;
    }

    sqlx::query(
        "UPDATE public_shares \
         SET password_hash = $1, expires_at = $2, block_download = $3 \
         WHERE id = $4 AND user_id = $5 AND revoked_at IS NULL",
    )
    .bind(&share.password_hash)
    .bind(share.expires_at)
    .bind(share.block_download)
    .bind(&share.id)
    .bind(&claims.sub)
    .execute(&state.pool)
    .await?;

    audit::write_audit_logged(
        &state.pool,
        Some(&claims.sub),
        "shares.update",
        Some("share"),
        Some(&share.id),
        None,
        &headers,
    )
    .await;

    Ok(Json(UpdateShareResponse {
        share: share_dto_from_record(share),
    }))
}

// Human: Invite one enabled instance user to a file or folder by email address.
// Agent: INSERT resource_user_shares; AUDIT shares.user_invite; RETURNS UserShareDto.
pub async fn create_user_share(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    headers: HeaderMap,
    Json(body): Json<CreateUserShareRequest>,
) -> Result<Json<CreateUserShareResponse>, AppError> {
    let resource_type = body.resource_type.trim().to_lowercase();
    if resource_type != "file" && resource_type != "folder" {
        return Err(AppError::BadRequest(
            "resource_type must be \"file\" or \"folder\"".into(),
        ));
    }

    let email = body.email.trim().to_lowercase();
    if email.is_empty() {
        return Err(AppError::BadRequest("email is required".into()));
    }

    if resource_type == "file" {
        ensure_file_owned_for_share(&state.pool, &claims.sub, &body.resource_id).await?;
    } else {
        ensure_folder_owned_for_share(&state.pool, &claims.sub, &body.resource_id).await?;
    }

    let grantee: Option<(String, String, bool)> = sqlx::query_as(
        "SELECT id, email, enabled FROM users WHERE lower(email) = $1",
    )
    .bind(&email)
    .fetch_optional(&state.pool)
    .await?;

    let (grantee_user_id, _grantee_email, enabled) = grantee.ok_or(AppError::NotFound)?;

    if !enabled {
        return Err(AppError::BadRequest(
            "that user account is disabled".into(),
        ));
    }

    if grantee_user_id == claims.sub {
        return Err(AppError::BadRequest(
            "you cannot invite yourself to your own resource".into(),
        ));
    }

    let share_id = Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO resource_user_shares (id, owner_user_id, resource_type, resource_id, grantee_user_id) \
         VALUES ($1, $2, $3, $4, $5)",
    )
    .bind(&share_id)
    .bind(&claims.sub)
    .bind(&resource_type)
    .bind(&body.resource_id)
    .bind(&grantee_user_id)
    .execute(&state.pool)
    .await
    .map_err(|error| match error {
        sqlx::Error::Database(db_err) if db_err.code() == Some("23505".into()) => {
            AppError::Conflict("this user already has access".into())
        }
        other => other.into(),
    })?;

    // Human: Mirror user invite into atomic grant for authz resolver.
    // Agent: UPSERT permission_grants allow row for grantee user subject.
    let permission = body
        .permission
        .as_deref()
        .unwrap_or("content.read");
    crate::authz::grant_content_for_user_share(
        &state.pool,
        &claims.sub,
        &grantee_user_id,
        &resource_type,
        &body.resource_id,
        permission,
    )
    .await?;

    let user_share: UserShareDto = sqlx::query_as(
        "SELECT rus.id, rus.grantee_user_id, u.email AS grantee_email, rus.created_at \
         FROM resource_user_shares rus \
         INNER JOIN users u ON u.id = rus.grantee_user_id \
         WHERE rus.id = $1",
    )
    .bind(&share_id)
    .fetch_one(&state.pool)
    .await?;

    audit::write_audit_logged(
        &state.pool,
        Some(&claims.sub),
        "shares.user_invite",
        Some(&resource_type),
        Some(&body.resource_id),
        Some(serde_json::json!({ "grantee_user_id": grantee_user_id })),
        &headers,
    )
    .await;

    Ok(Json(CreateUserShareResponse { user_share }))
}

// Human: Remove one invited user from a shared file or folder.
// Agent: DELETE resource_user_shares row owned by caller; AUDIT shares.user_revoke.
pub async fn revoke_user_share(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    let mut tx = state.pool.begin().await?;

    let deleted: Option<(String, String, String)> = sqlx::query_as(
        "DELETE FROM resource_user_shares \
         WHERE id = $1 AND owner_user_id = $2 \
         RETURNING resource_type, resource_id, grantee_user_id",
    )
    .bind(&id)
    .bind(&claims.sub)
    .fetch_optional(&mut *tx)
    .await?;

    let Some((resource_type, resource_id, grantee_user_id)) = deleted else {
        return Err(AppError::NotFound);
    };

    audit::write_audit_required_in_tx(
        &mut tx,
        Some(&claims.sub),
        "shares.user_revoke",
        Some(&resource_type),
        Some(&resource_id),
        Some(serde_json::json!({ "user_share_id": id })),
        &headers,
    )
    .await?;

    tx.commit().await?;

    crate::authz::revoke_content_read_for_user_share(
        &state.pool,
        &grantee_user_id,
        &resource_type,
        &resource_id,
    )
    .await
    .ok();

    Ok(Json(serde_json::json!({ "ok": true })))
}

// Human: Build zip member rows for anonymous share archive jobs.
// Agent: READS owner files table after ensure_file_ids_in_share; DEDUPES display names.
async fn collect_zip_entries_for_share(
    pool: &sqlx::PgPool,
    share: &ShareRecord,
    file_ids: &[String],
) -> Result<Vec<ZipFileEntry>, AppError> {
    ensure_file_ids_in_share(pool, share, file_ids).await?;

    let mut entries = Vec::with_capacity(file_ids.len());
    for file_id in file_ids {
        let row: Option<(
            String,
            String,
            String,
            Option<String>,
            bool,
            bool,
            Option<i32>,
        )> = sqlx::query_as(
            "SELECT id, name, storage_key, mime_type, hls_ready, download_export_ready, segment_count \
             FROM files WHERE id = $1 AND user_id = $2",
        )
        .bind(file_id)
        .bind(&share.user_id)
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
        ) = row.ok_or(AppError::NotFound)?;

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

// Human: Copy one shared file into the signed-in visitor's library with new storage blobs.
// Agent: READS owner file row; WRITES grantee files row; AUDIT shares.save_from_public per file.
async fn copy_share_file_into_library(
    state: &Arc<AppState>,
    share: &ShareRecord,
    file_id: &str,
    grantee_id: &str,
    target_folder_id: &Option<String>,
    headers: &HeaderMap,
) -> Result<FileDto, AppError> {
    load_file_in_share_scope(&state.pool, share, file_id).await?;

    let source: Option<CopyFileSourceRow> = sqlx::query_as(
        "SELECT storage_key, segment_count, name, mime_type, size_bytes, hls_ready, \
         hls_encode_status, hls_encode_error, conversion_progress, duration_seconds, \
         video_width, video_height, \
         audio_waveform_ready, audio_encode_status, audio_waveform_key \
         FROM files WHERE id = $1 AND user_id = $2",
    )
    .bind(file_id)
    .bind(&share.user_id)
    .fetch_optional(&state.pool)
    .await?;

    let source = source.ok_or(AppError::NotFound)?;
    ensure_file_not_processing(
        &source.mime_type,
        source.hls_ready,
        &source.hls_encode_status,
        source.audio_waveform_ready,
        &source.audio_encode_status,
    )?;

    let target_folder = target_folder_id
        .as_ref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .map(str::to_string);

    if let Some(ref folder_id) = target_folder {
        ensure_folder_owned(&state.pool, grantee_id, folder_id).await?;
    }

    let new_file_id = Uuid::new_v4().to_string();
    let new_storage_key = format!("users/{grantee_id}/files/{new_file_id}");
    let copy_name =
        unique_name_in_folder(&state.pool, grantee_id, &target_folder, &source.name).await?;

    copy_storage_artifacts(
        state,
        &source.storage_key,
        &new_storage_key,
        source.segment_count,
    )
    .await?;

    let new_waveform_key = source
        .audio_waveform_key
        .as_ref()
        .map(|_| crate::audio::waveform_storage_key(&new_storage_key));

    let file: FileDto = sqlx::query_as(&format!(
        "INSERT INTO files (id, user_id, folder_id, name, storage_key, mime_type, size_bytes, \
         duration_seconds, video_width, video_height, hls_ready, hls_encode_status, hls_encode_error, \
         conversion_progress, segment_count, audio_waveform_ready, audio_encode_status, audio_waveform_key) \
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18) \
         RETURNING {FILE_COLUMNS}"
    ))
    .bind(&new_file_id)
    .bind(grantee_id)
    .bind(&target_folder)
    .bind(&copy_name)
    .bind(&new_storage_key)
    .bind(&source.mime_type)
    .bind(source.size_bytes)
    .bind(source.duration_seconds)
    .bind(source.video_width)
    .bind(source.video_height)
    .bind(source.hls_ready)
    .bind(&source.hls_encode_status)
    .bind(&source.hls_encode_error)
    .bind(source.conversion_progress)
    .bind(source.segment_count)
    .bind(source.audio_waveform_ready)
    .bind(&source.audio_encode_status)
    .bind(&new_waveform_key)
    .fetch_one(&state.pool)
    .await?;

    audit::write_audit_logged(
        &state.pool,
        Some(grantee_id),
        "shares.save_from_public",
        Some("file"),
        Some(&new_file_id),
        Some(serde_json::json!({
            "share_token": share.token,
            "source_file_id": file_id,
            "name": copy_name,
        })),
        headers,
    )
    .await;

    Ok(file)
}

fn public_archive_status_json(
    job_id: &str,
    job: &FolderDownloadJob,
) -> PublicShareDownloadArchiveResponse {
    PublicShareDownloadArchiveResponse {
        job_id: job_id.to_string(),
        status: zip_status_json(job),
        single_file_id: None,
    }
}

// Human: Build the public overview payload for a share token (no auth).
// Agent: READS share + resource metadata + tree stats + sharer email; NO owner user_id in response.
async fn public_overview_for_share(
    pool: &sqlx::PgPool,
    share: &ShareRecord,
) -> Result<PublicShareOverview, AppError> {
    let email = sharer_email(pool, &share.user_id).await?;
    let stats = compute_share_tree_stats(pool, share).await?;

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
            requires_password: share.password_hash.is_some(),
            block_download: share.block_download,
            created_at: share.created_at,
            expires_at: share.expires_at,
            shared_by_email: email,
            total_file_count: stats.file_count,
            total_folder_count: stats.folder_count,
            total_bytes: stats.total_bytes,
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
        requires_password: share.password_hash.is_some(),
        block_download: share.block_download,
        created_at: share.created_at,
        expires_at: share.expires_at,
        shared_by_email: email,
        total_file_count: stats.file_count,
        total_folder_count: stats.folder_count,
        total_bytes: stats.total_bytes,
    })
}

// Human: Anonymous metadata probe for a public share link.
// Agent: resolve_public_share enforces x-share-password (SEC-007); RETURNS resource metadata.
pub async fn public_share_overview(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(token): Path<String>,
) -> Result<Json<PublicShareOverviewResponse>, AppError> {
    let share = resolve_public_share(state.as_ref(), &token, &headers).await?;
    let overview = public_overview_for_share(&state.pool, &share).await?;
    Ok(Json(PublicShareOverviewResponse { share: overview }))
}

// Human: List files and subfolders visible inside a folder-type public share.
// Agent: SCOPES queries to share.user_id + validated folder_id (defaults to shared root).
pub async fn public_share_contents(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(token): Path<String>,
    Query(query): Query<PublicContentsQuery>,
) -> Result<Json<serde_json::Value>, AppError> {
    let share = resolve_public_share(state.as_ref(), &token, &headers).await?;
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
         WHERE user_id = $1 AND parent_id = $2 AND deleted_at IS NULL \
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
    headers: HeaderMap,
    Path((token, file_id)): Path<(String, String)>,
) -> Result<Response, AppError> {
    let share = resolve_public_share(state.as_ref(), &token, &headers).await?;
    ensure_share_download_allowed(&share)?;
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

// Human: Return a ticket URL for server-transcoded animated preview MP4 inside a public share.
// Agent: resolve_public_share; GIF/WebP mime only; EMITS share-scoped preview-animation href.
pub async fn public_share_preview_animation_url(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path((token, file_id)): Path<(String, String)>,
) -> Result<Json<gif_preview::PreviewAnimationUrlResponse>, AppError> {
    let share = resolve_public_share(state.as_ref(), &token, &headers).await?;
    load_file_in_share_scope(&state.pool, &share, &file_id).await?;

    let row: Option<(String, String, i64)> = sqlx::query_as(
        "SELECT storage_key, mime_type, size_bytes FROM files WHERE id = $1 AND user_id = $2",
    )
    .bind(&file_id)
    .bind(&share.user_id)
    .fetch_optional(&state.pool)
    .await?;

    let (storage_key, mime_type, size_bytes) = row.ok_or(AppError::NotFound)?;
    if !qualifies_for_animated_preview(&mime_type) {
        return Err(AppError::BadRequest(
            "animated preview is only available for GIF and animated WebP images".into(),
        ));
    }

    let source_size_bytes = size_bytes.max(0) as u64;
    let ready =
        gif_preview::preview_sidecar_is_ready(&state.storage, &storage_key, source_size_bytes)
            .await?;

    let ticket = stream_ticket::generate_ticket(
        &file_id,
        &share.user_id,
        &state.signing_secret,
        state.url_expiry_seconds,
    );
    let encoded = encode_query_component(&ticket);
    Ok(Json(gif_preview::PreviewAnimationUrlResponse {
        url: format!(
            "/api/v1/public/shares/{token}/files/{file_id}/preview-animation?ticket={encoded}"
        ),
        expires_in_seconds: state.url_expiry_seconds,
        ready,
    }))
}

// Human: Ticket-gated MP4 animated preview stream for shared GIF/WebP files (iOS WebKit).
// Agent: validate_ticket; CALLS gif_preview::open_gif_preview_stream; SUPPORTS HEAD probe.
pub async fn public_share_preview_animation(
    method: Method,
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path((token, file_id)): Path<(String, String)>,
    Query(params): Query<crate::hls::handlers::TicketParams>,
) -> Result<Response, AppError> {
    let share = resolve_public_share(state.as_ref(), &token, &headers).await?;
    load_file_in_share_scope(&state.pool, &share, &file_id).await?;

    let ticket = params.ticket.ok_or(AppError::Unauthorized)?;
    stream_ticket::validate_ticket(&ticket, &file_id, &state.signing_secret)?;

    let row: Option<(String, String, i64)> = sqlx::query_as(
        "SELECT storage_key, mime_type, size_bytes FROM files WHERE id = $1 AND user_id = $2",
    )
    .bind(&file_id)
    .bind(&share.user_id)
    .fetch_optional(&state.pool)
    .await?;

    let (storage_key, mime_type, size_bytes) = row.ok_or(AppError::NotFound)?;
    if !qualifies_for_animated_preview(&mime_type) {
        return Err(AppError::NotFound);
    }

    let source_size_bytes = size_bytes.max(0) as u64;
    let storage = state.storage.clone();

    // Human: HEAD must not transcode — only report cached sidecar metadata when already ready.
    // Agent: READS preview_sidecar_is_ready; RETURNS 404 on miss; SKIPS open_gif_preview_stream/ffmpeg.
    if method == Method::HEAD {
        if !gif_preview::preview_sidecar_is_ready(&storage, &storage_key, source_size_bytes).await?
        {
            return Err(AppError::NotFound);
        }
        let preview_key = gif_preview::gif_preview_object_key(&storage_key);
        let (_, mp4_size, _) = storage
            .get_stream(&preview_key)
            .await
            .map_err(|e| AppError::Storage(e.to_string()))?;
        let response_headers = gif_preview::preview_mp4_headers_for_size(mp4_size)?;
        return Ok((StatusCode::OK, response_headers).into_response());
    }

    let (stream, mp4_size) =
        gif_preview::open_gif_preview_stream(&state, &storage_key, source_size_bytes).await?;
    let response_headers = gif_preview::preview_mp4_headers_for_size(mp4_size)?;

    Ok((response_headers, Body::from_stream(stream)).into_response())
}

// Human: Return HLS playlist URL for a video inside a public share (when ready).
// Agent: PUBLIC path prefix includes share token so segments stay scoped.
pub async fn public_share_stream_url(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path((token, file_id)): Path<(String, String)>,
) -> Result<Json<serde_json::Value>, AppError> {
    let share = resolve_public_share(state.as_ref(), &token, &headers).await?;
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

// Human: Return stored waveform peaks for audio inside a public share.
// Agent: PUBLIC scoped path; READS audio_waveform_key sidecar from Nebular; RETURNS JSON artifact.
pub async fn public_share_waveform(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path((token, file_id)): Path<(String, String)>,
) -> Result<Json<crate::audio::waveform::AudioWaveformArtifact>, AppError> {
    use futures_util::StreamExt;

    let share = resolve_public_share(state.as_ref(), &token, &headers).await?;
    let scoped = load_file_in_share_scope(&state.pool, &share, &file_id).await?;
    ensure_shared_file_ready(&scoped)?;

    if !scoped
        .mime_type
        .as_deref()
        .is_some_and(|m| m.starts_with("audio/"))
    {
        return Err(AppError::BadRequest("file is not an audio track".into()));
    }

    if !scoped.audio_waveform_ready {
        return Err(AppError::Conflict("waveform is not ready yet".into()));
    }

    let row: Option<(Option<String>,)> = sqlx::query_as(
        "SELECT audio_waveform_key FROM files WHERE id = $1 AND user_id = $2",
    )
    .bind(&file_id)
    .bind(&share.user_id)
    .fetch_optional(&state.pool)
    .await?;

    let key = row
        .and_then(|(waveform_key,)| waveform_key)
        .ok_or(AppError::NotFound)?;

    let (mut stream, _, _) = state
        .storage
        .get_stream(&key)
        .await
        .map_err(|e| AppError::Storage(e.to_string()))?;

    let mut data = Vec::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| AppError::Storage(e.to_string()))?;
        data.extend_from_slice(&chunk);
    }

    let artifact: crate::audio::waveform::AudioWaveformArtifact = serde_json::from_slice(&data)
        .map_err(|e| AppError::Internal(anyhow::anyhow!("invalid waveform sidecar: {e}")))?;

    Ok(Json(artifact))
}

// Human: Serve an AES key for HLS playback on a shared video file.
// Agent: load_file_in_share_scope; READS hls_key_store by file id.
pub async fn public_share_key(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path((token, file_id)): Path<(String, String)>,
) -> Result<Response, AppError> {
    let share = resolve_public_share(state.as_ref(), &token, &headers).await?;
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
    headers: HeaderMap,
    Path((token, file_id)): Path<(String, String)>,
) -> Result<Response, AppError> {
    let share = resolve_public_share(state.as_ref(), &token, &headers).await?;
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
    headers: HeaderMap,
    Path((token, file_id, segment_name)): Path<(String, String, String)>,
) -> Result<Response, AppError> {
    let share = resolve_public_share(state.as_ref(), &token, &headers).await?;
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
    headers: HeaderMap,
    Path((token, file_id)): Path<(String, String)>,
) -> Result<Response, AppError> {
    let share = resolve_public_share(state.as_ref(), &token, &headers).await?;
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
    headers: HeaderMap,
    Path((token, file_id)): Path<(String, String)>,
) -> Result<Json<serde_json::Value>, AppError> {
    let share = resolve_public_share(state.as_ref(), &token, &headers).await?;
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

// Human: Flat file list for the entire share tree (folder shares) or one row (file shares).
// Agent: list_all_files_in_share; USED for search, download-all, and save-to-library selection.
pub async fn public_share_all_files(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(token): Path<String>,
) -> Result<Json<PublicShareAllFilesResponse>, AppError> {
    let share = resolve_public_share(state.as_ref(), &token, &headers).await?;
    let files = list_all_files_in_share(&state.pool, &share).await?;
    let folders = list_all_folders_in_share(&state.pool, &share).await?;
    Ok(Json(PublicShareAllFilesResponse { files, folders }))
}

// Human: Start a zip archive for some or all files in a public share.
// Agent: POST body file_ids; SPAWNS zip job keyed by token; RETURNS single_file_id when only one file.
pub async fn public_share_download_archive(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(token): Path<String>,
    Json(body): Json<PublicShareDownloadArchiveRequest>,
) -> Result<Json<PublicShareDownloadArchiveResponse>, AppError> {
    let share = resolve_public_share(state.as_ref(), &token, &headers).await?;
    ensure_share_download_allowed(&share)?;

    let mut file_ids: Vec<String> = body
        .file_ids
        .unwrap_or_default()
        .into_iter()
        .map(|id| id.trim().to_string())
        .filter(|id| !id.is_empty())
        .collect();

    if file_ids.is_empty() {
        let files = list_all_files_in_share(&state.pool, &share).await?;
        file_ids = files.into_iter().map(|f| f.id).collect();
    }

    if file_ids.is_empty() {
        return Err(AppError::BadRequest("no files available to download".into()));
    }

    if file_ids.len() == 1 {
        return Ok(Json(PublicShareDownloadArchiveResponse {
            job_id: String::new(),
            status: zip_status_json(&FolderDownloadJob {
                status: "ready".into(),
                progress: 100,
                ready: true,
                error: None,
                archive_name: String::new(),
                size_bytes: None,
                archive_path: None,
                cancelled: false,
            }),
            single_file_id: Some(file_ids[0].clone()),
        }));
    }

    if file_ids.len() > MAX_PUBLIC_SHARE_ZIP_FILES {
        return Err(AppError::BadRequest(format!(
            "cannot download more than {MAX_PUBLIC_SHARE_ZIP_FILES} files at once"
        )));
    }

    let entries = collect_zip_entries_for_share(&state.pool, &share, &file_ids).await?;
    let job_id = Uuid::new_v4().to_string();
    let key = FolderDownloadRegistry::public_share_job_key(&token, &job_id);
    let archive_name = format!("{}-shared.zip", share.resource_id);
    let job = FolderDownloadJob {
        status: "queued".to_string(),
        progress: 0,
        ready: false,
        error: None,
        archive_name: archive_name.clone(),
        size_bytes: None,
        archive_path: None,
        cancelled: false,
    };
    state.folder_download_jobs.set(key.clone(), job.clone()).await;

    let work_dir = std::env::temp_dir().join(format!("mv_public_share_zip_{job_id}"));
    let state_spawn = state.clone();
    tokio::spawn(async move {
        run_zip_entries_job(
            state_spawn,
            key,
            work_dir,
            archive_name,
            entries,
            &format!("public-share:{token}"),
            None,
        )
        .await;
    });

    Ok(Json(public_archive_status_json(&job_id, &job)))
}

// Human: Poll anonymous zip job progress for a public share download.
// Agent: READS folder_download_jobs public-share:{token}:{job_id} key.
pub async fn public_share_download_archive_status(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path((token, job_id)): Path<(String, String)>,
) -> Result<Json<PublicShareDownloadArchiveResponse>, AppError> {
    let _share = resolve_public_share(state.as_ref(), &token, &headers).await?;
    let key = FolderDownloadRegistry::public_share_job_key(&token, &job_id);
    let job = state
        .folder_download_jobs
        .get(&key)
        .await
        .ok_or(AppError::NotFound)?;
    Ok(Json(public_archive_status_json(&job_id, &job)))
}

// Human: Stream a finished public-share zip archive to the visitor.
// Agent: GET archive bytes; REMOVES registry entry and temp dir after read starts.
pub async fn public_share_download_archive_stream(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path((token, job_id)): Path<(String, String)>,
) -> Result<Response, AppError> {
    let share = resolve_public_share(state.as_ref(), &token, &headers).await?;
    ensure_share_download_allowed(&share)?;

    let key = FolderDownloadRegistry::public_share_job_key(&token, &job_id);
    let job = state
        .folder_download_jobs
        .get(&key)
        .await
        .ok_or(AppError::NotFound)?;

    if !job.ready {
        return Err(AppError::Conflict(
            "archive is not ready — poll download status and retry".into(),
        ));
    }

    let archive_path = job
        .archive_path
        .clone()
        .ok_or(AppError::Internal(anyhow::anyhow!("missing archive path")))?;
    let archive_name = job.archive_name.clone();
    let work_dir = archive_path
        .parent()
        .map(std::path::Path::to_path_buf)
        .unwrap_or_else(std::env::temp_dir);

    let bytes = tokio::fs::read(&archive_path)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("read public share archive: {e}")))?;

    state.folder_download_jobs.remove(&key).await;
    let _ = tokio::fs::remove_dir_all(&work_dir).await;

    let disposition = format!(
        "attachment; filename=\"{}\"",
        archive_name.replace('"', "")
    );

    Ok((
        [
            (header::CONTENT_TYPE, "application/zip".to_string()),
            (header::CONTENT_DISPOSITION, disposition),
        ],
        Body::from(bytes),
    )
        .into_response())
}

// Human: Copy shared files into the signed-in visitor's drive (save to My Ownly).
// Agent: POST /shares/save-from-public; REQUIRES JWT + optional X-Share-Password; AUDIT per file.
pub async fn save_from_public_share(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    headers: HeaderMap,
    Json(body): Json<SaveFromPublicShareRequest>,
) -> Result<Json<SaveFromPublicShareResponse>, AppError> {
    let token = body.token.trim();
    if token.is_empty() {
        return Err(AppError::BadRequest("token is required".into()));
    }

    let share = resolve_public_share(state.as_ref(), token, &headers).await?;
    ensure_share_download_allowed(&share)?;

    let mut file_ids: Vec<String> = body
        .file_ids
        .unwrap_or_default()
        .into_iter()
        .map(|id| id.trim().to_string())
        .filter(|id| !id.is_empty())
        .collect();

    if file_ids.is_empty() {
        let files = list_all_files_in_share(&state.pool, &share).await?;
        file_ids = files.into_iter().map(|f| f.id).collect();
    }

    if file_ids.is_empty() {
        return Err(AppError::BadRequest("no files available to save".into()));
    }

    if file_ids.len() > MAX_PUBLIC_SHARE_SAVE_FILES {
        return Err(AppError::BadRequest(format!(
            "cannot save more than {MAX_PUBLIC_SHARE_SAVE_FILES} files at once"
        )));
    }

    ensure_file_ids_in_share(&state.pool, &share, &file_ids).await?;

    let total_bytes: i64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(size_bytes), 0)::BIGINT FROM files \
         WHERE id = ANY($1) AND deleted_at IS NULL",
    )
    .bind(&file_ids)
    .fetch_one(&state.pool)
    .await?;
    crate::quota::ensure_within_quota(&state.pool, &claims.sub, total_bytes).await?;

    let target_folder = body
        .folder_id
        .as_ref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .map(str::to_string);

    let mut saved = Vec::with_capacity(file_ids.len());
    for file_id in file_ids {
        let file = copy_share_file_into_library(
            &state,
            &share,
            &file_id,
            &claims.sub,
            &target_folder,
            &headers,
        )
        .await?;
        saved.push(file);
    }

    Ok(Json(SaveFromPublicShareResponse {
        saved_count: saved.len(),
        files: saved,
    }))
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct SharedWithMeItemDto {
    pub id: String,
    pub resource_type: String,
    pub resource_id: String,
    pub name: String,
    pub mime_type: Option<String>,
    pub size_bytes: Option<i64>,
    pub shared_at: chrono::DateTime<chrono::Utc>,
    pub owner_email: String,
    pub permission: String,
}

#[derive(Debug, Serialize)]
pub struct SharedWithMeResponse {
    pub items: Vec<SharedWithMeItemDto>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
struct SharedByMeResourceRow {
    resource_type: String,
    resource_id: String,
    first_shared_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Serialize)]
pub struct SharedByMeGranteeDto {
    pub id: String,
    pub email: String,
}

#[derive(Debug, Serialize)]
pub struct SharedByMeItemDto {
    pub resource_type: String,
    pub resource_id: String,
    pub name: String,
    pub mime_type: Option<String>,
    pub size_bytes: i64,
    pub shared_at: chrono::DateTime<chrono::Utc>,
    pub public_share: Option<ShareDto>,
    pub grantees: Vec<SharedByMeGranteeDto>,
    pub view_count: i64,
}

#[derive(Debug, Serialize)]
pub struct SharedByMeMetricsDto {
    pub active_links: i64,
    pub collaborators: i64,
    pub total_views: i64,
}

#[derive(Debug, Serialize)]
pub struct SharedByMeResponse {
    pub metrics: SharedByMeMetricsDto,
    pub items: Vec<SharedByMeItemDto>,
}

// Human: List files and folders another user invited the signed-in account to access.
// Agent: GET /shares/with-me; READS resource_user_shares for grantee; SKIPS deleted resources.
pub async fn list_shared_with_me(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<SharedWithMeResponse>, AppError> {
    let items: Vec<SharedWithMeItemDto> = sqlx::query_as(
        "SELECT rus.id, rus.resource_type, rus.resource_id, rus.created_at AS shared_at, \
         owner.email AS owner_email, \
         COALESCE(f.name, fo.name) AS name, f.mime_type, f.size_bytes, \
         'view' AS permission \
         FROM resource_user_shares rus \
         INNER JOIN users owner ON owner.id = rus.owner_user_id \
         LEFT JOIN files f ON rus.resource_type = 'file' AND f.id = rus.resource_id AND f.deleted_at IS NULL \
         LEFT JOIN folders fo ON rus.resource_type = 'folder' AND fo.id = rus.resource_id AND fo.deleted_at IS NULL \
         WHERE rus.grantee_user_id = $1 AND (f.id IS NOT NULL OR fo.id IS NOT NULL) \
         ORDER BY rus.created_at DESC",
    )
    .bind(&claims.sub)
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(SharedWithMeResponse { items }))
}

// Human: Aggregate every resource the caller has shared via public links or user invites.
// Agent: GET /shares/by-me; MERGES public_shares + resource_user_shares per resource id.
pub async fn list_shared_by_me(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<SharedByMeResponse>, AppError> {
    let active_links: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM public_shares WHERE user_id = $1 AND revoked_at IS NULL",
    )
    .bind(&claims.sub)
    .fetch_one(&state.pool)
    .await?;

    let collaborators: i64 = sqlx::query_scalar(
        "SELECT COUNT(DISTINCT grantee_user_id) FROM resource_user_shares WHERE owner_user_id = $1",
    )
    .bind(&claims.sub)
    .fetch_one(&state.pool)
    .await?;

    let resources: Vec<SharedByMeResourceRow> = sqlx::query_as(
        "SELECT resource_type, resource_id, MIN(shared_at) AS first_shared_at \
         FROM ( \
           SELECT resource_type, resource_id, created_at AS shared_at \
           FROM public_shares WHERE user_id = $1 AND revoked_at IS NULL \
           UNION ALL \
           SELECT resource_type, resource_id, created_at AS shared_at \
           FROM resource_user_shares WHERE owner_user_id = $1 \
         ) shared \
         GROUP BY resource_type, resource_id \
         ORDER BY first_shared_at DESC",
    )
    .bind(&claims.sub)
    .fetch_all(&state.pool)
    .await?;

    let mut items = Vec::with_capacity(resources.len());
    for resource in resources {
        let (name, mime_type, size_bytes) = if resource.resource_type == "file" {
            type FileMeta = (String, Option<String>, i64);
            let row: Option<FileMeta> = sqlx::query_as(
                "SELECT name, mime_type, size_bytes FROM files \
                 WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL",
            )
            .bind(&resource.resource_id)
            .bind(&claims.sub)
            .fetch_optional(&state.pool)
            .await?;
            row.unwrap_or((resource.resource_id.clone(), None, 0))
        } else {
            type FolderMeta = (String,);
            let row: Option<FolderMeta> = sqlx::query_as(
                "SELECT name FROM folders \
                 WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL",
            )
            .bind(&resource.resource_id)
            .bind(&claims.sub)
            .fetch_optional(&state.pool)
            .await?;
            row.map(|(name,)| (name, None, 0))
                .unwrap_or((resource.resource_id.clone(), None, 0))
        };

        let public_share: Option<ShareRecord> = sqlx::query_as(&format!(
            "SELECT {SHARE_RECORD_COLUMNS} \
             FROM public_shares \
             WHERE user_id = $1 AND resource_type = $2 AND resource_id = $3 AND revoked_at IS NULL",
        ))
        .bind(&claims.sub)
        .bind(&resource.resource_type)
        .bind(&resource.resource_id)
        .fetch_optional(&state.pool)
        .await?;

        let grantee_rows: Vec<(String, String)> = sqlx::query_as(
            "SELECT rus.id, u.email \
             FROM resource_user_shares rus \
             INNER JOIN users u ON u.id = rus.grantee_user_id \
             WHERE rus.owner_user_id = $1 AND rus.resource_type = $2 AND rus.resource_id = $3 \
             ORDER BY rus.created_at ASC",
        )
        .bind(&claims.sub)
        .bind(&resource.resource_type)
        .bind(&resource.resource_id)
        .fetch_all(&state.pool)
        .await?;

        items.push(SharedByMeItemDto {
            resource_type: resource.resource_type,
            resource_id: resource.resource_id,
            name,
            mime_type,
            size_bytes,
            shared_at: resource.first_shared_at,
            public_share: public_share.map(share_dto_from_record),
            grantees: grantee_rows
                .into_iter()
                .map(|(id, email)| SharedByMeGranteeDto { id, email })
                .collect(),
            view_count: 0,
        });
    }

    Ok(Json(SharedByMeResponse {
        metrics: SharedByMeMetricsDto {
            active_links,
            collaborators,
            total_views: 0,
        },
        items,
    }))
}

// Human: Grantee removes their own access to a file or folder shared with them.
// Agent: DELETE /shares/with-me/:id; AUDIT shares.leave; REQUIRES matching grantee_user_id.
pub async fn leave_shared_with_me(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    let result = sqlx::query_as::<_, (String, String)>(
        "DELETE FROM resource_user_shares WHERE id = $1 AND grantee_user_id = $2 \
         RETURNING resource_type, resource_id",
    )
    .bind(&id)
    .bind(&claims.sub)
    .fetch_optional(&state.pool)
    .await?;

    let Some((resource_type, resource_id)) = result else {
        return Err(AppError::NotFound);
    };

    crate::authz::revoke_content_read_for_user_share(
        &state.pool,
        &claims.sub,
        &resource_type,
        &resource_id,
    )
    .await
    .ok();

    audit::write_audit_logged(
        &state.pool,
        Some(&claims.sub),
        "shares.leave",
        Some("user_share"),
        Some(&id),
        None,
        &headers,
    )
    .await;

    Ok(Json(serde_json::json!({ "ok": true })))
}

#[derive(Debug, sqlx::FromRow)]
struct GrantedDownloadRow {
    storage_key: String,
    name: String,
    mime_type: Option<String>,
    hls_ready: bool,
    download_export_ready: bool,
}

// Human: Download one file that was shared with the signed-in user via user invite.
// Agent: GET /shares/granted/files/:id/download; VERIFIES resource_user_shares grantee row.
pub async fn download_granted_file(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(file_id): Path<String>,
) -> Result<Response, AppError> {
    let row: Option<GrantedDownloadRow> = sqlx::query_as(
        "SELECT f.storage_key, f.name, f.mime_type, f.hls_ready, f.download_export_ready \
         FROM files f \
         INNER JOIN resource_user_shares rus \
           ON rus.resource_type = 'file' AND rus.resource_id = f.id \
         WHERE f.id = $1 AND f.deleted_at IS NULL AND rus.grantee_user_id = $2",
    )
    .bind(&file_id)
    .bind(&claims.sub)
    .fetch_optional(&state.pool)
    .await?;

    let row = row.ok_or(AppError::NotFound)?;

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
