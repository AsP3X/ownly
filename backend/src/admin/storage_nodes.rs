// Human: Storage Nodes Network registry — DB-backed node list probed against Nebular /health + /metrics.
// Agent: READS storage_nodes; WRITES on POST /admin/storage/nodes; AUDIT storage_nodes.create.

use std::sync::Arc;
use std::time::Instant;

use axum::{
    extract::State,
    http::HeaderMap,
    Extension, Json,
};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;

use crate::{
    admin::handlers::require_admin,
    audit,
    auth::Claims,
    error::AppError,
    storage::nebular_cluster,
    AppState,
};

use super::console::{read_setting, AdminStorageMetrics, AdminStorageNodeRow, AdminStorageResponse};

#[derive(Debug, sqlx::FromRow)]
struct StorageNodeRecord {
    id: String,
    region_label: String,
    base_url: String,
    architecture: String,
    target_capacity_bytes: Option<i64>,
}

#[derive(Debug, Deserialize)]
struct NosHealthBody {
    status: String,
    #[serde(default)]
    node_id: String,
    #[serde(default)]
    cluster_mode: String,
    region_label: Option<String>,
    #[serde(default)]
    replication_lag_events: u64,
}

#[derive(Debug, Deserialize)]
struct NosMetricsBody {
    #[serde(default)]
    logical_bytes: i64,
}

#[derive(Debug)]
struct NodeProbe {
    reachable: bool,
    latency_ms: Option<u128>,
    health: Option<NosHealthBody>,
    logical_bytes: i64,
}

const ALLOWED_ARCHITECTURES: &[&str] = &["replicated", "single", "assigned"];

// Human: Map legacy storage_mode env values to a registry architecture label.
fn architecture_from_storage_mode(mode: &str) -> &'static str {
    match mode.trim().to_lowercase().as_str() {
        "replicated" => "replicated",
        "assigned" => "assigned",
        "single" => "single",
        _ => "single",
    }
}

// Human: Normalize and validate node id from setup wizard and Add Storage Node form.
pub fn normalize_node_id(raw: &str) -> Result<String, AppError> {
    let id = raw.trim();
    if id.is_empty() {
        return Err(AppError::BadRequest("node id is required".into()));
    }
    if id.len() > 64 {
        return Err(AppError::BadRequest("node id is too long".into()));
    }
    if !id
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err(AppError::BadRequest(
            "node id may only contain letters, numbers, hyphens, and underscores".into(),
        ));
    }
    Ok(id.to_string())
}

// Human: Require http(s) base URL without trailing slash noise.
pub fn normalize_base_url(raw: &str) -> Result<String, AppError> {
    let url = raw.trim();
    if url.is_empty() {
        return Err(AppError::BadRequest("storage endpoint URL is required".into()));
    }
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err(AppError::BadRequest(
            "storage endpoint URL must start with http:// or https://".into(),
        ));
    }
    Ok(url.trim_end_matches('/').to_string())
}

// Human: Host portion for table IP column — strips scheme and path.
fn endpoint_host_from_url(base_url: &str) -> String {
    base_url
        .trim_start_matches("http://")
        .trim_start_matches("https://")
        .split('/')
        .next()
        .unwrap_or(base_url)
        .to_string()
}

#[derive(Debug, Serialize)]
pub struct StorageEndpointProbe {
    pub reachable: bool,
    pub latency_ms: Option<u128>,
    pub node_id: Option<String>,
    pub status: Option<String>,
    pub region_label: Option<String>,
}

// Human: Live health probe for setup wizard and admin node registration tests.
// Agent: HTTP GET /health; RETURNS latency + node metadata; NO DB writes.
pub async fn probe_storage_endpoint(base_url: &str) -> StorageEndpointProbe {
    let probe = probe_storage_node(base_url).await;
    StorageEndpointProbe {
        reachable: probe.reachable,
        latency_ms: probe.latency_ms,
        node_id: probe
            .health
            .as_ref()
            .map(|h| h.node_id.clone())
            .filter(|id| !id.is_empty()),
        status: probe.health.as_ref().map(|h| h.status.clone()),
        region_label: probe
            .health
            .as_ref()
            .and_then(|h| h.region_label.clone())
            .filter(|r| !r.is_empty()),
    }
}

