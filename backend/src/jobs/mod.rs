// Human: Unified background job queue — uploads processing, downloads, HLS encode/export, streaming prep.
// Agent: EXPORTS store/worker/executor/handlers; DB-CLAIMED jobs; SINGLE worker per job via SKIP LOCKED.

pub mod executor;
pub mod handlers;
pub mod model;
pub mod recovery;
pub mod store;
pub mod worker;

pub use model::{JobKind, JobStatus};
pub use store::{
    cancel_hls_encode_for_file, cancel_job, cancel_job_by_resource, cancel_video_thumbnail_for_file,
    enqueue_job, find_active_job,
    list_user_jobs, recover_running_jobs_on_startup, recover_stale_jobs,
};
pub use recovery::{recover_stale_queued_jobs, recover_stuck_processing_jobs};
pub use worker::{start_worker_pool, JobWorkerSettings};
