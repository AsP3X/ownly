// Human: Capacity-aware node selection and Postgres placement metadata for multi-node uploads.
// Agent: READS storage_nodes + live Nebular metrics; WRITES storage_blob_placements + file_storage_parts.

use std::cmp::min;

use sqlx::PgPool;

use crate::admin::storage_nodes;
use crate::error::AppError;

/// Human: Live view of one registry row plus probed used bytes for placement decisions.
#[derive(Debug, Clone)]
pub struct NodeSnapshot {
    pub id: String,
    pub base_url: String,
    pub target_capacity_bytes: Option<i64>,
    pub used_bytes: i64,
}

/// Human: One stripe segment destined for a specific node object key.
#[derive(Debug, Clone)]
pub struct StripePartPlan {
    pub node_id: String,
    pub object_key: String,
    pub byte_offset: i64,
    pub byte_length: i64,
}

/// Human: Outcome of planning a blob upload — single node or striped overflow.
#[derive(Debug, Clone)]
pub enum UploadPlacementPlan {
    Single {
        node_id: String,
        object_key: String,
    },
    Striped {
        primary_node_id: String,
        parts: Vec<StripePartPlan>,
    },
}

// Human: `nebular` keeps object index in Nebular; `ownly` expects Nebular blob-only + Ownly Postgres index.
// Agent: READ from app_settings; DEFAULT nebular when unset.
pub async fn read_metadata_mode(pool: &PgPool) -> String {
    let row: Option<(String,)> =
        sqlx::query_as("SELECT value FROM app_settings WHERE key = 'storage_metadata_mode'")
            .fetch_optional(pool)
            .await
            .ok()
            .flatten();
    row.map(|(v,)| v)
        .filter(|v| v == "ownly" || v == "nebular")
        .unwrap_or_else(|| "nebular".into())
}

// Human: Base storage key for a file artifact (`users/{uid}/files/{fid}` prefix).
// Agent: STRIPS HLS/segment suffixes; RETURNS None for unrelated keys.
pub fn base_file_storage_key(key: &str) -> Option<String> {
    let segments: Vec<&str> = key.split('/').collect();
    if segments.len() >= 4 && segments[0] == "users" && segments[2] == "files" {
        Some(segments[..4].join("/"))
    } else {
        None
    }
}

// Human: Parse file id from canonical storage key path.
pub fn file_id_from_storage_key(key: &str) -> Option<String> {
    let segments: Vec<&str> = key.split('/').collect();
    if segments.len() >= 4 && segments[0] == "users" && segments[2] == "files" {
        Some(segments[3].to_string())
    } else {
        None
    }
}

pub(crate) fn remaining_bytes(node: &NodeSnapshot) -> i64 {
    match node.target_capacity_bytes {
        Some(cap) if cap > 0 => (cap - node.used_bytes).max(0),
        _ => i64::MAX,
    }
}

// Human: Sum free space across capped storage nodes — matches upload striping preflight.
// Agent: RETURNS None when every node is uncapped (unlimited network for UI); Some(sum) when any cap set.
pub fn aggregate_network_remaining_bytes(nodes: &[NodeSnapshot]) -> Option<i64> {
    if nodes.is_empty() {
        return None;
    }
    let mut total: i64 = 0;
    let mut any_capped = false;
    for node in nodes {
        if let Some(cap) = node.target_capacity_bytes {
            if cap > 0 {
                any_capped = true;
                let free = remaining_bytes(node);
                if free < i64::MAX {
                    total = total.saturating_add(free);
                }
            }
        }
    }
    if any_capped {
        Some(total)
    } else {
        None
    }
}

// Human: Bytes the user can still store — minimum of library quota and network aggregate.
// Agent: READS user used/quota + optional network sum; USED by GET /dashboard for upload warnings.
pub fn effective_remaining_bytes(
    user_used_bytes: i64,
    user_quota_bytes: i64,
    network_remaining_bytes: Option<i64>,
) -> i64 {
    let user_remaining = if user_quota_bytes > 0 {
        (user_quota_bytes - user_used_bytes.max(0)).max(0)
    } else {
        i64::MAX
    };
    let Some(network) = network_remaining_bytes else {
        return user_remaining;
    };
    if user_remaining == i64::MAX {
        return network.max(0);
    }
    user_remaining.min(network.max(0))
}

