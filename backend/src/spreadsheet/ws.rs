// Human: WebSocket endpoint for live spreadsheet collab events (ops + presence).
// Agent: GET /api/v1/spreadsheet/sessions/{id}/ws; AUTH via Claims extension; BROADCASTS hub messages.

use std::sync::Arc;

use axum::{
    extract::{
        ws::{Message, WebSocket},
        Path, State, WebSocketUpgrade,
    },
    response::IntoResponse,
    Extension,
};
use futures_util::{SinkExt, StreamExt};
use serde_json::json;
use tracing::debug;

use crate::{auth::handlers::Claims, error::AppError, AppState};

// Human: Upgrade HTTP connection to a session-scoped collab WebSocket.
// Agent: REQUIRES prior join (participant must exist); SUBSCRIBES hub channel.
pub async fn session_ws(
    ws: WebSocketUpgrade,
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(session_id): Path<String>,
) -> Result<impl IntoResponse, AppError> {
    let session = state
        .spreadsheet_collab
        .get(&session_id)
        .await
        .ok_or(AppError::NotFound)?;
    if !session.participants.contains_key(&claims.sub) {
        return Err(AppError::Forbidden(
            "join the co-editing session before opening the WebSocket".into(),
        ));
    }

    Ok(ws.on_upgrade(move |socket| {
        handle_socket(socket, state, session_id, claims.sub)
    }))
}

async fn handle_socket(
    socket: WebSocket,
    state: Arc<AppState>,
    session_id: String,
    user_id: String,
) {
    let (mut sender, mut receiver) = socket.split();
    let mut rx = state.spreadsheet_collab_hub.subscribe(&session_id);

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
                    // Human: Client may send pings or presence JSON; keep connection alive.
                    // Agent: LOGS at debug; heartbeat still via HTTP for store updates.
                    debug!(%text, "collab ws client message");
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
