// Human: Tunable concurrency for permanent delete jobs — blob and file parallelism.
// Agent: READ by delete_job + file_delete; BOUNDS Nebular HTTP fan-out during bulk purge.

pub use crate::storage::DELETE_BLOB_CONCURRENCY;

/// Human: Max files purged in parallel during a delete job after DB rows are removed.
/// Agent: USED by run_delete_job permanent path and recycle soft-delete path.
pub const DELETE_FILE_CONCURRENCY: usize = 16;
