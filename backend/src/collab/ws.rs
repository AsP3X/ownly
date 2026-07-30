// Human: Bidirectional WebSocket for shared collab (ops + presence + sync).
// Agent: GET /api/v1/collab/sessions/{id}/ws and public variant.

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
use serde_json::{json, Value};
use tracing::warn;
use uuid::Uuid;

use crate::{
    auth::handlers::Claims,
    collab::engine::session_view,
    collab::types::{CollabError, PROTOCOL_VERSION},
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
        .collab
        .get(&session_id)
        .await
        .map_err(|_| AppError::NotFound)?;
    if !session.participants.contains_key(&claims.sub) {
        return Err(AppError::Forbidden(
            "join the collab session before opening the WebSocket".into(),
        ));
    }
    state.collab.hub().spawn_redis_bridge(session_id.clone());
    Ok(ws.on_upgrade(move |socket| {
        handle_socket(socket, state, session_id, claims.sub)
    }))
}

#[derive(Debug, Deserialize)]
pub struct PublicWsQuery {
    pub guest_id: String,
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
            .filter(|v| !v.is_empty())
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
        .collab
        .get(&session_id)
        .await
        .map_err(|_| AppError::NotFound)?;
    load_file_in_share_scope(&state.pool, &share, &session.file_id).await?;
    if !session.participants.contains_key(&guest_key) {
        return Err(AppError::Forbidden(
            "join the collab session before opening the WebSocket".into(),
        ));
    }
    state.collab.hub().spawn_redis_bridge(session_id.clone());
    Ok(ws.on_upgrade(move |socket| {
        handle_socket(socket, state, session_id, guest_key)
    }))
}

#[derive(Debug, Deserialize)]
struct WsClientMessage {
    #[serde(rename = "type")]
    msg_type: String,
    presence: Option<Value>,
    selection_start: Option<u32>,
    selection_end: Option<u32>,
    lock_start: Option<u32>,
    lock_end: Option<u32>,
    clear_lock: Option<bool>,
    active_cell: Option<String>,
    sheet_name: Option<String>,
    base_seq: Option<u64>,
    op_type: Option<String>,
    payload: Option<Value>,
    client_op_id: Option<String>,
    after_seq: Option<u64>,
}

async fn handle_socket(
    socket: WebSocket,
    state: Arc<AppState>,
    session_id: String,
    user_id: String,
) {
    let (mut sender, mut receiver) = socket.split();
    let mut rx = state.collab.hub().subscribe(&session_id);

    let hello = json!({
        "type": "hello",
        "session_id": session_id,
        "user_id": user_id,
        "protocol": PROTOCOL_VERSION,
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
                    if let Err(err) = handle_client_message(
                        &state_recv,
                        &session_id_recv,
                        &user_id_recv,
                        &text,
                    )
                    .await
                    {
                        warn!(
                            %err,
                            %session_id_recv,
                            %user_id_recv,
                            "collab ws client message failed"
                        );
                        // Best-effort error frame via hub to this session (all peers see it — ok for now).
                        let err_msg = json!({
                            "type": "error",
                            "code": "client_message",
                            "message": err,
                        })
                        .to_string();
                        state_recv
                            .collab
                            .hub()
                            .publish(&session_id_recv, err_msg)
                            .await;
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

fn merge_ws_presence(msg: &WsClientMessage) -> Option<Value> {
    let mut map = serde_json::Map::new();
    if let Some(p) = &msg.presence {
        if let Some(obj) = p.as_object() {
            for (k, v) in obj {
                map.insert(k.clone(), v.clone());
            }
        }
    }
    if let Some(v) = msg.selection_start {
        map.insert("selection_start".into(), Value::from(v));
    }
    if let Some(v) = msg.selection_end {
        map.insert("selection_end".into(), Value::from(v));
    }
    if msg.clear_lock == Some(true) {
        map.insert("lock_start".into(), Value::Null);
        map.insert("lock_end".into(), Value::Null);
    } else {
        if let Some(v) = msg.lock_start {
            map.insert("lock_start".into(), Value::from(v));
        }
        if let Some(v) = msg.lock_end {
            map.insert("lock_end".into(), Value::from(v));
        }
    }
    if let Some(v) = &msg.active_cell {
        map.insert("active_cell".into(), Value::String(v.clone()));
    }
    if let Some(v) = &msg.sheet_name {
        map.insert("sheet_name".into(), Value::String(v.clone()));
    }
    if map.is_empty() {
        None
    } else {
        Some(Value::Object(map))
    }
}

async fn handle_client_message(
    state: &AppState,
    session_id: &str,
    user_id: &str,
    text: &str,
) -> Result<(), String> {
    let msg: WsClientMessage =
        serde_json::from_str(text).map_err(|e| format!("invalid json: {e}"))?;
    match msg.msg_type.as_str() {
        "ping" => Ok(()),
        "heartbeat" | "presence" => {
            let _ = state
                .collab
                .heartbeat(session_id, user_id, merge_ws_presence(&msg))
                .await
                .map_err(|e| e.to_string())?;
            Ok(())
        }
        "op" => {
            let op_type = msg
                .op_type
                .as_deref()
                .ok_or_else(|| "op_type required".to_string())?;
            let payload = msg.payload.unwrap_or(json!({}));
            let base_seq = msg.base_seq.unwrap_or(0);
            match state
                .collab
                .submit_op(
                    session_id,
                    user_id,
                    base_seq,
                    op_type,
                    payload,
                    msg.client_op_id.clone(),
                )
                .await
            {
                Ok((op, _session)) => {
                    // Fan-out already done in engine; also send personal ack.
                    let ack = json!({
                        "type": "ack",
                        "client_op_id": op.client_op_id,
                        "seq": op.seq,
                        "op": op,
                    })
                    .to_string();
                    state.collab.hub().publish(session_id, ack).await;
                    Ok(())
                }
                Err(CollabError::Locked) => {
                    let err = json!({
                        "type": "error",
                        "code": "locked",
                        "message": "That range is locked by another collaborator",
                        "client_op_id": msg.client_op_id,
                    })
                    .to_string();
                    state.collab.hub().publish(session_id, err).await;
                    Ok(())
                }
                Err(CollabError::TextMismatch) => {
                    let err = json!({
                        "type": "error",
                        "code": "text_mismatch",
                        "message": "Document text diverged; sync and retry",
                        "client_op_id": msg.client_op_id,
                    })
                    .to_string();
                    state.collab.hub().publish(session_id, err).await;
                    Ok(())
                }
                Err(e) => Err(e.to_string()),
            }
        }
        "sync" => {
            let after = msg.after_seq.unwrap_or(0);
            let ops = state
                .collab
                .ops_since(session_id, after)
                .await
                .map_err(|e| e.to_string())?;
            let session = state
                .collab
                .get(session_id)
                .await
                .map_err(|e| e.to_string())?;
            let msg = json!({
                "type": "ops",
                "ops": ops,
                "session": session_view(&session),
                "snapshot": session.snapshot,
            })
            .to_string();
            state.collab.hub().publish(session_id, msg).await;
            Ok(())
        }
        other => Err(format!("unknown message type: {other}")),
    }
}
