// Human: Limit simultaneous Nebular PUT HTTP calls so SQLite metadata writes do not time out under bulk ingest.
// Agent: WRAPS Storage::put via GatedStorage; READS STORAGE_PUT_MAX_CONCURRENT; DEFAULT 2 concurrent PUTs.

use std::sync::Arc;

use tokio::sync::{OwnedSemaphorePermit, Semaphore};

/// Human: Process-wide semaphore — one permit per in-flight object-storage PUT.
/// Agent: ACQUIRED in GatedStorage::put; RELEASED when PUT completes (success or failure).
pub struct StoragePutGate {
    permits: Arc<Semaphore>,
    max_concurrent: usize,
}

impl StoragePutGate {
    // Human: Build gate from env-tuned concurrency (minimum 1).
    // Agent: CALLED from build_app_state; CREATES Semaphore(max_concurrent).
    pub fn new(max_concurrent: usize) -> Arc<Self> {
        let max_concurrent = max_concurrent.max(1);
        Arc::new(Self {
            permits: Arc::new(Semaphore::new(max_concurrent)),
            max_concurrent,
        })
    }

    pub fn max_concurrent(&self) -> usize {
        self.max_concurrent
    }

    // Human: Wait until a PUT slot is free — queues excess upload/thumbnail/HLS tasks instead of hammering Nebular.
    // Agent: AWAIT acquire_owned; RETURNS AppError::Internal when semaphore is closed.
    pub async fn acquire(&self) -> Result<OwnedSemaphorePermit, crate::error::AppError> {
        self.permits
            .clone()
            .acquire_owned()
            .await
            .map_err(|_| {
                crate::error::AppError::Internal(anyhow::anyhow!(
                    "storage PUT gate semaphore closed"
                ))
            })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn gate_limits_concurrent_holders() {
        let gate = StoragePutGate::new(1);
        let first = gate.acquire().await.expect("first acquire");
        let gate2 = Arc::clone(&gate);
        let second = tokio::spawn(async move { gate2.acquire().await });
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        assert!(!second.is_finished());
        drop(first);
        let _second = second.await.expect("second acquire task panicked").expect("second acquire");
    }
}
