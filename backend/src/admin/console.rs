// Human: Admin console read/write APIs — overview metrics, audit ledger, storage health, upload health, instance settings.
// Agent: HTTP /api/v1/admin/*; READS users/files/audit_logs/app_settings; WRITES app_settings on PATCH; AUDIT admin.settings.update.

use std::sync::Arc;
use std::time::Instant;

use axum::{
    extract::State,
    http::HeaderMap,
    Extension, Json,
};
use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;

use crate::{
    admin::audit_catalog,
    admin::handlers::require_instance_permission,
    app_settings_secrets::AppSettingsSecretStore,
    audit,
    auth::handlers::Claims,
    authz::Permission,
    crypto,
    error::AppError,
    files::gif_preview,
    temp_cleanup::{self, GIF_PREVIEW_TEMP_AUTO_CLEANUP_KEY},
    AppState,
};

pub(crate) async fn read_setting(pool: &PgPool, key: &str) -> Option<String> {
    let row: Option<(String,)> =
        sqlx::query_as("SELECT value FROM app_settings WHERE key = $1")
            .bind(key)
            .fetch_optional(pool)
            .await
            .ok()?;
    row.map(|(value,)| value)
}

async fn upsert_setting(pool: &PgPool, key: &str, value: &str) -> Result<(), AppError> {
    sqlx::query(
        "INSERT INTO app_settings (key, value) VALUES ($1, $2) \
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
    )
    .bind(key)
    .bind(value)
    .execute(pool)
    .await?;
    Ok(())
}

fn parse_bool_setting(value: Option<String>, default: bool) -> bool {
    value
        .map(|v| v.eq_ignore_ascii_case("true") || v == "1")
        .unwrap_or(default)
}

// Human: Eight 15-minute audit buckets for the workload diagnostics chart (last 2 hours).
// Agent: READS audit_logs created_at; RETURNS fixed-length series even when counts are zero.
async fn build_workload_diagnostics(pool: &PgPool) -> Result<Vec<AdminOverviewWorkloadBar>, AppError> {
    const SLOT_COUNT: i64 = 8;
    const SLOT_SECONDS: i64 = 15 * 60;
    let window_seconds = SLOT_COUNT * SLOT_SECONDS;
    let since = Utc::now() - Duration::seconds(window_seconds);

    let rows: Vec<(DateTime<Utc>,)> =
        sqlx::query_as("SELECT created_at FROM audit_logs WHERE created_at >= $1")
            .bind(since)
            .fetch_all(pool)
            .await?;

    let window_start = since.timestamp();
    let mut counts = [0_i64; 8];
    for (created_at,) in rows {
        let offset = created_at.timestamp() - window_start;
        if offset < 0 || offset >= window_seconds {
            continue;
        }
        let slot = (offset / SLOT_SECONDS) as usize;
        if slot < 8 {
            counts[slot] += 1;
        }
    }

    let mut workload = Vec::with_capacity(8);
    for (slot, count) in counts.into_iter().enumerate() {
        let label_time = since + Duration::seconds((slot as i64) * SLOT_SECONDS);
        workload.push(AdminOverviewWorkloadBar {
            label: label_time.format("%H:%M").to_string(),
            value: count,
        });
    }
    Ok(workload)
}

async fn object_storage_healthy(state: &AppState) -> (bool, Option<u128>) {
    if !state.storage_configured {
        return (true, None);
    }
    let health_url = format!(
        "{}/health/ready",
        state.object_storage_url.trim_end_matches('/')
    );
    let started = Instant::now();
    match reqwest::get(&health_url).await {
        Ok(resp) => {
            let ok = resp.status().is_success();
            let latency = started.elapsed().as_millis();
            (ok, Some(latency))
        }
        Err(_) => (false, None),
    }
}

#[derive(Debug, Serialize)]
pub struct AdminOverviewMetrics {
    pub total_users: i64,
    pub enabled_users: i64,
    pub total_storage_bytes: i64,
    pub total_files: i64,
    pub instance_name: String,
    pub alert_count: i64,
}

