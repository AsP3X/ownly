// Human: Retry object-storage PUTs when Nebular returns transient 5xx or transport errors.
// Agent: CALLS Storage::put with backoff; RE-LOADS body via callback each attempt; USED by uploads + thumbnails.

use std::future::Future;

use super::Storage;

// Human: Match HLS segment upload retry budget — enough for SQLite busy windows under bulk ingest.
// Agent: MAX 4 attempts; exponential backoff from 250ms capped at 5s.
const PUT_MAX_ATTEMPTS: u32 = 4;
const PUT_RETRY_BASE_MS: u64 = 250;
const PUT_RETRY_MAX_MS: u64 = 5_000;

// Human: Classify errors that often clear after a short pause (Nebular contention, dropped connections).
// Agent: READS anyhow display string; MATCHES HLS is_likely_storage_pressure for consistent behavior.
pub fn is_likely_transient_put_error(error: &anyhow::Error) -> bool {
    let msg = format!("{error:#}").to_ascii_lowercase();
    msg.contains("error sending request")
        || msg.contains("connection")
        || msg.contains("timed out")
        || msg.contains("broken pipe")
        || msg.contains("connection reset")
        || msg.contains("500 internal server error")
        || msg.contains("503 service unavailable")
        || msg.contains("backpressure")
        || msg.contains("storage error")
}

// Human: PUT with bounded retries — reloads payload each attempt so large spool files are not cloned.
// Agent: CALLS load_data future before every attempt; RETURNS last error when attempts exhausted.
pub async fn put_with_retry<F, Fut>(
    storage: &dyn Storage,
    key: &str,
    content_type: &str,
    mut load_data: F,
) -> anyhow::Result<()>
where
    F: FnMut() -> Fut,
    Fut: Future<Output = anyhow::Result<Vec<u8>>>,
{
    let mut delay_ms = PUT_RETRY_BASE_MS;
    for attempt in 1..=PUT_MAX_ATTEMPTS {
        let data = load_data().await?;
        match storage.put(key, content_type, data).await {
            Ok(()) => return Ok(()),
            Err(error) if attempt < PUT_MAX_ATTEMPTS && is_likely_transient_put_error(&error) => {
                tracing::warn!(
                    storage_key = %key,
                    attempt,
                    %error,
                    retry_in_ms = delay_ms,
                    "object storage PUT failed; retrying"
                );
                tokio::time::sleep(std::time::Duration::from_millis(delay_ms)).await;
                delay_ms = (delay_ms.saturating_mul(2)).min(PUT_RETRY_MAX_MS);
            }
            Err(error) => return Err(error),
        }
    }
    unreachable!("put_with_retry exits via return or Err")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn transient_detection_matches_storage_500() {
        let err = anyhow::anyhow!("object storage PUT failed: 500 Internal Server Error");
        assert!(is_likely_transient_put_error(&err));
    }

    #[test]
    fn transient_detection_matches_backpressure() {
        let err = anyhow::anyhow!("object storage PUT backpressure (retry after 1s)");
        assert!(is_likely_transient_put_error(&err));
    }

    #[test]
    fn transient_detection_rejects_validation_errors() {
        let err = anyhow::anyhow!("object storage PUT failed: 400 Bad Request");
        assert!(!is_likely_transient_put_error(&err));
    }
}
