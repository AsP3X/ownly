// Human: Push Ownly storage node registry topology to Nebular via PUT /_cluster/config.
// Agent: READS storage_nodes + app_settings; HTTP PUT each node; WRITES storage_cluster_token setting.

use std::time::Duration;

use reqwest::StatusCode;
use serde::Serialize;
use sqlx::PgPool;
use uuid::Uuid;

use crate::error::AppError;

const CLUSTER_TOKEN_SETTING: &str = "storage_cluster_token";

#[derive(Debug, Clone, sqlx::FromRow)]
struct StorageNodeRow {
    id: String,
    region_label: String,
    base_url: String,
    architecture: String,
}

#[derive(Debug, Serialize)]
struct NebularClusterPeer {
    id: String,
    url: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    storage_classes: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    group: Option<String>,
}

#[derive(Debug, Serialize)]
struct NebularClusterConfigPut {
    mode: String,
    node_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    region_label: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    cluster_token: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    peers: Vec<NebularClusterPeer>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    storage_classes: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    default_storage_class: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    replication_group: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    replication_role: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    replication_factor: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    replication_async: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    assignment_rules: Option<serde_json::Value>,
}

// Human: Map Ownly architecture labels to Nebular cluster mode strings.
// Agent: single→standalone; replicated→replicated; assigned→assigned.
fn nebular_mode(architecture: &str) -> &'static str {
    match architecture.trim().to_ascii_lowercase().as_str() {
        "replicated" => "replicated",
        "assigned" => "assigned",
        "single" => "standalone",
        _ => "standalone",
    }
}

fn mode_needs_cluster_token(mode: &str) -> bool {
    mode != "standalone"
}

// Human: Default assignment rules when admin picks Assigned architecture.
// Agent: JSON rules array; Nebular requires ≥1 rule for assigned modes.
fn default_assignment_rules() -> serde_json::Value {
    serde_json::json!({
        "rules": [{ "storage_class": "default" }]
    })
}

// Human: Build peer list for one node — every other cluster-capable registry row.
// Agent: EXCLUDES self; SKIPS architecture=single; INCLUDES url + replication group.
fn build_peers_for_node(target_id: &str, nodes: &[StorageNodeRow]) -> Vec<NebularClusterPeer> {
    nodes
        .iter()
        .filter(|n| n.id != target_id && nebular_mode(&n.architecture) != "standalone")
        .map(|n| NebularClusterPeer {
            id: n.id.clone(),
            url: n.base_url.trim_end_matches('/').to_string(),
            storage_classes: Vec::new(),
            group: Some("default".into()),
        })
        .collect()
}

// Human: Count nodes participating in replication for replication_factor.
fn replication_factor_for(nodes: &[StorageNodeRow], target: &StorageNodeRow) -> u32 {
    if nebular_mode(&target.architecture) != "replicated" {
        return 1;
    }
    let count = nodes
        .iter()
        .filter(|n| nebular_mode(&n.architecture) == "replicated")
        .count();
    count.max(1) as u32
}

// Human: Assemble PUT body for one registry row against the full node list.
// Agent: READS target row + peers; INCLUDES cluster_token when mode != standalone.
fn build_cluster_config_put(
    target: &StorageNodeRow,
    all_nodes: &[StorageNodeRow],
    cluster_token: &str,
) -> NebularClusterConfigPut {
    let mode = nebular_mode(&target.architecture);
    let peers = build_peers_for_node(&target.id, all_nodes);
    let region = target.region_label.trim();
    let mut put = NebularClusterConfigPut {
        mode: mode.to_string(),
        node_id: target.id.clone(),
        region_label: if region.is_empty() {
            None
        } else {
            Some(region.to_string())
        },
        cluster_token: None,
        peers,
        storage_classes: Vec::new(),
        default_storage_class: None,
        replication_group: None,
        replication_role: None,
        replication_factor: None,
        replication_async: None,
        assignment_rules: None,
    };

    if mode_needs_cluster_token(mode) {
        put.cluster_token = Some(cluster_token.to_string());
        put.storage_classes = vec!["default".into()];
        put.default_storage_class = Some("default".into());
        put.replication_group = Some("default".into());
        put.replication_role = Some("member".into());
        put.replication_async = Some(true);

        if mode == "replicated" {
            put.replication_factor = Some(replication_factor_for(all_nodes, target));
        }
        if mode == "assigned" {
            put.assignment_rules = Some(default_assignment_rules());
        }
    }

    put
}

