// Human: WebSocket endpoint for live document collab (ops + presence + locks).
// Agent: GET /api/v1/document/sessions/{id}/ws; AUTH Claims; BROADCASTS hub messages.
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
use tracing::debug;
use uuid::Uuid;

use crate::{
    auth::handlers::Claims,
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

    // Human: Prefer header password; fall back to query when the browser cannot set WS headers.
    // Agent: If query password present, inject x-share-password before resolve_public_share.
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

    let mut recv_task = tokio::spawn(async move {
        while let Some(Ok(msg)) = receiver.next().await {
            match msg {
                Message::Text(text) => {
                    debug!(%text, "document collab ws client message");
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
