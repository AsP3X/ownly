// Human: Operational probes for orchestrators — DB connectivity and object storage reachability.
// Agent: GET /api/v1/health/ready; READS pool SELECT 1; OPTIONAL object storage GET /health; NO auth.

use std::sync::Arc;

use axum::{extract::State, Json};
use serde_json::json;

use crate::AppState;

// Human: Readiness aggregates dependency checks; returns JSON with per-service status.
// Agent: PUBLIC route; DB required; object storage checked when configured in proxy mode.
pub async fn readiness(State(state): State<Arc<AppState>>) -> Json<serde_json::Value> {
    let db_ok = sqlx::query("SELECT 1")
        .execute(&state.pool)
        .await
        .is_ok();

    let storage_ok = if state.storage_configured {
        let health_url = format!(
            "{}/health",
            state.object_storage_url.trim_end_matches('/')
        );
        match reqwest::get(&health_url).await {
            Ok(resp) => resp.status().is_success(),
            Err(_) => false,
        }
    } else {
        true
    };

    let ready = db_ok && storage_ok;

    Json(json!({
        "ready": ready,
        "database": if db_ok { "ok" } else { "error" },
        "object_storage": if !state.storage_configured {
            "not_configured"
        } else if storage_ok {
            "ok"
        } else {
            "error"
        },
        "environment": state.environment,
    }))
}
