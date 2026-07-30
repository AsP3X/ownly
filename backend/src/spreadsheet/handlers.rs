// Human: Spreadsheet Copilot HTTP handler (heuristic assistant).
// Agent: AUTH required; AUDITS replies; live collab is crate::collab.

use axum::{extract::State, Extension, Json};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::sync::Arc;

use crate::{audit, auth::handlers::Claims, error::AppError, AppState};

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
