// Human: Object-storage staging for resumable non-video parts — avoids multi-GiB API disk spools.
// Agent: KEYS under upload-staging/{session_id}/; PUT parts; STREAM-concat to final key; DELETE prefix on abort.

use std::pin::Pin;
use std::sync::Arc;
use std::task::{Context, Poll};

use bytes::Bytes;
use futures_util::StreamExt;
use sha2::{Digest, Sha256};
use tokio::sync::mpsc;

use crate::error::AppError;
use crate::storage::{Storage, StorageStream};

/// Human: Object key prefix for one resumable session's staged parts.
/// Agent: USED by upload_part (non-video), complete, abort, and session expiry cleanup.
pub fn staging_prefix(session_id: &str) -> String {
    format!("upload-staging/{session_id}/")
}

/// Human: Object key for one zero-based part number inside a session staging prefix.
pub fn staging_part_key(session_id: &str, part_number: i32) -> String {
    format!("upload-staging/{session_id}/{part_number}")
}

// Human: Ordered staging keys for every part in a completed session.
// Agent: part_number is zero-based to match Ownly /uploads/{id}/parts/{n}.
pub fn staging_part_keys(session_id: &str, total_parts: i32) -> Vec<String> {
    (0..total_parts)
        .map(|part_number| staging_part_key(session_id, part_number))
        .collect()
}

// Human: Best-effort delete of every staged part for a session (abort, expiry, post-complete).
// Agent: CALLS storage.delete_prefix; IGNORES storage errors so finalize/abort still succeed.
pub async fn cleanup_staging_prefix(storage: &Arc<dyn Storage>, session_id: &str) {
    let prefix = staging_prefix(session_id);
    if let Err(error) = storage.delete_prefix(&prefix).await {
        tracing::warn!(
            session_id = %session_id,
            prefix = %prefix,
            %error,
            "failed to clean upload staging prefix"
        );
    }
}

// Human: Stream SHA-256 over staged parts in order without buffering the whole file.
// Agent: GET each staging key; UPDATES hasher; RETURNS lowercase hex digest.
pub async fn hash_staged_parts(
    storage: &Arc<dyn Storage>,
    part_keys: &[String],
) -> Result<String, AppError> {
    let mut hasher = Sha256::new();
    for key in part_keys {
        let (mut stream, _, _) = storage
            .get_stream(key)
            .await
            .map_err(|error| AppError::Storage(format!("read staged upload part {key}: {error}")))?;
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|error| {
                AppError::Storage(format!("stream staged upload part {key}: {error}"))
            })?;
            hasher.update(&chunk);
        }
    }
    Ok(hex::encode(hasher.finalize()))
}

/// Human: mpsc-backed byte stream used to feed put_stream when concatenating staged parts.
struct ReceiverByteStream {
    rx: mpsc::Receiver<Result<Bytes, std::io::Error>>,
}

impl futures_util::Stream for ReceiverByteStream {
    type Item = Result<Bytes, std::io::Error>;

    fn poll_next(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Option<Self::Item>> {
        self.rx.poll_recv(cx)
    }
}

// Human: Open a StorageStream that yields staged parts in order (for final object PUT).
// Agent: SPAWNS reader task; RE-CREATED on each put_stream_with_retry attempt.
fn open_concat_parts_stream(
    storage: Arc<dyn Storage>,
    part_keys: Vec<String>,
) -> StorageStream {
    let (tx, rx) = mpsc::channel::<Result<Bytes, std::io::Error>>(4);
    tokio::spawn(async move {
        for key in part_keys {
            let opened = storage.get_stream(&key).await;
            let (mut stream, _, _) = match opened {
                Ok(value) => value,
                Err(error) => {
                    let _ = tx
                        .send(Err(std::io::Error::other(format!(
                            "open staged part {key}: {error}"
                        ))))
                        .await;
                    return;
                }
            };
            while let Some(chunk) = stream.next().await {
                if tx.send(chunk).await.is_err() {
                    return;
                }
            }
        }
    });
    Box::pin(ReceiverByteStream { rx })
}

// Human: Assemble staged parts into the permanent object key via streaming PUT (no API disk spool).
// Agent: SINGLE-PART fast path streams one key; MULTI-PART concatenates ordered staging keys.
pub async fn put_final_from_staged_parts(
    storage: &Arc<dyn Storage>,
    final_key: &str,
    mime: &str,
    part_keys: &[String],
    total_size: u64,
) -> Result<(), AppError> {
    if part_keys.is_empty() {
        return Err(AppError::BadRequest("no staged parts to assemble".into()));
    }

    // Human: Single-part uploads skip multi-key concat machinery (one stream, one PUT).
    let keys = if part_keys.len() == 1 {
        vec![part_keys[0].clone()]
    } else {
        part_keys.to_vec()
    };

    let storage_for_factory = storage.clone();
    let mime = mime.to_string();
    let key = final_key.to_string();
    crate::storage::put_stream_with_retry(
        storage.as_ref(),
        &key,
        &mime,
        total_size,
        || {
            let storage = storage_for_factory.clone();
            let keys = keys.clone();
            async move { Ok(open_concat_parts_stream(storage, keys)) }
        },
    )
    .await
    .map_err(|error| AppError::Storage(error.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::memory::MemoryStorage;

    #[tokio::test]
    async fn hash_and_put_from_staged_parts_round_trips() {
        let storage: Arc<dyn Storage> = Arc::new(MemoryStorage::new());
        let session_id = "sess-1";
        let part0 = b"hello ".to_vec();
        let part1 = b"world".to_vec();
        storage
            .put(&staging_part_key(session_id, 0), "application/octet-stream", part0)
            .await
            .unwrap();
        storage
            .put(&staging_part_key(session_id, 1), "application/octet-stream", part1)
            .await
            .unwrap();

        let keys = staging_part_keys(session_id, 2);
        let hash = hash_staged_parts(&storage, &keys).await.unwrap();
        let expected = hex::encode(Sha256::digest(b"hello world"));
        assert_eq!(hash, expected);

        put_final_from_staged_parts(
            &storage,
            "users/u1/files/f1",
            "text/plain",
            &keys,
            11,
        )
        .await
        .unwrap();

        let (mut stream, len, _) = storage.get_stream("users/u1/files/f1").await.unwrap();
        assert_eq!(len, 11);
        let mut body = Vec::new();
        while let Some(chunk) = stream.next().await {
            body.extend_from_slice(&chunk.unwrap());
        }
        assert_eq!(body, b"hello world");
    }
}
