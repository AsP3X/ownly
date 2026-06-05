// Human: Storage abstraction and backend implementations (Nebular OS proxy + in-memory test double).
// Agent: EXPORTS Storage trait; MODULES nebula + memory; USED by files handlers and AppState.

use std::pin::Pin;

pub type StorageStream = Pin<Box<dyn futures_util::Stream<Item = Result<bytes::Bytes, std::io::Error>> + Send>>;

/// Human: Max concurrent object-storage DELETE calls during prefix purge fallbacks.
/// Agent: USED by NebulaStorage, MemoryStorage, and file_delete parallel key removal.
pub const DELETE_BLOB_CONCURRENCY: usize = 12;

#[async_trait::async_trait]
pub trait Storage: Send + Sync {
    async fn get_stream(&self, key: &str) -> anyhow::Result<(StorageStream, u64, String)>;
    async fn exists(&self, key: &str) -> anyhow::Result<bool>;
    async fn delete(&self, key: &str) -> anyhow::Result<()>;
    async fn put(&self, key: &str, content_type: &str, data: Vec<u8>) -> anyhow::Result<()>;
    /// Human: List object keys under a prefix — used to purge partial HLS uploads on cancel/delete.
    /// Agent: CALLS Nebular GET /{bucket}?prefix=… with pagination; MemoryStorage filters HashMap keys.
    async fn list_keys_with_prefix(&self, prefix: &str) -> anyhow::Result<Vec<String>>;
    /// Human: Best-effort delete of every object under a prefix (bulk Nebular DELETE or parallel fallback).
    /// Agent: RETURNS count of delete attempts; IGNORES missing keys; USED by file_delete purge path.
    async fn delete_prefix(&self, prefix: &str) -> anyhow::Result<u32>;
    fn presigned_url(&self, key: &str, expiry_seconds: u64) -> anyhow::Result<String>;
}

pub mod memory;
pub mod nebula;
pub mod placement;
pub mod put_retry;
pub mod router;

pub use put_retry::put_with_retry;