// Human: Register the first storage node during setup — replaces env-only bootstrap.
// Agent: WRITES storage_nodes row; CALLED once from setup handler when table is empty.
pub async fn register_setup_storage_node(
    pool: &PgPool,
    id: &str,
    region_label: &str,
    base_url: &str,
    architecture: &str,
    target_capacity_bytes: Option<i64>,
) -> Result<(), AppError> {
    let id = normalize_node_id(id)?;
    let base_url = normalize_base_url(base_url)?;
    let architecture = architecture.trim().to_lowercase();
    if !ALLOWED_ARCHITECTURES.contains(&architecture.as_str()) {
        return Err(AppError::BadRequest(
            "architecture must be replicated, single, or assigned".into(),
        ));
    }

    sqlx::query(
        "INSERT INTO storage_nodes (id, region_label, base_url, architecture, target_capacity_bytes) \
         VALUES ($1, $2, $3, $4, $5)",
    )
    .bind(&id)
    .bind(region_label.trim())
    .bind(&base_url)
    .bind(&architecture)
    .bind(target_capacity_bytes)
    .execute(pool)
    .await?;

    Ok(())
}

// Human: After registry changes, push topology to every Nebular node via PUT /_cluster/config.
// Agent: CALLS nebular_cluster::sync_storage_cluster; SKIPPED in integration tests (relax_sync).
pub async fn sync_cluster_after_registry_change(
    state: &AppState,
) -> Result<(), AppError> {
    nebular_cluster::sync_storage_cluster(
        &state.pool,
        state.nos_cluster_bootstrap_token.as_deref(),
        state.setup_relaxes_storage_probe,
    )
    .await
}

// Human: Probe Nebular /health and JSON /metrics for one registered node.
async fn probe_storage_node(base_url: &str) -> NodeProbe {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());

    let health_url = format!("{}/health", base_url.trim_end_matches('/'));
    let started = Instant::now();
    let health_resp = client.get(&health_url).send().await;
    let latency_ms = started.elapsed().as_millis();

    let (reachable, health) = match health_resp {
        Ok(resp) if resp.status().is_success() => {
            let parsed = resp.json::<NosHealthBody>().await.ok();
            (parsed.is_some(), parsed)
        }
        _ => (false, None),
    };

    let metrics_url = format!("{}/metrics", base_url.trim_end_matches('/'));
    let logical_bytes = match client
        .get(&metrics_url)
        .header("accept", "application/json")
        .send()
        .await
    {
        Ok(resp) if resp.status().is_success() => resp
            .json::<NosMetricsBody>()
            .await
            .map(|m| m.logical_bytes.max(0))
            .unwrap_or(0),
        _ => 0,
    };

    NodeProbe {
        reachable,
        latency_ms: if reachable { Some(latency_ms) } else { None },
        health,
        logical_bytes,
    }
}

// Human: Map probe results to Pencil status labels (healthy / syncing / degraded).
fn node_status(probe: &NodeProbe) -> String {
    if !probe.reachable {
        return "degraded".into();
    }
    let Some(health) = &probe.health else {
        return "degraded".into();
    };
    if health.status != "ok" {
        return "degraded".into();
    }
    if health.replication_lag_events > 0 {
        return "syncing".into();
    }
    "healthy".into()
}

// Human: Display string for used vs target capacity on a node row.
fn format_capacity_amount(bytes: i64) -> String {
    let b = bytes.max(0) as f64;
    const TB: f64 = 1024.0 * 1024.0 * 1024.0 * 1024.0;
    const GB: f64 = 1024.0 * 1024.0 * 1024.0;
    const MB: f64 = 1024.0 * 1024.0;
    if b >= TB {
        format!("{:.1} TB", b / TB)
    } else if b >= GB {
        format!("{:.1} GB", b / GB)
    } else {
        format!("{:.1} MB", b / MB.max(1.0))
    }
}

fn capacity_label(used_bytes: i64, target_capacity_bytes: Option<i64>) -> String {
    match target_capacity_bytes {
        Some(cap) if cap > 0 => format!(
            "{} / {}",
            format_capacity_amount(used_bytes),
            format_capacity_amount(cap)
        ),
        _ => format_capacity_amount(used_bytes),
    }
}

// Human: Convert admin-entered capacity + unit into bytes for storage_nodes.target_capacity_bytes.
pub fn parse_target_capacity_bytes(value: f64, unit: &str) -> Result<i64, AppError> {
    if !value.is_finite() || value <= 0.0 {
        return Err(AppError::BadRequest(
            "target capacity must be a positive number".into(),
        ));
    }
    let multiplier = match unit.trim().to_ascii_uppercase().as_str() {
        "MB" => 1024.0 * 1024.0,
        "GB" => 1024.0 * 1024.0 * 1024.0,
        "TB" => 1024.0 * 1024.0 * 1024.0 * 1024.0,
        _ => {
            return Err(AppError::BadRequest(
                "target capacity unit must be MB, GB, or TB".into(),
            ));
        }
    };
    Ok((value * multiplier).round() as i64)
}

