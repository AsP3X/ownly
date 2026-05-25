// Human: Probe uploaded video duration with ffprobe so ffmpeg progress and DB metadata stay accurate.
// Agent: SPAWNS ffprobe subprocess; RETURNS seconds as i32; DEFAULTS 3600 when probe fails.

use std::path::Path;
use tokio::process::Command;

const DEFAULT_DURATION_SECONDS: i32 = 3600;

/// Human: How ffmpeg should package this source for browser HLS playback.
/// Agent: REMUX_COPY is fastest; ALIGN_SEGMENTS re-encodes H.264 with regular GOP; FULL transcodes both.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HlsEncodeMode {
    RemuxCopy,
    CopyVideoTranscodeAudio,
    /// Human: Re-encode H.264 with keyframes aligned to HLS segment length (24fps film-safe).
    /// Agent: USED when stream copy would yield irregular segment durations; audio may still copy.
    AlignSegmentsRetranscode,
    FullTranscode,
}

/// Human: Tracks source codecs and the fastest safe ffmpeg strategy for HLS ingest.
/// Agent: READS ffprobe stream codec_name + avg_frame_rate; USED by HlsEncoder before ffmpeg spawn.
#[derive(Debug, Clone)]
pub struct CodecProbe {
    pub video_codec: Option<String>,
    pub audio_codec: Option<String>,
    pub avg_frame_rate: Option<f64>,
    pub encode_mode: HlsEncodeMode,
}

impl CodecProbe {
    pub fn can_remux_copy(self) -> bool {
        self.encode_mode == HlsEncodeMode::RemuxCopy
    }
}

pub async fn probe_codecs(path: &Path) -> CodecProbe {
    let video = probe_stream_codec(path, "v:0").await;
    let audio = probe_stream_codec(path, "a:0").await;
    let avg_frame_rate = probe_avg_frame_rate(path).await;

    let encode_mode = resolve_encode_mode(
        video.as_deref(),
        audio.as_deref(),
        avg_frame_rate,
    );

    CodecProbe {
        video_codec: video,
        audio_codec: audio,
        avg_frame_rate,
        encode_mode,
    }
}

// Human: Pick ffmpeg strategy from codecs — H.264 always gets GOP-aligned segments for browser HLS.
// Agent: NEVER RemuxCopy; stream copy breaks on long/large sources (irregular keyframes, bad seeks).
pub fn resolve_encode_mode(
    video_codec: Option<&str>,
    _audio_codec: Option<&str>,
    avg_frame_rate: Option<f64>,
) -> HlsEncodeMode {
    let _ = avg_frame_rate;
    let video_ok = matches!(video_codec, Some("h264"));

    if video_ok {
        HlsEncodeMode::AlignSegmentsRetranscode
    } else {
        HlsEncodeMode::FullTranscode
    }
}

// Human: True when HLS stream copy would likely produce irregular segment durations.
// Agent: Kept for tests; H.264 ingest always uses AlignSegmentsRetranscode now.
pub fn needs_hls_segment_align(avg_frame_rate: Option<f64>) -> bool {
    matches!(avg_frame_rate, Some(fps) if (23.9..=24.1).contains(&fps))
}

// Human: Convert a probed fps scalar into an ffmpeg `-r` value (fractions for NTSC/film rates).
// Agent: USED by HlsEncoder CFR packaging; PREFERS 24000/1001 over rounded 23.976.
pub fn fps_to_ffmpeg_rate(fps: f64) -> String {
    if !fps.is_finite() || fps <= 0.0 {
        return "24".to_string();
    }
    if (fps - 23.976).abs() < 0.02 {
        return "24000/1001".to_string();
    }
    if (fps - 29.97).abs() < 0.02 {
        return "30000/1001".to_string();
    }
    if (fps - 59.94).abs() < 0.02 {
        return "60000/1001".to_string();
    }
    let rounded = fps.round();
    if (fps - rounded).abs() < 0.01 {
        return format!("{rounded:.0}");
    }
    format!("{fps}")
}

