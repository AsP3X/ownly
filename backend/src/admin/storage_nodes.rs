// Human: Storage Nodes Network registry — DB-backed node list probed against Nebular /health + /metrics.
// Agent: READS storage_nodes; WRITES on POST /admin/storage/nodes; AUDIT storage_nodes.create.

use std::sync::Arc;
use std::time::Instant;

use axum::{
    extract::{Path, Query, State},
    http::HeaderMap,
    Extension, Json,
};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;

use crate::{
    admin::handlers::require_instance_permission,
    audit,
    auth::Claims,
    authz::Permission,
    error::AppError,
    storage::nebula::NebulaStorage,
    AppState,
};

use super::console::{read_setting, AdminStorageMetrics, AdminStorageNodeRow, AdminStorageResponse};

const STORAGE_NODE_ARCHITECTURE: &str = "single";

#[derive(Debug, sqlx::FromRow)]
pub(crate) struct StorageNodeRecord {
    pub id: String,
    pub region_label: String,
    pub base_url: String,
    pub architecture: String,
    pub target_capacity_bytes: Option<i64>,
}

#[derive(Debug, Deserialize)]
struct NosHealthBody {
    status: String,
    #[serde(default)]
    node_id: String,
    region_label: Option<String>,
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
// Agent: HTTP GET /health/ready; RETURNS latency + node metadata; NO DB writes.
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
    target_capacity_bytes: Option<i64>,
) -> Result<(), AppError> {
    let id = normalize_node_id(id)?;
    let base_url = normalize_base_url(base_url)?;
    crate::outbound_target::validate_http_outbound_base_url(&base_url).await?;

    sqlx::query(
        "INSERT INTO storage_nodes (id, region_label, base_url, architecture, target_capacity_bytes) \
         VALUES ($1, $2, $3, $4, $5)",
    )
    .bind(&id)
    .bind(region_label.trim())
    .bind(&base_url)
    .bind(STORAGE_NODE_ARCHITECTURE)
    .bind(target_capacity_bytes)
    .execute(pool)
    .await?;

    Ok(())
}

// Human: Quick readiness probe — placement skips nodes that fail this check.
// Agent: READS GET /health/ready; RETURNS false on transport or non-success status.
pub(crate) async fn probe_reachable(base_url: &str) -> bool {
    let client = crate::outbound_target::outbound_probe_client();
    let health_url = format!("{}/health/ready", base_url.trim_end_matches('/'));
    match client.get(&health_url).send().await {
        Ok(resp) if resp.status().is_success() => resp.json::<NosHealthBody>().await.is_ok(),
        _ => false,
    }
}

// Human: Fetch logical_bytes from Nebular /metrics — used for capacity-aware placement.
// Agent: READS GET /metrics JSON; RETURNS 0 when unreachable.
pub(crate) async fn probe_logical_bytes(base_url: &str) -> i64 {
    let client = crate::outbound_target::outbound_probe_client();
    let metrics_url = format!("{}/metrics", base_url.trim_end_matches('/'));
    match client
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
    }
}

// Human: Probe Nebular readiness plus liveness metadata (/health/ready then /health).
// Agent: READS GET /health/ready for reachable; GET /health for node_id when ready; GET /metrics for bytes.
async fn probe_storage_node(base_url: &str) -> NodeProbe {
    let client = crate::outbound_target::outbound_probe_client();

    let ready_url = format!("{}/health/ready", base_url.trim_end_matches('/'));
    let started = Instant::now();
    let ready_resp = client.get(&ready_url).send().await;
    let latency_ms = started.elapsed().as_millis();

    let reachable = matches!(ready_resp, Ok(ref resp) if resp.status().is_success());

    let health = if reachable {
        let health_url = format!("{}/health", base_url.trim_end_matches('/'));
        match client.get(&health_url).send().await {
            Ok(resp) if resp.status().is_success() => resp.json::<NosHealthBody>().await.ok(),
            _ => None,
        }
    } else {
        None
    };

    let logical_bytes = probe_logical_bytes(base_url).await;

    NodeProbe {
        reachable,
        latency_ms: if reachable { Some(latency_ms) } else { None },
        health,
        logical_bytes,
    }
}

