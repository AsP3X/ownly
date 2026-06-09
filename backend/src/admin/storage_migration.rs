// Human: Admin maintenance — migrate legacy Nebular blobs (nested paths, old compression) to the current layout.
// Agent: POST /api/v1/admin/maintenance/migrate-storage-blobs; CALLS Nebular maintenance or GET+PUT rewrite; AUDIT admin.storage_blobs.migrate.

use std::sync::Arc;

use axum::{
    extract::{Query, State},
    http::HeaderMap,
    Extension, Json,
};
use serde::{Deserialize, Serialize};

use crate::{
    admin::{
        console::read_setting,
        handlers::require_instance_permission,
        storage_nodes::{normalize_node_id, StorageNodeRecord},
    },
    audit,
    auth::Claims,
    authz::Permission,
    error::AppError,
    storage::{
        nebula::NebulaStorage,
        put_retry::is_likely_transient_put_error,
    },
    AppState,
};

#[derive(Debug, Deserialize)]
pub struct MigrateStorageBlobsQuery {
    /// Human: Registry node id — omit to migrate every enabled storage node in one call.
    pub node_id: Option<String>,
    /// Human: Only list/migrate keys under this prefix (default empty = whole bucket).
    #[serde(default)]
    pub prefix: String,
    /// Human: Max objects per node in this request (default 25, cap 200).
    #[serde(default = "default_migrate_limit")]
    pub limit: u64,
    /// Human: Pagination cursor from a prior response (`next_start_after`).
    pub start_after: Option<String>,
    /// Human: When true, list candidates only — no GET/PUT or Nebular maintenance writes.
    #[serde(default)]
    pub dry_run: bool,
    /// Human: Prefer Nebular `/_nos/maintenance/migrate_blobs` when available (default true).
    #[serde(default = "default_true")]
    pub prefer_server: bool,
}

fn default_migrate_limit() -> u64 {
    25
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Serialize)]
pub struct MigrateStorageBlobsFailure {
    pub key: String,
    pub message: String,
}

#[derive(Debug, Serialize)]
pub struct MigrateStorageBlobsNodeReport {
    pub node_id: String,
    pub method: String,
    pub scanned: u64,
    pub migrated: u64,
    pub skipped: u64,
    pub failed: u64,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub failures: Vec<MigrateStorageBlobsFailure>,
    pub next_start_after: Option<String>,
    pub is_truncated: bool,
}

#[derive(Debug, Serialize)]
pub struct MigrateStorageBlobsResponse {
    pub nodes: Vec<MigrateStorageBlobsNodeReport>,
}

// Human: Build an admin JWT Nebular client for one registry row.
// Agent: READS app_settings bucket + env secrets; RETURNS NebulaStorage for LIST/PUT/maintenance.
async fn nebula_client_for_node(
    state: &AppState,
    record: &StorageNodeRecord,
) -> Result<NebulaStorage, AppError> {
    if !state.storage_configured {
        return Err(AppError::BadRequest(
            "Object storage is not configured for this instance.".into(),
        ));
    }

    let bucket = read_setting(&state.pool, "object_storage_bucket")
        .await
        .unwrap_or_else(|| state.object_storage_bucket.clone());
    let object_storage_jwt = std::env::var("OBJECT_STORAGE_JWT_SECRET")
        .ok()
        .filter(|value| !value.is_empty())
        .ok_or_else(|| AppError::Internal(anyhow::anyhow!("OBJECT_STORAGE_JWT_SECRET is not set")))?;
    let signing_secret = std::env::var("NOS_SIGNING_SECRET")
        .ok()
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| state.signing_secret.clone());

    NebulaStorage::new(
        record.base_url.clone(),
        state.object_storage_public_url.clone(),
        bucket,
        &object_storage_jwt,
        &signing_secret,
    )
    .map_err(AppError::Internal)
}

// Human: Keys with `/` may still live on the legacy nested on-disk layout until rewritten.
// Agent: PREDICATE for client-side migration; flat keys may still need format upgrade via recompress env.
fn key_needs_client_migration(key: &str) -> bool {
    key.contains('/')
}

// Human: Rewrite one object by streaming GET → PUT on the same key (idempotent for already-migrated blobs).
// Agent: RETRIES whole stream on transient PUT errors; WRITES encoded flat path + upload-level NOSI on Nebular.
async fn rewrite_object_with_retry(client: &NebulaStorage, key: &str) -> Result<(), anyhow::Error> {
    const MAX_ATTEMPTS: u32 = 5;
    let mut delay_ms: u64 = 1_500;

    for attempt in 1..=MAX_ATTEMPTS {
        match client.rewrite_object_stream(key).await {
            Ok(()) => return Ok(()),
            Err(error) if attempt < MAX_ATTEMPTS && is_likely_transient_put_error(&error) => {
                tracing::warn!(
                    storage_key = %key,
                    attempt,
                    %error,
                    retry_in_ms = delay_ms,
                    "storage blob migration rewrite failed; retrying"
                );
                tokio::time::sleep(std::time::Duration::from_millis(delay_ms)).await;
                delay_ms = (delay_ms.saturating_mul(2)).min(12_000);
            }
            Err(error) => return Err(error),
        }
    }
    unreachable!("rewrite_object_with_retry exits via return or Err")
}

