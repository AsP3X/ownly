// Human: Per-user concurrent HLS transcode cap — complements global job_worker_count (SEC-021).
// Agent: ACQUIRED in jobs executor before run_hls_encode_job; RELEASED when encode finishes.

use std::collections::HashMap;
use std::sync::Arc;

use tokio::sync::{Mutex, OwnedSemaphorePermit, Semaphore};

/// Human: Limits simultaneous ffmpeg HLS encodes per account.
/// Agent: GLOBAL worker pool still capped by JOB_WORKER_COUNT; this gate prevents one user monopolizing it.
pub struct UserTranscodeGate {
    inner: Mutex<HashMap<String, Arc<Semaphore>>>,
    max_per_user: usize,
}

/// Human: RAII permit returned from UserTranscodeGate::acquire — drop to release the slot.
pub struct TranscodePermit {
    _permit: OwnedSemaphorePermit,
}

impl UserTranscodeGate {
    // Human: Construct gate with per-user parallelism (minimum 1).
    // Agent: CALLED from build_app_state; READS MAX_CONCURRENT_TRANSCODES_PER_USER from Config.
    pub fn new(max_per_user: usize) -> Arc<Self> {
        Arc::new(Self {
            inner: Mutex::new(HashMap::new()),
            max_per_user: max_per_user.max(1),
        })
    }

    pub fn max_per_user(&self) -> usize {
        self.max_per_user
    }

    // Human: Block until this user has a free transcode slot.
    // Agent: AWAITED in run_hls_encode executor; HELD for the full HLS encode job.
    pub async fn acquire(self: &Arc<Self>, user_id: &str) -> TranscodePermit {
        let semaphore = {
            let mut map = self.inner.lock().await;
            map.entry(user_id.to_string())
                .or_insert_with(|| Arc::new(Semaphore::new(self.max_per_user)))
                .clone()
        };
        let permit = semaphore
            .acquire_owned()
            .await
            .expect("user transcode semaphore closed");
        TranscodePermit { _permit: permit }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn gate_limits_concurrent_holders_per_user() {
        let gate = UserTranscodeGate::new(1);
        let first = gate.acquire("user-a").await;
        let second = gate.acquire("user-a");
        tokio::pin!(second);
        assert!(
            tokio::time::timeout(std::time::Duration::from_millis(50), &mut second)
                .await
                .is_err()
        );
        drop(first);
        let _second = second.await;
    }

    #[tokio::test]
    async fn different_users_do_not_share_permits() {
        let gate = UserTranscodeGate::new(1);
        let _first = gate.acquire("user-a").await;
        let _second = gate.acquire("user-b").await;
    }
}