// Human: Load enabled nodes with fresh logical_bytes from each Nebular /metrics endpoint.
// Agent: ORDER BY created_at ASC so overflow fills earlier-registered nodes first.
pub async fn load_node_snapshots(pool: &PgPool) -> Result<Vec<NodeSnapshot>, AppError> {
    let records: Vec<storage_nodes::StorageNodeRecord> = sqlx::query_as(
        "SELECT id, region_label, base_url, architecture, target_capacity_bytes \
         FROM storage_nodes \
         WHERE enabled = true \
         ORDER BY created_at ASC",
    )
    .fetch_all(pool)
    .await?;

    let mut snapshots = Vec::with_capacity(records.len());
    for record in records {
        // Human: Unreachable nodes must not receive uploads — a dead host looks empty (used_bytes=0).
        // Agent: SKIPS node when /health fails; LOGS warn so ops can fix or disable the registry row.
        if !storage_nodes::probe_reachable(&record.base_url).await {
            tracing::warn!(
                node_id = %record.id,
                base_url = %record.base_url,
                "storage node unreachable; excluding from placement"
            );
            continue;
        }
        let used_bytes = storage_nodes::probe_logical_bytes(&record.base_url).await;
        snapshots.push(NodeSnapshot {
            id: record.id,
            base_url: record.base_url,
            target_capacity_bytes: record.target_capacity_bytes,
            used_bytes,
        });
    }
    Ok(snapshots)
}

// Human: Pick nodes for a blob of `size_bytes` — single node when possible, else stripe across caps.
// Agent: ERRORS with 507 when aggregate remaining capacity is insufficient.
pub fn plan_upload(
    nodes: &[NodeSnapshot],
    storage_key: &str,
    size_bytes: u64,
) -> Result<UploadPlacementPlan, AppError> {
    if nodes.is_empty() {
        return Err(AppError::Storage(
            "no storage nodes are registered for placement".into(),
        ));
    }

    let size = size_bytes as i64;
    if size == 0 {
        return Err(AppError::BadRequest("empty upload".into()));
    }

    for node in nodes {
        if remaining_bytes(node) >= size {
            return Ok(UploadPlacementPlan::Single {
                node_id: node.id.clone(),
                object_key: storage_key.to_string(),
            });
        }
    }

    let mut parts = Vec::new();
    let mut offset: i64 = 0;
    let mut remaining_upload = size;
    let mut primary_node_id: Option<String> = None;

    for node in nodes {
        if remaining_upload <= 0 {
            break;
        }
        let free = remaining_bytes(node);
        if free <= 0 {
            continue;
        }
        let take = min(free, remaining_upload);
        let part_index = parts.len() as i32;
        let object_key = format!("{storage_key}/parts/{part_index:04}");
        if primary_node_id.is_none() {
            primary_node_id = Some(node.id.clone());
        }
        parts.push(StripePartPlan {
            node_id: node.id.clone(),
            object_key,
            byte_offset: offset,
            byte_length: take,
        });
        offset += take;
        remaining_upload -= take;
    }

    if remaining_upload > 0 {
        return Err(AppError::Storage(
            "no storage node has sufficient aggregate capacity for this upload".into(),
        ));
    }

    let primary_node_id = primary_node_id.ok_or_else(|| {
        AppError::Storage("could not assign a storage node for upload".into())
    })?;

    Ok(UploadPlacementPlan::Striped {
        primary_node_id,
        parts,
    })
}

