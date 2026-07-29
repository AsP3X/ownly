// Human: WebSocket endpoint for live document collab (ops + presence + locks).
// Agent: GET /api/v1/document/sessions/{id}/ws; AUTH Claims; BIDIRECTIONAL ops/heartbeat.
// Agent: ALSO public_session_ws under /public/shares/{token}/document/sessions/{id}/ws.

use std::sync::Arc;

use axum::{
    extract::{
        ws::{Message, WebSocket},
        Path, Query, State, WebSocketUpgrade,
    },
    http::HeaderMap,
    response::IntoResponse,
    Extension,
};
use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use serde_json::json;
use tracing::{debug, warn};
use uuid::Uuid;

use crate::{
    auth::handlers::Claims,
    document::collab::AppendOpError,
    document::collab_handlers::{normalize_session_locks, session_view},
    error::AppError,
    shares::store::{ensure_share_edit_allowed, load_file_in_share_scope},
    AppState,
};

pub async fn session_ws(
    ws: WebSocketUpgrade,
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(session_id): Path<String>,
) -> Result<impl IntoResponse, AppError> {
    let session = state
        .document_collab
        .get(&session_id)
        .await
        .ok_or(AppError::NotFound)?;
    if !session.participants.contains_key(&claims.sub) {
        return Err(AppError::Forbidden(
            "join the document session before opening the WebSocket".into(),
        ));
    }

    Ok(ws.on_upgrade(move |socket| handle_socket(socket, state, session_id, claims.sub)))
}

#[derive(Debug, Deserialize)]
pub struct PublicWsQuery {
    pub guest_id: String,
    /// Human: Browser WebSocket cannot set X-Share-Password — optional query fallback.
    pub password: Option<String>,
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

// Human: Public-share WebSocket for editable document collab (guest identity via query).
// Agent: resolve share + password (header or query) + allow_edit + participant membership.
pub async fn public_session_ws(
    ws: WebSocketUpgrade,
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path((token, session_id)): Path<(String, String)>,
    Query(query): Query<PublicWsQuery>,
) -> Result<impl IntoResponse, AppError> {
    let guest_key = normalize_guest_id(&query.guest_id)?;

    let mut headers = headers;
    if headers.get("x-share-password").is_none() {
        if let Some(password) = query
            .password
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            if let Ok(value) = axum::http::HeaderValue::from_str(password) {
                headers.insert("x-share-password", value);
            }
        }
    }

    let share =
        crate::shares::handlers::resolve_public_share(state.as_ref(), &token, &headers).await?;
    ensure_share_edit_allowed(&share)?;

    let session = state
        .document_collab
        .get(&session_id)
        .await
        .ok_or(AppError::NotFound)?;
    load_file_in_share_scope(&state.pool, &share, &session.file_id).await?;
    if !session.participants.contains_key(&guest_key) {
        return Err(AppError::Forbidden(
            "join the document session before opening the WebSocket".into(),
        ));
    }

    Ok(ws.on_upgrade(move |socket| handle_socket(socket, state, session_id, guest_key)))
}

#[derive(Debug, Deserialize)]
struct WsClientMessage {
    #[serde(rename = "type")]
    msg_type: String,
    selection_start: Option<u32>,
    selection_end: Option<u32>,
    lock_start: Option<u32>,
    lock_end: Option<u32>,
    clear_lock: Option<bool>,
    op_type: Option<String>,
    payload: Option<serde_json::Value>,
}

async fn handle_socket(
    socket: WebSocket,
    state: Arc<AppState>,
    session_id: String,
    user_id: String,
) {
    let (mut sender, mut receiver) = socket.split();
    let mut rx = state.document_collab_hub.subscribe(&session_id);

    let hello = json!({
        "type": "hello",
        "session_id": session_id,
        "user_id": user_id,
    })
    .to_string();
    if sender.send(Message::Text(hello.into())).await.is_err() {
        return;
    }

    let mut send_task = tokio::spawn(async move {
        while let Ok(msg) = rx.recv().await {
            if sender.send(Message::Text(msg.into())).await.is_err() {
                break;
            }
        }
    });

    let state_recv = state.clone();
    let session_id_recv = session_id.clone();
    let user_id_recv = user_id.clone();
    let mut recv_task = tokio::spawn(async move {
        while let Some(Ok(msg)) = receiver.next().await {
            match msg {
                Message::Text(text) => {
                    if let Err(err) =
                        handle_client_message(&state_recv, &session_id_recv, &user_id_recv, &text)
                            .await
                    {
                        warn!(%err, %session_id_recv, %user_id_recv, "document collab ws client message failed");
                    }
                }
                Message::Ping(_) | Message::Pong(_) => {}
                Message::Close(_) => break,
                _ => {}
            }
        }
    });

    tokio::select! {
        _ = &mut send_task => recv_task.abort(),
        _ = &mut recv_task => send_task.abort(),
    }
}

// Human: Process client WS frames for presence and document ops (avoids HTTP round-trips).
// Agent: heartbeat → store + presence fan-out; op → append_op + op fan-out.
async fn handle_client_message(
    state: &AppState,
    session_id: &str,
    user_id: &str,
    text: &str,
) -> Result<(), String> {
    let msg: WsClientMessage =
        serde_json::from_str(text).map_err(|e| format!("invalid json: {e}"))?;
    match msg.msg_type.as_str() {
        "heartbeat" | "presence" => {
            let (lock_start, lock_end) = if msg.clear_lock == Some(true) {
                (Some(0), Some(0))
            } else {
                (msg.lock_start, msg.lock_end)
            };

            if msg.clear_lock == Some(true) {
                let _ = state
                    .document_collab
                    .append_op(session_id, user_id, "unlock", json!({}))
                    .await;
            }

            let session = state
                .document_collab
                .heartbeat(
                    session_id,
                    user_id,
                    msg.selection_start,
                    msg.selection_end,
                    lock_start,
                    lock_end,
                )
                .await
                .ok_or_else(|| "session not found".to_string())?;

            let mut view = session_view(&session);
            normalize_session_locks(&mut view);
            state.document_collab_hub.publish(
                session_id,
                json!({
                    "type": "presence",
                    "session": view,
                })
                .to_string(),
            );
            Ok(())
        }
        "op" => {
            let op_type = msg
                .op_type
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .ok_or_else(|| "op_type required".to_string())?;
            let payload = msg.payload.unwrap_or_else(|| json!({}));
            let op = state
                .document_collab
                .append_op(session_id, user_id, op_type, payload)
                .await
                .map_err(|e| match e {
                    AppendOpError::NotFound => "session not found".to_string(),
                    AppendOpError::Locked => "range locked".to_string(),
                })?;

            let session = state.document_collab.get(session_id).await;
            state.document_collab_hub.publish(
                session_id,
                json!({
                    "type": "op",
                    "op": op,
                    "document_html": session.as_ref().map(|s| &s.document_html),
                    "document_text": session.as_ref().map(|s| &s.document_text),
                    "session": session.as_ref().map(session_view),
                })
                .to_string(),
            );
            Ok(())
        }
        "ping" => Ok(()),
        other => {
            debug!(msg_type = %other, "ignored document collab ws message");
            Ok(())
        }
    }
}
