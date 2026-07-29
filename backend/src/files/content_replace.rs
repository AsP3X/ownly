// Human: In-place file content replace for shared editors — keeps ownership (unlike delete+reupload).
// Agent: REQUIRES ContentWrite; PUTS storage blob; UPDATES size_bytes; RETURNS FileDto.

use axum::{
    body::Bytes,
    extract::{Path, State},
    http::HeaderMap,
    Extension, Json,
};
use serde::Serialize;
use std::sync::Arc;

use crate::{
    audit,
    auth::handlers::Claims,
    error::AppError,
    files::{
        handlers::{FileDto, FILE_COLUMNS},
        recycle_bin::ACTIVE_FILES_SQL,
    },
    storage::put_with_retry,
    AppState,
};

#[derive(Debug, Serialize)]
pub struct ReplaceContentResponse {
    pub file: FileDto,
}

// Human: PUT /api/v1/files/{id}/content — replace text/RTF bytes without changing owner or id.
// Agent: ensure_file_access ContentWrite; storage.put; UPDATE files.size_bytes; AUDIT files.content_replace.
pub async fn put_file_content(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    body: Bytes,
) -> Result<Json<ReplaceContentResponse>, AppError> {
    crate::files::access::ensure_file_access(
        &state.pool,
        &claims.sub,
        &id,
        crate::authz::Permission::ContentWrite,
    )
    .await?;

    if body.is_empty() {
        return Err(AppError::BadRequest("content body must not be empty".into()));
    }

    let row: Option<(String, Option<String>)> = sqlx::query_as(
        "SELECT storage_key, mime_type FROM files WHERE id = $1 AND deleted_at IS NULL",
    )
    .bind(&id)
    .fetch_optional(&state.pool)
    .await?;

    let (storage_key, mime_type) = row.ok_or(AppError::NotFound)?;
    let content_type = mime_type
        .as_deref()
        .filter(|m| !m.is_empty())
        .unwrap_or("application/octet-stream");
    let size_bytes = body.len() as i64;
    let data = body.to_vec();

    put_with_retry(state.storage.as_ref(), &storage_key, content_type, || {
        let data = data.clone();
        async move { Ok(data) }
    })
    .await
    .map_err(|e| AppError::Internal(anyhow::anyhow!("storage put failed: {e}")))?;

    sqlx::query(
        "UPDATE files SET size_bytes = $2, updated_at = NOW() WHERE id = $1 AND deleted_at IS NULL",
    )
    .bind(&id)
    .bind(size_bytes)
    .execute(&state.pool)
    .await?;

    let file: FileDto = sqlx::query_as(&format!(
        "SELECT {FILE_COLUMNS} FROM files WHERE id = $1 AND {ACTIVE_FILES_SQL}"
    ))
    .bind(&id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or(AppError::NotFound)?;

    audit::write_audit_logged(
        &state.pool,
        Some(&claims.sub),
        "files.content_replace",
        Some("file"),
        Some(&id),
        Some(serde_json::json!({ "size_bytes": size_bytes })),
        &headers,
    )
    .await;

    Ok(Json(ReplaceContentResponse { file }))
}