// Human: Parse ffprobe avg_frame_rate fractions (e.g. `24000/1001`, `24/1`) into a scalar fps.
// Agent: RETURNS None for missing, zero, or non-numeric values.
pub fn parse_frame_rate(raw: &str) -> Option<f64> {
    let trimmed = raw.trim();
    if trimmed.is_empty() || trimmed == "0/0" || trimmed.eq_ignore_ascii_case("n/a") {
        return None;
    }
    if let Some((num, den)) = trimmed.split_once('/') {
        let num: f64 = num.trim().parse().ok()?;
        let den: f64 = den.trim().parse().ok()?;
        if den > 0.0 && num.is_finite() && den.is_finite() {
            let fps = num / den;
            if fps > 0.0 && fps.is_finite() {
                return Some(fps);
            }
        }
        return None;
    }
    let fps: f64 = trimmed.parse().ok()?;
    if fps > 0.0 && fps.is_finite() {
        Some(fps)
    } else {
        None
    }
}

async fn probe_avg_frame_rate(path: &Path) -> Option<f64> {
    let output = Command::new("ffprobe")
        .args([
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=avg_frame_rate",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            path.to_str().unwrap_or(""),
        ])
        .output()
        .await
        .ok()?;

    if !output.status.success() {
        return None;
    }

    parse_frame_rate(&String::from_utf8_lossy(&output.stdout))
}

async fn probe_stream_codec(path: &Path, selector: &str) -> Option<String> {
    let output = Command::new("ffprobe")
        .args([
            "-v",
            "error",
            "-select_streams",
            selector,
            "-show_entries",
            "stream=codec_name",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            path.to_str().unwrap_or(""),
        ])
        .output()
        .await
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let name = String::from_utf8_lossy(&output.stdout).trim().to_lowercase();
    if name.is_empty() {
        None
    } else {
        Some(name)
    }
}

pub async fn probe_duration_seconds(path: &Path) -> i32 {
    let output = Command::new("ffprobe")
        .args([
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            path.to_str().unwrap_or(""),
        ])
        .output()
        .await;

    match output {
        Ok(out) if out.status.success() => {
            let text = String::from_utf8_lossy(&out.stdout);
            let trimmed = text.trim();
            match trimmed.parse::<f64>() {
                Ok(secs) if secs.is_finite() && secs > 0.0 => secs.round() as i32,
                _ => DEFAULT_DURATION_SECONDS,
            }
        }
        Ok(out) => {
            tracing::warn!(
                status = ?out.status.code(),
                stderr = %String::from_utf8_lossy(&out.stderr),
                "ffprobe failed; using default duration"
            );
            DEFAULT_DURATION_SECONDS
        }
        Err(e) => {
            tracing::warn!(error = %e, "ffprobe spawn failed; using default duration");
            DEFAULT_DURATION_SECONDS
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fps_to_ffmpeg_rate_prefers_film_fraction() {
        assert_eq!(fps_to_ffmpeg_rate(23.976), "24000/1001");
        assert_eq!(fps_to_ffmpeg_rate(24.0), "24");
        assert_eq!(fps_to_ffmpeg_rate(30.0), "30");
    }

    #[test]
    fn parse_frame_rate_handles_fraction_and_integer() {
        let film = parse_frame_rate("24000/1001").expect("film rate");
        assert!((film - 23.976).abs() < 0.01);
        assert_eq!(parse_frame_rate("24/1"), Some(24.0));
        assert_eq!(parse_frame_rate("30/1"), Some(30.0));
        assert_eq!(parse_frame_rate("0/0"), None);
    }

    #[test]
    fn needs_hls_segment_align_for_24fps_band() {
        assert!(needs_hls_segment_align(Some(24.0)));
        assert!(needs_hls_segment_align(Some(23.976)));
        assert!(!needs_hls_segment_align(Some(30.0)));
        assert!(!needs_hls_segment_align(None));
    }

    #[test]
    fn resolve_encode_mode_aligns_all_h264_sources() {
        assert_eq!(
            resolve_encode_mode(Some("h264"), Some("aac"), Some(24.0)),
            HlsEncodeMode::AlignSegmentsRetranscode
        );
        assert_eq!(
            resolve_encode_mode(Some("h264"), Some("aac"), Some(30.0)),
            HlsEncodeMode::AlignSegmentsRetranscode
        );
        assert_eq!(
            resolve_encode_mode(Some("h264"), Some("ac3"), Some(24.0)),
            HlsEncodeMode::AlignSegmentsRetranscode
        );
        assert_eq!(
            resolve_encode_mode(Some("hevc"), Some("aac"), Some(24.0)),
            HlsEncodeMode::FullTranscode
        );
    }
}