async fn read_setting(pool: &PgPool, key: &str) -> Option<String> {
    sqlx::query_scalar("SELECT value FROM app_settings WHERE key = $1")
        .bind(key)
        .fetch_optional(pool)
        .await
        .ok()
        .flatten()
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

// Human: Persist or reuse the inter-node token Ownly pushes to every Nebular node.
// Agent: READS storage_cluster_token; WRITES new UUID hex when missing.
async fn load_or_create_cluster_token(pool: &PgPool) -> Result<String, AppError> {
    if let Some(existing) = read_setting(pool, CLUSTER_TOKEN_SETTING).await {
        let trimmed = existing.trim();
        if trimmed.len() >= 32 {
            return Ok(trimmed.to_string());
        }
    }
    let token = format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple());
    upsert_setting(pool, CLUSTER_TOKEN_SETTING, &token).await?;
    Ok(token)
}

async fn load_enabled_nodes(pool: &PgPool) -> Result<Vec<StorageNodeRow>, AppError> {
    sqlx::query_as(
        "SELECT id, region_label, base_url, architecture \
         FROM storage_nodes \
         WHERE enabled = true \
         ORDER BY created_at ASC",
    )
    .fetch_all(pool)
    .await
    .map_err(AppError::from)
}

// Human: Apply runtime cluster config on one Nebular endpoint.
// Agent: HTTP PUT /_cluster/config; tries cluster_token then bootstrap_token auth.
async fn put_cluster_config(
    base_url: &str,
    auth_tokens: &[&str],
    body: &NebularClusterConfigPut,
) -> Result<(), AppError> {
    let url = format!("{}/_cluster/config", base_url.trim_end_matches('/'));
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());

    let mut last_status: Option<StatusCode> = None;
    for token in auth_tokens {
        if token.trim().is_empty() {
            continue;
        }
        let resp = client
            .put(&url)
            .header("Authorization", format!("Bearer {}", token.trim()))
            .json(body)
            .send()
            .await
            .map_err(|e| {
                tracing::error!(url = %url, error = %e, "nebular cluster config request failed");
                AppError::Storage(
                    "could not reach storage node to apply cluster configuration".into(),
                )
            })?;

        if resp.status().is_success() {
            return Ok(());
        }
        last_status = Some(resp.status());
        if resp.status() == StatusCode::UNAUTHORIZED || resp.status() == StatusCode::FORBIDDEN {
            continue;
        }
        tracing::error!(
            url = %url,
            status = %resp.status(),
            "nebular rejected cluster configuration"
        );
        return Err(AppError::Storage(
            "storage node rejected cluster configuration".into(),
        ));
    }

    tracing::error!(
        url = %url,
        ?last_status,
        "nebular cluster config unauthorized with available tokens"
    );
    Err(AppError::Storage(
        "could not authenticate cluster configuration; set NOS_CLUSTER_BOOTSTRAP_TOKEN on the API and storage nodes".into(),
    ))
}

