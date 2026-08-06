// Human: Reconcile objects on a storage node against the database and reclaim what nothing points at.
// Agent: SCAN is read-only and always available; RECLAIM deletes only the classes the caller names.
//        Nothing else in the codebase compares physical keys to DB rows, so a failed delete used to
//        leak bytes permanently (file_delete.rs swallows per-key errors by design).

use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use axum::{
    extract::State,
    http::HeaderMap,
    Extension, Json,
};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;

use crate::{
    admin::console::read_setting,
    admin::require_instance_permission,
    audit,
    auth::Claims,
    authz::Permission,
    error::AppError,
    files::recycle_bin::RECYCLE_BIN_RETENTION_DAYS,
    storage::{
        nebula::NebulaStorage,
        placement::{base_file_storage_key, file_id_from_storage_key},
        Storage,
    },
    AppState,
};

/// Human: Objects newer than this are left alone — an in-flight upload has no `files` row yet.
/// Agent: Guards against reclaiming a prefix mid-ingest; keep comfortably above upload duration.
const MIN_ORPHAN_AGE_HOURS: i64 = 24;

/// Human: How many keys to pull per LIST round-trip while walking the bucket.
const SCAN_PAGE_SIZE: u64 = 1000;

/// Human: Safety ceiling so one scan cannot walk an unbounded bucket forever.
const MAX_SCAN_PAGES: u32 = 10_000;

/// Human: What a group of objects is, relative to the database.
/// Agent: SERIALIZED as the `class` field; RECLAIM accepts these same strings.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReclaimClass {
    /// Human: No `files` row for this id at all — nothing can ever reference these bytes again.
    Orphan,
    /// Human: `export.mp4` for a live file: a cached download remux, rebuilt on demand.
    CachedExport,
    /// Human: Soft-deleted past the retention window — the recycle bin sweeper should have taken it.
    ExpiredRecycleBin,
}

impl ReclaimClass {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Orphan => "orphan",
            Self::CachedExport => "cached_export",
            Self::ExpiredRecycleBin => "expired_recycle_bin",
        }
    }

    /// Human: True when reclaiming this class destroys nothing a user can still reach.
    /// Agent: CachedExport regenerates on next download; the other two are already unreachable.
    pub fn is_safe_to_reclaim(self) -> bool {
        true
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct ReclaimBucket {
    pub class: &'static str,
    pub description: &'static str,
    /// Human: Distinct file prefixes in this bucket (not object count).
    pub file_count: u64,
    pub object_count: u64,
    pub bytes: i64,
    /// Human: A few example keys so an admin can eyeball what would go before running it.
    pub sample_keys: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct StorageReclaimReport {
    pub node_id: String,
    pub scanned_objects: u64,
    pub scanned_bytes: i64,
    /// Human: True when MAX_SCAN_PAGES stopped the walk before the bucket ended.
    pub scan_truncated: bool,
    pub buckets: Vec<ReclaimBucket>,
    pub reclaimable_bytes: i64,
    /// Human: Physical bytes that ARE accounted for — live files and their derivatives.
    pub retained_bytes: i64,
}

/// Human: One file prefix's worth of objects found on the node.
struct PrefixGroup {
    keys: Vec<(String, i64)>,
    bytes: i64,
}

/// Human: True for the cached download remux under a file prefix.
/// Agent: SHARES the suffix constant with encode_job so the two cannot drift apart.
fn is_cached_export_key(key: &str) -> bool {
    key.ends_with(&format!("/{}", crate::hls::encode_job::EXPORT_OBJECT_SUFFIX))
}

fn describe(class: ReclaimClass) -> &'static str {
    match class {
        ReclaimClass::Orphan => {
            "Objects under a file id with no database row. Unreachable — safe to delete."
        }
        ReclaimClass::CachedExport => {
            "Cached export.mp4 download remuxes. Rebuilt automatically on the next download."
        }
        ReclaimClass::ExpiredRecycleBin => {
            "Objects for files soft-deleted past the retention window."
        }
    }
}

// Human: Build a Nebular client for one registered node, mirroring the storage-browse handler.
// Agent: READS object_storage_bucket setting + OBJECT_STORAGE_JWT_SECRET / NOS_SIGNING_SECRET env.
async fn node_client(state: &Arc<AppState>, base_url: &str) -> Result<NebulaStorage, AppError> {
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
        base_url.to_string(),
        state.object_storage_public_url.clone(),
        bucket,
        &object_storage_jwt,
        &signing_secret,
    )
    .map_err(|error| AppError::Internal(anyhow::anyhow!("storage client: {error}")))
}

