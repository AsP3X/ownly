// Human: Routes Storage trait calls to the correct Nebular node using Postgres placement metadata.
// Agent: READS storage_nodes + placement tables; WRITES blobs with capacity-aware overflow striping.

use std::collections::HashMap;

use async_trait::async_trait;
use futures_util::stream;
use futures_util::StreamExt;
use sqlx::PgPool;
use tokio::sync::RwLock;

use crate::storage::nebula::NebulaStorage;
use crate::storage::placement::{
    self, base_file_storage_key, is_derived_storage_key, load_node_snapshots_cached,
    load_stripe_parts, persist_placement, plan_upload, resolve_node_for_key, UploadPlacementPlan,
};
use crate::storage::{Storage, StorageStream};

/// Human: Credentials and URLs shared by every per-node Nebular client in the router.
#[derive(Clone)]
pub struct RouterConfig {
    pub primary_base_url: String,
    pub public_base_url: String,
    pub bucket: String,
    pub jwt_secret: String,
    pub signing_secret: String,
}

/// Human: Production storage backend — capacity-aware PUT and placement-aware GET/DELETE.
pub struct RouterStorage {
    pool: PgPool,
    config: RouterConfig,
    clients: RwLock<HashMap<String, NebulaStorage>>,
}

impl RouterStorage {
    // Human: Construct router; seeds client cache with the primary OBJECT_STORAGE_URL node.
    // Agent: READS pool + RouterConfig; WRITES HashMap entry for node-primary when bootstrapping.
    pub fn new(pool: PgPool, config: RouterConfig) -> anyhow::Result<Self> {
        let primary = NebulaStorage::new(
            config.primary_base_url.clone(),
            config.public_base_url.clone(),
            config.bucket.clone(),
            &config.jwt_secret,
            &config.signing_secret,
        )?;
        let mut clients = HashMap::new();
        clients.insert("node-primary".to_string(), primary);
        Ok(Self {
            pool,
            config,
            clients: RwLock::new(clients),
        })
    }

    // Human: Resolve or create a Nebular HTTP client for a registry node id.
    async fn client_for_node(&self, node_id: &str, base_url: &str) -> anyhow::Result<NebulaStorage> {
        {
            let guard = self.clients.read().await;
            if let Some(client) = guard.get(node_id) {
                return Ok(client.clone());
            }
        }

        let client = NebulaStorage::new(
            base_url.to_string(),
            self.config.public_base_url.clone(),
            self.config.bucket.clone(),
            &self.config.jwt_secret,
            &self.config.signing_secret,
        )?;

        let mut guard = self.clients.write().await;
        guard.insert(node_id.to_string(), client.clone());
        Ok(client)
    }

    async fn client_for_node_id(&self, node_id: &str) -> anyhow::Result<NebulaStorage> {
        let record: Option<(String,)> =
            sqlx::query_as("SELECT base_url FROM storage_nodes WHERE id = $1 AND enabled = true")
                .bind(node_id)
                .fetch_optional(&self.pool)
                .await?;

        let Some((base_url,)) = record else {
            anyhow::bail!("storage node {node_id} is not registered or disabled");
        };

        self.client_for_node(node_id, &base_url).await
    }

    async fn fallback_primary_client(&self) -> anyhow::Result<NebulaStorage> {
        self.client_for_node("node-primary", &self.config.primary_base_url)
            .await
    }

    async fn resolve_client(&self, key: &str) -> anyhow::Result<NebulaStorage> {
        if let Some(node_id) = resolve_node_for_key(&self.pool, key).await? {
            return self.client_for_node_id(&node_id).await;
        }
        self.fallback_primary_client().await
    }

    // Human: PUT with placement planning — may stripe across nodes when one cap is insufficient.
    async fn put_routed(&self, key: &str, content_type: &str, data: Vec<u8>) -> anyhow::Result<()> {
        let size_bytes = data.len() as u64;
        let base_key = base_file_storage_key(key).unwrap_or_else(|| key.to_string());

        // Human: HLS segments and other sidecars reuse the parent file's reserved node — skip placement probes.
        // Agent: READS resolve_node_for_key; PUTS via client_for_node_id; NO persist_placement on fast path.
        if is_derived_storage_key(key, &base_key) {
            if let Some(node_id) = resolve_node_for_key(&self.pool, key)
                .await
                .map_err(|e| anyhow::anyhow!(e.to_string()))?
            {
                let client = self.client_for_node_id(&node_id).await?;
                client.put(key, content_type, data).await?;
                return Ok(());
            }
        }

        let nodes = load_node_snapshots_cached(&self.pool)
            .await
            .map_err(|e| anyhow::anyhow!(e.to_string()))?;

        if nodes.is_empty() {
            let client = self.fallback_primary_client().await?;
            client.put(key, content_type, data).await?;
            return Ok(());
        }

        let plan = plan_upload(&nodes, &base_key, size_bytes)
            .map_err(|e| anyhow::anyhow!(e.to_string()))?;

        match &plan {
            UploadPlacementPlan::Single { node_id, object_key: _ } => {
                // Human: Placement plans use the base file key; HLS artifacts keep distinct suffix paths.
                // Agent: PUT must use caller `key` (e.g. …/segments/0001.m4s); plan object_key is base-only.
                let client = self.client_for_node_id(node_id).await?;
                client.put(key, content_type, data).await?;
            }
            UploadPlacementPlan::Striped { parts, .. } => {
                let mut offset: usize = 0;
                for part in parts {
                    let end = offset + part.byte_length as usize;
                    let chunk = data[offset..end].to_vec();
                    let client = self.client_for_node_id(&part.node_id).await?;
                    client.put(&part.object_key, content_type, chunk).await?;
                    offset = end;
                }
            }
        }

        persist_placement(&self.pool, &base_key, &plan)
            .await
            .map_err(|e| anyhow::anyhow!(e.to_string()))?;

        Ok(())
    }

