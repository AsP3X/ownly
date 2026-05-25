// Human: Server-side HLS for video — ffmpeg packaging, AES keys, playlists, and authenticated segment routes.
// Agent: MODULES encoder/encode_job/handlers/key_store/playlist; USED on video upload and `/files/:id/playlist` playback.

pub mod encode_job;
pub mod export_job;
pub mod encoder;
pub mod handlers;
pub mod hardware;
pub mod key_store;
pub mod playlist;
pub mod probe;
pub mod segment_crypto;