// Human: Insert the primary object-storage endpoint when the registry is empty after setup.
pub async fn bootstrap_primary_if_empty(
    pool: &PgPool,
    base_url: &str,
    region_label: &str,
    architecture: &str,
) -> Result<(), AppError> {
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*)::BIGINT FROM storage_nodes")
        .fetch_one(pool)
        .await?;
    if count > 0 {
        return Ok(());
    }

    sqlx::query(
        "INSERT INTO storage_nodes (id, region_label, base_url, architecture) \
         VALUES ($1, $2, $3, $4) \
         ON CONFLICT (id) DO NOTHING",
    )
    .bind("node-primary")
    .bind(region_label)
    .bind(base_url.trim_end_matches('/'))
    .bind(architecture_from_storage_mode(architecture))
    .execute(pool)
    .await?;

    Ok(())
}

// Human: Build admin panel response from DB rows + live probes.
async fn build_storage_response(state: &AppState) -> Result<AdminStorageResponse, AppError> {
    if state.storage_configured {
        let region = read_setting(&state.pool, "instance_name")
            .await
            .unwrap_or_else(|| "Primary".into());
        bootstrap_primary_if_empty(
            &state.pool,
            &state.object_storage_url,
            &region,
            &state.storage_mode,
        )
        .await?;
    }

    let records: Vec<StorageNodeRecord> = sqlx::query_as(
        "SELECT id, region_label, base_url, architecture, target_capacity_bytes \
         FROM storage_nodes \
         WHERE enabled = true \
         ORDER BY created_at ASC",
    )
    .fetch_all(&state.pool)
    .await?;

    let used_bytes: (i64,) = sqlx::query_as(
        "SELECT COALESCE(SUM(size_bytes), 0)::BIGINT FROM files WHERE deleted_at IS NULL",
    )
    .fetch_one(&state.pool)
    .await?;

    let quota_gb = read_setting(&state.pool, "default_storage_quota_gb")
        .await
        .and_then(|v| v.parse::<i64>().ok())
        .unwrap_or(50)
        .max(1);
    let user_count: (i64,) = sqlx::query_as("SELECT COUNT(*)::BIGINT FROM users")
        .fetch_one(&state.pool)
        .await?;
    let network_capacity_bytes = quota_gb
        .saturating_mul(user_count.0.max(1))
        .saturating_mul(1024 * 1024 * 1024);

    let mut nodes = Vec::with_capacity(records.len());
    let mut active_nodes = 0_i64;
    let mut latency_sum = 0_u128;
    let mut latency_count = 0_u64;
    let mut probed_used_bytes = 0_i64;

    for record in records {
        let probe = probe_storage_node(&record.base_url).await;
        let status = node_status(&probe);
        if status == "healthy" || status == "syncing" {
            active_nodes += 1;
        }
        if let Some(ms) = probe.latency_ms {
            latency_sum += ms;
            latency_count += 1;
        }
        probed_used_bytes += probe.logical_bytes;

        // Human: Registry id/region come from setup or Add Storage Node — not Nebular env defaults.
        // Agent: Probe READS /health for status/latency/bytes only; WRITES nothing; no id/region override.
        let storage_mode = probe
            .health
            .as_ref()
            .map(|h| {
                if h.cluster_mode.is_empty() {
                    record.architecture.clone()
                } else {
                    h.cluster_mode.clone()
                }
            })
            .unwrap_or_else(|| record.architecture.clone());

        nodes.push(AdminStorageNodeRow {
            id: record.id.clone(),
            region_label: record.region_label.clone(),
            endpoint_host: endpoint_host_from_url(&record.base_url),
            status,
            used_bytes: probe.logical_bytes,
            capacity_label: capacity_label(probe.logical_bytes, record.target_capacity_bytes),
            latency_ms: probe.latency_ms,
            storage_mode,
        });
    }

    let avg_latency_ms = if latency_count > 0 {
        Some(latency_sum / latency_count as u128)
    } else {
        None
    };

    Ok(AdminStorageResponse {
        metrics: AdminStorageMetrics {
            used_bytes: if probed_used_bytes > 0 {
                probed_used_bytes
            } else {
                used_bytes.0
            },
            capacity_bytes: Some(network_capacity_bytes),
            active_nodes,
            total_nodes: nodes.len() as i64,
            avg_latency_ms,
        },
        nodes,
    })
}

