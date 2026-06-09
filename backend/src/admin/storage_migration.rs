// Human: Admin maintenance — migrate legacy Nebular blobs (nested paths, old compression) to the current layout.
// Agent: POST /api/v1/admin/maintenance/migrate-storage-blobs; CALLS Nebular maintenance or per-object probe; AUDIT.

use std::{sync::Arc, time::Duration};

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
    /// Human: When true, inspect each object without writes.
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

/// Human: Optional per-object log line emitted while scanning or migrating a batch.
/// Agent: USED by storage_migration_run to persist full operator logs.
#[derive(Debug, Clone)]
pub struct StorageMigrationObjectLog {
    pub level: &'static str,
    pub message: String,
    pub object_key: Option<String>,
}

/// Human: Callback for per-object migration log lines during batched work.
pub type StorageMigrationLogSink = dyn Fn(StorageMigrationObjectLog) + Send + Sync;

/// Human: Per HTTP call for client-side GET/PUT during migration — caps one stuck Nebular stream.
/// Agent: APPLIES to list_objects_page, get_stream, put_stream in client_rewrite fallback.
pub(crate) const MIGRATION_HTTP_REQUEST_TIMEOUT: Duration = Duration::from_secs(90);

/// Human: Wall-clock budget for one object rewrite (GET → PUT, including retries) before fail-forward.
/// Agent: WRAPS rewrite_object_with_retry; PREVENTS one bad blob from freezing a 25-object batch for hours.
pub(crate) const MIGRATION_PER_OBJECT_TIMEOUT: Duration = Duration::from_secs(180);

/// Human: Outer timeout for a single Nebular `migrate_blobs` maintenance POST (server-side batch).
/// Agent: LONGER than per-object cap because Nebular may rewrite many blobs locally without HTTP streaming.
pub(crate) const MIGRATION_MAINTENANCE_TIMEOUT: Duration = Duration::from_secs(600);

// Human: Build an admin JWT Nebular client for one registry row with a caller-chosen request timeout.
// Agent: READS app_settings bucket + env secrets; RETURNS NebulaStorage for LIST/PUT/maintenance.
pub(crate) async fn nebula_client_for_node(
    state: &AppState,
    record: &StorageNodeRecord,
    request_timeout: Option<Duration>,
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

    NebulaStorage::new_with_request_timeout(
        record.base_url.clone(),
        state.object_storage_public_url.clone(),
        bucket,
        &object_storage_jwt,
        &signing_secret,
        Some(request_timeout.unwrap_or(MIGRATION_HTTP_REQUEST_TIMEOUT)),
    )
    .map_err(AppError::Internal)
}

// Human: Legacy compression magics that always require server-side re-encode.
// Agent: MATCHES scripts/storage-audit.py classification for preview probes.
fn legacy_magic_prefix(head: &[u8]) -> bool {
    head.starts_with(b"NOSB") || head.starts_with(b"NOSZ") || head.starts_with(b"NOS2")
}

// Human: Keys with `/` may still live on the legacy nested on-disk layout until rewritten.
fn key_needs_path_relocation(key: &str) -> bool {
    key.contains('/')
}

// Human: Inspect one object key to decide whether migration work is still required.
// Agent: READS ranged GET prefix; CHECKS nested key layout and legacy blob magics.
pub(crate) async fn object_needs_migration(
    client: &NebulaStorage,
    key: &str,
) -> Result<bool, anyhow::Error> {
    if key_needs_path_relocation(key) {
        return Ok(true);
    }

    let head = client.get_object_prefix(key, 4).await?;
    if legacy_magic_prefix(&head) {
        return Ok(true);
    }

    Ok(false)
}