// Human: Reserve the primary node for a file before metadata INSERT (e.g. video HLS ingest).
// Agent: CALLS plan_upload; RETURNS node id; DOES NOT write blobs.
pub async fn reserve_node_for_upload(
    pool: &PgPool,
    storage_key: &str,
    size_bytes: u64,
) -> Result<String, AppError> {
    let nodes = load_node_snapshots(pool).await?;
    let plan = plan_upload(&nodes, storage_key, size_bytes)?;
    Ok(match plan {
        UploadPlacementPlan::Single { node_id, .. } => node_id,
        UploadPlacementPlan::Striped { primary_node_id, .. } => primary_node_id,
    })
}

// Human: Copy placement from PUT-time cache onto the files row after INSERT.
// Agent: READS storage_blob_placements; UPDATES files.storage_node_id; IDEMPOTENT when unset.
pub async fn link_file_to_placement(
    pool: &PgPool,
    file_id: &str,
    storage_key: &str,
) -> Result<(), AppError> {
    let placement: Option<(String,)> = sqlx::query_as(
        "SELECT storage_node_id FROM storage_blob_placements WHERE storage_key = $1",
    )
    .bind(storage_key)
    .fetch_optional(pool)
    .await?;

    let Some((node_id,)) = placement else {
        return Ok(());
    };

    sqlx::query(
        "UPDATE files SET storage_node_id = $1 WHERE id = $2 AND storage_node_id IS NULL",
    )
    .bind(&node_id)
    .bind(file_id)
    .execute(pool)
    .await?;

    Ok(())
}

// Human: Persist placement metadata after a successful routed PUT.
// Agent: WRITES storage_blob_placements; WRITES file_storage_parts when striped.
pub async fn persist_placement(
    pool: &PgPool,
    storage_key: &str,
    plan: &UploadPlacementPlan,
) -> Result<(), AppError> {
    let primary_node_id = match plan {
        UploadPlacementPlan::Single { node_id, .. } => node_id.clone(),
        UploadPlacementPlan::Striped { primary_node_id, .. } => primary_node_id.clone(),
    };

    sqlx::query(
        "INSERT INTO storage_blob_placements (storage_key, storage_node_id) \
         VALUES ($1, $2) \
         ON CONFLICT (storage_key) DO UPDATE SET storage_node_id = EXCLUDED.storage_node_id",
    )
    .bind(storage_key)
    .bind(&primary_node_id)
    .execute(pool)
    .await?;

    if let UploadPlacementPlan::Striped { parts, .. } = plan {
        for (index, part) in parts.iter().enumerate() {
            sqlx::query(
                "INSERT INTO file_storage_parts \
                 (storage_key, part_index, storage_node_id, object_key, byte_offset, byte_length) \
                 VALUES ($1, $2, $3, $4, $5, $6) \
                 ON CONFLICT (storage_key, part_index) DO UPDATE SET \
                 storage_node_id = EXCLUDED.storage_node_id, \
                 object_key = EXCLUDED.object_key, \
                 byte_offset = EXCLUDED.byte_offset, \
                 byte_length = EXCLUDED.byte_length",
            )
            .bind(storage_key)
            .bind(index as i32)
            .bind(&part.node_id)
            .bind(&part.object_key)
            .bind(part.byte_offset)
            .bind(part.byte_length)
            .execute(pool)
            .await?;
        }
    }

    Ok(())
}

#[derive(Debug, sqlx::FromRow)]
pub(crate) struct StripePartRow {
    pub storage_node_id: String,
    pub object_key: String,
    /// Human: Byte offset in the logical file — persisted for future range-GET; stripe stream uses part order.
    #[allow(dead_code)]
    pub byte_offset: i64,
    #[allow(dead_code)]
    pub byte_length: i64,
}