    async fn stripe_parts_for_key(
        &self,
        key: &str,
    ) -> anyhow::Result<Vec<placement::StripePartRow>> {
        let base = base_file_storage_key(key).unwrap_or_else(|| key.to_string());
        load_stripe_parts(&self.pool, &base)
            .await
            .map_err(|e| anyhow::anyhow!(e.to_string()))
    }

    // Human: Sidecars (thumbnails, manifest, HLS segments) live on the parent file's node — never striped.
    // Agent: READS is_derived_storage_key; BYPASSES file_storage_parts lookup that would concat video stripes.
    fn is_derived_sidecar_key(key: &str) -> bool {
        let base = base_file_storage_key(key).unwrap_or_else(|| key.to_string());
        is_derived_storage_key(key, &base)
    }
}

#[async_trait]
impl Storage for RouterStorage {
    async fn get_stream(&self, key: &str) -> anyhow::Result<(StorageStream, u64, String)> {
        // Human: Thumbnail/manifest GET must not replay multi-node stripe parts of the parent video blob.
        // Agent: MATCHES put_routed derived fast-path; READS single sidecar object via resolve_client.
        if Self::is_derived_sidecar_key(key) {
            let client = self.resolve_client(key).await?;
            return client.get_stream(key).await;
        }

        let parts = self.stripe_parts_for_key(key).await?;
        if parts.is_empty() {
            let client = self.resolve_client(key).await?;
            return client.get_stream(key).await;
        }

        let mut total_len: u64 = 0;
        let mut content_type = "application/octet-stream".to_string();
        let mut chunk_streams = Vec::new();

        for part in parts {
            let client = self.client_for_node_id(&part.storage_node_id).await?;
            let (stream, len, ct) = client.get_stream(&part.object_key).await?;
            total_len += len;
            if content_type == "application/octet-stream" {
                content_type = ct;
            }
            chunk_streams.push(stream);
        }

        let combined = stream::iter(chunk_streams).flatten();
        Ok((Box::pin(combined), total_len, content_type))
    }

    async fn exists(&self, key: &str) -> anyhow::Result<bool> {
        if Self::is_derived_sidecar_key(key) {
            let client = self.resolve_client(key).await?;
            return client.exists(key).await;
        }

        let parts = self.stripe_parts_for_key(key).await?;
        if !parts.is_empty() {
            for part in parts {
                let client = self.client_for_node_id(&part.storage_node_id).await?;
                if !client.exists(&part.object_key).await? {
                    return Ok(false);
                }
            }
            return Ok(true);
        }
        let client = self.resolve_client(key).await?;
        client.exists(key).await
    }

    async fn delete(&self, key: &str) -> anyhow::Result<()> {
        let base = base_file_storage_key(key).unwrap_or_else(|| key.to_string());
        if is_derived_storage_key(key, &base) {
            let client = self.resolve_client(key).await?;
            return client.delete(key).await;
        }

        let parts = self.stripe_parts_for_key(key).await?;
        if !parts.is_empty() {
            for part in parts {
                let client = self.client_for_node_id(&part.storage_node_id).await?;
                client.delete(&part.object_key).await?;
            }
            sqlx::query("DELETE FROM file_storage_parts WHERE storage_key = $1")
                .bind(&base)
                .execute(&self.pool)
                .await?;
            sqlx::query("DELETE FROM storage_blob_placements WHERE storage_key = $1")
                .bind(&base)
                .execute(&self.pool)
                .await?;
            return Ok(());
        }
        let client = self.resolve_client(key).await?;
        client.delete(key).await
    }

    async fn put(&self, key: &str, content_type: &str, data: Vec<u8>) -> anyhow::Result<()> {
        self.put_routed(key, content_type, data).await
    }

    async fn list_keys_with_prefix(&self, prefix: &str) -> anyhow::Result<Vec<String>> {
        let client = self.resolve_client(prefix).await?;
        client.list_keys_with_prefix(prefix).await
    }

    // Human: Purge every routed object under a prefix — delegates to the resolved Nebular client.
    // Agent: CALLS NebulaStorage::delete_prefix; STRIPED keys still purge via per-key router.delete fallback.
    async fn delete_prefix(&self, prefix: &str) -> anyhow::Result<u32> {
        let client = self.resolve_client(prefix).await?;
        client.delete_prefix(prefix).await
    }

    fn presigned_url(&self, key: &str, expiry_seconds: u64) -> anyhow::Result<String> {
        // Human: Presigned URLs only work for single-node blobs — striped files use API proxy download.
        // Agent: block_in_place + block_on from async handlers; ERRORS when file_storage_parts exist.
        tokio::task::block_in_place(|| {
            tokio::runtime::Handle::current().block_on(async {
                let parts = self.stripe_parts_for_key(key).await?;
                if !parts.is_empty() {
                    anyhow::bail!(
                        "presigned URLs are not available for multi-node striped objects; use API download"
                    );
                }
                let client = self.resolve_client(key).await?;
                client.presigned_url(key, expiry_seconds)
            })
        })
    }
}
