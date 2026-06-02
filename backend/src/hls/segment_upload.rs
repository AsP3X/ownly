// Human: Dynamic HLS segment upload pacing — byte-weighted parallelism and storage backpressure.
// Agent: READS local .m4s sizes; LIMITS in-flight PUT bytes; SHRINKS budget on transport errors.

use std::path::Path;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;

use anyhow::Context;
use tokio::sync::{OwnedSemaphorePermit, Semaphore};

use crate::hls::playlist::HLS_SEGMENT_EXTENSION;
use crate::storage::Storage;

// Human: Target aggregate upload buffer — Nebular OOM at ~12×5 MiB concurrent bodies in Compose.
// Agent: WEIGHTED semaphore permits = ceil(bytes / PERMIT_UNIT) capped by this budget.
pub const HLS_UPLOAD_MAX_IN_FLIGHT_BYTES: u64 = 32 * 1024 * 1024;

// Human: Minimum in-flight budget after repeated storage pressure (25% of max).
// Agent: FLOOR for budget_permille recovery; PREVENTS stalling on tiny segments only.
const HLS_UPLOAD_MIN_IN_FLIGHT_BYTES: u64 = 8 * 1024 * 1024;

// Human: Granularity for weighted semaphore permits (2 MiB per permit).
// Agent: 7 MiB segment acquires 4 permits; budget 32 MiB allows ~2 such segments at once.
const HLS_UPLOAD_PERMIT_UNIT_BYTES: u64 = 2 * 1024 * 1024;

// Human: Hard cap on simultaneous segment tasks regardless of size.
// Agent: CEILING on plan_segment_upload; PAIRED with byte budget.
pub const HLS_UPLOAD_MAX_PARALLEL_SEGMENTS: usize = 8;

// Human: Retry segment PUTs when object storage restarts or refuses connections mid-ingest.
// Agent: EXPONENTIAL backoff starting 250ms; RE-READS segment file each attempt.
const HLS_SEGMENT_PUT_MAX_ATTEMPTS: u32 = 4;
const HLS_SEGMENT_PUT_RETRY_BASE_MS: u64 = 250;

// Human: Successful PUTs before raising in-flight budget after a pressure event.
// Agent: ADDITIVE +100 permille steps; RESET streak on any failure.
const HLS_UPLOAD_RECOVERY_SUCCESS_STREAK: u32 = 8;

// Human: Result of parallel HLS segment PUTs — ingest must not set hls_ready unless complete.
// Agent: VALIDATED by validate_segment_upload_outcome before marking files.hls_ready.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SegmentUploadOutcome {
    pub expected: usize,
    pub uploaded: usize,
    pub failed: usize,
    pub bytes: u64,
}

// Human: User-safe failure when not every segment reached object storage (partial Nebular ingest).
// Agent: WRITTEN to files.hls_encode_error; REGRESSION: issue where hls_ready was true with gaps.
pub fn segment_upload_failure_message(outcome: &SegmentUploadOutcome) -> String {
    if outcome.expected == 0 {
        return "no HLS segments were produced".to_string();
    }
    format!(
        "uploaded {} of {} video segments ({} failed); object storage may be unavailable — try re-uploading",
        outcome.uploaded, outcome.expected, outcome.failed
    )
}

// Human: True when every segment uploaded and none failed — required before hls_ready.
// Agent: RETURNS Err(message) for regression tests and encode_job completion gate.
pub fn validate_segment_upload_outcome(outcome: &SegmentUploadOutcome) -> Result<(), String> {
    if outcome.uploaded == outcome.expected && outcome.failed == 0 && outcome.expected > 0 {
        return Ok(());
    }
    Err(segment_upload_failure_message(outcome))
}

// Human: Count `.m4s` objects under `{storage_key}/segments/` after upload.
// Agent: READS storage list API; FINAL gate when PUT counters and storage disagree.
pub async fn count_stored_hls_segments(
    storage: &dyn Storage,
    storage_key: &str,
) -> anyhow::Result<usize> {
    let prefix = format!("{storage_key}/segments/");
    let keys = storage.list_keys_with_prefix(&prefix).await?;
    Ok(keys
        .iter()
        .filter(|key| key.ends_with(&format!(".{HLS_SEGMENT_EXTENSION}")))
        .count())
}

