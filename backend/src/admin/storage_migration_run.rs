// Human: Persistent admin storage migration runs — server-side preview/migrate loop with full logs.
// Agent: WRITES storage_migration_runs rows; SPAWNS tokio worker; GET status/logs for all InstanceAdmin sessions.

use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::Duration,
};

use axum::{
    extract::{Path, Query, State},
    http::HeaderMap,
    Extension, Json,
};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use uuid::Uuid;

use crate::{
    admin::{
        handlers::require_instance_permission,
        storage_migration::{
            execute_node_migration_batch, load_migration_node_rows, NodeMigrationBatchRequest,
            MIGRATION_HTTP_REQUEST_TIMEOUT, StorageMigrationLogSink, StorageMigrationObjectLog,
        },
        storage_nodes::StorageNodeRecord,
    },
    audit,
    auth::Claims,
    authz::Permission,
    error::AppError,
    AppState,
};

const BATCH_LIMIT: u64 = 25;

/// Human: Outer safety net for one migration batch — slightly longer than a single Nebular maintenance POST.
/// Agent: WRAPS execute_node_migration_batch; MARKS run error on timeout instead of leaving status `running`.
const BATCH_EXECUTION_TIMEOUT: Duration =
    Duration::from_secs(MIGRATION_HTTP_REQUEST_TIMEOUT.as_secs() + 120);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StorageMigrationRunKind {
    Preview,
    Migrate,
}

