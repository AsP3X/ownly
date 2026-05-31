// Human: Audio ingest helpers — waveform peak extraction and Nebular sidecar artifacts.
// Agent: EXPORTS waveform job + handlers; USED after audio upload enqueue.

pub mod handlers;
pub mod waveform;
pub mod waveform_job;

pub const WAVEFORM_OBJECT_SUFFIX: &str = "waveform.json";

// Human: Nebular object key for the JSON peak envelope beside the source audio blob.
// Agent: FORMAT `{storage_key}/waveform.json`; WRITTEN by waveform worker.
pub fn waveform_storage_key(storage_key: &str) -> String {
    format!("{storage_key}/{WAVEFORM_OBJECT_SUFFIX}")
}