// Human: Verify upload counters and storage listing both match ffmpeg segment_count.
// Agent: RETURNS Err on partial ingest; USED by encode_job before UPDATE hls_ready.
pub async fn verify_hls_segments_in_storage(
    storage: &dyn Storage,
    storage_key: &str,
    mut outcome: SegmentUploadOutcome,
) -> Result<SegmentUploadOutcome, String> {
    validate_segment_upload_outcome(&outcome)?;
    let stored_in_bucket = count_stored_hls_segments(storage, storage_key)
        .await
        .map_err(|error| format!("verify HLS segments in storage: {error}"))?;
    if stored_in_bucket != outcome.expected {
        outcome.uploaded = stored_in_bucket;
        outcome.failed = outcome.expected.saturating_sub(stored_in_bucket);
        return Err(segment_upload_failure_message(&outcome));
    }
    Ok(outcome)
}

pub struct SegmentUploadPlan {
    pub segment_count: usize,
    pub max_segment_bytes: u64,
    pub p95_segment_bytes: u64,
    pub parallel_hint: usize,
    pub total_permits: usize,
}

/// Human: Limits concurrent bytes in flight to object storage; adapts on transport failures.
/// Agent: WRAPS Semaphore(acquire_many_owned); MUTATES budget_permille on record_storage_pressure.
pub struct DynamicUploadLimiter {
    permits: Arc<Semaphore>,
    budget_permille: AtomicU32,
    success_streak: AtomicU32,
}

impl DynamicUploadLimiter {
    // Human: Build limiter from ffmpeg output sizes — full budget until pressure is detected.
    // Agent: CREATES Semaphore with total_permits from plan_segment_upload.
    pub fn from_plan(plan: &SegmentUploadPlan) -> Self {
        Self {
            permits: Arc::new(Semaphore::new(plan.total_permits)),
            budget_permille: AtomicU32::new(1000),
            success_streak: AtomicU32::new(0),
        }
    }

    // Human: Block until this segment's byte weight fits the current in-flight budget.
    // Agent: CALLS acquire_many_owned; WEIGHT from segment_permit_weight + budget_permille.
    pub async fn acquire_for_segment(
        &self,
        size_bytes: u64,
    ) -> Result<OwnedSemaphorePermit, tokio::sync::AcquireError> {
        let weight = segment_permit_weight(size_bytes, self.budget_permille.load(Ordering::Acquire));
        self.permits.clone().acquire_many_owned(weight).await
    }

    // Human: Back off when Nebular refuses connections or OOMs — shrink in-flight budget.
    // Agent: MULTIPLIES budget_permille by 0.75; RESETS success_streak; LOGS new permille.
    pub fn record_storage_pressure(&self) {
        self.success_streak.store(0, Ordering::Relaxed);
        let old = self.budget_permille.load(Ordering::Relaxed);
        let min_permille = budget_permille_for_bytes(HLS_UPLOAD_MIN_IN_FLIGHT_BYTES);
        let new = ((old as u64 * 3) / 4).max(min_permille as u64) as u32;
        if new < old {
            self.budget_permille.store(new, Ordering::Release);
            tracing::warn!(
                old_budget_permille = old,
                new_budget_permille = new,
                effective_in_flight_mb = effective_max_in_flight_bytes(new) / (1024 * 1024),
                "reduced HLS segment upload in-flight budget after storage pressure"
            );
        }
    }

    // Human: Slowly restore in-flight budget after a run of successful PUTs.
    // Agent: INCREMENTS budget_permille by 100 permille every RECOVERY_SUCCESS_STREAK successes.
    pub fn record_success(&self) {
        let streak = self.success_streak.fetch_add(1, Ordering::Relaxed) + 1;
        if streak < HLS_UPLOAD_RECOVERY_SUCCESS_STREAK {
            return;
        }
        self.success_streak.store(0, Ordering::Relaxed);
        let old = self.budget_permille.load(Ordering::Relaxed);
        let new = old.saturating_add(100).min(1000);
        if new > old {
            self.budget_permille.store(new, Ordering::Release);
            tracing::info!(
                old_budget_permille = old,
                new_budget_permille = new,
                effective_in_flight_mb = effective_max_in_flight_bytes(new) / (1024 * 1024),
                "increased HLS segment upload in-flight budget after stable uploads"
            );
        }
    }

    pub fn budget_permille(&self) -> u32 {
        self.budget_permille.load(Ordering::Relaxed)
    }
}

