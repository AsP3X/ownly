// Human: Shared helpers for HLS→MP4 download export (web + iOS + API download routes).
// Agent: DEFINES min size + ftyp check; USED by export_job and export HTTP handlers.

/// Minimum bytes for a cached `export.mp4` to be treated as a real video file.
pub const MIN_EXPORT_MP4_BYTES: i64 = 4096;

/// True when ISO BMFF `ftyp` appears at offset 4 (rejects playlists/JSON saved as `.mp4`).
pub fn looks_like_mp4(bytes: &[u8]) -> bool {
    bytes.len() >= 8 && &bytes[4..8] == b"ftyp"
}

/// True when DB + size indicate a usable cached export (not a stale 262-byte artifact).
pub fn export_cache_is_valid(export_ready: bool, size_bytes: Option<i64>) -> bool {
    if !export_ready {
        return false;
    }
    matches!(size_bytes, Some(size) if size >= MIN_EXPORT_MP4_BYTES)
}

/// Human: Map stored manifest URIs to `segments/NNNN.m4s` paths beside `stream.m3u8`.
/// Agent: TAKES basename only; AVOIDS passing `http://…/segments/foo.m4s` to ffmpeg.
pub fn segment_rel_path_for_export(path: &str) -> String {
    let basename = path.rsplit('/').next().unwrap_or(path).trim();
    if basename.contains('/') {
        basename.to_string()
    } else {
        format!("segments/{basename}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn export_cache_rejects_legacy_tiny_mp4() {
        assert!(!export_cache_is_valid(true, Some(262)));
        assert!(export_cache_is_valid(true, Some(5_000_000)));
    }

    #[test]
    fn segment_rel_path_strips_api_url_prefix() {
        let rel = segment_rel_path_for_export(
            "http://localhost:3000/api/v1/files/abc/hls/segments/0138.m4s",
        );
        assert_eq!(rel, "segments/0138.m4s");
    }
}