// Human: Map probe results to Pencil status labels (healthy / degraded).
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

// Human: Map one registry row + live probe into the admin API node shape.
// Agent: READS StorageNodeRecord + NodeProbe; RETURNS AdminStorageNodeRow for list/detail responses.
fn build_node_row(record: &StorageNodeRecord, probe: &NodeProbe) -> AdminStorageNodeRow {
    let status = node_status(probe);
    AdminStorageNodeRow {
        id: record.id.clone(),
        region_label: record.region_label.clone(),
        base_url: record.base_url.clone(),
        endpoint_host: endpoint_host_from_url(&record.base_url),
        status,
        used_bytes: probe.logical_bytes,
        capacity_label: capacity_label(probe.logical_bytes, record.target_capacity_bytes),
        target_capacity_bytes: record.target_capacity_bytes,
        latency_ms: probe.latency_ms,
        storage_mode: record.architecture.clone(),
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
    .bind(STORAGE_NODE_ARCHITECTURE)
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
        bootstrap_primary_if_empty(&state.pool, &state.object_storage_url, &region).await?;
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

    // Human: Network-wide capacity is the sum of each node's configured target capacity.
    // Agent: READS storage_nodes.target_capacity_bytes; SUM for metrics.capacity_bytes.
    let node_capacity_bytes: i64 = records
        .iter()
        .filter_map(|record| record.target_capacity_bytes)
        .sum();

    let mut nodes = Vec::with_capacity(records.len());
    let mut active_nodes = 0_i64;
    let mut latency_sum = 0_u128;
    let mut latency_count = 0_u64;
    let mut probed_used_bytes = 0_i64;

    for record in records {
        let probe = probe_storage_node(&record.base_url).await;
        if node_status(&probe) == "healthy" {
            active_nodes += 1;
        }
        if let Some(ms) = probe.latency_ms {
            latency_sum += ms;
            latency_count += 1;
        }
        probed_used_bytes += probe.logical_bytes;
        nodes.push(build_node_row(&record, &probe));
    }

    let avg_latency_ms = if latency_count > 0 {
        Some(latency_sum / latency_count as u128)
    } else {
        None
    };

    let metadata_mode = crate::storage::placement::read_metadata_mode(&state.pool).await;

    Ok(AdminStorageResponse {
        metadata_mode,
        metrics: AdminStorageMetrics {
            used_bytes: if probed_used_bytes > 0 {
                probed_used_bytes
            } else {
                used_bytes.0
            },
            capacity_bytes: if node_capacity_bytes > 0 {
                Some(node_capacity_bytes)
            } else {
                None
            },
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
    require_instance_permission(&state.pool, &claims, Permission::InstanceSettingsRead).await?;
    Ok(Json(build_storage_response(&state).await?))
}

#[derive(Debug, Deserialize)]
pub struct StorageNodeDetailQuery {
    pub prefix: Option<String>,
    pub start_after: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct MediaCategoryStat {
    pub category: String,
    pub label: String,
    pub file_count: i64,
    pub total_bytes: i64,
}

#[derive(Debug, Serialize)]
pub struct NodeBrowseEntry {
    pub name: String,
    pub kind: String,
    pub key: String,
    pub size_bytes: Option<i64>,
    pub mime_type: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct NodeBrowsePage {
    pub prefix: String,
    pub parent_prefix: Option<String>,
    pub entries: Vec<NodeBrowseEntry>,
    pub is_truncated: bool,
    pub next_start_after: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct AdminStorageNodeDetailResponse {
    pub node: AdminStorageNodeRow,
    pub media_breakdown: Vec<MediaCategoryStat>,
    pub indexed_files_total: i64,
    pub browse: Option<NodeBrowsePage>,
    pub browse_unavailable: Option<String>,
}

#[derive(Debug, sqlx::FromRow)]
struct MediaAggRow {
    category: String,
    file_count: i64,
    total_bytes: i64,
}

fn media_category_label(category: &str) -> &'static str {
    match category {
        "images" => "Images",
        "videos" => "Videos",
        "audio" => "Audio",
        "documents" => "Documents",
        "archives" => "Archives",
        _ => "Other",
    }
}

// Human: Aggregate Ownly-indexed files by coarse media type for the node detail panel.
// Agent: READS files.mime_type; GROUP BY category; RETURNS counts and byte totals.
async fn fetch_media_breakdown(pool: &PgPool) -> Result<(Vec<MediaCategoryStat>, i64), AppError> {
    let rows: Vec<MediaAggRow> = sqlx::query_as(
        "SELECT \
            CASE \
                WHEN mime_type ILIKE 'image/%' THEN 'images' \
                WHEN mime_type ILIKE 'video/%' THEN 'videos' \
                WHEN mime_type ILIKE 'audio/%' THEN 'audio' \
                WHEN mime_type ILIKE 'application/pdf' OR mime_type ILIKE '%/pdf' THEN 'documents' \
                WHEN mime_type ILIKE '%zip%' OR mime_type ILIKE '%compressed%' OR mime_type ILIKE '%archive%' THEN 'archives' \
                ELSE 'other' \
            END AS category, \
            COUNT(*)::BIGINT AS file_count, \
            COALESCE(SUM(size_bytes), 0)::BIGINT AS total_bytes \
         FROM files \
         WHERE deleted_at IS NULL \
         GROUP BY 1 \
         ORDER BY total_bytes DESC",
    )
    .fetch_all(pool)
    .await?;

    let indexed_files_total = rows.iter().map(|row| row.file_count).sum();
    let media_breakdown = rows
        .into_iter()
        .map(|row| MediaCategoryStat {
            label: media_category_label(&row.category).to_string(),
            category: row.category,
            file_count: row.file_count,
            total_bytes: row.total_bytes,
        })
        .collect();

    Ok((media_breakdown, indexed_files_total))
}

fn normalize_list_prefix(raw: Option<String>) -> String {
    let trimmed = raw.unwrap_or_default().trim().to_string();
    if trimmed.is_empty() {
        return String::new();
    }
    if trimmed.ends_with('/') {
        trimmed
    } else {
        format!("{trimmed}/")
    }
}

fn parent_list_prefix(prefix: &str) -> Option<String> {
    let trimmed = prefix.trim_end_matches('/');
    if trimmed.is_empty() {
        return None;
    }
    let parent = trimmed
        .rsplit_once('/')
        .map(|(head, _)| head)
        .unwrap_or("");
    if parent.is_empty() {
        Some(String::new())
    } else {
        Some(format!("{parent}/"))
    }
}

fn browse_entry_name(key: &str, prefix: &str) -> String {
    let rest = key.strip_prefix(prefix).unwrap_or(key);
    let segment = rest.split('/').next().unwrap_or(rest);
    segment.trim_end_matches('/').to_string()
}

// Human: Build explorer rows from one Nebular list page (folders via delimiter prefixes).
// Agent: READS ObjectListPage; RETURNS NodeBrowseEntry folder + file rows sorted by name.
fn build_browse_page(
    prefix: String,
    page: crate::storage::nebula::ObjectListPage,
) -> NodeBrowsePage {
    let mut entries = Vec::new();

    for folder_prefix in page.common_prefixes {
        let name = browse_entry_name(&folder_prefix, &prefix);
        if name.is_empty() {
            continue;
        }
        entries.push(NodeBrowseEntry {
            name: name.clone(),
            kind: "folder".into(),
            key: folder_prefix,
            size_bytes: None,
            mime_type: None,
        });
    }

    for item in page.items {
        if item.key.ends_with('/') {
            continue;
        }
        let name = browse_entry_name(&item.key, &prefix);
        if name.is_empty() {
            continue;
        }
        entries.push(NodeBrowseEntry {
            name,
            kind: "file".into(),
            key: item.key,
            size_bytes: Some(item.size.max(0)),
            mime_type: item.mime_type,
        });
    }

    entries.sort_by(|a, b| {
        let rank = |kind: &str| if kind == "folder" { 0 } else { 1 };
        rank(&a.kind)
            .cmp(&rank(&b.kind))
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    NodeBrowsePage {
        parent_prefix: parent_list_prefix(&prefix),
        prefix: prefix.clone(),
        entries,
        is_truncated: page.is_truncated,
        next_start_after: page.next_start_after,
    }
}

// Human: GET /admin/storage/nodes/{id}/detail — node health, media mix, and object browser page.
// Agent: READS storage_nodes + files aggregates; CALLS Nebular list on node base_url; REQUIRES admin.
pub async fn get_storage_node_detail(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(node_id): Path<String>,
    Query(query): Query<StorageNodeDetailQuery>,
) -> Result<Json<AdminStorageNodeDetailResponse>, AppError> {
    require_instance_permission(&state.pool, &claims, Permission::InstanceSettingsRead).await?;

    let id = normalize_node_id(&node_id)?;
    let record: StorageNodeRecord = sqlx::query_as(
        "SELECT id, region_label, base_url, architecture, target_capacity_bytes \
         FROM storage_nodes \
         WHERE enabled = true AND id = $1",
    )
    .bind(&id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or(AppError::NotFound)?;

    let probe = probe_storage_node(&record.base_url).await;
    let node = build_node_row(&record, &probe);
    let (media_breakdown, indexed_files_total) = fetch_media_breakdown(&state.pool).await?;

    let list_prefix = normalize_list_prefix(query.prefix);
    let (browse, browse_unavailable) = if !state.storage_configured {
        (
            None,
            Some("Object storage is not configured for this instance.".into()),
        )
    } else if node.status != "healthy" {
        (None, Some("Node is offline or degraded — storage browse is unavailable.".into()))
    } else {
        let bucket = read_setting(&state.pool, "object_storage_bucket")
            .await
            .unwrap_or_else(|| state.object_storage_bucket.clone());
        let object_storage_jwt = std::env::var("OBJECT_STORAGE_JWT_SECRET")
            .ok()
            .filter(|value| !value.is_empty())
            .ok_or_else(|| {
                AppError::Internal(anyhow::anyhow!("OBJECT_STORAGE_JWT_SECRET is not set"))
            })?;
        let signing_secret = std::env::var("NOS_SIGNING_SECRET")
            .ok()
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| state.signing_secret.clone());
        let storage = NebulaStorage::new(
            record.base_url.clone(),
            state.object_storage_public_url.clone(),
            bucket,
            &object_storage_jwt,
            &signing_secret,
        )?;
        match storage
            .list_objects_page(
                &list_prefix,
                Some("/"),
                200,
                query.start_after.as_deref(),
            )
            .await
        {
            Ok(page) => (Some(build_browse_page(list_prefix, page)), None),
            Err(error) => {
                tracing::warn!(
                    node_id = %id,
                    error = %error,
                    "storage node object browse failed"
                );
                (
                    None,
                    Some("Could not list objects on this node. Check the endpoint URL and credentials.".into()),
                )
            }
        }
    };

    Ok(Json(AdminStorageNodeDetailResponse {
        node,
        media_breakdown,
        indexed_files_total,
        browse,
        browse_unavailable,
    }))
}

#[derive(Debug, Deserialize)]
pub struct CreateStorageNodeRequest {
    pub id: String,
    pub region_label: String,
    pub base_url: String,
    pub target_capacity_value: Option<f64>,
    pub target_capacity_unit: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct CreateStorageNodeResponse {
    pub node: AdminStorageNodeRow,
}

// Human: POST /admin/storage/nodes — register an additional standalone Nebular endpoint.
pub async fn create_storage_node(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    headers: HeaderMap,
    Json(body): Json<CreateStorageNodeRequest>,
) -> Result<Json<CreateStorageNodeResponse>, AppError> {
    require_instance_permission(&state.pool, &claims, Permission::InstanceSettingsManage).await?;

    let id = normalize_node_id(&body.id)?;
    let base_url = normalize_base_url(&body.base_url)?;
    crate::outbound_target::validate_http_outbound_base_url(&base_url).await?;

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
    .bind(STORAGE_NODE_ARCHITECTURE)
    .bind(target_capacity_bytes)
    .execute(&state.pool)
    .await?;

    audit::write_audit_logged(
        &state.pool,
        Some(&claims.sub),
        "storage_nodes.create",
        Some("storage_node"),
        Some(&id),
        Some(serde_json::json!({
            "region_label": body.region_label.trim(),
            "base_url": base_url,
            "architecture": STORAGE_NODE_ARCHITECTURE,
            "target_capacity_value": body.target_capacity_value,
            "target_capacity_unit": body.target_capacity_unit,
        })),
        &headers,
    )
    .await;

    let response = build_storage_response(&state).await?;
    let node = response
        .nodes
        .into_iter()
        .find(|row| row.id == id || row.endpoint_host == endpoint_host_from_url(&base_url))
        .ok_or_else(|| AppError::Internal(anyhow::anyhow!("created storage node not found")))?;

    Ok(Json(CreateStorageNodeResponse { node }))
}

#[derive(Debug, Deserialize)]
pub struct UpdateStorageNodeRequest {
    pub region_label: Option<String>,
    pub base_url: Option<String>,
    pub target_capacity_value: Option<f64>,
    pub target_capacity_unit: Option<String>,
}

// Human: PATCH /admin/storage/nodes/{id} — update region, endpoint, or target capacity.
// Agent: WRITES storage_nodes row; AUDIT storage_nodes.update; RETURNS refreshed node row.
pub async fn update_storage_node(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    headers: HeaderMap,
    Path(node_id): Path<String>,
    Json(body): Json<UpdateStorageNodeRequest>,
) -> Result<Json<CreateStorageNodeResponse>, AppError> {
    require_instance_permission(&state.pool, &claims, Permission::InstanceSettingsManage).await?;

    let id = normalize_node_id(&node_id)?;

    let existing: Option<StorageNodeRecord> = sqlx::query_as(
        "SELECT id, region_label, base_url, architecture, target_capacity_bytes \
         FROM storage_nodes \
         WHERE id = $1 AND enabled = true",
    )
    .bind(&id)
    .fetch_optional(&state.pool)
    .await?;

    let Some(existing) = existing else {
        return Err(AppError::NotFound);
    };

    let region_label = body
        .region_label
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .unwrap_or(existing.region_label.clone());

    let base_url = match body.base_url.as_deref() {
        Some(raw) => normalize_base_url(raw)?,
        None => existing.base_url.clone(),
    };
    crate::outbound_target::validate_http_outbound_base_url(&base_url).await?;

    if base_url != existing.base_url {
        let url_taken: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM storage_nodes WHERE base_url = $1 AND id <> $2)",
        )
        .bind(&base_url)
        .bind(&id)
        .fetch_one(&state.pool)
        .await?;
        if url_taken {
            return Err(AppError::Conflict(
                "a storage node with this endpoint URL already exists".into(),
            ));
        }
    }

    let target_capacity_bytes = match (body.target_capacity_value, body.target_capacity_unit.as_deref()) {
        (Some(value), Some(unit)) => Some(parse_target_capacity_bytes(value, unit)?),
        (None, None) => existing.target_capacity_bytes,
        _ => {
            return Err(AppError::BadRequest(
                "target capacity requires both value and unit (MB, GB, or TB)".into(),
            ));
        }
    };

    sqlx::query(
        "UPDATE storage_nodes \
         SET region_label = $1, base_url = $2, target_capacity_bytes = $3, updated_at = NOW() \
         WHERE id = $4",
    )
    .bind(&region_label)
    .bind(&base_url)
    .bind(target_capacity_bytes)
    .bind(&id)
    .execute(&state.pool)
    .await?;

    audit::write_audit_logged(
        &state.pool,
        Some(&claims.sub),
        "storage_nodes.update",
        Some("storage_node"),
        Some(&id),
        Some(serde_json::json!({
            "region_label": region_label,
            "base_url": base_url,
            "target_capacity_value": body.target_capacity_value,
            "target_capacity_unit": body.target_capacity_unit,
        })),
        &headers,
    )
    .await;

    let response = build_storage_response(&state).await?;
    let node = response
        .nodes
        .into_iter()
        .find(|row| row.id == id)
        .ok_or_else(|| AppError::Internal(anyhow::anyhow!("updated storage node not found")))?;

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