// Human: Resolve which node serves a storage key (file row, stripe table, or PUT cache).
pub async fn resolve_node_for_key(pool: &PgPool, key: &str) -> Result<Option<String>, AppError> {
    let base = base_file_storage_key(key).unwrap_or_else(|| key.to_string());

    if let Some(file_id) = file_id_from_storage_key(&base) {
        let from_file: Option<(Option<String>,)> =
            sqlx::query_as("SELECT storage_node_id FROM files WHERE id = $1")
                .bind(&file_id)
                .fetch_optional(pool)
                .await?;
        if let Some((Some(node_id),)) = from_file {
            return Ok(Some(node_id));
        }
    }

    let from_parts: Option<(String,)> = sqlx::query_as(
        "SELECT storage_node_id FROM file_storage_parts \
         WHERE storage_key = $1 \
         ORDER BY part_index ASC \
         LIMIT 1",
    )
    .bind(&base)
    .fetch_optional(pool)
    .await?;
    if from_parts.is_some() {
        return Ok(from_parts.map(|(id,)| id));
    }

    let from_cache: Option<(String,)> = sqlx::query_as(
        "SELECT storage_node_id FROM storage_blob_placements WHERE storage_key = $1",
    )
    .bind(&base)
    .fetch_optional(pool)
    .await?;

    Ok(from_cache.map(|(id,)| id))
}

// Human: Load stripe parts for a base storage key when the blob was split across nodes.
pub(crate) async fn load_stripe_parts(
    pool: &PgPool,
    storage_key: &str,
) -> Result<Vec<StripePartRow>, AppError> {
    let rows: Vec<StripePartRow> = sqlx::query_as(
        "SELECT storage_node_id, object_key, byte_offset, byte_length \
         FROM file_storage_parts \
         WHERE storage_key = $1 \
         ORDER BY part_index ASC",
    )
    .bind(storage_key)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base_key_strips_hls_segment_suffix_for_placement_lookup() {
        let segment_key = "users/u/files/f1/segments/0019.m4s";
        assert_eq!(
            base_file_storage_key(segment_key).as_deref(),
            Some("users/u/files/f1")
        );
    }

    #[test]
    fn plan_single_node_when_capacity_fits() {
        let nodes = vec![NodeSnapshot {
            id: "a".into(),
            base_url: "http://a".into(),
            target_capacity_bytes: Some(1000),
            used_bytes: 100,
        }];
        let plan = plan_upload(&nodes, "users/u/files/f", 500).unwrap();
        assert!(matches!(
            plan,
            UploadPlacementPlan::Single {
                node_id,
                ..
            } if node_id == "a"
        ));
    }

    #[test]
    fn aggregate_network_remaining_sums_capped_nodes() {
        let nodes = vec![
            NodeSnapshot {
                id: "a".into(),
                base_url: "http://a".into(),
                target_capacity_bytes: Some(100),
                used_bytes: 80,
            },
            NodeSnapshot {
                id: "b".into(),
                base_url: "http://b".into(),
                target_capacity_bytes: Some(100),
                used_bytes: 50,
            },
        ];
        assert_eq!(aggregate_network_remaining_bytes(&nodes), Some(70));
    }

    #[test]
    fn effective_remaining_respects_network_cap() {
        let network = aggregate_network_remaining_bytes(&[NodeSnapshot {
            id: "a".into(),
            base_url: "http://a".into(),
            target_capacity_bytes: Some(100),
            used_bytes: 90,
        }]);
        assert_eq!(effective_remaining_bytes(0, 1_000, network), 10);
    }

    #[test]
    fn plan_stripes_across_nodes_on_overflow() {
        let nodes = vec![
            NodeSnapshot {
                id: "a".into(),
                base_url: "http://a".into(),
                target_capacity_bytes: Some(100),
                used_bytes: 80,
            },
            NodeSnapshot {
                id: "b".into(),
                base_url: "http://b".into(),
                target_capacity_bytes: Some(100),
                used_bytes: 70,
            },
        ];
        let plan = plan_upload(&nodes, "users/u/files/f", 50).unwrap();
        match plan {
            UploadPlacementPlan::Striped { primary_node_id, parts } => {
                assert_eq!(primary_node_id, "a");
                assert_eq!(parts.len(), 2);
                assert_eq!(parts[0].byte_length, 20);
                assert_eq!(parts[1].byte_length, 30);
            }
            _ => panic!("expected striped plan"),
        }
    }
}
