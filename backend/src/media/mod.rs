// Human: Shared media-processing guards — subprocess timeouts, decode limits, transcode concurrency.
// Agent: USED by HLS, thumbnails, waveform, and animated preview paths (SEC-021).

pub mod limits;
pub mod subprocess;
pub mod transcode_gate;

pub use limits::{
    probe_raster_dimensions, validate_animated_canvas_dimensions, validate_image_dimensions,
    MAX_ANIMATED_CANVAS_DIMENSION, MAX_IMAGE_DIMENSION, MAX_IMAGE_PIXEL_COUNT,
};
pub use subprocess::{
    ffmpeg_transcode_timeout, run_command_with_timeout, wait_child_with_timeout,
    FFMPEG_SHORT_TIMEOUT, FFPROBE_TIMEOUT,
};
pub use transcode_gate::{TranscodePermit, UserTranscodeGate};
