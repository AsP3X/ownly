// Human: Storage wrapper that serializes Nebular PUT pressure via StoragePutGate.
// Agent: DELEGATES get/delete/list to inner; ACQUIRES gate permit before inner.put.

use std::sync::Arc;

use async_trait::async_trait;

use super::put_gate::StoragePutGate;
use super::{Storage, StorageStream};

/// Human: Transparent Storage decorator — only PUT paths are gated; reads and deletes pass through.
/// Agent: WRAPS RouterStorage or MemoryStorage at startup in build_app_state.
pub struct GatedStorage {
    inner: Arc<dyn Storage>,
    put_gate: Arc<StoragePutGate>,
}

impl GatedStorage {
    pub fn new(inner: Arc<dyn Storage>, put_gate: Arc<StoragePutGate>) -> Self {
        Self { inner, put_gate }
    }
}

#[async_trait]
impl Storage for GatedStorage {
    async fn get_stream(&self, key: &str) -> anyhow::Result<(StorageStream, u64, String)> {
        self.inner.get_stream(key).await
    }

    async fn exists(&self, key: &str) -> anyhow::Result<bool> {
        self.inner.exists(key).await
    }

    async fn delete(&self, key: &str) -> anyhow::Result<()> {
        self.inner.delete(key).await
    }

    async fn put(&self, key: &str, content_type: &str, data: Vec<u8>) -> anyhow::Result<()> {
        let _permit = self.put_gate.acquire().await;
        self.inner.put(key, content_type, data).await
    }

    async fn list_keys_with_prefix(&self, prefix: &str) -> anyhow::Result<Vec<String>> {
        self.inner.list_keys_with_prefix(prefix).await
    }

    async fn delete_prefix(&self, prefix: &str) -> anyhow::Result<u32> {
        self.inner.delete_prefix(prefix).await
    }

    fn presigned_url(&self, key: &str, expiry_seconds: u64) -> anyhow::Result<String> {
        self.inner.presigned_url(key, expiry_seconds)
    }
}