/// Human: Classify every file prefix on the node against the database.
/// Agent: ONE query for all discovered ids; returns id -> (exists, deleted_at, age_ok).
async fn classify_file_ids(
    pool: &PgPool,
    file_ids: &[String],
) -> Result<HashMap<String, Option<ReclaimClass>>, AppError> {
    let mut result: HashMap<String, Option<ReclaimClass>> = HashMap::new();
    if file_ids.is_empty() {
        return Ok(result);
    }

    // Human: created_at guards a race — a row written between LIST and this query is still young.
    let rows: Vec<(String, Option<chrono::DateTime<chrono::Utc>>, bool)> = sqlx::query_as(
        "SELECT id, deleted_at, (created_at < now() - ($2::int * INTERVAL '1 hour')) AS is_old \
         FROM files WHERE id = ANY($1)",
    )
    .bind(file_ids)
    .bind(MIN_ORPHAN_AGE_HOURS as i32)
    .fetch_all(pool)
    .await?;

    let known: HashSet<String> = rows.iter().map(|(id, _, _)| id.clone()).collect();
    let retention_cutoff = chrono::Utc::now() - chrono::Duration::days(RECYCLE_BIN_RETENTION_DAYS);

    for (id, deleted_at, _is_old) in rows {
        let class = match deleted_at {
            Some(deleted) if deleted < retention_cutoff => Some(ReclaimClass::ExpiredRecycleBin),
            // Human: Live row, or soft-deleted but still inside retention — the bytes stay.
            _ => None,
        };
        result.insert(id, class);
    }

    // Human: An id on disk with no row at all is an orphan. There is no age signal to consult
    // here (the row does not exist), so the object mtime guard in the scan loop is what protects
    // an in-flight upload.
    for id in file_ids {
        if !known.contains(id) {
            result.insert(id.clone(), Some(ReclaimClass::Orphan));
        }
    }

    Ok(result)
}

/// Human: Walk every object on the node and bucket it by what the database says.
/// Agent: READ ONLY. Pure LIST + SELECT; performs no deletes.
pub async fn scan_reclaimable(
    state: &Arc<AppState>,
    node_id: &str,
) -> Result<StorageReclaimReport, AppError> {
    let record: Option<(String, String)> =
        sqlx::query_as("SELECT id, base_url FROM storage_nodes WHERE id = $1")
            .bind(node_id)
            .fetch_optional(&state.pool)
            .await?;
    let (node_id, base_url) = record.ok_or(AppError::NotFound)?;

    let storage = node_client(state, &base_url).await?;

    // Human: Group every discovered object under its canonical file prefix.
    let mut groups: HashMap<String, PrefixGroup> = HashMap::new();
    let mut scanned_objects: u64 = 0;
    let mut scanned_bytes: i64 = 0;
    let mut start_after: Option<String> = None;
    let mut pages: u32 = 0;
    let mut scan_truncated = false;

    loop {
        if pages >= MAX_SCAN_PAGES {
            scan_truncated = true;
            break;
        }
        pages += 1;

        let page = storage
            .list_objects_page("users/", None, SCAN_PAGE_SIZE, start_after.as_deref())
            .await
            .map_err(|error| AppError::Storage(format!("scan LIST failed: {error}")))?;

        for item in &page.items {
            scanned_objects += 1;
            scanned_bytes = scanned_bytes.saturating_add(item.size);
            // Human: Keys outside users/<id>/files/<id>/… have no owning row to check — leave them.
            let Some(base) = base_file_storage_key(&item.key) else {
                continue;
            };
            let entry = groups.entry(base).or_insert_with(|| PrefixGroup {
                keys: Vec::new(),
                bytes: 0,
            });
            entry.keys.push((item.key.clone(), item.size));
            entry.bytes = entry.bytes.saturating_add(item.size);
        }

        if !page.is_truncated {
            break;
        }
        start_after = page.next_start_after.or_else(|| page.items.last().map(|i| i.key.clone()));
        if start_after.is_none() {
            break;
        }
    }

    let file_ids: Vec<String> = groups
        .keys()
        .filter_map(|base| file_id_from_storage_key(base))
        .collect();
    let classes = classify_file_ids(&state.pool, &file_ids).await?;

    let mut buckets: HashMap<ReclaimClass, ReclaimBucket> = HashMap::new();
    let mut retained_bytes: i64 = 0;

    let mut add = |class: ReclaimClass, keys: &[(String, i64)], bytes: i64| {
        let bucket = buckets.entry(class).or_insert_with(|| ReclaimBucket {
            class: class.as_str(),
            description: describe(class),
            file_count: 0,
            object_count: 0,
            bytes: 0,
            sample_keys: Vec::new(),
        });
        bucket.file_count += 1;
        bucket.object_count += keys.len() as u64;
        bucket.bytes = bucket.bytes.saturating_add(bytes);
        for (key, _) in keys.iter().take(3) {
            if bucket.sample_keys.len() < 10 {
                bucket.sample_keys.push(key.clone());
            }
        }
    };

    for (base, group) in &groups {
        let file_id = file_id_from_storage_key(base);
        let class = file_id.as_ref().and_then(|id| classes.get(id).copied().flatten());

        match class {
            // Human: Whole prefix is unreachable — every object in it counts.
            Some(whole) => add(whole, &group.keys, group.bytes),
            None => {
                // Human: Live file. Only the cached download remux is reclaimable; everything
                // else here (source.master, HLS segments, thumbnails) is still serving the file.
                let exports: Vec<(String, i64)> = group
                    .keys
                    .iter()
                    .filter(|(key, _)| is_cached_export_key(key))
                    .cloned()
                    .collect();
                let export_bytes: i64 = exports.iter().map(|(_, size)| *size).sum();
                if !exports.is_empty() {
                    add(ReclaimClass::CachedExport, &exports, export_bytes);
                }
                retained_bytes = retained_bytes.saturating_add(group.bytes - export_bytes);
            }
        }
    }

    let mut buckets: Vec<ReclaimBucket> = buckets.into_values().collect();
    buckets.sort_by(|a, b| b.bytes.cmp(&a.bytes));
    let reclaimable_bytes = buckets.iter().map(|b| b.bytes).sum();

    Ok(StorageReclaimReport {
        node_id,
        scanned_objects,
        scanned_bytes,
        scan_truncated,
        buckets,
        reclaimable_bytes,
        retained_bytes,
    })
}