// Human: Rewrite one object by streaming GET → PUT on the same key (idempotent for already-migrated blobs).
// Agent: RETRIES whole stream on transient PUT errors; WRITES encoded flat path + upload-level NOSI on Nebular.
async fn rewrite_object_with_retry(
    client: &NebulaStorage,
    key: &str,
    max_attempts: u32,
) -> Result<(), anyhow::Error> {
    let mut delay_ms: u64 = 1_500;

    for attempt in 1..=max_attempts {
        match client.rewrite_object_stream(key).await {
            Ok(()) => return Ok(()),
            Err(error) if attempt < max_attempts && is_likely_transient_put_error(&error) => {
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

// Human: Probe whether one object still needs migration, bounded by a wall-clock timeout.
// Agent: CALLS object_needs_migration; RETURNS Err on timeout so caller can fail-forward.
async fn object_needs_migration_with_timeout(
    client: &NebulaStorage,
    key: &str,
) -> Result<bool, anyhow::Error> {
    match tokio::time::timeout(MIGRATION_PER_OBJECT_TIMEOUT, object_needs_migration(client, key)).await {
        Ok(result) => result,
        Err(_) => Err(anyhow::anyhow!(
            "object inspection timed out after {}s",
            MIGRATION_PER_OBJECT_TIMEOUT.as_secs()
        )),
    }
}

// Human: Rewrite one object with retry budget and an outer wall-clock cap for migration batches.
// Agent: WRAPS rewrite_object_with_retry(2 attempts); FAILS FAST when Nebular hangs mid-PUT.
async fn rewrite_object_for_migration(client: &NebulaStorage, key: &str) -> Result<(), anyhow::Error> {
    const MIGRATION_REWRITE_ATTEMPTS: u32 = 2;
    match tokio::time::timeout(
        MIGRATION_PER_OBJECT_TIMEOUT,
        rewrite_object_with_retry(client, key, MIGRATION_REWRITE_ATTEMPTS),
    )
    .await
    {
        Ok(result) => result,
        Err(_) => Err(anyhow::anyhow!(
            "object rewrite timed out after {}s",
            MIGRATION_PER_OBJECT_TIMEOUT.as_secs()
        )),
    }
}

// Human: Optional heartbeat so long client batches still refresh `updated_at` for stale-run detection.
pub(crate) type StorageMigrationHeartbeat = dyn Fn() + Send + Sync;

fn emit_object_log(
    sink: Option<&StorageMigrationLogSink>,
    level: &'static str,
    message: impl Into<String>,
    object_key: Option<&str>,
) {
    if let Some(log) = sink {
        log(StorageMigrationObjectLog {
            level,
            message: message.into(),
            object_key: object_key.map(str::to_string),
        });
    }
}

// Human: Client-side batch — probe or rewrite each listed object individually.
// Agent: READS list_objects_page; CALLS object_needs_migration on dry_run; RETURNS pagination cursor.
pub(crate) async fn migrate_node_client_batch(
    client: &NebulaStorage,
    node_id: &str,
    prefix: &str,
    limit: u64,
    start_after: Option<&str>,
    dry_run: bool,
    log_sink: Option<&StorageMigrationLogSink>,
    heartbeat: Option<&StorageMigrationHeartbeat>,
) -> Result<MigrateStorageBlobsNodeReport, AppError> {
    let page = client
        .list_objects_page(prefix, None, limit, start_after)
        .await
        .map_err(|e| AppError::BadRequest(format!("object list failed: {e:#}")))?;

    let mut report = MigrateStorageBlobsNodeReport {
        node_id: node_id.to_string(),
        method: if dry_run {
            "client_probe".into()
        } else {
            "client_rewrite".into()
        },
        scanned: page.items.len() as u64,
        migrated: 0,
        skipped: 0,
        failed: 0,
        failures: Vec::new(),
        next_start_after: page.next_start_after.clone(),
        is_truncated: page.is_truncated,
    };

    for item in &page.items {
        if let Some(touch) = heartbeat {
            touch();
        }

        if dry_run {
            match object_needs_migration_with_timeout(client, &item.key).await {
                Ok(true) => {
                    report.migrated += 1;
                    emit_object_log(
                        log_sink,
                        "info",
                        format!("Would migrate object on {node_id}"),
                        Some(&item.key),
                    );
                }
                Ok(false) => {
                    report.skipped += 1;
                    emit_object_log(
                        log_sink,
                        "info",
                        format!("Skipped object already current on {node_id}"),
                        Some(&item.key),
                    );
                }
                Err(error) => {
                    report.failed += 1;
                    let message = format!("{error:#}");
                    if report.failures.len() < 20 {
                        report.failures.push(MigrateStorageBlobsFailure {
                            key: item.key.clone(),
                            message: message.clone(),
                        });
                    }
                    emit_object_log(
                        log_sink,
                        "error",
                        format!("Failed to inspect object on {node_id}: {message}"),
                        Some(&item.key),
                    );
                }
            }
            continue;
        }

        match object_needs_migration_with_timeout(client, &item.key).await {
            Ok(false) => {
                report.skipped += 1;
                emit_object_log(
                    log_sink,
                    "info",
                    format!("Skipped object already current on {node_id}"),
                    Some(&item.key),
                );
                continue;
            }
            Ok(true) => {}
            Err(error) => {
                report.failed += 1;
                let message = format!("{error:#}");
                if report.failures.len() < 20 {
                    report.failures.push(MigrateStorageBlobsFailure {
                        key: item.key.clone(),
                        message: message.clone(),
                    });
                }
                emit_object_log(
                    log_sink,
                    "error",
                    format!("Failed to inspect object on {node_id}: {message}"),
                    Some(&item.key),
                );
                continue;
            }
        }

        match rewrite_object_for_migration(client, &item.key).await {
            Ok(()) => {
                report.migrated += 1;
                emit_object_log(
                    log_sink,
                    "info",
                    format!("Migrated object on {node_id}"),
                    Some(&item.key),
                );
            }
            Err(error) => {
                report.failed += 1;
                let message = format!("{error:#}");
                if report.failures.len() < 20 {
                    report.failures.push(MigrateStorageBlobsFailure {
                        key: item.key.clone(),
                        message: message.clone(),
                    });
                }
                emit_object_log(
                    log_sink,
                    "error",
                    format!("Failed to migrate object on {node_id}: {message}"),
                    Some(&item.key),
                );
            }
        }
    }

    Ok(report)
}

/// Human: Inputs for one node migration batch — shared by HTTP handler and background runner.
pub(crate) struct NodeMigrationBatchRequest<'a> {
    pub prefix: &'a str,
    pub limit: u64,
    pub start_after: Option<&'a str>,
    pub dry_run: bool,
    pub prefer_server: bool,
    pub log_sink: Option<&'a StorageMigrationLogSink>,
    /// Human: Optional DB touch between objects so operators see `updated_at` move during long batches.
    pub heartbeat: Option<&'a StorageMigrationHeartbeat>,
}

// Human: Execute one migration batch for a single storage node — shared by HTTP handler and background runner.
// Agent: TRIES Nebular maintenance when safe; FALLBACK client probe/rewrite with per-object inspection.
pub(crate) async fn execute_node_migration_batch(
    state: &AppState,
    record: &StorageNodeRecord,
    request: NodeMigrationBatchRequest<'_>,
) -> Result<MigrateStorageBlobsNodeReport, AppError> {
    let client = nebula_client_for_node(state, record, Some(MIGRATION_HTTP_REQUEST_TIMEOUT)).await?;
    let maintenance_client =
        nebula_client_for_node(state, record, Some(MIGRATION_MAINTENANCE_TIMEOUT)).await?;

    if request.dry_run {
        if request.prefer_server {
            if let Some(server) = maintenance_client
                .try_migrate_blobs_maintenance(request.limit, request.start_after, true)
                .await
                .map_err(|e| AppError::BadRequest(format!("nebular maintenance failed: {e:#}")))?
            {
                if server.dry_run_applied {
                    emit_object_log(
                        request.log_sink,
                        "info",
                        format!(
                            "Batch on {} via nebular_maintenance: would migrate {}, skipped {}, failed {}",
                            record.id, server.migrated, server.skipped, server.failed
                        ),
                        None,
                    );
                    return Ok(MigrateStorageBlobsNodeReport {
                        node_id: record.id.clone(),
                        method: "nebular_maintenance".into(),
                        scanned: server.scanned,
                        migrated: server.migrated,
                        skipped: server.skipped,
                        failed: server.failed,
                        failures: Vec::new(),
                        next_start_after: server.next_start_after,
                        is_truncated: server.is_truncated,
                    });
                }
            }
        }

        return migrate_node_client_batch(
            &client,
            &record.id,
            request.prefix,
            request.limit,
            request.start_after,
            true,
            request.log_sink,
            request.heartbeat,
        )
        .await;
    }

    if request.prefer_server {
        if let Some(server) = maintenance_client
            .try_migrate_blobs_maintenance(request.limit, request.start_after, false)
            .await
            .map_err(|e| AppError::BadRequest(format!("nebular maintenance failed: {e:#}")))?
        {
            emit_object_log(
                request.log_sink,
                "info",
                format!(
                    "Batch on {} via nebular_maintenance: migrated {}, skipped {}, failed {}",
                    record.id, server.migrated, server.skipped, server.failed
                ),
                None,
            );
            return Ok(MigrateStorageBlobsNodeReport {
                node_id: record.id.clone(),
                method: "nebular_maintenance".into(),
                scanned: server.scanned,
                migrated: server.migrated,
                skipped: server.skipped,
                failed: server.failed,
                failures: Vec::new(),
                next_start_after: server.next_start_after,
                is_truncated: server.is_truncated,
            });
        }

        tracing::warn!(
            node_id = %record.id,
            limit = request.limit,
            start_after = ?request.start_after,
            "nebular migrate_blobs maintenance unavailable; falling back to client_rewrite"
        );
    }

    migrate_node_client_batch(
        &client,
        &record.id,
        request.prefix,
        request.limit,
        request.start_after,
        false,
        request.log_sink,
        request.heartbeat,
    )
    .await
}

// Human: Load enabled storage node rows for a migration request scope.
pub(crate) async fn load_migration_node_rows(
    pool: &sqlx::PgPool,
    node_id: Option<&str>,
) -> Result<Vec<StorageNodeRecord>, AppError> {
    if let Some(node_id) = node_id {
        let id = normalize_node_id(node_id)?;
        let row: Option<StorageNodeRecord> = sqlx::query_as(
            "SELECT id, region_label, base_url, architecture, target_capacity_bytes \
             FROM storage_nodes WHERE enabled = true AND id = $1",
        )
        .bind(&id)
        .fetch_optional(pool)
        .await?;
        Ok(row.into_iter().collect())
    } else {
        sqlx::query_as(
            "SELECT id, region_label, base_url, architecture, target_capacity_bytes \
             FROM storage_nodes WHERE enabled = true ORDER BY id",
        )
        .fetch_all(pool)
        .await
        .map_err(AppError::from)
    }
}

// Human: POST /api/v1/admin/maintenance/migrate-storage-blobs — batched legacy blob migration per node.
// Agent: InstanceAdmin; CALLS execute_node_migration_batch; AUDIT with counts.
pub async fn migrate_storage_blobs(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    headers: HeaderMap,
    Query(query): Query<MigrateStorageBlobsQuery>,
) -> Result<Json<MigrateStorageBlobsResponse>, AppError> {
    require_instance_permission(&state.pool, &claims, Permission::InstanceAdmin).await?;

    let limit = query.limit.clamp(1, 200);
    let prefix = query.prefix.trim().to_string();

    let node_rows = load_migration_node_rows(&state.pool, query.node_id.as_deref()).await?;
    if node_rows.is_empty() {
        return Err(AppError::BadRequest(
            "No enabled storage nodes match the request.".into(),
        ));
    }

    let mut nodes = Vec::with_capacity(node_rows.len());
    let start_after = if node_rows.len() == 1 {
        query.start_after.as_deref()
    } else {
        None
    };

    for record in node_rows {
        let report = execute_node_migration_batch(
            state.as_ref(),
            &record,
            NodeMigrationBatchRequest {
                prefix: &prefix,
                limit,
                start_after,
                dry_run: query.dry_run,
                prefer_server: query.prefer_server,
                log_sink: None,
                heartbeat: None,
            },
        )
        .await?;
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
