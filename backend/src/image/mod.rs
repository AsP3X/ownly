// Human: Image ingest helpers — grid JPEG generation and HTTP streaming for drive tiles.
// Agent: EXPORTS thumbnail job + handlers; ENQUEUED after image upload completes in object storage.

pub mod handlers;
pub mod thumbnail;
pub mod thumbnail_job;

pub const GRID_THUMBNAIL_OBJECT_SUFFIX: &str = "grid-thumbnail.jpg";

// Human: Nebular object key for a resized grid preview beside the original image blob.
// Agent: FORMAT `{storage_key}/grid-thumbnail.jpg`; WRITTEN by image thumbnail worker.
pub fn grid_thumbnail_storage_key(storage_key: &str) -> String {
    format!("{storage_key}/{GRID_THUMBNAIL_OBJECT_SUFFIX}")
}