// Human: Scan segment directory for `.m4s` paths and on-disk byte lengths.
// Agent: USED before upload; FEEDS plan_segment_upload.
pub async fn collect_segment_sizes(
    segments_dir: &Path,
    extension: &str,
) -> anyhow::Result<Vec<(String, std::path::PathBuf, u64)>> {
    let mut out = Vec::new();
    let mut entries = tokio::fs::read_dir(segments_dir)
        .await
        .with_context(|| format!("read segments dir {}", segments_dir.display()))?;
    while let Some(entry) = entries.next_entry().await? {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some(extension) {
            continue;
        }
        let meta = tokio::fs::metadata(&path).await.with_context(|| {
            format!("stat segment {}", path.display())
        })?;
        let name = path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string();
        out.push((name, path, meta.len()));
    }
    out.sort_by(|left, right| left.0.cmp(&right.0));
    Ok(out)
}

// Human: Derive upload parallelism from segment sizes — small segments allow more concurrent PUTs.
// Agent: RETURNS min(parallel by max size, parallel by p95, MAX_PARALLEL); total_permits = budget/unit.
pub fn plan_segment_upload(sizes: &[u64]) -> SegmentUploadPlan {
    let segment_count = sizes.len();
    let max_segment_bytes = sizes.iter().copied().max().unwrap_or(HLS_UPLOAD_PERMIT_UNIT_BYTES);
    let p95_segment_bytes = percentile_u64(sizes, 95).max(HLS_UPLOAD_PERMIT_UNIT_BYTES);
    let parallel_by_max = upload_parallel_for_largest_segment(max_segment_bytes);
    let parallel_by_p95 = upload_parallel_for_largest_segment(p95_segment_bytes);
    let parallel_hint = parallel_by_max
        .min(parallel_by_p95)
        .clamp(1, HLS_UPLOAD_MAX_PARALLEL_SEGMENTS);
    let total_permits = (HLS_UPLOAD_MAX_IN_FLIGHT_BYTES / HLS_UPLOAD_PERMIT_UNIT_BYTES)
        .max(1) as usize;
    SegmentUploadPlan {
        segment_count,
        max_segment_bytes,
        p95_segment_bytes,
        parallel_hint,
        total_permits,
    }
}

// Human: PUT one encrypted segment with bounded retries after transport or 5xx errors.
// Agent: CALLS limiter.record_storage_pressure on likely transport failures; RE-READS file each attempt.
pub async fn put_hls_segment_with_retry(
    storage: &dyn Storage,
    object_key: &str,
    path: &Path,
    limiter: &DynamicUploadLimiter,
) -> anyhow::Result<u64> {
    let mut delay_ms = HLS_SEGMENT_PUT_RETRY_BASE_MS;
    for attempt in 1..=HLS_SEGMENT_PUT_MAX_ATTEMPTS {
        let data = tokio::fs::read(path)
            .await
            .with_context(|| format!("read segment {}", path.display()))?;
        let len = data.len() as u64;
        match storage.put(object_key, "video/mp4", data).await {
            Ok(()) => {
                limiter.record_success();
                return Ok(len);
            }
            Err(error) if attempt < HLS_SEGMENT_PUT_MAX_ATTEMPTS => {
                if is_likely_storage_pressure(&error) {
                    limiter.record_storage_pressure();
                }
                tracing::warn!(
                    %object_key,
                    attempt,
                    %error,
                    retry_in_ms = delay_ms,
                    budget_permille = limiter.budget_permille(),
                    "HLS segment PUT failed; retrying"
                );
                tokio::time::sleep(std::time::Duration::from_millis(delay_ms)).await;
                delay_ms = (delay_ms.saturating_mul(2)).min(5_000);
            }
            Err(error) => {
                if is_likely_storage_pressure(&error) {
                    limiter.record_storage_pressure();
                }
                return Err(error);
            }
        }
    }
    unreachable!("put_hls_segment_with_retry exits via return or Err")
}

fn effective_max_in_flight_bytes(budget_permille: u32) -> u64 {
    (HLS_UPLOAD_MAX_IN_FLIGHT_BYTES * budget_permille as u64 / 1000).max(HLS_UPLOAD_MIN_IN_FLIGHT_BYTES)
}