impl StorageMigrationRunKind {
    fn as_str(self) -> &'static str {
        match self {
            Self::Preview => "preview",
            Self::Migrate => "migrate",
        }
    }

    fn parse(value: &str) -> Option<Self> {
        match value {
            "preview" => Some(Self::Preview),
            "migrate" => Some(Self::Migrate),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StorageMigrationRunStatus {
    Running,
    Complete,
    Error,
    Cancelled,
}

impl StorageMigrationRunStatus {
    fn as_str(self) -> &'static str {
        match self {
            Self::Running => "running",
            Self::Complete => "complete",
            Self::Error => "error",
            Self::Cancelled => "cancelled",
        }
    }

}

#[derive(Debug, Default, Serialize, Deserialize)]
struct RunProgress {
    node_ids: Vec<String>,
    current_node_index: usize,
    #[serde(default)]
    cursors: HashMap<String, String>,
}

#[derive(Debug, sqlx::FromRow)]
struct StorageMigrationRunRow {
    id: Uuid,
    kind: String,
    status: String,
    node_id: Option<String>,
    prefix: String,
    total_target: i64,
    migrated: i64,
    skipped: i64,
    failed: i64,
    scanned: i64,
    current_node_id: Option<String>,
    batch_number: i32,
    preview_run_id: Option<Uuid>,
    progress_json: serde_json::Value,
    error_message: Option<String>,
    started_by_user_id: String,
    dismissed_at: Option<chrono::DateTime<chrono::Utc>>,
    created_at: chrono::DateTime<chrono::Utc>,
    updated_at: chrono::DateTime<chrono::Utc>,
    completed_at: Option<chrono::DateTime<chrono::Utc>>,
}

#[derive(Debug, Serialize)]
pub struct StorageMigrationRunResponse {
    pub id: String,
    pub kind: String,
    pub status: String,
    pub node_id: Option<String>,
    pub prefix: String,
    pub total_target: u64,
    pub migrated: u64,
    pub skipped: u64,
    pub failed: u64,
    pub scanned: u64,
    pub current_node_id: Option<String>,
    pub batch_number: u32,
    pub preview_run_id: Option<String>,
    pub error_message: Option<String>,
    pub started_by_user_id: String,
    pub dismissed: bool,
    pub created_at: String,
    pub updated_at: String,
    pub completed_at: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct StorageMigrationLogEntryResponse {
    pub id: i64,
    pub level: String,
    pub message: String,
    pub node_id: Option<String>,
    pub object_key: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Serialize)]
pub struct StorageMigrationLogsResponse {
    pub entries: Vec<StorageMigrationLogEntryResponse>,
    pub has_more: bool,
    pub next_after: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct StartStorageMigrationRunBody {
    pub node_id: Option<String>,
    #[serde(default)]
    pub prefix: String,
    /// Human: Completed preview run to migrate — preferred over scope lookup when the UI dismissed the preview card.
    pub preview_run_id: Option<Uuid>,
}

#[derive(Debug, Deserialize)]
pub struct StorageMigrationLogsQuery {
    pub after: Option<i64>,
    #[serde(default = "default_log_limit")]
    pub limit: i64,
}

fn default_log_limit() -> i64 {
    200
}

// Human: Tracks whether a background migration worker should stop between batches.
// Agent: Arc<AtomicBool> shared with spawned tokio task; SET on cancel endpoint.
#[derive(Clone, Default)]
pub struct StorageMigrationCoordinator {
    cancel_requested: Arc<AtomicBool>,
}

impl StorageMigrationCoordinator {
    pub fn new() -> Self {
        Self::default()
    }

    fn request_cancel(&self) {
        self.cancel_requested.store(true, Ordering::SeqCst);
    }

    fn clear_cancel(&self) {
        self.cancel_requested.store(false, Ordering::SeqCst);
    }

    fn is_cancel_requested(&self) -> bool {
        self.cancel_requested.load(Ordering::SeqCst)
    }
}

fn row_to_response(row: StorageMigrationRunRow) -> StorageMigrationRunResponse {
    StorageMigrationRunResponse {
        id: row.id.to_string(),
        kind: row.kind,
        status: row.status,
        node_id: row.node_id,
        prefix: row.prefix,
        total_target: row.total_target.max(0) as u64,
        migrated: row.migrated.max(0) as u64,
        skipped: row.skipped.max(0) as u64,
        failed: row.failed.max(0) as u64,
        scanned: row.scanned.max(0) as u64,
        current_node_id: row.current_node_id,
        batch_number: row.batch_number.max(0) as u32,
        preview_run_id: row.preview_run_id.map(|id| id.to_string()),
        error_message: row.error_message,
        started_by_user_id: row.started_by_user_id,
        dismissed: row.dismissed_at.is_some(),
        created_at: row.created_at.to_rfc3339(),
        updated_at: row.updated_at.to_rfc3339(),
        completed_at: row.completed_at.map(|value| value.to_rfc3339()),
    }
}

async fn fetch_run(pool: &PgPool, run_id: Uuid) -> Result<Option<StorageMigrationRunRow>, AppError> {
    let row = sqlx::query_as::<_, StorageMigrationRunRow>(
        "SELECT id, kind, status, node_id, prefix, total_target, migrated, skipped, failed, scanned, \
         current_node_id, batch_number, preview_run_id, progress_json, error_message, started_by_user_id, \
         dismissed_at, created_at, updated_at, completed_at \
         FROM storage_migration_runs WHERE id = $1",
    )
    .bind(run_id)
    .fetch_optional(pool)
    .await?;
    Ok(row)
}

async fn fetch_latest_visible_run(pool: &PgPool) -> Result<Option<StorageMigrationRunRow>, AppError> {
    let row = sqlx::query_as::<_, StorageMigrationRunRow>(
        "SELECT id, kind, status, node_id, prefix, total_target, migrated, skipped, failed, scanned, \
         current_node_id, batch_number, preview_run_id, progress_json, error_message, started_by_user_id, \
         dismissed_at, created_at, updated_at, completed_at \
         FROM storage_migration_runs \
         WHERE dismissed_at IS NULL \
         ORDER BY \
           CASE WHEN status = 'running' THEN 0 WHEN kind = 'migrate' THEN 1 ELSE 2 END, \
           created_at DESC \
         LIMIT 1",
    )
    .fetch_optional(pool)
    .await?;
    Ok(row)
}

async fn append_log(
    pool: &PgPool,
    run_id: Uuid,
    level: &str,
    message: &str,
    node_id: Option<&str>,
    object_key: Option<&str>,
) -> Result<(), AppError> {
    sqlx::query(
        "INSERT INTO storage_migration_log_entries (run_id, level, message, node_id, object_key) \
         VALUES ($1, $2, $3, $4, $5)",
    )
    .bind(run_id)
    .bind(level)
    .bind(message)
    .bind(node_id)
    .bind(object_key)
    .execute(pool)
    .await?;
    Ok(())
}

struct RunCountUpdate<'a> {
    migrated: i64,
    skipped: i64,
    failed: i64,
    scanned: i64,
    batch_number: i32,
    current_node_id: Option<&'a str>,
    progress: &'a RunProgress,
}

async fn update_run_counts(
    pool: &PgPool,
    run_id: Uuid,
    update: RunCountUpdate<'_>,
) -> Result<(), AppError> {
    sqlx::query(
        "UPDATE storage_migration_runs \
         SET migrated = $2, skipped = $3, failed = $4, scanned = $5, batch_number = $6, \
             current_node_id = $7, progress_json = $8, updated_at = now() \
         WHERE id = $1",
    )
    .bind(run_id)
    .bind(update.migrated)
    .bind(update.skipped)
    .bind(update.failed)
    .bind(update.scanned)
    .bind(update.batch_number)
    .bind(update.current_node_id)
    .bind(serde_json::to_value(update.progress).unwrap_or_else(|_| serde_json::json!({})))
    .execute(pool)
    .await?;
    Ok(())
}

async fn finish_run(
    pool: &PgPool,
    run_id: Uuid,
    status: StorageMigrationRunStatus,
    total_target: Option<i64>,
    error_message: Option<String>,
) -> Result<(), AppError> {
    sqlx::query(
        "UPDATE storage_migration_runs \
         SET status = $2, total_target = COALESCE($3, total_target), error_message = $4, \
             completed_at = now(), updated_at = now(), current_node_id = NULL \
         WHERE id = $1",
    )
    .bind(run_id)
    .bind(status.as_str())
    .bind(total_target)
    .bind(error_message)
    .execute(pool)
    .await?;
    Ok(())
}

async fn is_run_cancelled(pool: &PgPool, run_id: Uuid) -> Result<bool, AppError> {
    let status: Option<String> =
        sqlx::query_scalar("SELECT status FROM storage_migration_runs WHERE id = $1")
            .bind(run_id)
            .fetch_optional(pool)
            .await?;
    Ok(matches!(status.as_deref(), Some("cancelled")))
}

async fn ensure_no_running_run(pool: &PgPool) -> Result<(), AppError> {
    let active: Option<(Uuid, String)> = sqlx::query_as(
        "SELECT id, kind FROM storage_migration_runs WHERE status = 'running' LIMIT 1",
    )
    .fetch_optional(pool)
    .await?;
    if let Some((run_id, kind)) = active {
        return Err(AppError::BadRequest(format!(
            "A storage {kind} run is already in progress (id {run_id}). Cancel it before starting another."
        )));
    }
    Ok(())
}

async fn find_matching_preview(
    pool: &PgPool,
    node_id: Option<&str>,
    prefix: &str,
) -> Result<Option<StorageMigrationRunRow>, AppError> {
    let row = sqlx::query_as::<_, StorageMigrationRunRow>(
        "SELECT id, kind, status, node_id, prefix, total_target, migrated, skipped, failed, scanned, \
         current_node_id, batch_number, preview_run_id, progress_json, error_message, started_by_user_id, \
         dismissed_at, created_at, updated_at, completed_at \
         FROM storage_migration_runs \
         WHERE kind = 'preview' AND status = 'complete' \
           AND COALESCE(node_id, '') = COALESCE($1, '') AND prefix = $2 \
         ORDER BY completed_at DESC NULLS LAST \
         LIMIT 1",
    )
    .bind(node_id)
    .bind(prefix)
    .fetch_optional(pool)
    .await?;
    Ok(row)
}

// Human: Resolve the preview run for migrate — explicit id from the UI wins over scope lookup.
// Agent: READS preview_run_id when set; VERIFIES kind/status/scope before spawn_run.
async fn resolve_preview_for_migrate(
    pool: &PgPool,
    preview_run_id: Option<Uuid>,
    node_id: Option<&str>,
    prefix: &str,
) -> Result<StorageMigrationRunRow, AppError> {
    if let Some(run_id) = preview_run_id {
        let row = fetch_run(pool, run_id)
            .await?
            .ok_or(AppError::BadRequest(
                "The selected preview run was not found. Run preview migration again.".into(),
            ))?;
        if row.kind != StorageMigrationRunKind::Preview.as_str() || row.status != "complete" {
            return Err(AppError::BadRequest(
                "The selected preview run is not complete. Run preview migration again.".into(),
            ));
        }
        let scope_matches = row.node_id.as_deref() == node_id
            && row.prefix == prefix;
        if !scope_matches {
            return Err(AppError::BadRequest(
                "The selected preview run does not match the current node and prefix.".into(),
            ));
        }
        return Ok(row);
    }

    find_matching_preview(pool, node_id, prefix)
        .await?
        .ok_or_else(|| {
            AppError::BadRequest(
                "Run preview migration for this node and prefix before starting migration.".into(),
            )
        })
}

// Human: Background worker — paginates each node, persists counts/logs, honours cancel.
// Agent: LOOPS execute_node_migration_batch until all nodes complete or failure.
async fn run_storage_migration_worker(
    state: Arc<AppState>,
    run_id: Uuid,
    dry_run: bool,
    prefix: String,
) {
    let coordinator = state.storage_migration_coordinator.clone();
    coordinator.clear_cancel();

    let mut run = match fetch_run(&state.pool, run_id).await {
        Ok(Some(row)) => row,
        _ => return,
    };

    let mut progress: RunProgress = serde_json::from_value(run.progress_json.clone()).unwrap_or_default();
    if progress.node_ids.is_empty() {
        let _ = finish_run(
            &state.pool,
            run_id,
            StorageMigrationRunStatus::Error,
            None,
            Some("No storage nodes configured for migration.".into()),
        )
        .await;
        return;
    }

    let node_map: HashMap<String, StorageNodeRecord> =
        match load_migration_node_rows(&state.pool, run.node_id.as_deref()).await {
            Ok(rows) => rows.into_iter().map(|row| (row.id.clone(), row)).collect(),
            Err(error) => {
                let _ = finish_run(
                    &state.pool,
                    run_id,
                    StorageMigrationRunStatus::Error,
                    None,
                    Some(error.to_string()),
                )
                .await;
                return;
            }
        };

    let _ = append_log(
        &state.pool,
        run_id,
        "info",
        if dry_run {
            "Preview scan started"
        } else {
            "Migration started"
        },
        None,
        None,
    )
    .await;

    while progress.current_node_index < progress.node_ids.len() {
        if coordinator.is_cancel_requested() || is_run_cancelled(&state.pool, run_id).await.unwrap_or(false)
        {
            let _ = finish_run(
                &state.pool,
                run_id,
                StorageMigrationRunStatus::Cancelled,
                None,
                None,
            )
            .await;
            let _ = append_log(&state.pool, run_id, "warn", "Run cancelled", None, None).await;
            return;
        }

        let node_id = progress.node_ids[progress.current_node_index].clone();
        let Some(record) = node_map.get(&node_id) else {
            progress.current_node_index += 1;
            progress.cursors.remove(&node_id);
            continue;
        };

        let cursor = progress.cursors.get(&node_id).map(String::as_str);
        run.batch_number += 1;

        let log_pool = state.pool.clone();
        let log_node_id = node_id.clone();
        let log_run_id = run_id;
        let log_sink: Arc<StorageMigrationLogSink> = Arc::new(move |entry: StorageMigrationObjectLog| {
            let pool = log_pool.clone();
            let node = log_node_id.clone();
            let run = log_run_id;
            tokio::spawn(async move {
                let _ = append_log(
                    &pool,
                    run,
                    entry.level,
                    &entry.message,
                    Some(node.as_str()),
                    entry.object_key.as_deref(),
                )
                .await;
            });
        });

        let batch_future = execute_node_migration_batch(
            state.as_ref(),
            record,
            NodeMigrationBatchRequest {
                prefix: &prefix,
                limit: BATCH_LIMIT,
                start_after: cursor,
                dry_run,
                prefer_server: true,
                log_sink: Some(log_sink.as_ref()),
            },
        );

        let batch_result = tokio::time::timeout(BATCH_EXECUTION_TIMEOUT, batch_future).await;

        let report = match batch_result {
            Ok(Ok(report)) => report,
            Ok(Err(error)) => {
                let message = error.to_string();
                let _ = append_log(&state.pool, run_id, "error", &message, Some(&node_id), None).await;
                let _ = finish_run(
                    &state.pool,
                    run_id,
                    StorageMigrationRunStatus::Error,
                    None,
                    Some(message),
                )
                .await;
                return;
            }
            Err(_) => {
                let timeout_secs = BATCH_EXECUTION_TIMEOUT.as_secs();
                let message = format!(
                    "Migration batch timed out after {timeout_secs}s on node {node_id}. \
                     Nebular may be stuck on a large object or the storage volume may be full. \
                     Check object-storage logs and disk space, cancel this run, then retry."
                );
                let _ = append_log(&state.pool, run_id, "error", &message, Some(&node_id), None).await;
                let _ = finish_run(
                    &state.pool,
                    run_id,
                    StorageMigrationRunStatus::Error,
                    Some(run.total_target),
                    Some(message),
                )
                .await;
                return;
            }
        };

        run.migrated += report.migrated as i64;
        run.skipped += report.skipped as i64;
        run.failed += report.failed as i64;
        run.scanned += report.scanned as i64;
        run.current_node_id = Some(node_id.clone());

        let batch_summary = format!(
            "Batch {} on {} ({}): migrated {}, skipped {}, failed {}",
            run.batch_number,
            node_id,
            report.method,
            report.migrated,
            report.skipped,
            report.failed
        );
        let _ = append_log(
            &state.pool,
            run_id,
            "info",
            &batch_summary,
            Some(&node_id),
            None,
        )
        .await;

        if report.is_truncated {
            if let Some(next) = report.next_start_after {
                progress.cursors.insert(node_id, next);
            } else {
                progress.current_node_index += 1;
                progress.cursors.remove(&node_id);
            }
        } else {
            progress.current_node_index += 1;
            progress.cursors.remove(&node_id);
        }

        let _ = update_run_counts(
            &state.pool,
            run_id,
            RunCountUpdate {
                migrated: run.migrated,
                skipped: run.skipped,
                failed: run.failed,
                scanned: run.scanned,
                batch_number: run.batch_number,
                current_node_id: run.current_node_id.as_deref(),
                progress: &progress,
            },
        )
        .await;

        if !dry_run && report.failed > 0 {
            let _ = finish_run(
                &state.pool,
                run_id,
                StorageMigrationRunStatus::Error,
                Some(run.total_target),
                Some("One or more objects failed to migrate. See the run log for details.".into()),
            )
            .await;
            let _ = append_log(
                &state.pool,
                run_id,
                "error",
                "Migration finished with errors",
                None,
                None,
            )
            .await;
            return;
        }
    }

    if dry_run {
        let total = run.migrated.max(0);
        let _ = finish_run(
            &state.pool,
            run_id,
            StorageMigrationRunStatus::Complete,
            Some(total),
            None,
        )
        .await;
        let _ = append_log(
            &state.pool,
            run_id,
            "info",
            &format!("Preview complete — {total} object(s) need migration"),
            None,
            None,
        )
        .await;
        return;
    }

    let _ = finish_run(
        &state.pool,
        run_id,
        if run.failed > 0 {
            StorageMigrationRunStatus::Error
        } else {
            StorageMigrationRunStatus::Complete
        },
        Some(run.total_target),
        if run.failed > 0 {
            Some("One or more objects failed to migrate. See the run log for details.".into())
        } else {
            None
        },
    )
    .await;
    let _ = append_log(
        &state.pool,
        run_id,
        "info",
        &format!("Migration complete — {} object(s) migrated", run.migrated),
        None,
        None,
    )
    .await;
}

async fn spawn_run(
    state: Arc<AppState>,
    kind: StorageMigrationRunKind,
    node_id: Option<String>,
    prefix: String,
    started_by: &str,
    preview_run_id: Option<Uuid>,
    total_target: i64,
) -> Result<StorageMigrationRunRow, AppError> {
    ensure_no_running_run(&state.pool).await?;

    let node_rows = load_migration_node_rows(&state.pool, node_id.as_deref()).await?;
    if node_rows.is_empty() {
        return Err(AppError::BadRequest(
            "No enabled storage nodes match the request.".into(),
        ));
    }

    let progress = RunProgress {
        node_ids: if let Some(ref scoped) = node_id {
            vec![scoped.clone()]
        } else {
            node_rows.into_iter().map(|row| row.id).collect()
        },
        current_node_index: 0,
        cursors: HashMap::new(),
    };

    let run_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO storage_migration_runs \
         (id, kind, status, node_id, prefix, total_target, preview_run_id, progress_json, started_by_user_id) \
         VALUES ($1, $2, 'running', $3, $4, $5, $6, $7, $8)",
    )
    .bind(run_id)
    .bind(kind.as_str())
    .bind(node_id.as_deref())
    .bind(&prefix)
    .bind(total_target)
    .bind(preview_run_id)
    .bind(serde_json::to_value(&progress).unwrap_or_else(|_| serde_json::json!({})))
    .bind(started_by)
    .execute(&state.pool)
    .await?;

    let row = fetch_run(&state.pool, run_id)
        .await?
        .ok_or_else(|| AppError::Internal(anyhow::anyhow!("migration run insert missing")))?;

    let dry_run = kind == StorageMigrationRunKind::Preview;
    let worker_state = state.clone();
    let worker_prefix = prefix.clone();
    tokio::spawn(async move {
        run_storage_migration_worker(worker_state, run_id, dry_run, worker_prefix).await;
    });

    Ok(row)
}