/// Human: HLS video packaging health for ops — encode modes, failures, average encode time.
// Agent: FILLED by overview from files table aggregates; CONSUMED by AdminOverviewPanel.
#[derive(Debug, Serialize)]
pub struct AdminHlsVideoMetrics {
    pub ready_count: i64,
    pub processing_count: i64,
    pub failed_count: i64,
    pub source_master_count: i64,
    pub avg_encode_ms: Option<i64>,
    pub encode_mode_counts: Vec<AdminHlsEncodeModeCount>,
}

#[derive(Debug, Serialize)]
pub struct AdminHlsEncodeModeCount {
    pub mode: String,
    pub count: i64,
}

#[derive(Debug, Serialize)]
pub struct AdminOverviewStorageHealth {
    pub status: String,
    pub object_storage_url: String,
    pub bucket: String,
    pub storage_mode: String,
}

#[derive(Debug, Serialize)]
pub struct AdminOverviewResourceRow {
    pub label: String,
    pub percent: u8,
}

#[derive(Debug, Serialize)]
pub struct AdminOverviewWorkloadBar {
    pub label: String,
    pub value: i64,
}

#[derive(Debug, Serialize)]
pub struct AdminOverviewAlertRow {
    pub severity: String,
    pub source: String,
    pub detail: String,
    pub timestamp: String,
}

#[derive(Debug, Serialize)]
pub struct AdminOverviewResponse {
    pub metrics: AdminOverviewMetrics,
    pub storage_health: AdminOverviewStorageHealth,
    pub resource_allocation: Vec<AdminOverviewResourceRow>,
    pub workload: Vec<AdminOverviewWorkloadBar>,
    pub recent_alerts: Vec<AdminOverviewAlertRow>,
    /// Human: Video stream packaging stats for the admin dashboard.
    pub hls_video: AdminHlsVideoMetrics,
}