fn budget_permille_for_bytes(bytes: u64) -> u32 {
    let min_permille =
        (HLS_UPLOAD_MIN_IN_FLIGHT_BYTES * 1000 / HLS_UPLOAD_MAX_IN_FLIGHT_BYTES) as u32;
    let raw = (bytes.saturating_mul(1000) / HLS_UPLOAD_MAX_IN_FLIGHT_BYTES) as u32;
    raw.clamp(min_permille, 1000)
}

fn upload_parallel_for_largest_segment(largest_bytes: u64) -> usize {
    let bytes = largest_bytes.max(HLS_UPLOAD_PERMIT_UNIT_BYTES);
    (HLS_UPLOAD_MAX_IN_FLIGHT_BYTES / bytes)
        .max(1) as usize
}

fn segment_permit_weight(size_bytes: u64, budget_permille: u32) -> u32 {
    let cap_bytes = effective_max_in_flight_bytes(budget_permille);
    let weight = size_bytes.div_ceil(HLS_UPLOAD_PERMIT_UNIT_BYTES);
    let max_weight = cap_bytes.div_ceil(HLS_UPLOAD_PERMIT_UNIT_BYTES);
    weight.max(1).min(max_weight).min(u32::MAX as u64) as u32
}

fn percentile_u64(values: &[u64], pct: u8) -> u64 {
    if values.is_empty() {
        return 0;
    }
    let mut sorted = values.to_vec();
    sorted.sort_unstable();
    let idx = ((sorted.len() - 1) * pct as usize / 100).min(sorted.len() - 1);
    sorted[idx]
}

fn is_likely_storage_pressure(error: &anyhow::Error) -> bool {
    let msg = format!("{error:#}").to_ascii_lowercase();
    msg.contains("error sending request")
        || msg.contains("connection")
        || msg.contains("timed out")
        || msg.contains("broken pipe")
        || msg.contains("connection reset")
        || msg.contains("500 internal server error")
        || msg.contains("storage error")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plan_reduces_parallelism_for_large_segments() {
        let sizes: Vec<u64> = (0..150).map(|_| 6 * 1024 * 1024).collect();
        let plan = plan_segment_upload(&sizes);
        assert_eq!(plan.parallel_hint, 5);
        assert_eq!(plan.max_segment_bytes, 6 * 1024 * 1024);
    }

    #[test]
    fn plan_allows_more_parallelism_for_small_segments() {
        let sizes: Vec<u64> = (0..200).map(|_| 512 * 1024).collect();
        let plan = plan_segment_upload(&sizes);
        assert_eq!(plan.parallel_hint, 8);
    }

    #[test]
    fn permit_weight_grows_with_segment_size() {
        let small = segment_permit_weight(512 * 1024, 1000);
        let large = segment_permit_weight(7 * 1024 * 1024, 1000);
        assert!(large > small);
        assert_eq!(large, 4);
    }

    #[test]
    fn reduced_budget_caps_per_segment_weight() {
        let full = segment_permit_weight(7 * 1024 * 1024, 1000);
        let reduced = segment_permit_weight(7 * 1024 * 1024, 500);
        assert!(reduced <= full);
    }

    #[test]
    fn storage_pressure_detection_matches_transport_errors() {
        let err = anyhow::anyhow!("error sending request for url (http://object-storage:9000/x)");
        assert!(is_likely_storage_pressure(&err));
    }

    #[test]
    fn storage_pressure_detection_matches_object_storage_500() {
        let err = anyhow::anyhow!("object storage PUT failed: 500 Internal Server Error");
        assert!(is_likely_storage_pressure(&err));
    }

    #[test]
    fn segment_upload_failure_message_describes_partial_upload() {
        let msg = segment_upload_failure_message(&SegmentUploadOutcome {
            expected: 150,
            uploaded: 12,
            failed: 138,
            bytes: 2_000_111,
        });
        assert!(msg.contains("12 of 150"));
        assert!(msg.contains("138 failed"));
    }

    #[test]
    fn validate_rejects_partial_and_accepts_complete() {
        let partial = SegmentUploadOutcome {
            expected: 5,
            uploaded: 2,
            failed: 3,
            bytes: 0,
        };
        assert!(validate_segment_upload_outcome(&partial).is_err());

        let complete = SegmentUploadOutcome {
            expected: 2,
            uploaded: 2,
            failed: 0,
            bytes: 10,
        };
        assert!(validate_segment_upload_outcome(&complete).is_ok());
    }
}