// Human: Push registry topology to every enabled Nebular node after setup or Add Storage Node.
// Agent: READS storage_nodes; WRITES app_settings cluster token; HTTP PUT each base_url; SKIPPED when relax_sync.
pub async fn sync_storage_cluster(
    pool: &PgPool,
    bootstrap_token: Option<&str>,
    relax_sync: bool,
) -> Result<(), AppError> {
    if relax_sync {
        return Ok(());
    }

    let nodes = load_enabled_nodes(pool).await?;
    if nodes.is_empty() {
        return Ok(());
    }

    let all_standalone = nodes
        .iter()
        .all(|n| !mode_needs_cluster_token(nebular_mode(&n.architecture)));
    let bootstrap_present = bootstrap_token.map(str::trim).is_some_and(|s| !s.is_empty());
    if all_standalone && !bootstrap_present {
        tracing::info!("skipping nebular cluster sync: standalone nodes and no bootstrap token configured");
        return Ok(());
    }

    let needs_cluster_auth = nodes
        .iter()
        .any(|n| mode_needs_cluster_token(nebular_mode(&n.architecture)));
    if needs_cluster_auth && bootstrap_token.map(str::trim).is_none_or(str::is_empty) {
        return Err(AppError::BadRequest(
            "NOS_CLUSTER_BOOTSTRAP_TOKEN is required to configure replicated or assigned storage nodes".into(),
        ));
    }

    let cluster_token = if nodes.iter().any(|n| mode_needs_cluster_token(nebular_mode(&n.architecture))) {
        load_or_create_cluster_token(pool).await?
    } else {
        String::new()
    };

    let mut auth_tokens: Vec<String> = Vec::new();
    if let Some(bootstrap) = bootstrap_token.map(str::trim).filter(|s| !s.is_empty()) {
        auth_tokens.push(bootstrap.to_string());
    }
    if !cluster_token.is_empty() {
        auth_tokens.push(cluster_token.clone());
    }
    let auth_refs: Vec<&str> = auth_tokens.iter().map(String::as_str).collect();

    for target in &nodes {
        let body = if cluster_token.is_empty() {
            build_cluster_config_put(target, &nodes, "")
        } else {
            build_cluster_config_put(target, &nodes, &cluster_token)
        };
        put_cluster_config(&target.base_url, &auth_refs, &body).await?;
        tracing::info!(
            node_id = %target.id,
            mode = %body.mode,
            peers = body.peers.len(),
            "applied nebular cluster configuration"
        );
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(id: &str, arch: &str, url: &str) -> StorageNodeRow {
        StorageNodeRow {
            id: id.into(),
            region_label: "Test".into(),
            base_url: url.into(),
            architecture: arch.into(),
        }
    }

    #[test]
    fn build_peers_excludes_self_and_standalone_nodes() {
        let nodes = vec![
            row("node-a", "replicated", "http://a:9000"),
            row("node-b", "replicated", "http://b:9000"),
            row("node-c", "single", "http://c:9000"),
        ];
        let peers = build_peers_for_node("node-a", &nodes);
        assert_eq!(peers.len(), 1);
        assert_eq!(peers[0].id, "node-b");
    }

    #[test]
    fn standalone_put_omits_cluster_token_and_peers() {
        let nodes = vec![row("node-primary", "single", "http://localhost:9000")];
        let put = build_cluster_config_put(&nodes[0], &nodes, "unused-token");
        assert_eq!(put.mode, "standalone");
        assert!(put.cluster_token.is_none());
        assert!(put.peers.is_empty());
    }

    #[test]
    fn replicated_put_includes_cluster_token_and_replication_factor() {
        let nodes = vec![
            row("node-a", "replicated", "http://a:9000"),
            row("node-b", "replicated", "http://b:9000"),
        ];
        let put = build_cluster_config_put(&nodes[0], &nodes, "cluster-token-at-least-32-characters-long");
        assert_eq!(put.mode, "replicated");
        assert_eq!(put.cluster_token.as_deref(), Some("cluster-token-at-least-32-characters-long"));
        assert_eq!(put.peers.len(), 1);
        assert_eq!(put.replication_factor, Some(2));
    }

    #[test]
    fn assigned_put_includes_assignment_rules() {
        let nodes = vec![row("node-hot", "assigned", "http://hot:9000")];
        let put = build_cluster_config_put(&nodes[0], &nodes, "cluster-token-at-least-32-characters-long");
        assert_eq!(put.mode, "assigned");
        assert!(put.assignment_rules.is_some());
    }
}
