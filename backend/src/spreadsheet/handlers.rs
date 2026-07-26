// Human: Spreadsheet Copilot + co-editing session HTTP handlers.
// Agent: AUTH required; Copilot audits replies; collab uses in-memory session store.

use axum::{
    extract::{Path, Query, State},
    Extension, Json,
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::sync::Arc;

use crate::{
    audit,
    auth::handlers::Claims,
    error::AppError,
    spreadsheet::collab::{CollabOp, CollabParticipant, CollabSession},
    AppState,
};

#[derive(Debug, Deserialize)]
pub struct CopilotRequest {
    pub prompt: String,
    #[serde(default)]
    pub cell: Option<String>,
    #[serde(default)]
    pub sheet_name: Option<String>,
    #[serde(default)]
    pub file_id: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct CopilotResponse {
    pub reply: String,
    pub source: &'static str,
}

// Human: Keyword heuristic replies matching frontend buildCopilotPromptReply.
// Agent: FALLBACK path when no LLM provider is configured; ALWAYS audits the request.
fn heuristic_reply(prompt: &str, cell: Option<&str>) -> String {
    let text = prompt.trim().to_lowercase();
    let cell = cell.unwrap_or("the active cell");
    if text.is_empty() {
        return "Ask me to draft a formula, explain a value, or suggest formatting.".into();
    }
    if text.contains("sum") || text.contains("total") {
        return format!(
            "Try =SUM on the column below your data for {cell}, or use AutoSum on the Formulas tab."
        );
    }
    if text.contains("average") || text.contains("mean") {
        return "Use =AVERAGE(range) for a simple mean, or =AVERAGEIF(range, criteria) to filter rows first.".into();
    }
    if text.contains("lookup") || text.contains("vlookup") || text.contains("xlookup") {
        return "Prefer =XLOOKUP(lookup, lookup_array, return_array). For legacy sheets, =VLOOKUP(lookup, table, col, FALSE) still works.".into();
    }
    if text.contains("filter") || text.contains("unique") || text.contains("sort") {
        return "Dynamic arrays: =FILTER(range, include), =SORT(range), =UNIQUE(range). Clear blockers to avoid #SPILL!.".into();
    }
    if text.contains("pivot") {
        return "Select your data range, then Insert → PivotTable. Pick row fields and value aggregations.".into();
    }
    if text.contains("format") || text.contains("currency") || text.contains("percent") {
        return "Use Home → Number for Currency/Percent. Format Painter copies style between cells.".into();
    }
    format!(
        "Recorded request about {cell}. Server Copilot is in heuristic mode (LLM optional). Try Insert Function, Trace Precedents, or a more specific formula goal (sum, lookup, filter)."
    )
}

// Human: POST /api/v1/spreadsheet/copilot — authenticated spreadsheet assistant reply.
// Agent: AUDITS prompt length + cell; RETURNS heuristic reply (LLM hook-ready).
pub async fn copilot(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    headers: axum::http::HeaderMap,
    Json(body): Json<CopilotRequest>,
) -> Result<Json<CopilotResponse>, AppError> {
    let prompt = body.prompt.trim().to_string();
    if prompt.chars().count() > 4000 {
        return Err(AppError::BadRequest("Prompt is too long".into()));
    }

    let reply = heuristic_reply(&prompt, body.cell.as_deref());

    let _ = audit::write_audit(
        &state.pool,
        Some(&claims.sub),
        "spreadsheet.copilot",
        Some("spreadsheet"),
        body.file_id.as_deref(),
        Some(json!({
            "prompt_len": prompt.len(),
            "cell": body.cell,
            "sheet_name": body.sheet_name,
            "source": "heuristic",
        })),
        &headers,
    )
    .await;

    Ok(Json(CopilotResponse {
        reply,
        source: "heuristic",
    }))
}

// —— Co-editing foundation ——

#[derive(Debug, Deserialize)]
pub struct JoinSessionRequest {
    pub file_id: String,
    #[serde(default)]
    pub display_name: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct SessionView {
    pub id: String,
    pub file_id: String,
    pub participants: Vec<CollabParticipant>,
    pub latest_seq: u64,
}

#[derive(Debug, Deserialize)]
pub struct HeartbeatRequest {
    #[serde(default)]
    pub active_cell: Option<String>,
    #[serde(default)]
    pub sheet_name: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct PostOpRequest {
    pub op_type: String,
    pub payload: serde_json::Value,
}

#[derive(Debug, Deserialize)]
pub struct ListOpsQuery {
    #[serde(default)]
    pub after_seq: u64,
}

fn session_view(session: &CollabSession) -> SessionView {
    let mut participants: Vec<_> = session.participants.values().cloned().collect();
    participants.sort_by(|a, b| a.display_name.cmp(&b.display_name));
    SessionView {
        id: session.id.clone(),
        file_id: session.file_id.clone(),
        participants,
        latest_seq: session.next_seq.saturating_sub(1),
    }
}

// Human: POST /api/v1/spreadsheet/sessions — join or create a co-edit session for a file.
// Agent: UPSERTS participant presence; RETURNS session id + current participants.
pub async fn join_session(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Json(body): Json<JoinSessionRequest>,
) -> Result<Json<SessionView>, AppError> {
    let file_id = body.file_id.trim().to_string();
    if file_id.is_empty() {
        return Err(AppError::BadRequest("file_id is required".into()));
    }
    // Human: Require read access to the workbook before joining collab.
    // Agent: CALLS ensure_file_access ContentRead.
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
        .spreadsheet_collab
        .join_or_create(&file_id, &claims.sub, display)
        .await;
    Ok(Json(session_view(&session)))
}

// Human: GET /api/v1/spreadsheet/sessions/:id — snapshot participants + latest seq.
// Agent: 404 when session expired or unknown.
pub async fn get_session(
    State(state): State<Arc<AppState>>,
    Extension(_claims): Extension<Claims>,
    Path(session_id): Path<String>,
) -> Result<Json<SessionView>, AppError> {
    let session = state
        .spreadsheet_collab
        .get(&session_id)
        .await
        .ok_or(AppError::NotFound)?;
    Ok(Json(session_view(&session)))
}

// Human: POST heartbeat — refresh presence + optional cursor cell.
// Agent: 404 when session/participant missing (re-join required).
pub async fn session_heartbeat(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(session_id): Path<String>,
    Json(body): Json<HeartbeatRequest>,
) -> Result<Json<SessionView>, AppError> {
    let session = state
        .spreadsheet_collab
        .heartbeat(
            &session_id,
            &claims.sub,
            body.active_cell,
            body.sheet_name,
        )
        .await
        .ok_or(AppError::NotFound)?;
    Ok(Json(session_view(&session)))
}

// Human: GET ops since after_seq for light sync (not full OT/CRDT).
// Agent: RETURNS ordered CollabOp list; clients apply best-effort.
pub async fn list_ops(
    State(state): State<Arc<AppState>>,
    Extension(_claims): Extension<Claims>,
    Path(session_id): Path<String>,
    Query(query): Query<ListOpsQuery>,
) -> Result<Json<Vec<CollabOp>>, AppError> {
    let ops = state
        .spreadsheet_collab
        .ops_since(&session_id, query.after_seq)
        .await
        .ok_or(AppError::NotFound)?;
    Ok(Json(ops))
}

// Human: POST a collaboration op (cell_edit, selection, comment, …).
// Agent: APPENDS to session log; RETURNS the stored op with seq.
pub async fn post_op(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(session_id): Path<String>,
    Json(body): Json<PostOpRequest>,
) -> Result<Json<CollabOp>, AppError> {
    let op_type = body.op_type.trim();
    if op_type.is_empty() {
        return Err(AppError::BadRequest("op_type is required".into()));
    }
    let op = state
        .spreadsheet_collab
        .append_op(&session_id, &claims.sub, op_type, body.payload)
        .await
        .ok_or(AppError::NotFound)?;
    Ok(Json(op))
}
