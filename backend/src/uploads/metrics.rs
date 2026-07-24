// Human: Process-local upload counters for admin health and structured logging.
// Agent: AtomicU64 increments from upload handlers; SNAPSHOT for GET /admin/uploads/health.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

#[derive(Debug, Default)]
pub struct UploadMetrics {
    pub parts_direct: AtomicU64,
    pub parts_proxy: AtomicU64,
    pub parts_confirmed: AtomicU64,
    pub sessions_created: AtomicU64,
    pub sessions_completed: AtomicU64,
    pub sessions_aborted: AtomicU64,
    pub sessions_expired: AtomicU64,
    pub dedup_hits: AtomicU64,
    pub quota_rejects: AtomicU64,
    pub signed_url_minted: AtomicU64,
    pub signed_url_rejected: AtomicU64,
}

impl UploadMetrics {
    pub fn new() -> Arc<Self> {
        Arc::new(Self::default())
    }

    fn bump(counter: &AtomicU64) {
        counter.fetch_add(1, Ordering::Relaxed);
    }

    pub fn inc_parts_direct(&self) {
        Self::bump(&self.parts_direct);
    }
    pub fn inc_parts_proxy(&self) {
        Self::bump(&self.parts_proxy);
    }
    pub fn inc_parts_confirmed(&self) {
        Self::bump(&self.parts_confirmed);
    }
    pub fn inc_sessions_created(&self) {
        Self::bump(&self.sessions_created);
    }
    pub fn inc_sessions_completed(&self) {
        Self::bump(&self.sessions_completed);
    }
    pub fn inc_sessions_aborted(&self) {
        Self::bump(&self.sessions_aborted);
    }
    pub fn inc_sessions_expired(&self) {
        Self::bump(&self.sessions_expired);
    }
    pub fn inc_dedup_hits(&self) {
        Self::bump(&self.dedup_hits);
    }
    pub fn inc_quota_rejects(&self) {
        Self::bump(&self.quota_rejects);
    }
    pub fn inc_signed_url_minted(&self) {
        Self::bump(&self.signed_url_minted);
    }
    pub fn inc_signed_url_rejected(&self) {
        Self::bump(&self.signed_url_rejected);
    }

    pub fn snapshot(&self) -> UploadMetricsSnapshot {
        UploadMetricsSnapshot {
            parts_direct: self.parts_direct.load(Ordering::Relaxed),
            parts_proxy: self.parts_proxy.load(Ordering::Relaxed),
            parts_confirmed: self.parts_confirmed.load(Ordering::Relaxed),
            sessions_created: self.sessions_created.load(Ordering::Relaxed),
            sessions_completed: self.sessions_completed.load(Ordering::Relaxed),
            sessions_aborted: self.sessions_aborted.load(Ordering::Relaxed),
            sessions_expired: self.sessions_expired.load(Ordering::Relaxed),
            dedup_hits: self.dedup_hits.load(Ordering::Relaxed),
            quota_rejects: self.quota_rejects.load(Ordering::Relaxed),
            signed_url_minted: self.signed_url_minted.load(Ordering::Relaxed),
            signed_url_rejected: self.signed_url_rejected.load(Ordering::Relaxed),
        }
    }
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct UploadMetricsSnapshot {
    pub parts_direct: u64,
    pub parts_proxy: u64,
    pub parts_confirmed: u64,
    pub sessions_created: u64,
    pub sessions_completed: u64,
    pub sessions_aborted: u64,
    pub sessions_expired: u64,
    pub dedup_hits: u64,
    pub quota_rejects: u64,
    pub signed_url_minted: u64,
    pub signed_url_rejected: u64,
}
