// Human: HTTP API for rich-text live collab — join, heartbeat, ops, range locks.
// Agent: REQUIRES ContentRead; PUBLISHES hub events after heartbeat/ops.

use std::sync::Arc;

use axum::{
    extract::{Path, Query, State},
    Extension, Json,
};
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::{
    auth::handlers::Claims,
    document::collab::{AppendOpError, DocCollabOp, DocCollabParticipant, DocCollabSession},
    error::AppError,
    AppState,
};

#[derive(Debug, Deserialize)]
pub struct JoinSessionRequest {
    pub file_id: String,
    pub display_name: Option<String>,
    pub initial_html: Option<String>,
    pub initial_text: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct HeartbeatRequest {
    pub selection_start: Option<u32>,
    pub selection_end: Option<u32>,
    pub lock_start: Option<u32>,
    pub lock_end: Option<u32>,
    /// Human: When true, clear the participant's exclusive range lock.
    pub clear_lock: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct ListOpsQuery {
    pub after_seq: u64,
}

#[derive(Debug, Deserialize)]
pub struct PostOpRequest {
    pub op_type: String,
    pub payload: serde_json::Value,
}

#[derive(Debug, Serialize)]
pub struct ParticipantView {
    pub user_id: String,
    pub display_name: String,
    pub color: String,
    pub last_seen: u64,
    pub selection_start: Option<u32>,
    pub selection_end: Option<u32>,
    pub lock_start: Option<u32>,
    pub lock_end: Option<u32>,
}

#[derive(Debug, Serialize)]
pub struct SessionView {
    pub id: String,
    pub file_id: String,
    pub participants: Vec<ParticipantView>,
    pub latest_seq: u64,
    pub document_html: String,
    pub document_text: String,
}

fn participant_view(p: &DocCollabParticipant) -> ParticipantView {
    ParticipantView {
        user_id: p.user_id.clone(),
        display_name: p.display_name.clone(),
        color: p.color.clone(),
        last_seen: p.last_seen,
        selection_start: p.selection_start,
        selection_end: p.selection_end,
        lock_start: p.lock_start,
        lock_end: p.lock_end,
    }
}

fn session_view(session: &DocCollabSession) -> SessionView {
    let mut participants: Vec<_> = session.participants.values().map(participant_view).collect();
    participants.sort_by(|a, b| a.display_name.cmp(&b.display_name));
    SessionView {
        id: session.id.clone(),
        file_id: session.file_id.clone(),
        participants,
        latest_seq: session.next_seq.saturating_sub(1),
        document_html: session.document_html.clone(),
        document_text: session.document_text.clone(),
    }
}

// Human: POST /api/v1/document/sessions — join or create live co-editing for a file.
// Agent: ensure_file_access ContentRead; join_or_create with optional seed HTML/text.
pub async fn join_session(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Json(body): Json<JoinSessionRequest>,
) -> Result<Json<SessionView>, AppError> {
    let file_id = body.file_id.trim().to_string();
    if file_id.is_empty() {
        return Err(AppError::BadRequest("file_id is required".into()));
    }
    crate::files::access::ensure_file_access(
        &state.pool,
        &claims.sub,
        &file_id,
        crate::authz::Permission::ContentRead,
    )
    .await?;

    let display = body
        .display_name
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or(claims.email.as_str());

    let session = state
        .document_collab
        .join_or_create(
            &file_id,
            &claims.sub,
            display,
            body.initial_html,
            body.initial_text,
        )
        .await;
    Ok(Json(session_view(&session)))
}

pub async fn get_session(
    State(state): State<Arc<AppState>>,
    Extension(_claims): Extension<Claims>,
    Path(session_id): Path<String>,
) -> Result<Json<SessionView>, AppError> {
    let session = state
        .document_collab
        .get(&session_id)
        .await
        .ok_or(AppError::NotFound)?;
    Ok(Json(session_view(&session)))
}

pub async fn session_heartbeat(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(session_id): Path<String>,
    Json(body): Json<HeartbeatRequest>,
) -> Result<Json<SessionView>, AppError> {
    let (lock_start, lock_end) = if body.clear_lock == Some(true) {
        (Some(0), Some(0)) // cleared in store when both 0 — need special case
    } else {
        (body.lock_start, body.lock_end)
    };

    // Human: clear_lock uses unlock op path; heartbeat only sets locks when both ends provided.
    let session = if body.clear_lock == Some(true) {
        let _ = state
            .document_collab
            .append_op(&session_id, &claims.sub, "unlock", json!({}))
            .await;
        state
            .document_collab
            .heartbeat(
                &session_id,
                &claims.sub,
                body.selection_start,
                body.selection_end,
                Some(0),
                Some(0),
            )
            .await
    } else {
        state
            .document_collab
            .heartbeat(
                &session_id,
                &claims.sub,
                body.selection_start,
                body.selection_end,
                lock_start,
                lock_end,
            )
            .await
    }
    .ok_or(AppError::NotFound)?;

    // Normalize 0,0 locks as none for clients after heartbeat clear
    let mut view = session_view(&session);
    for p in &mut view.participants {
        if p.lock_start == Some(0) && p.lock_end == Some(0) {
            p.lock_start = None;
            p.lock_end = None;
        }
    }

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

pub async fn list_ops(
    State(state): State<Arc<AppState>>,
    Extension(_claims): Extension<Claims>,
    Path(session_id): Path<String>,
    Query(query): Query<ListOpsQuery>,
) -> Result<Json<Vec<DocCollabOp>>, AppError> {
    let ops = state
        .document_collab
        .ops_since(&session_id, query.after_seq)
        .await
        .ok_or(AppError::NotFound)?;
    Ok(Json(ops))
}

pub async fn post_op(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(session_id): Path<String>,
    Json(body): Json<PostOpRequest>,
) -> Result<Json<DocCollabOp>, AppError> {
    let op_type = body.op_type.trim();
    if op_type.is_empty() {
        return Err(AppError::BadRequest("op_type is required".into()));
    }

    // Human: Mutating collab ops require content.write (shared edit grants); join/read can use content.read.
    // Agent: LOAD session file_id; ensure_file_access ContentWrite for doc_html/text_*/lock.
    let mutating = matches!(
        op_type,
        "doc_html" | "text_insert" | "text_delete" | "lock" | "unlock"
    );
    if mutating {
        let session = state
            .document_collab
            .get(&session_id)
            .await
            .ok_or(AppError::NotFound)?;
        crate::files::access::ensure_file_access(
            &state.pool,
            &claims.sub,
            &session.file_id,
            crate::authz::Permission::ContentWrite,
        )
        .await?;
    }

    let op = state
        .document_collab
        .append_op(&session_id, &claims.sub, op_type, body.payload)
        .await
        .map_err(|e| match e {
            AppendOpError::NotFound => AppError::NotFound,
            AppendOpError::Locked => AppError::Conflict(
                "That range is locked by another collaborator".into(),
            ),
        })?;

    // Include latest document projection for fast catch-up clients
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
