// Human: Admin API for reading and updating runtime logging configuration.
// Agent: GET/PATCH /admin/logging; REQUIRES instance.settings.*; AUDIT admin.logging.update on PATCH.

use std::sync::Arc;

use axum::{extract::State, http::HeaderMap, Extension, Json};

use crate::{
    admin::handlers::require_instance_permission,
    audit,
    auth::handlers::Claims,
    authz::Permission,
    error::AppError,
    AppState,
};

use super::{load_config, save_and_apply, LoggingConfig, LoggingConfigPatch, LoggingConfigResponse};

/// Human: Return current logging preset, effective category levels, and catalog metadata.
// Agent: GET /api/v1/admin/logging; READS app_settings; AUDIT exempt.
pub async fn get_logging_config(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<LoggingConfigResponse>, AppError> {
    require_instance_permission(&state.pool, &claims, Permission::InstanceSettingsRead).await?;
    let config = load_config(&state.pool).await;
    Ok(Json(config.to_response()))
}

/// Human: Update logging preset and/or per-category levels; applies immediately without restart.
// Agent: PATCH /api/v1/admin/logging; WRITES app_settings; AUDIT admin.logging.update.
pub async fn patch_logging_config(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    headers: HeaderMap,
    Json(body): Json<LoggingConfigPatch>,
) -> Result<Json<LoggingConfigResponse>, AppError> {
    require_instance_permission(&state.pool, &claims, Permission::InstanceSettingsManage).await?;

    if body.preset.is_none() && body.categories.is_none() {
        return Err(AppError::BadRequest(
            "provide preset and/or categories to update logging".into(),
        ));
    }

    let current = load_config(&state.pool).await;
    let updated = LoggingConfig::normalize_patch(current, body)
        .map_err(AppError::BadRequest)?;

    save_and_apply(&state.pool, &updated)
        .await
        .map_err(AppError::BadRequest)?;

    audit::write_audit(
        &state.pool,
        Some(&claims.sub),
        "admin.logging.update",
        Some("app_settings"),
        Some(super::LOGGING_CONFIG_KEY),
        Some(serde_json::json!({ "preset": updated.preset.as_str() })),
        &headers,
    )
    .await?;

    tracing::info!(
        admin_id = %claims.sub,
        preset = updated.preset.as_str(),
        "admin updated runtime logging configuration"
    );

    Ok(Json(updated.to_response()))
}
