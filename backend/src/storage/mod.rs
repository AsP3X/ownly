// Human: Storage abstraction and backend implementations (Nebular OS proxy + in-memory test double).
// Agent: EXPORTS Storage trait; MODULES nebula + memory; USED by files handlers and AppState.

use std::pin::Pin;

pub type StorageStream = Pin<Box<dyn futures_util::Stream<Item = Result<bytes::Bytes, std::io::Error>> + Send>>;

/// Human: Max concurrent object-storage DELETE calls during prefix purge fallbacks.
/// Agent: USED by NebulaStorage, MemoryStorage, and file_delete parallel key removal.
/// Human: Parallel object DELETEs when Nebular bulk/prefix delete is unavailable.
/// Agent: USED by NebulaStorage fallbacks and file_delete::delete_keys_parallel.
pub const DELETE_BLOB_CONCURRENCY: usize = 32;

#[async_trait::async_trait]
pub trait Storage: Send + Sync {
    async fn get_stream(&self, key: &str) -> anyhow::Result<(StorageStream, u64, String)>;
    async fn exists(&self, key: &str) -> anyhow::Result<bool>;
    /// Human: Object size without reading body — used to confirm staged upload parts.
    /// Agent: PREFER HEAD; DEFAULT falls back to get_stream content-length when unimplemented.
    async fn object_size(&self, key: &str) -> anyhow::Result<u64> {
        let (stream, len, _) = self.get_stream(key).await?;
        drop(stream);
        Ok(len)
    }
    async fn delete(&self, key: &str) -> anyhow::Result<()>;
    async fn put(&self, key: &str, content_type: &str, data: Vec<u8>) -> anyhow::Result<()>;
    /// Human: Stream PUT without buffering the entire object in API memory.
    /// Agent: CALLS Nebular streaming PUT when supported; content_length required for placement planning.
    async fn put_stream(
        &self,
        key: &str,
        content_type: &str,
        content_length: u64,
        stream: StorageStream,
    ) -> anyhow::Result<()>;
    /// Human: List object keys under a prefix — used to purge partial HLS uploads on cancel/delete.
    /// Agent: CALLS Nebular GET /{bucket}?prefix=… with pagination; MemoryStorage filters HashMap keys.
    async fn list_keys_with_prefix(&self, prefix: &str) -> anyhow::Result<Vec<String>>;
    /// Human: Best-effort delete of every object under a prefix (bulk Nebular DELETE or parallel fallback).
    /// Agent: RETURNS count of delete attempts; IGNORES missing keys; USED by file_delete purge path.
    async fn delete_prefix(&self, prefix: &str) -> anyhow::Result<u32>;
    fn presigned_url(&self, key: &str, expiry_seconds: u64) -> anyhow::Result<String>;
    /// Human: True when the backend can mint browser-usable Nebular PUT URLs (not in-memory test storage).
    /// Agent: GATES direct_upload on create_session for non-video resumable parts.
    fn supports_presigned_put(&self) -> bool {
        false
    }
    /// Human: HMAC-signed PUT URL so the browser can write a staging object without proxying bytes through Ownly.
    /// Agent: SIGNS method PUT; USED by uploads signed-url handler; MemoryStorage returns Err.
    fn presigned_put_url(&self, key: &str, expiry_seconds: u64) -> anyhow::Result<String> {
        let _ = (key, expiry_seconds);
        anyhow::bail!("presigned PUT is not supported by this storage backend")
    }
}

pub mod gated;
pub mod memory;
pub mod nebula;
pub mod placement;
pub mod put_gate;
pub mod put_retry;
pub mod router;

pub use put_retry::{put_stream_with_retry, put_with_retry};