// Human: Resume any migration runs left in `running` after an API restart.
// Agent: CALLED from run() on startup; SPAWNS worker per orphaned row.
pub async fn resume_running_storage_migrations(state: Arc<AppState>) {
    let rows = sqlx::query_as::<_, StorageMigrationRunRow>(
        "SELECT id, kind, status, node_id, prefix, total_target, migrated, skipped, failed, scanned, \
         current_node_id, batch_number, preview_run_id, progress_json, error_message, started_by_user_id, \
         dismissed_at, created_at, updated_at, completed_at \
         FROM storage_migration_runs WHERE status = 'running' ORDER BY created_at ASC",
    )
    .fetch_all(&state.pool)
    .await
    .unwrap_or_default();

    for row in rows {
        let kind = StorageMigrationRunKind::parse(&row.kind).unwrap_or(StorageMigrationRunKind::Preview);
        let dry_run = kind == StorageMigrationRunKind::Preview;
        let worker_state = state.clone();
        let prefix = row.prefix.clone();
        let run_id = row.id;
        tokio::spawn(async move {
            run_storage_migration_worker(worker_state, run_id, dry_run, prefix).await;
        });
    }
}

// Human: GET /api/v1/admin/maintenance/storage-migration/status — active or latest undismissed run.
// Agent: InstanceAdmin; RETURNS running job first so any admin can restore the progress tray.
pub async fn get_storage_migration_status(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<StorageMigrationRunResponse>, AppError> {
    require_instance_permission(&state.pool, &claims, Permission::InstanceAdmin).await?;
    let row = fetch_latest_visible_run(&state.pool)
        .await?
        .ok_or(AppError::NotFound)?;
    Ok(Json(row_to_response(row)))
}

// Human: POST /api/v1/admin/maintenance/storage-migration/preview — full per-object dry-run scan.
// Agent: InstanceAdmin; SPAWNS background preview worker; AUDIT admin.storage_blobs.preview.
pub async fn start_storage_migration_preview(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    headers: HeaderMap,
    Json(body): Json<StartStorageMigrationRunBody>,
) -> Result<Json<StorageMigrationRunResponse>, AppError> {
    require_instance_permission(&state.pool, &claims, Permission::InstanceAdmin).await?;

    let prefix = body.prefix.trim().to_string();
    let node_id = body
        .node_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);

    let row = spawn_run(
        state.clone(),
        StorageMigrationRunKind::Preview,
        node_id.clone(),
        prefix.clone(),
        &claims.sub,
        None,
        0,
    )
    .await?;

    audit::write_audit(
        &state.pool,
        Some(&claims.sub),
        "admin.storage_blobs.preview",
        Some("instance"),
        Some(&claims.sub),
        Some(serde_json::json!({
            "run_id": row.id,
            "node_id": node_id,
            "prefix": prefix,
        })),
        &headers,
    )
    .await
    .ok();

    Ok(Json(row_to_response(row)))
}

