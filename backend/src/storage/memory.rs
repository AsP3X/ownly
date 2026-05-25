// Human: In-memory blob store for integration tests — avoids Nebular OS during HTTP contract checks.
// Agent: USES Mutex<HashMap>; IMPLEMENTS Storage; NOT used in production create_app_state.

use std::collections::HashMap;
use std::sync::Mutex;

use async_trait::async_trait;
use bytes::Bytes;
use futures_util::stream;

use crate::storage::{Storage, StorageStream};

#[derive(Default)]
pub struct MemoryStorage {
    blobs: Mutex<HashMap<String, (Vec<u8>, String)>>,
}

impl MemoryStorage {
    pub fn new() -> Self {
        Self::default()
    }
}

#[async_trait]
impl Storage for MemoryStorage {
    async fn get_stream(&self, key: &str) -> anyhow::Result<(StorageStream, u64, String)> {
        let guard = self.blobs.lock().expect("memory storage lock");
        let (data, content_type) = guard
            .get(key)
            .cloned()
            .ok_or_else(|| anyhow::anyhow!("key not found"))?;
        let len = data.len() as u64;
        let stream = stream::once(async move { Ok(Bytes::from(data)) });
        Ok((Box::pin(stream), len, content_type))
    }

    async fn exists(&self, key: &str) -> anyhow::Result<bool> {
        Ok(self.blobs.lock().expect("memory storage lock").contains_key(key))
    }

    async fn delete(&self, key: &str) -> anyhow::Result<()> {
        self.blobs.lock().expect("memory storage lock").remove(key);
        Ok(())
    }

    async fn put(&self, key: &str, content_type: &str, data: Vec<u8>) -> anyhow::Result<()> {
        self.blobs
            .lock()
            .expect("memory storage lock")
            .insert(key.to_string(), (data, content_type.to_string()));
        Ok(())
    }

    async fn list_keys_with_prefix(&self, prefix: &str) -> anyhow::Result<Vec<String>> {
        let guard = self.blobs.lock().expect("memory storage lock");
        let mut keys: Vec<String> = guard
            .keys()
            .filter(|key| key.starts_with(prefix))
            .cloned()
            .collect();
        keys.sort();
        Ok(keys)
    }

    fn presigned_url(&self, key: &str, _expiry_seconds: u64) -> anyhow::Result<String> {
        Ok(format!("memory://{key}"))
    }
}