// Human: Aggregate instance KPIs and recent security events for the dashboard overview panel.
// Agent: GET /api/v1/admin/overview; READS users/files/audit_logs/app_settings; AUDIT exempt.
pub async fn overview(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<AdminOverviewResponse>, AppError> {
    require_instance_permission(&state.pool, &claims, Permission::InstanceSettingsRead).await?;

    let user_stats: (i64, i64) = sqlx::query_as(
        "SELECT COUNT(*)::BIGINT, COALESCE(SUM(CASE WHEN enabled THEN 1 ELSE 0 END), 0)::BIGINT FROM users",
    )
    .fetch_one(&state.pool)
    .await?;

    let file_stats: (i64, i64) = sqlx::query_as(
        "SELECT COUNT(*)::BIGINT, COALESCE(SUM(size_bytes), 0)::BIGINT FROM files WHERE deleted_at IS NULL",
    )
    .fetch_one(&state.pool)
    .await?;

    let alert_count: (i64,) = sqlx::query_as(
        "SELECT COUNT(*)::BIGINT FROM audit_logs \
         WHERE action LIKE '%delete%' OR action LIKE '%revoke%' OR action LIKE 'admin.%'",
    )
    .fetch_one(&state.pool)
    .await?;

    let instance_name = read_setting(&state.pool, "instance_name")
        .await
        .unwrap_or_else(|| "Ownly".into());
    let bucket = read_setting(&state.pool, "object_storage_bucket")
        .await
        .unwrap_or_else(|| state.object_storage_bucket.clone());

    let quota_gb = read_setting(&state.pool, "default_storage_quota_gb")
        .await
        .and_then(|v| v.parse::<i64>().ok())
        .unwrap_or(50)
        .max(1);
    let capacity_bytes = quota_gb
        .saturating_mul(user_stats.0.max(1))
        .saturating_mul(1024 * 1024 * 1024);
    let storage_pct = if capacity_bytes > 0 {
        ((file_stats.1 as f64 / capacity_bytes as f64) * 100.0).round() as u8
    } else {
        0
    };
    let activation_pct = if user_stats.0 > 0 {
        ((user_stats.1 as f64 / user_stats.0 as f64) * 100.0).round() as u8
    } else {
        100
    };

    let (storage_ok, _) = object_storage_healthy(&state).await;
    let storage_status = if !state.storage_configured {
        "not_configured"
    } else if storage_ok {
        "healthy"
    } else {
        "degraded"
    };

    let workload = build_workload_diagnostics(&state.pool).await?;

    let alert_rows: Vec<(String, String, Option<String>, String, DateTime<Utc>)> = sqlx::query_as(
        "SELECT action, COALESCE(resource_type, 'system'), resource_id, \
            COALESCE(ip, 'internal'), created_at \
         FROM audit_logs \
         ORDER BY created_at DESC LIMIT 8",
    )
    .fetch_all(&state.pool)
    .await?;

    let recent_alerts: Vec<AdminOverviewAlertRow> = alert_rows
        .into_iter()
        .map(|(action, resource_type, resource_id, ip, created_at)| {
            AdminOverviewAlertRow {
                severity: audit_catalog::severity_of(&action).as_str().into(),
                source: ip,
                detail: audit_catalog::label_of(
                    &action,
                    Some(resource_type.as_str()),
                    resource_id.as_deref(),
                ),
                timestamp: created_at.format("%Y-%m-%d %H:%M:%S").to_string(),
            }
        })
        .collect();

    let hls_video = build_hls_video_metrics(&state.pool).await?;

    Ok(Json(AdminOverviewResponse {
        metrics: AdminOverviewMetrics {
            total_users: user_stats.0,
            enabled_users: user_stats.1,
            total_storage_bytes: file_stats.1,
            total_files: file_stats.0,
            instance_name,
            alert_count: alert_count.0,
        },
        storage_health: AdminOverviewStorageHealth {
            status: storage_status.into(),
            object_storage_url: state.object_storage_url.clone(),
            bucket,
            storage_mode: state.storage_mode.clone(),
        },
        resource_allocation: vec![
            AdminOverviewResourceRow {
                label: "Account activation".into(),
                percent: activation_pct,
            },
            AdminOverviewResourceRow {
                label: "Storage pool utilization".into(),
                percent: storage_pct.min(100),
            },
            AdminOverviewResourceRow {
                label: "Object storage reachability".into(),
                percent: if storage_ok || !state.storage_configured {
                    100
                } else {
                    0
                },
            },
            AdminOverviewResourceRow {
                label: "Database connectivity".into(),
                percent: 100,
            },
        ],
        workload,
        recent_alerts,
        hls_video,
    }))
}

// Human: Aggregate HLS packaging stats — ready/processing/failed, masters, encode modes, avg duration.
// Agent: READS files video rows; TOLERATES missing hls_* columns by returning zeros on query error.
async fn build_hls_video_metrics(pool: &sqlx::PgPool) -> Result<AdminHlsVideoMetrics, AppError> {
    let counts: Result<(i64, i64, i64, i64, Option<f64>), sqlx::Error> = sqlx::query_as(
        "SELECT \
            COUNT(*) FILTER (WHERE hls_ready)::BIGINT, \
            COUNT(*) FILTER (WHERE NOT hls_ready AND COALESCE(hls_encode_status, '') \
                IN ('queued', 'processing', 'reprocessing'))::BIGINT, \
            COUNT(*) FILTER (WHERE COALESCE(hls_encode_status, '') = 'failed')::BIGINT, \
            COUNT(*) FILTER (WHERE COALESCE(hls_source_master, false))::BIGINT, \
            AVG(hls_last_encode_ms) FILTER (WHERE hls_last_encode_ms IS NOT NULL AND hls_last_encode_ms > 0) \
         FROM files \
         WHERE deleted_at IS NULL AND mime_type LIKE 'video/%'",
    )
    .fetch_one(pool)
    .await;

    let (ready_count, processing_count, failed_count, source_master_count, avg_ms) = match counts {
        Ok(row) => row,
        Err(error) => {
            tracing::warn!(%error, "HLS video metrics query failed; returning zeros");
            return Ok(AdminHlsVideoMetrics {
                ready_count: 0,
                processing_count: 0,
                failed_count: 0,
                source_master_count: 0,
                avg_encode_ms: None,
                encode_mode_counts: vec![],
            });
        }
    };

    let mode_rows: Vec<(Option<String>, i64)> = sqlx::query_as(
        "SELECT hls_encode_mode, COUNT(*)::BIGINT \
         FROM files \
         WHERE deleted_at IS NULL AND mime_type LIKE 'video/%' AND hls_encode_mode IS NOT NULL \
         GROUP BY hls_encode_mode \
         ORDER BY COUNT(*) DESC",
    )
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    let encode_mode_counts = mode_rows
        .into_iter()
        .filter_map(|(mode, count)| {
            mode.map(|m| AdminHlsEncodeModeCount {
                mode: m,
                count,
            })
        })
        .collect();

    Ok(AdminHlsVideoMetrics {
        ready_count,
        processing_count,
        failed_count,
        source_master_count,
        avg_encode_ms: avg_ms.map(|v| v.round() as i64),
        encode_mode_counts,
    })
}


#[derive(Debug, Serialize)]
pub struct AdminStorageNodeRow {
    pub id: String,
    pub region_label: String,
    pub base_url: String,
    pub endpoint_host: String,
    pub status: String,
    pub used_bytes: i64,
    pub capacity_label: String,
    pub target_capacity_bytes: Option<i64>,
    pub latency_ms: Option<u128>,
    pub storage_mode: String,
}

#[derive(Debug, Serialize)]
pub struct AdminStorageMetrics {
    pub used_bytes: i64,
    pub capacity_bytes: Option<i64>,
    pub active_nodes: i64,
    pub total_nodes: i64,
    pub avg_latency_ms: Option<u128>,
}

#[derive(Debug, Serialize)]
pub struct AdminStorageResponse {
    /// Human: `nebular` (index in Nebular) or `ownly` (index in Postgres, blobs only in Nebular).
    pub metadata_mode: String,
    pub metrics: AdminStorageMetrics,
    pub nodes: Vec<AdminStorageNodeRow>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AdminNotificationRules {
    pub storage_offline: bool,
    pub audit_violations: bool,
    pub quota_alerts: bool,
}

#[derive(Debug, Serialize)]
pub struct AdminSmtpSettings {
    pub host: String,
    pub port: String,
    pub from_address: String,
    pub security: String,
    pub username: String,
    pub password_set: bool,
}

#[derive(Debug, Serialize)]
pub struct AdminSettingsResponse {
    pub instance_name: String,
    pub console_url: String,
    pub allow_public_registration: bool,
    pub require_account_activation: bool,
    pub default_storage_quota_gb: u32,
    pub maintenance_mode: bool,
    pub default_onboarding_role: String,
    pub enforce_mfa_on_admin_login: bool,
    /// Human: When enabled, idle ownly_gif_preview_* ffmpeg scratch dirs are purged automatically.
    pub gif_preview_temp_auto_cleanup: bool,
    /// Human: Maximum rows one audit CSV export may produce; 0 means unlimited.
    pub audit_export_max_rows: i64,
    pub smtp: AdminSmtpSettings,
    pub notification_rules: AdminNotificationRules,
}

#[derive(Debug, Deserialize)]
pub struct AdminSettingsPatch {
    pub instance_name: Option<String>,
    pub console_url: Option<String>,
    pub allow_public_registration: Option<bool>,
    pub require_account_activation: Option<bool>,
    pub default_storage_quota_gb: Option<u32>,
    pub maintenance_mode: Option<bool>,
    pub default_onboarding_role: Option<String>,
    pub enforce_mfa_on_admin_login: Option<bool>,
    pub smtp_host: Option<String>,
    pub smtp_port: Option<String>,
    pub smtp_from: Option<String>,
    pub smtp_security: Option<String>,
    pub smtp_username: Option<String>,
    pub smtp_password: Option<String>,
    pub notification_storage_offline: Option<bool>,
    pub notification_audit_violations: Option<bool>,
    pub notification_quota_alerts: Option<bool>,
    pub gif_preview_temp_auto_cleanup: Option<bool>,
    /// Human: 0 selects unlimited; there is deliberately no upper bound.
    pub audit_export_max_rows: Option<i64>,
}

#[derive(Debug, Serialize)]
pub struct CleanupGifPreviewTempResponse {
    pub temp_dirs_removed: u32,
    pub storage_objects_removed: u32,
}

fn notification_rules_from_json(raw: Option<String>) -> AdminNotificationRules {
    raw.and_then(|v| serde_json::from_str(&v).ok()).unwrap_or(AdminNotificationRules {
        storage_offline: true,
        audit_violations: true,
        quota_alerts: false,
    })
}

// Human: Build settings JSON from app_settings — shared by GET and PATCH handlers.
// Agent: READS app_settings keys; RETURNS AdminSettingsResponse; no HTTP.
async fn load_settings_response(state: &AppState) -> Result<AdminSettingsResponse, AppError> {
    let instance_name = read_setting(&state.pool, "instance_name")
        .await
        .unwrap_or_else(|| "Ownly".into());
    let console_url = read_setting(&state.pool, "object_storage_public_url")
        .await
        .unwrap_or_else(|| state.object_storage_public_url.clone());
    let allow_public_registration =
        parse_bool_setting(read_setting(&state.pool, "allow_public_registration").await, false);
    let require_account_activation =
        parse_bool_setting(read_setting(&state.pool, "require_account_activation").await, false);
    let maintenance_mode =
        parse_bool_setting(read_setting(&state.pool, "maintenance_mode").await, false);
    let enforce_mfa_on_admin_login = parse_bool_setting(
        read_setting(&state.pool, "enforce_mfa_on_admin_login").await,
        false,
    );
    let default_onboarding_role = read_setting(&state.pool, "default_onboarding_role")
        .await
        .unwrap_or_else(|| "standard".into());
    let default_storage_quota_gb = read_setting(&state.pool, "default_storage_quota_gb")
        .await
        .and_then(|v| v.parse().ok())
        .unwrap_or(50)
        .max(1);
    let gif_preview_temp_auto_cleanup = parse_bool_setting(
        read_setting(&state.pool, GIF_PREVIEW_TEMP_AUTO_CLEANUP_KEY).await,
        true,
    );
    let audit_export_max_rows = crate::admin::audit_logs::export_max_rows(&state.pool).await;

    let smtp_password_set = AppSettingsSecretStore::secret_is_set(
        read_setting(&state.pool, "smtp_password").await.as_deref(),
    );

    Ok(AdminSettingsResponse {
        instance_name,
        console_url,
        allow_public_registration,
        require_account_activation,
        default_storage_quota_gb,
        maintenance_mode,
        default_onboarding_role,
        enforce_mfa_on_admin_login,
        gif_preview_temp_auto_cleanup,
        audit_export_max_rows,
        smtp: AdminSmtpSettings {
            host: read_setting(&state.pool, "smtp_host")
                .await
                .unwrap_or_default(),
            port: read_setting(&state.pool, "smtp_port")
                .await
                .unwrap_or_else(|| "587".into()),
            from_address: read_setting(&state.pool, "smtp_from")
                .await
                .unwrap_or_default(),
            security: read_setting(&state.pool, "smtp_security")
                .await
                .unwrap_or_else(|| "STARTTLS".into()),
            username: read_setting(&state.pool, "smtp_username")
                .await
                .unwrap_or_default(),
            password_set: smtp_password_set,
        },
        notification_rules: notification_rules_from_json(
            read_setting(&state.pool, "admin_notification_rules").await,
        ),
    })
}

// Human: Load editable instance settings for the System Settings panel.
// Agent: GET /api/v1/admin/settings; READS app_settings; AUDIT exempt.
pub async fn get_settings(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<AdminSettingsResponse>, AppError> {
    require_instance_permission(&state.pool, &claims, Permission::InstanceSettingsRead).await?;
    Ok(Json(load_settings_response(&state).await?))
}

// Human: Persist instance settings changed from the admin System Settings panel.
// Agent: PATCH /api/v1/admin/settings; WRITES app_settings; AUDIT admin.settings.update.
pub async fn patch_settings(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    headers: HeaderMap,
    Json(body): Json<AdminSettingsPatch>,
) -> Result<Json<AdminSettingsResponse>, AppError> {
    require_instance_permission(&state.pool, &claims, Permission::InstanceSettingsManage).await?;

    if let Some(name) = body.instance_name.as_ref() {
        let trimmed = name.trim();
        if trimmed.is_empty() {
            return Err(AppError::BadRequest("instance name cannot be empty".into()));
        }
        let previous = read_setting(&state.pool, "instance_name").await;
        upsert_setting(&state.pool, "instance_name", trimmed).await?;
        // Human: Storage nodes seeded at setup use the instance name as their region label.
        // Agent: WRITES storage_nodes.region_label when the old label matched the previous instance name.
        if let Some(old) = previous {
            let old_trimmed = old.trim();
            if !old_trimmed.is_empty() && old_trimmed != trimmed {
                sqlx::query("UPDATE storage_nodes SET region_label = $1 WHERE region_label = $2")
                    .bind(trimmed)
                    .bind(old_trimmed)
                    .execute(&state.pool)
                    .await?;
            }
        }
    }
    if let Some(url) = body.console_url.as_ref() {
        upsert_setting(&state.pool, "object_storage_public_url", url.trim()).await?;
    }
    if let Some(v) = body.allow_public_registration {
        upsert_setting(
            &state.pool,
            "allow_public_registration",
            if v { "true" } else { "false" },
        )
        .await?;
    }
    if let Some(v) = body.require_account_activation {
        upsert_setting(
            &state.pool,
            "require_account_activation",
            if v { "true" } else { "false" },
        )
        .await?;
    }
    if let Some(gb) = body.default_storage_quota_gb {
        let gb = gb.max(1);
        upsert_setting(&state.pool, "default_storage_quota_gb", &gb.to_string()).await?;
    }
    if let Some(v) = body.maintenance_mode {
        upsert_setting(&state.pool, "maintenance_mode", if v { "true" } else { "false" }).await?;
    }
    if let Some(role) = body.default_onboarding_role.as_ref() {
        upsert_setting(&state.pool, "default_onboarding_role", role.trim()).await?;
    }
    if let Some(v) = body.enforce_mfa_on_admin_login {
        upsert_setting(
            &state.pool,
            "enforce_mfa_on_admin_login",
            if v { "true" } else { "false" },
        )
        .await?;
    }
    if let Some(v) = body.gif_preview_temp_auto_cleanup {
        upsert_setting(
            &state.pool,
            GIF_PREVIEW_TEMP_AUTO_CLEANUP_KEY,
            if v { "true" } else { "false" },
        )
        .await?;
    }
    if let Some(v) = body.audit_export_max_rows {
        // Human: 0 means unlimited; negatives are meaningless and would silently disable exports.
        if v < 0 {
            return Err(AppError::BadRequest(
                "audit export row limit cannot be negative (use 0 for unlimited)".into(),
            ));
        }
        upsert_setting(
            &state.pool,
            crate::admin::audit_logs::AUDIT_EXPORT_MAX_ROWS_KEY,
            &v.to_string(),
        )
        .await?;
    }
    if let Some(v) = body.smtp_host.as_ref() {
        upsert_setting(&state.pool, "smtp_host", v.trim()).await?;
    }
    if let Some(v) = body.smtp_port.as_ref() {
        upsert_setting(&state.pool, "smtp_port", v.trim()).await?;
    }
    if let Some(v) = body.smtp_from.as_ref() {
        upsert_setting(&state.pool, "smtp_from", v.trim()).await?;
    }
    if let Some(v) = body.smtp_security.as_ref() {
        upsert_setting(&state.pool, "smtp_security", v.trim()).await?;
    }
    if let Some(v) = body.smtp_username.as_ref() {
        upsert_setting(&state.pool, "smtp_username", v.trim()).await?;
    }
    if let Some(v) = body.smtp_password.as_ref() {
        if !v.is_empty() {
            let store = AppSettingsSecretStore::new(&state.signing_secret);
            let encrypted = store.encrypt(v)?;
            upsert_setting(&state.pool, "smtp_password", &encrypted).await?;
        }
    }

    let mut rules = notification_rules_from_json(
        read_setting(&state.pool, "admin_notification_rules").await,
    );
    let mut rules_changed = false;
    if let Some(v) = body.notification_storage_offline {
        rules.storage_offline = v;
        rules_changed = true;
    }
    if let Some(v) = body.notification_audit_violations {
        rules.audit_violations = v;
        rules_changed = true;
    }
    if let Some(v) = body.notification_quota_alerts {
        rules.quota_alerts = v;
        rules_changed = true;
    }
    if rules_changed {
        let json = serde_json::to_string(&rules).map_err(|e| AppError::Internal(e.into()))?;
        upsert_setting(&state.pool, "admin_notification_rules", &json).await?;
    }

    audit::write_audit_logged(
        &state.pool,
        Some(&claims.sub),
        "admin.settings.update",
        Some("instance"),
        Some(&claims.sub),
        None,
        &headers,
    )
    .await;

    Ok(Json(load_settings_response(&state).await?))
}

// Human: Admin command — purge iOS GIF replay scratch dirs and cached MP4 sidecars immediately.
// Agent: POST /api/v1/admin/maintenance/cleanup-gif-preview-temp; AUDIT admin.gif_preview_temp.cleanup.
pub async fn cleanup_gif_preview_temp(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    headers: HeaderMap,
) -> Result<Json<CleanupGifPreviewTempResponse>, AppError> {
    require_instance_permission(&state.pool, &claims, Permission::InstanceAdmin).await?;

    let temp_dirs_removed =
        temp_cleanup::sweep_gif_preview_temp_files(Some(state.gif_preview_transcode_locks.as_ref()))
            .await;
    let storage_objects_removed =
        gif_preview::purge_all_cached_preview_sidecars(&state.pool, state.storage.clone())
            .await?;

    audit::write_audit_logged(
        &state.pool,
        Some(&claims.sub),
        "admin.gif_preview_temp.cleanup",
        Some("instance"),
        Some(&claims.sub),
        Some(serde_json::json!({
            "temp_dirs_removed": temp_dirs_removed,
            "storage_objects_removed": storage_objects_removed,
        })),
        &headers,
    )
    .await;

    Ok(Json(CleanupGifPreviewTempResponse {
        temp_dirs_removed,
        storage_objects_removed,
    }))
}

#[derive(Debug, Serialize)]
pub struct AdminSecurityPolicyRow {
    pub label: String,
    pub enabled: bool,
}

#[derive(Debug, Serialize)]
pub struct AdminKeyRotationRow {
    pub title: String,
    pub initiator: String,
    pub status: String,
    pub date: String,
}

#[derive(Debug, Serialize)]
pub struct AdminEncryptionProfile {
    pub symmetric_cipher: String,
    pub key_wrapping: String,
    pub key_exchange: String,
    pub streaming_segment_cipher: String,
    pub password_kdf: String,
    pub quantum_posture: String,
}

#[derive(Debug, Serialize)]
pub struct AdminSecurityOverviewResponse {
    pub encryption_standard: String,
    pub encryption: AdminEncryptionProfile,
    pub kms_nodes_active: i64,
    pub kms_nodes_total: i64,
    pub storage_status: String,
    pub policies: Vec<AdminSecurityPolicyRow>,
    pub rotation_history: Vec<AdminKeyRotationRow>,
}

// Human: Security policies and key rotation history derived from settings and audit logs.
// Agent: GET /api/v1/admin/security; READS app_settings + audit_logs; AUDIT exempt.
pub async fn security_overview(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<AdminSecurityOverviewResponse>, AppError> {
    require_instance_permission(&state.pool, &claims, Permission::InstanceSettingsRead).await?;

    let settings = load_settings_response(&state).await?;

    let (healthy, _) = object_storage_healthy(&state).await;
    let rotation_rows: Vec<(String, Option<String>, DateTime<Utc>)> = sqlx::query_as(
        "SELECT action, ip, created_at FROM audit_logs \
         WHERE action LIKE 'admin.%' OR action = 'setup.complete' \
         ORDER BY created_at DESC LIMIT 10",
    )
    .fetch_all(&state.pool)
    .await?;

    let rotation_history: Vec<AdminKeyRotationRow> = rotation_rows
        .into_iter()
        .map(|(action, ip, created_at)| AdminKeyRotationRow {
            title: audit_catalog::label_of(&action, None, None),
            initiator: format!(
                "Initiator: {}",
                ip.unwrap_or_else(|| "system".into())
            ),
            status: "Recorded in audit ledger".into(),
            date: created_at.format("%b %d, %Y").to_string(),
        })
        .collect();

    Ok(Json(AdminSecurityOverviewResponse {
        encryption_standard: crypto::ENCRYPTION_SUMMARY.into(),
        encryption: AdminEncryptionProfile {
            symmetric_cipher: crypto::SYMMETRIC_CIPHER.into(),
            key_wrapping: crypto::KEY_WRAPPING.into(),
            key_exchange: crypto::KEY_EXCHANGE.into(),
            streaming_segment_cipher: crypto::STREAMING_SEGMENT_CIPHER.into(),
            password_kdf: crypto::PASSWORD_KDF.into(),
            quantum_posture: crypto::QUANTUM_POSTURE.into(),
        },
        kms_nodes_active: if state.storage_configured && healthy {
            1
        } else {
            0
        },
        kms_nodes_total: if state.storage_configured { 1 } else { 0 },
        storage_status: if healthy || !state.storage_configured {
            "healthy"
        } else {
            "degraded"
        }
        .into(),
        policies: vec![
            AdminSecurityPolicyRow {
                label: "Require account activation before first sign-in".into(),
                enabled: settings.require_account_activation,
            },
            AdminSecurityPolicyRow {
                label: "Allow public self-service registration".into(),
                enabled: settings.allow_public_registration,
            },
            AdminSecurityPolicyRow {
                label: "Enforce MFA prompt for administrators (stored preference)".into(),
                enabled: settings.enforce_mfa_on_admin_login,
            },
        ],
        rotation_history,
    }))
}

// Human: Live + DB view of resumable upload health for the admin console.
// Agent: GET /api/v1/admin/uploads/health; READS process counters + active session counts.
#[derive(Debug, Serialize)]
pub struct AdminUploadHealthResponse {
    pub process_metrics: crate::uploads::metrics::UploadMetricsSnapshot,
    pub active_sessions: i64,
    pub reserved_bytes: i64,
    pub signed_url_rate_limit: crate::rate_limit::RateLimitSnapshot,
}

pub async fn upload_health(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<AdminUploadHealthResponse>, AppError> {
    require_instance_permission(&state.pool, &claims, Permission::InstanceSettingsRead).await?;

    let active_sessions = crate::uploads::store::count_active_sessions(&state.pool).await?;
    let reserved_bytes = crate::uploads::store::sum_active_reserved_bytes(&state.pool).await?;
    let signed_url_rate_limit =
        crate::rate_limit::snapshot(&state.upload_signed_url_rl, &claims.sub)?;

    Ok(Json(AdminUploadHealthResponse {
        process_metrics: state.upload_metrics.snapshot(),
        active_sessions,
        reserved_bytes,
        signed_url_rate_limit,
    }))
}