// Human: Client-side batch — list page, rewrite keys that still need layout migration.
// Agent: READS list_objects_page; CALLS rewrite_object_stream per key; RETURNS pagination cursor.
async fn migrate_node_client_batch(
    client: &NebulaStorage,
    prefix: &str,
    limit: u64,
    start_after: Option<&str>,
    dry_run: bool,
) -> Result<MigrateStorageBlobsNodeReport, AppError> {
    let page = client
        .list_objects_page(prefix, None, limit, start_after)
        .await
        .map_err(|e| AppError::BadRequest(format!("object list failed: {e:#}")))?;

    let mut report = MigrateStorageBlobsNodeReport {
        node_id: String::new(),
        method: "client_rewrite".into(),
        scanned: page.items.len() as u64,
        migrated: 0,
        skipped: 0,
        failed: 0,
        failures: Vec::new(),
        next_start_after: page.next_start_after.clone(),
        is_truncated: page.is_truncated,
    };

    for item in &page.items {
        if !key_needs_client_migration(&item.key) {
            report.skipped += 1;
            continue;
        }
        if dry_run {
            report.migrated += 1;
            continue;
        }
        match rewrite_object_with_retry(client, &item.key).await {
            Ok(()) => report.migrated += 1,
            Err(error) => {
                report.failed += 1;
                if report.failures.len() < 20 {
                    report.failures.push(MigrateStorageBlobsFailure {
                        key: item.key.clone(),
                        message: format!("{error:#}"),
                    });
                }
            }
        }
    }

    Ok(report)
}

// Human: POST /api/v1/admin/maintenance/migrate-storage-blobs — batched legacy blob migration per node.
// Agent: InstanceAdmin; TRIES Nebular maintenance POST first; FALLBACK client_rewrite; AUDIT with counts.
pub async fn migrate_storage_blobs(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    headers: HeaderMap,
    Query(query): Query<MigrateStorageBlobsQuery>,
) -> Result<Json<MigrateStorageBlobsResponse>, AppError> {
    require_instance_permission(&state.pool, &claims, Permission::InstanceAdmin).await?;

    let limit = query.limit.clamp(1, 200);
    let prefix = query.prefix.trim().to_string();

    let node_rows: Vec<StorageNodeRecord> = if let Some(ref node_id) = query.node_id {
        let id = normalize_node_id(node_id)?;
        let row: Option<StorageNodeRecord> = sqlx::query_as(
            "SELECT id, region_label, base_url, architecture, target_capacity_bytes \
             FROM storage_nodes WHERE enabled = true AND id = $1",
        )
        .bind(&id)
        .fetch_optional(&state.pool)
        .await?;
        row.into_iter().collect()
    } else {
        sqlx::query_as(
            "SELECT id, region_label, base_url, architecture, target_capacity_bytes \
             FROM storage_nodes WHERE enabled = true ORDER BY id",
        )
        .fetch_all(&state.pool)
        .await?
    };

    if node_rows.is_empty() {
        return Err(AppError::BadRequest(
            "No enabled storage nodes match the request.".into(),
        ));
    }

    let mut nodes = Vec::with_capacity(node_rows.len());
    // Human: Pagination cursor is per-node — only honor it when migrating a single explicit node.
    let start_after = if node_rows.len() == 1 {
        query.start_after.as_deref()
    } else {
        None
    };

    for record in node_rows {
        let client = nebula_client_for_node(state.as_ref(), &record).await?;
        let mut report = if query.prefer_server && !query.dry_run {
            match client
                .try_migrate_blobs_maintenance(limit, start_after)
                .await
                .map_err(|e| AppError::BadRequest(format!("nebular maintenance failed: {e:#}")))?
            {
                Some(server) => MigrateStorageBlobsNodeReport {
                    node_id: record.id.clone(),
                    method: "nebular_maintenance".into(),
                    scanned: server.scanned,
                    migrated: server.migrated,
                    skipped: server.skipped,
                    failed: server.failed,
                    failures: Vec::new(),
                    next_start_after: server.next_start_after,
                    is_truncated: server.is_truncated,
                },
                None => {
                    let mut client_report = migrate_node_client_batch(
                        &client,
                        &prefix,
                        limit,
                        start_after,
                        query.dry_run,
                    )
                    .await?;
                    client_report.node_id = record.id.clone();
                    client_report
                }
            }
        } else {
            let mut client_report = migrate_node_client_batch(
                &client,
                &prefix,
                limit,
                start_after,
                query.dry_run,
            )
            .await?;
            client_report.node_id = record.id.clone();
            client_report
        };

        report.node_id = record.id.clone();
        nodes.push(report);
    }

    let audit_context = serde_json::json!({
        "dry_run": query.dry_run,
        "prefix": prefix,
        "limit": limit,
        "node_count": nodes.len(),
        "migrated_total": nodes.iter().map(|n| n.migrated).sum::<u64>(),
        "failed_total": nodes.iter().map(|n| n.failed).sum::<u64>(),
    });

    audit::write_audit(
        &state.pool,
        Some(&claims.sub),
        "admin.storage_blobs.migrate",
        Some("instance"),
        Some(&claims.sub),
        Some(audit_context),
        &headers,
    )
    .await
    .ok();

    Ok(Json(MigrateStorageBlobsResponse { nodes }))
}
