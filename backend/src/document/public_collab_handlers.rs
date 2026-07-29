// Human: Anonymous document collab over public share links with allow_edit.
// Agent: GATES resolve_public_share + allow_edit + file scope; USES guest_id participant keys.

use std::sync::Arc;

use axum::{
    extract::{Path, Query, State},
    http::HeaderMap,
    Json,
};
use serde::Deserialize;
use serde_json::json;
use uuid::Uuid;

use crate::{
    document::collab::AppendOpError,
    document::collab_handlers::{
        normalize_session_locks, session_view, HeartbeatRequest, SessionView,
    },
    error::AppError,
    shares::store::{
        ensure_share_edit_allowed, load_file_in_share_scope, ShareRecord,
    },
    AppState,
};

#[derive(Debug, Deserialize)]
pub struct PublicJoinSessionRequest {
    pub file_id: String,
    /// Human: Stable browser guest identity (UUID) so presence survives reconnects.
    pub guest_id: String,
    pub display_name: Option<String>,
    pub initial_html: Option<String>,
    pub initial_text: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct PublicGuestBody {
    pub guest_id: String,
}

#[derive(Debug, Deserialize)]
pub struct PublicHeartbeatRequest {
    pub guest_id: String,
    pub selection_start: Option<u32>,
    pub selection_end: Option<u32>,
    pub lock_start: Option<u32>,
    pub lock_end: Option<u32>,
    pub clear_lock: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct PublicPostOpRequest {
    pub guest_id: String,
    pub op_type: String,
    pub payload: serde_json::Value,
}

#[derive(Debug, Deserialize)]
pub struct PublicListOpsQuery {
    pub after_seq: u64,
    pub guest_id: String,
}

// Human: Validate a guest participant id from the public collab client.
// Agent: REQUIRES UUID v4-ish 8-64 chars of hex/dashes; PREFIXES with "guest:" for store keys.
fn normalize_guest_id(raw: &str) -> Result<String, AppError> {
    let trimmed = raw.trim();
    if trimmed.is_empty() || trimmed.len() > 64 {
        return Err(AppError::BadRequest("guest_id is required".into()));
    }
    // Accept plain UUID or already-prefixed guest ids from older clients.
    let bare = trimmed.strip_prefix("guest:").unwrap_or(trimmed);
    if Uuid::parse_str(bare).is_err() {
        // Allow non-UUID stable ids that are still URL-safe (sessionStorage fallbacks).
        if bare.len() < 8
            || !bare
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
        {
            return Err(AppError::BadRequest("guest_id is invalid".into()));
        }
    }
    Ok(format!("guest:{bare}"))
}

fn guest_display_name(raw: Option<&str>, guest_key: &str) -> String {
    if let Some(name) = raw.map(str::trim).filter(|s| !s.is_empty()) {
        return name.chars().take(64).collect();
    }
    let short = guest_key
        .strip_prefix("guest:")
        .unwrap_or(guest_key)
        .chars()
        .take(8)
        .collect::<String>();
    format!("Guest {short}")
}

// Human: Resolve share + require edit + ensure the collab file is inside this link.
// Agent: CALLS resolve_public_share; ensure_share_edit_allowed; load_file_in_share_scope.
async fn resolve_editable_share_file(
    state: &AppState,
    token: &str,
    headers: &HeaderMap,
    file_id: &str,
) -> Result<ShareRecord, AppError> {
    let share = crate::shares::handlers::resolve_public_share(state, token, headers).await?;
    ensure_share_edit_allowed(&share)?;
    load_file_in_share_scope(&state.pool, &share, file_id).await?;
    Ok(share)
}

// Human: Resolve share for an existing collab session and confirm file still in scope.
// Agent: LOAD session; resolve_editable_share_file(session.file_id); RETURNS (share, guest_key).
async fn resolve_editable_session(
    state: &AppState,
    token: &str,
    headers: &HeaderMap,
    session_id: &str,
    guest_id: &str,
) -> Result<(ShareRecord, String, String), AppError> {
    let guest_key = normalize_guest_id(guest_id)?;
    let session = state
        .document_collab
        .get(session_id)
        .await
        .ok_or(AppError::NotFound)?;
    let share =
        resolve_editable_share_file(state, token, headers, &session.file_id).await?;
    Ok((share, guest_key, session.file_id))
}

// Human: POST /public/shares/{token}/document/sessions — join live co-edit via public link.
// Agent: REQUIRES allow_edit + file in share; guest_id becomes participant user_id.
pub async fn public_join_session(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(token): Path<String>,
    Json(body): Json<PublicJoinSessionRequest>,
) -> Result<Json<SessionView>, AppError> {
    let file_id = body.file_id.trim().to_string();
    if file_id.is_empty() {
        return Err(AppError::BadRequest("file_id is required".into()));
    }
    let guest_key = normalize_guest_id(&body.guest_id)?;
    let _share = resolve_editable_share_file(state.as_ref(), &token, &headers, &file_id).await?;
    let display = guest_display_name(body.display_name.as_deref(), &guest_key);

    let session = state
        .document_collab
        .join_or_create(
            &file_id,
            &guest_key,
            &display,
            body.initial_html,
            body.initial_text,
        )
        .await;
    Ok(Json(session_view(&session)))
}

// Human: GET /public/shares/{token}/document/sessions/{id} — session snapshot for poll clients.
// Agent: REQUIRES allow_edit + guest joined (or at least share access); RETURNS SessionView.
pub async fn public_get_session(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path((token, session_id)): Path<(String, String)>,
    Query(query): Query<PublicGuestBody>,
) -> Result<Json<SessionView>, AppError> {
    let (guest_key, _file_id) = {
        let (_share, guest_key, file_id) =
            resolve_editable_session(state.as_ref(), &token, &headers, &session_id, &query.guest_id)
                .await?;
        (guest_key, file_id)
    };
    let session = state
        .document_collab
        .get(&session_id)
        .await
        .ok_or(AppError::NotFound)?;
    if !session.participants.contains_key(&guest_key) {
        return Err(AppError::Forbidden(
            "join the document session before reading it".into(),
        ));
    }
    Ok(Json(session_view(&session)))
}

// Human: POST heartbeat for public collab presence + sentence locks.
// Agent: SAME semantics as authenticated heartbeat; USES guest_key as user id.
pub async fn public_session_heartbeat(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path((token, session_id)): Path<(String, String)>,
    Json(body): Json<PublicHeartbeatRequest>,
) -> Result<Json<SessionView>, AppError> {
    let (_share, guest_key, _file_id) =
        resolve_editable_session(state.as_ref(), &token, &headers, &session_id, &body.guest_id)
            .await?;

    let hb = HeartbeatRequest {
        selection_start: body.selection_start,
        selection_end: body.selection_end,
        lock_start: body.lock_start,
        lock_end: body.lock_end,
        clear_lock: body.clear_lock,
    };

    let session = if hb.clear_lock == Some(true) {
        let _ = state
            .document_collab
            .append_op(&session_id, &guest_key, "unlock", json!({}))
            .await;
        state
            .document_collab
            .heartbeat(
                &session_id,
                &guest_key,
                hb.selection_start,
                hb.selection_end,
                Some(0),
                Some(0),
            )
            .await
    } else {
        state
            .document_collab
            .heartbeat(
                &session_id,
                &guest_key,
                hb.selection_start,
                hb.selection_end,
                hb.lock_start,
                hb.lock_end,
            )
            .await
    }
    .ok_or(AppError::NotFound)?;

    let mut view = session_view(&session);
    normalize_session_locks(&mut view);

    state.document_collab_hub.publish(
        &session_id,
        json!({
            "type": "presence",
            "session": view,
        })
        .to_string(),
    );
    Ok(Json(view))
}

// Human: GET ops since seq for public poll fallback.
// Agent: REQUIRES allow_edit + guest in session.
pub async fn public_list_ops(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path((token, session_id)): Path<(String, String)>,
    Query(query): Query<PublicListOpsQuery>,
) -> Result<Json<Vec<crate::document::collab::DocCollabOp>>, AppError> {
    let (_share, guest_key, _file_id) =
        resolve_editable_session(state.as_ref(), &token, &headers, &session_id, &query.guest_id)
            .await?;
    let session = state
        .document_collab
        .get(&session_id)
        .await
        .ok_or(AppError::NotFound)?;
    if !session.participants.contains_key(&guest_key) {
        return Err(AppError::Forbidden(
            "join the document session before listing ops".into(),
        ));
    }
    let ops = state
        .document_collab
        .ops_since(&session_id, query.after_seq)
        .await
        .ok_or(AppError::NotFound)?;
    Ok(Json(ops))
}

// Human: POST collab ops (doc_html, locks) for public editable shares.
// Agent: allow_edit already enforced; no separate content.write check for guests.
pub async fn public_post_op(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path((token, session_id)): Path<(String, String)>,
    Json(body): Json<PublicPostOpRequest>,
) -> Result<Json<crate::document::collab::DocCollabOp>, AppError> {
    let op_type = body.op_type.trim();
    if op_type.is_empty() {
        return Err(AppError::BadRequest("op_type is required".into()));
    }
    let (_share, guest_key, _file_id) =
        resolve_editable_session(state.as_ref(), &token, &headers, &session_id, &body.guest_id)
            .await?;

    let session = state
        .document_collab
        .get(&session_id)
        .await
        .ok_or(AppError::NotFound)?;
    if !session.participants.contains_key(&guest_key) {
        return Err(AppError::Forbidden(
            "join the document session before posting ops".into(),
        ));
    }

    let op = state
        .document_collab
        .append_op(&session_id, &guest_key, op_type, body.payload)
        .await
        .map_err(|e| match e {
            AppendOpError::NotFound => AppError::NotFound,
            AppendOpError::Locked => AppError::Conflict(
                "That range is locked by another collaborator".into(),
            ),
        })?;

    let session = state.document_collab.get(&session_id).await;
    state.document_collab_hub.publish(
        &session_id,
        json!({
            "type": "op",
            "op": op,
            "document_html": session.as_ref().map(|s| &s.document_html),
            "document_text": session.as_ref().map(|s| &s.document_text),
            "session": session.as_ref().map(session_view),
        })
        .to_string(),
    );
    Ok(Json(op))
}