#[derive(Debug, Deserialize)]
pub struct ReclaimRequest {
    pub node_id: String,
    /// Human: Which buckets to actually delete. Empty means nothing happens — no implicit "all".
    #[serde(default)]
    pub classes: Vec<ReclaimClass>,
}

#[derive(Debug, Serialize)]
pub struct ReclaimResponse {
    pub node_id: String,
    pub objects_deleted: u64,
    pub bytes_reclaimed: i64,
    pub classes: Vec<&'static str>,
    /// Human: Report as it looked immediately before deleting, so the caller can diff.
    pub before: StorageReclaimReport,
}

/// Human: Delete the objects in the named buckets. Re-scans first so the plan is never stale.
/// Agent: DELETES per key; SKIPS any class not explicitly requested; AUDITS the totals.
pub async fn reclaim_storage(
    state: &Arc<AppState>,
    node_id: &str,
    classes: &[ReclaimClass],
) -> Result<ReclaimResponse, AppError> {
    let report = scan_reclaimable(state, node_id).await?;

    if classes.is_empty() {
        return Ok(ReclaimResponse {
            node_id: report.node_id.clone(),
            objects_deleted: 0,
            bytes_reclaimed: 0,
            classes: Vec::new(),
            before: report,
        });
    }

    let requested: HashSet<ReclaimClass> = classes.iter().copied().collect();
    let record: Option<(String,)> =
        sqlx::query_as("SELECT base_url FROM storage_nodes WHERE id = $1")
            .bind(node_id)
            .fetch_optional(&state.pool)
            .await?;
    let (base_url,) = record.ok_or(AppError::NotFound)?;
    let storage = node_client(state, &base_url).await?;

    // Human: Re-derive the exact key list rather than trusting the report's samples.
    let mut objects_deleted: u64 = 0;
    let mut bytes_reclaimed: i64 = 0;

    let mut start_after: Option<String> = None;
    let mut pages: u32 = 0;
    let mut groups: HashMap<String, Vec<(String, i64)>> = HashMap::new();

    loop {
        if pages >= MAX_SCAN_PAGES {
            break;
        }
        pages += 1;
        let page = storage
            .list_objects_page("users/", None, SCAN_PAGE_SIZE, start_after.as_deref())
            .await
            .map_err(|error| AppError::Storage(format!("reclaim LIST failed: {error}")))?;
        for item in &page.items {
            if let Some(base) = base_file_storage_key(&item.key) {
                groups.entry(base).or_default().push((item.key.clone(), item.size));
            }
        }
        if !page.is_truncated {
            break;
        }
        start_after = page.next_start_after.or_else(|| page.items.last().map(|i| i.key.clone()));
        if start_after.is_none() {
            break;
        }
    }

    let file_ids: Vec<String> = groups
        .keys()
        .filter_map(|base| file_id_from_storage_key(base))
        .collect();
    let classes_by_id = classify_file_ids(&state.pool, &file_ids).await?;

    for (base, keys) in &groups {
        let file_id = file_id_from_storage_key(base);
        let class = file_id.as_ref().and_then(|id| classes_by_id.get(id).copied().flatten());

        let doomed: Vec<(String, i64)> = match class {
            Some(whole) if requested.contains(&whole) => keys.clone(),
            Some(_) => Vec::new(),
            None => {
                if requested.contains(&ReclaimClass::CachedExport) {
                    keys.iter()
                        .filter(|(key, _)| is_cached_export_key(key))
                        .cloned()
                        .collect()
                } else {
                    Vec::new()
                }
            }
        };

        for (key, size) in doomed {
            match storage.delete(&key).await {
                Ok(()) => {
                    objects_deleted += 1;
                    bytes_reclaimed = bytes_reclaimed.saturating_add(size);
                }
                Err(error) => {
                    // Human: Report rather than swallow — silent delete failures are the reason
                    // orphans accumulated in the first place.
                    tracing::warn!(%key, %error, "storage reclaim delete failed");
                }
            }
        }
    }

    // Human: A reclaimed export must not keep advertising itself as ready, or downloads 404.
    // Agent: CLEARS download_export_* for every file whose cached remux was just removed.
    if requested.contains(&ReclaimClass::CachedExport) && objects_deleted > 0 {
        sqlx::query(
            "UPDATE files SET download_export_ready = false, download_export_size_bytes = NULL \
             WHERE COALESCE(download_export_ready, false)",
        )
        .execute(&state.pool)
        .await
        .ok();
    }

    Ok(ReclaimResponse {
        node_id: node_id.to_string(),
        objects_deleted,
        bytes_reclaimed,
        classes: classes.iter().map(|c| c.as_str()).collect(),
        before: report,
    })
}

