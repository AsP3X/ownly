// Human: Copy-on-write file content replace for shared editors — keeps ownership (unlike delete+reupload).
// Agent: REQUIRES ContentWrite; DELEGATES to files::versions which archives the prior bytes before switching.

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
        handlers::FileDto,
        versions::{self, ContentWrite, VersionOrigin},
    },
    AppState,
};

#[derive(Debug, Serialize)]
pub struct ReplaceContentResponse {
    pub file: FileDto,
}

// Human: PUT /api/v1/files/{id}/content — replace text/RTF bytes without changing owner or id.
// Agent: ensure_file_access ContentWrite; versions::write_file_content; AUDIT files.content_replace.
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

    let mime_type: Option<(Option<String>,)> =
        sqlx::query_as("SELECT mime_type FROM files WHERE id = $1 AND deleted_at IS NULL")
            .bind(&id)
            .fetch_optional(&state.pool)
            .await?;
    let mime_type = mime_type.ok_or(AppError::NotFound)?.0;
    let content_type = mime_type
        .as_deref()
        .filter(|m| !m.is_empty())
        .unwrap_or("application/octet-stream")
        .to_string();

    let size_bytes = body.len() as i64;
    let result = versions::write_file_content(
        &state,
        ContentWrite {
            file_id: &id,
            bytes: body.to_vec(),
            content_type: &content_type,
            actor_id: Some(&claims.sub),
            origin: VersionOrigin::User,
        },
    )
    .await?;

    // Human: An unchanged autosave is not a content change — do not pad the audit ledger with it.
    if result.archived {
        audit::write_audit_logged(
            &state.pool,
            Some(&claims.sub),
            "files.content_replace",
            Some("file"),
            Some(&id),
            Some(serde_json::json!({
                "size_bytes": size_bytes,
                "revision": result.revision,
            })),
            &headers,
        )
        .await;
    }

    Ok(Json(ReplaceContentResponse { file: result.file }))
}
