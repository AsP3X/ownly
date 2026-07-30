// Human: HTTP API for shared collab — join, heartbeat, ops (JWT + public share).
// Agent: THIN authZ wrappers over CollabEngine; MOUNTED under /api/v1/collab and public shares.

use std::sync::Arc;

use axum::{
    extract::{Path, Query, State},
    Extension, Json,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

use crate::{
    auth::handlers::Claims,
    collab::engine::{session_view, SessionView, SharedCollabEngine},
    collab::types::{CollabError, OpEnvelope, RoomKind},
    error::AppError,
    shares::store::{ensure_share_edit_allowed, load_file_in_share_scope},
    AppState,
};

#[derive(Debug, Deserialize)]
pub struct JoinRequest {
    pub room_kind: String,
    pub file_id: String,
    pub display_name: Option<String>,
    pub seed: Option<Value>,
    /// Human: Legacy document seed fields (also accepted inside seed).
    pub initial_html: Option<String>,
    pub initial_text: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct HeartbeatRequest {
    pub presence: Option<Value>,
    // Document convenience flat fields
    pub selection_start: Option<u32>,
    pub selection_end: Option<u32>,
    pub lock_start: Option<u32>,
    pub lock_end: Option<u32>,
    pub clear_lock: Option<bool>,
    // Spreadsheet convenience
    pub active_cell: Option<String>,
    pub sheet_name: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ListOpsQuery {
    pub after_seq: u64,
}

#[derive(Debug, Deserialize)]
pub struct PostOpRequest {
    pub base_seq: u64,
    pub op_type: String,
    pub payload: Value,
    pub client_op_id: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct OpResponse {
    #[serde(flatten)]
    pub op: OpEnvelope,
}

fn map_collab_err(err: CollabError) -> AppError {
    match err {
        CollabError::NotFound | CollabError::NotParticipant => AppError::NotFound,
        CollabError::Locked => AppError::Conflict(
            "That range is locked by another collaborator".into(),
        ),
        CollabError::TextMismatch => AppError::Conflict(
            "Document text diverged; sync and retry format commit".into(),
        ),
        CollabError::SyncRequired => AppError::Conflict("Sync required before submitting ops".into()),
        CollabError::InvalidOp(msg) => AppError::BadRequest(msg),
        CollabError::Conflict(msg) => AppError::Conflict(msg),
        CollabError::Storage(msg) => AppError::Internal(anyhow::anyhow!(msg)),
    }
}

fn merge_presence(body: &HeartbeatRequest) -> Option<Value> {
    let mut map = serde_json::Map::new();
    if let Some(p) = &body.presence {
        if let Some(obj) = p.as_object() {
            for (k, v) in obj {
                map.insert(k.clone(), v.clone());
            }
        }
    }
    if let Some(v) = body.selection_start {
        map.insert("selection_start".into(), Value::from(v));
    }
    if let Some(v) = body.selection_end {
        map.insert("selection_end".into(), Value::from(v));
    }
    if body.clear_lock == Some(true) {
        map.insert("lock_start".into(), Value::Null);
        map.insert("lock_end".into(), Value::Null);
    } else {
        if let Some(v) = body.lock_start {
            map.insert("lock_start".into(), Value::from(v));
        }
        if let Some(v) = body.lock_end {
            map.insert("lock_end".into(), Value::from(v));
        }
    }
    if let Some(v) = &body.active_cell {
        map.insert("active_cell".into(), Value::String(v.clone()));
    }
    if let Some(v) = &body.sheet_name {
        map.insert("sheet_name".into(), Value::String(v.clone()));
    }
    if map.is_empty() {
        None
    } else {
        Some(Value::Object(map))
    }
}

fn seed_from_join(body: &JoinRequest) -> Option<Value> {
    if let Some(seed) = &body.seed {
        return Some(seed.clone());
    }
    let mut map = serde_json::Map::new();
    if let Some(html) = &body.initial_html {
        map.insert("html".into(), Value::String(html.clone()));
    }
    if let Some(text) = &body.initial_text {
        map.insert("text".into(), Value::String(text.clone()));
    }
    if map.is_empty() {
        None
    } else {
        Some(Value::Object(map))
    }
}

// ── Authenticated handlers ──────────────────────────────────────────────────

pub async fn join_session(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Json(body): Json<JoinRequest>,
) -> Result<Json<SessionView>, AppError> {
    let room_kind = RoomKind::parse(&body.room_kind)
        .ok_or_else(|| AppError::BadRequest("room_kind must be document or spreadsheet".into()))?;
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
        .collab
        .join(room_kind, &file_id, &claims.sub, display, seed_from_join(&body))
        .await
        .map_err(map_collab_err)?;
    Ok(Json(session_view(&session)))
}

pub async fn get_session(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(session_id): Path<String>,
) -> Result<Json<SessionView>, AppError> {
    let session = state.collab.get(&session_id).await.map_err(map_collab_err)?;
    if !session.participants.contains_key(&claims.sub) {
        crate::files::access::ensure_file_access(
            &state.pool,
            &claims.sub,
            &session.file_id,
            crate::authz::Permission::ContentRead,
        )
        .await?;
    }
    Ok(Json(session_view(&session)))
}

pub async fn session_heartbeat(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(session_id): Path<String>,
    Json(body): Json<HeartbeatRequest>,
) -> Result<Json<SessionView>, AppError> {
    let session = state
        .collab
        .heartbeat(&session_id, &claims.sub, merge_presence(&body))
        .await
        .map_err(map_collab_err)?;
    Ok(Json(session_view(&session)))
}

pub async fn list_ops(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(session_id): Path<String>,
    Query(query): Query<ListOpsQuery>,
) -> Result<Json<Vec<OpEnvelope>>, AppError> {
    let session = state.collab.get(&session_id).await.map_err(map_collab_err)?;
    if !session.participants.contains_key(&claims.sub) {
        return Err(AppError::Forbidden("join the session first".into()));
    }
    let ops = state
        .collab
        .ops_since(&session_id, query.after_seq)
        .await
        .map_err(map_collab_err)?;
    Ok(Json(ops))
}

pub async fn post_op(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(session_id): Path<String>,
    Json(body): Json<PostOpRequest>,
) -> Result<Json<OpEnvelope>, AppError> {
    let op_type = body.op_type.trim();
    if op_type.is_empty() {
        return Err(AppError::BadRequest("op_type is required".into()));
    }
    let session = state.collab.get(&session_id).await.map_err(map_collab_err)?;
    crate::files::access::ensure_file_access(
        &state.pool,
        &claims.sub,
        &session.file_id,
        crate::authz::Permission::ContentWrite,
    )
    .await?;

    let (op, _) = state
        .collab
        .submit_op(
            &session_id,
            &claims.sub,
            body.base_seq,
            op_type,
            body.payload,
            body.client_op_id,
        )
        .await
        .map_err(map_collab_err)?;
    Ok(Json(op))
}

// ── Public share handlers ───────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct PublicJoinRequest {
    pub room_kind: Option<String>,
    pub file_id: String,
    pub display_name: Option<String>,
    pub guest_id: String,
    pub seed: Option<Value>,
    pub initial_html: Option<String>,
    pub initial_text: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct PublicGuestQuery {
    pub guest_id: String,
}

fn normalize_guest_id(raw: &str) -> Result<String, AppError> {
    let trimmed = raw.trim();
    if trimmed.is_empty() || trimmed.len() > 64 {
        return Err(AppError::BadRequest("guest_id is required".into()));
    }
    let bare = trimmed.strip_prefix("guest:").unwrap_or(trimmed);
    if Uuid::parse_str(bare).is_err()
        && (bare.len() < 8
            || !bare
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'))
    {
        return Err(AppError::BadRequest("guest_id is invalid".into()));
    }
    Ok(format!("guest:{bare}"))
}

async fn resolve_public_edit(
    state: &AppState,
    token: &str,
    headers: &axum::http::HeaderMap,
    file_id: &str,
) -> Result<(), AppError> {
    let share = crate::shares::handlers::resolve_public_share(state, token, headers).await?;
    ensure_share_edit_allowed(&share)?;
    load_file_in_share_scope(&state.pool, &share, file_id).await?;
    Ok(())
}

pub async fn public_join_session(
    State(state): State<Arc<AppState>>,
    headers: axum::http::HeaderMap,
    Path(token): Path<String>,
    Json(body): Json<PublicJoinRequest>,
) -> Result<Json<SessionView>, AppError> {
    let room_kind = body
        .room_kind
        .as_deref()
        .and_then(RoomKind::parse)
        .unwrap_or(RoomKind::Document);
    if room_kind != RoomKind::Document {
        return Err(AppError::BadRequest(
            "public collab currently supports document rooms only".into(),
        ));
    }
    let file_id = body.file_id.trim().to_string();
    if file_id.is_empty() {
        return Err(AppError::BadRequest("file_id is required".into()));
    }
    resolve_public_edit(state.as_ref(), &token, &headers, &file_id).await?;
    let guest_key = normalize_guest_id(&body.guest_id)?;
    let display = body
        .display_name
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("Guest");

    let join_body = JoinRequest {
        room_kind: room_kind.as_str().into(),
        file_id: file_id.clone(),
        display_name: Some(display.to_string()),
        seed: body.seed,
        initial_html: body.initial_html,
        initial_text: body.initial_text,
    };
    let session = state
        .collab
        .join(
            room_kind,
            &file_id,
            &guest_key,
            display,
            seed_from_join(&join_body),
        )
        .await
        .map_err(map_collab_err)?;
    Ok(Json(session_view(&session)))
}

pub async fn public_get_session(
    State(state): State<Arc<AppState>>,
    headers: axum::http::HeaderMap,
    Path((token, session_id)): Path<(String, String)>,
    Query(query): Query<PublicGuestQuery>,
) -> Result<Json<SessionView>, AppError> {
    let guest_key = normalize_guest_id(&query.guest_id)?;
    let session = state.collab.get(&session_id).await.map_err(map_collab_err)?;
    resolve_public_edit(state.as_ref(), &token, &headers, &session.file_id).await?;
    if !session.participants.contains_key(&guest_key) {
        return Err(AppError::Forbidden("join the session first".into()));
    }
    Ok(Json(session_view(&session)))
}

pub async fn public_session_heartbeat(
    State(state): State<Arc<AppState>>,
    headers: axum::http::HeaderMap,
    Path((token, session_id)): Path<(String, String)>,
    Query(query): Query<PublicGuestQuery>,
    Json(body): Json<HeartbeatRequest>,
) -> Result<Json<SessionView>, AppError> {
    let guest_key = normalize_guest_id(&query.guest_id)?;
    let session = state.collab.get(&session_id).await.map_err(map_collab_err)?;
    resolve_public_edit(state.as_ref(), &token, &headers, &session.file_id).await?;
    let session = state
        .collab
        .heartbeat(&session_id, &guest_key, merge_presence(&body))
        .await
        .map_err(map_collab_err)?;
    Ok(Json(session_view(&session)))
}

pub async fn public_list_ops(
    State(state): State<Arc<AppState>>,
    headers: axum::http::HeaderMap,
    Path((token, session_id)): Path<(String, String)>,
    Query(query): Query<ListOpsPublicQuery>,
) -> Result<Json<Vec<OpEnvelope>>, AppError> {
    let guest_key = normalize_guest_id(&query.guest_id)?;
    let session = state.collab.get(&session_id).await.map_err(map_collab_err)?;
    resolve_public_edit(state.as_ref(), &token, &headers, &session.file_id).await?;
    if !session.participants.contains_key(&guest_key) {
        return Err(AppError::Forbidden("join the session first".into()));
    }
    let ops = state
        .collab
        .ops_since(&session_id, query.after_seq)
        .await
        .map_err(map_collab_err)?;
    Ok(Json(ops))
}

#[derive(Debug, Deserialize)]
pub struct ListOpsPublicQuery {
    pub after_seq: u64,
    pub guest_id: String,
}

#[derive(Debug, Deserialize)]
pub struct PublicPostOpRequest {
    pub base_seq: u64,
    pub op_type: String,
    pub payload: Value,
    pub client_op_id: Option<String>,
    pub guest_id: String,
}

pub async fn public_post_op(
    State(state): State<Arc<AppState>>,
    headers: axum::http::HeaderMap,
    Path((token, session_id)): Path<(String, String)>,
    Json(body): Json<PublicPostOpRequest>,
) -> Result<Json<OpEnvelope>, AppError> {
    let guest_key = normalize_guest_id(&body.guest_id)?;
    let session = state.collab.get(&session_id).await.map_err(map_collab_err)?;
    resolve_public_edit(state.as_ref(), &token, &headers, &session.file_id).await?;
    let op_type = body.op_type.trim();
    if op_type.is_empty() {
        return Err(AppError::BadRequest("op_type is required".into()));
    }
    let (op, _) = state
        .collab
        .submit_op(
            &session_id,
            &guest_key,
            body.base_seq,
            op_type,
            body.payload,
            body.client_op_id,
        )
        .await
        .map_err(map_collab_err)?;
    Ok(Json(op))
}

// Re-export engine type for handlers that only need views
#[allow(dead_code)]
pub type Engine = SharedCollabEngine;