// Human: POST /api/v1/admin/maintenance/storage-migration/migrate — starts migrate after preview.
// Agent: InstanceAdmin; REQUIRES matching completed preview; AUDIT admin.storage_blobs.migrate_start.
pub async fn start_storage_migration_run(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    headers: HeaderMap,
    Json(body): Json<StartStorageMigrationRunBody>,
) -> Result<Json<StorageMigrationRunResponse>, AppError> {
    require_instance_permission(&state.pool, &claims, Permission::InstanceAdmin).await?;

    let prefix = body.prefix.trim().to_string();
    let node_id = body
        .node_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);

    let preview = resolve_preview_for_migrate(
        &state.pool,
        body.preview_run_id,
        node_id.as_deref(),
        &prefix,
    )
    .await?;

    if preview.migrated <= 0 {
        return Err(AppError::BadRequest(
            "Preview found no objects that need migration.".into(),
        ));
    }

    let row = spawn_run(
        state.clone(),
        StorageMigrationRunKind::Migrate,
        node_id.clone(),
        prefix.clone(),
        &claims.sub,
        Some(preview.id),
        preview.migrated,
    )
    .await?;

    audit::write_audit(
        &state.pool,
        Some(&claims.sub),
        "admin.storage_blobs.migrate_start",
        Some("instance"),
        Some(&claims.sub),
        Some(serde_json::json!({
            "run_id": row.id,
            "preview_run_id": preview.id,
            "node_id": node_id,
            "prefix": prefix,
            "total_target": preview.migrated,
        })),
        &headers,
    )
    .await
    .ok();

    Ok(Json(row_to_response(row)))
}

