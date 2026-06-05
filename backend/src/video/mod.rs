// Human: Video ingest helpers — multi-option poster thumbnail extraction and Nebular sidecars.
// Agent: EXPORTS thumbnail job + handlers; USED after video upload enqueue alongside HLS.

pub mod handlers;
pub mod thumbnail;
pub mod thumbnail_job;

pub const THUMBNAILS_DIR_SUFFIX: &str = "thumbnails";
pub const THUMBNAIL_MANIFEST_SUFFIX: &str = "thumbnails/manifest.json";

// Human: Nebular object key for the JSON manifest beside numbered JPEG poster options.
// Agent: FORMAT `{storage_key}/thumbnails/manifest.json`; WRITTEN by thumbnail worker.
pub fn thumbnail_manifest_storage_key(storage_key: &str) -> String {
    format!("{storage_key}/{THUMBNAIL_MANIFEST_SUFFIX}")
}

// Human: Storage key for one scored poster option JPEG (index 0..4).
// Agent: FORMAT `{storage_key}/thumbnails/{index}.jpg`; READ by grid + picker UI.
pub fn thumbnail_option_storage_key(storage_key: &str, index: u32) -> String {
    format!("{storage_key}/{THUMBNAILS_DIR_SUFFIX}/{index}.jpg")
}