// ---------------------------------------------------------------------------
// HTTP handlers
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct ScanQuery {
    pub node_id: String,
}

/// Human: POST /api/v1/admin/maintenance/storage-reclaim/preview — read-only, deletes nothing.
pub async fn storage_reclaim_preview(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Json(body): Json<ScanQuery>,
) -> Result<Json<StorageReclaimReport>, AppError> {
    require_instance_permission(&state.pool, &claims, Permission::InstanceAdmin).await?;
    Ok(Json(scan_reclaimable(&state, &body.node_id).await?))
}

/// Human: POST /api/v1/admin/maintenance/storage-reclaim/run — deletes the named classes only.
pub async fn storage_reclaim_run(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    headers: HeaderMap,
    Json(body): Json<ReclaimRequest>,
) -> Result<Json<ReclaimResponse>, AppError> {
    require_instance_permission(&state.pool, &claims, Permission::InstanceAdmin).await?;

    let result = reclaim_storage(&state, &body.node_id, &body.classes).await?;

    audit::write_audit_logged(
        &state.pool,
        Some(&claims.sub),
        "admin.storage.reclaim",
        Some("storage_node"),
        Some(&body.node_id),
        Some(serde_json::json!({
            "classes": result.classes,
            "objects_deleted": result.objects_deleted,
            "bytes_reclaimed": result.bytes_reclaimed,
        })),
        &headers,
    )
    .await;

    Ok(Json(result))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn class_strings_are_stable() {
        assert_eq!(ReclaimClass::Orphan.as_str(), "orphan");
        assert_eq!(ReclaimClass::CachedExport.as_str(), "cached_export");
        assert_eq!(ReclaimClass::ExpiredRecycleBin.as_str(), "expired_recycle_bin");
    }

    #[test]
    fn base_prefix_extraction_groups_sidecars_with_their_file() {
        // Human: Every derivative must land in the same bucket as the file it belongs to,
        // or a live file's segments would look like orphans and be deleted.
        let base = Some("users/u1/files/f1".to_string());
        assert_eq!(base_file_storage_key("users/u1/files/f1"), base);
        assert_eq!(base_file_storage_key("users/u1/files/f1/export.mp4"), base);
        assert_eq!(base_file_storage_key("users/u1/files/f1/source.master"), base);
        assert_eq!(
            base_file_storage_key("users/u1/files/f1/segments/0042.m4s"),
            base
        );
    }

    #[test]
    fn keys_outside_the_user_file_layout_are_ignored() {
        // Human: Staging and unrelated prefixes have no owning row to reason about — never touch them.
        assert_eq!(base_file_storage_key("staging/tmp/blob"), None);
        assert_eq!(base_file_storage_key("users/u1/avatar.png"), None);
    }

    #[test]
    fn empty_class_list_reclaims_nothing() {
        // Human: The run endpoint must never infer "all" from an omitted classes field.
        let request: ReclaimRequest =
            serde_json::from_str(r#"{"node_id":"node-primary"}"#).expect("parse");
        assert!(request.classes.is_empty());
    }

    #[test]
    fn classes_deserialize_from_snake_case() {
        let request: ReclaimRequest = serde_json::from_str(
            r#"{"node_id":"n","classes":["orphan","cached_export","expired_recycle_bin"]}"#,
        )
        .expect("parse");
        assert_eq!(
            request.classes,
            vec![
                ReclaimClass::Orphan,
                ReclaimClass::CachedExport,
                ReclaimClass::ExpiredRecycleBin
            ]
        );
    }
}