// Human: GET /api/v1/admin/maintenance/storage-migration/{id}/logs — paginated full run log.
// Agent: InstanceAdmin; RETURNS entries in ascending id order with cursor pagination.
pub async fn get_storage_migration_logs(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(run_id): Path<Uuid>,
    Query(query): Query<StorageMigrationLogsQuery>,
) -> Result<Json<StorageMigrationLogsResponse>, AppError> {
    require_instance_permission(&state.pool, &claims, Permission::InstanceAdmin).await?;

    let _ = fetch_run(&state.pool, run_id)
        .await?
        .ok_or(AppError::NotFound)?;

    let limit = query.limit.clamp(1, 500);
    let rows = if let Some(after) = query.after {
        sqlx::query_as::<_, (i64, String, String, Option<String>, Option<String>, chrono::DateTime<chrono::Utc>)>(
            "SELECT id, level, message, node_id, object_key, created_at \
             FROM storage_migration_log_entries \
             WHERE run_id = $1 AND id > $2 \
             ORDER BY id ASC LIMIT $3",
        )
        .bind(run_id)
        .bind(after)
        .bind(limit + 1)
        .fetch_all(&state.pool)
        .await?
    } else {
        sqlx::query_as::<_, (i64, String, String, Option<String>, Option<String>, chrono::DateTime<chrono::Utc>)>(
            "SELECT id, level, message, node_id, object_key, created_at \
             FROM storage_migration_log_entries \
             WHERE run_id = $1 \
             ORDER BY id ASC LIMIT $2",
        )
        .bind(run_id)
        .bind(limit + 1)
        .fetch_all(&state.pool)
        .await?
    };

    let has_more = rows.len() as i64 > limit;
    let page: Vec<_> = rows.into_iter().take(limit as usize).collect();
    let next_after = page.last().map(|row| row.0);
    let entries = page
        .into_iter()
        .map(|row| StorageMigrationLogEntryResponse {
            id: row.0,
            level: row.1,
            message: row.2,
            node_id: row.3,
            object_key: row.4,
            created_at: row.5.to_rfc3339(),
        })
        .collect();

    Ok(Json(StorageMigrationLogsResponse {
        entries,
        has_more,
        next_after,
    }))
}