// Human: GET /admin/storage — list registered nodes with live health metrics.
pub async fn list_storage_nodes(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<AdminStorageResponse>, AppError> {
    require_admin(&claims)?;
    Ok(Json(build_storage_response(&state).await?))
}

#[derive(Debug, Deserialize)]
pub struct CreateStorageNodeRequest {
    pub id: String,
    pub region_label: String,
    pub base_url: String,
    pub architecture: String,
    pub target_capacity_value: Option<f64>,
    pub target_capacity_unit: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct CreateStorageNodeResponse {
    pub node: AdminStorageNodeRow,
}

// Human: POST /admin/storage/nodes — register a node for the Storage Nodes Network panel.
pub async fn create_storage_node(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    headers: HeaderMap,
    Json(body): Json<CreateStorageNodeRequest>,
) -> Result<Json<CreateStorageNodeResponse>, AppError> {
    require_admin(&claims)?;

    let id = normalize_node_id(&body.id)?;
    let base_url = normalize_base_url(&body.base_url)?;
    let architecture = body.architecture.trim().to_lowercase();
    if !ALLOWED_ARCHITECTURES.contains(&architecture.as_str()) {
        return Err(AppError::BadRequest(
            "architecture must be replicated, single, or assigned".into(),
        ));
    }

    let target_capacity_bytes = match (body.target_capacity_value, body.target_capacity_unit.as_deref()) {
        (Some(value), Some(unit)) => Some(parse_target_capacity_bytes(value, unit)?),
        (None, None) => None,
        _ => {
            return Err(AppError::BadRequest(
                "target capacity requires both value and unit (MB, GB, or TB)".into(),
            ));
        }
    };

    let exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM storage_nodes WHERE id = $1)")
        .bind(&id)
        .fetch_one(&state.pool)
        .await?;
    if exists {
        return Err(AppError::Conflict("a storage node with this id already exists".into()));
    }

    let url_taken: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM storage_nodes WHERE base_url = $1)")
            .bind(&base_url)
            .fetch_one(&state.pool)
            .await?;
    if url_taken {
        return Err(AppError::Conflict(
            "a storage node with this endpoint URL already exists".into(),
        ));
    }

    sqlx::query(
        "INSERT INTO storage_nodes (id, region_label, base_url, architecture, target_capacity_bytes) \
         VALUES ($1, $2, $3, $4, $5)",
    )
    .bind(&id)
    .bind(body.region_label.trim())
    .bind(&base_url)
    .bind(&architecture)
    .bind(target_capacity_bytes)
    .execute(&state.pool)
    .await?;

    audit::write_audit(
        &state.pool,
        Some(&claims.sub),
        "storage_nodes.create",
        Some("storage_node"),
        Some(&id),
        Some(serde_json::json!({
            "region_label": body.region_label.trim(),
            "base_url": base_url,
            "architecture": architecture,
            "target_capacity_value": body.target_capacity_value,
            "target_capacity_unit": body.target_capacity_unit,
        })),
        &headers,
    )
    .await
    .ok();

    sync_cluster_after_registry_change(&state).await?;

    let response = build_storage_response(&state).await?;
    let node = response
        .nodes
        .into_iter()
        .find(|row| row.id == id || row.endpoint_host == endpoint_host_from_url(&base_url))
        .ok_or_else(|| AppError::Internal(anyhow::anyhow!("created storage node not found")))?;

    Ok(Json(CreateStorageNodeResponse { node }))
}

#[cfg(test)]
mod tests {
    use super::parse_target_capacity_bytes;
    use crate::error::AppError;

    #[test]
    fn parse_capacity_accepts_mb_gb_tb() {
        assert_eq!(parse_target_capacity_bytes(512.0, "MB").unwrap(), 536_870_912);
        assert_eq!(
            parse_target_capacity_bytes(12.0, "GB").unwrap(),
            12 * 1024 * 1024 * 1024
        );
        assert_eq!(
            parse_target_capacity_bytes(1.5, "TB").unwrap(),
            (1.5_f64 * 1024.0 * 1024.0 * 1024.0 * 1024.0).round() as i64
        );
    }

    #[test]
    fn parse_capacity_rejects_invalid_unit() {
        let err = parse_target_capacity_bytes(10.0, "PB").unwrap_err();
        assert!(matches!(err, AppError::BadRequest(_)));
    }
}