// Human: POST /api/v1/admin/maintenance/storage-migration/{id}/cancel — stop between batches.
// Agent: InstanceAdmin; SETS status cancelled; SIGNALS in-memory coordinator.
pub async fn cancel_storage_migration_run(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    headers: HeaderMap,
    Path(run_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    require_instance_permission(&state.pool, &claims, Permission::InstanceAdmin).await?;

    let row = fetch_run(&state.pool, run_id)
        .await?
        .ok_or(AppError::NotFound)?;

    if row.status != StorageMigrationRunStatus::Running.as_str() {
        return Err(AppError::BadRequest(
            "Only running storage migration runs can be cancelled.".into(),
        ));
    }

    state.storage_migration_coordinator.request_cancel();
    sqlx::query(
        "UPDATE storage_migration_runs SET status = 'cancelled', completed_at = now(), updated_at = now() \
         WHERE id = $1",
    )
    .bind(run_id)
    .execute(&state.pool)
    .await?;

    audit::write_audit(
        &state.pool,
        Some(&claims.sub),
        "admin.storage_blobs.migrate_cancel",
        Some("storage_migration_run"),
        Some(&run_id.to_string()),
        None,
        &headers,
    )
    .await
    .ok();

    Ok(Json(serde_json::json!({ "ok": true })))
}

// Human: POST /api/v1/admin/maintenance/storage-migration/{id}/dismiss — hide finished run UI.
// Agent: InstanceAdmin; SETS dismissed_at so status endpoint skips it.
pub async fn dismiss_storage_migration_run(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(run_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    require_instance_permission(&state.pool, &claims, Permission::InstanceAdmin).await?;

    let _ = fetch_run(&state.pool, run_id)
        .await?
        .ok_or(AppError::NotFound)?;

    sqlx::query(
        "UPDATE storage_migration_runs SET dismissed_at = now(), updated_at = now() WHERE id = $1",
    )
    .bind(run_id)
    .execute(&state.pool)
    .await?;

    Ok(Json(serde_json::json!({ "ok": true })))
}
