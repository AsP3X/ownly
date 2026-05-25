// Human: Probe uploaded video duration with ffprobe so ffmpeg progress and DB metadata stay accurate.
// Agent: SPAWNS ffprobe subprocess; RETURNS seconds as i32; DEFAULTS 3600 when probe fails.

use std::path::Path;
use tokio::process::Command;

const DEFAULT_DURATION_SECONDS: i32 = 3600;

/// Human: Tracks whether ffmpeg can remux without re-encoding (H.264 + AAC).
/// Agent: READS ffprobe stream codec_name; USED by HlsEncoder before full transcode.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CodecProbe {
    pub can_remux_copy: bool,
}

pub async fn probe_codecs(path: &Path) -> CodecProbe {
    let video = probe_stream_codec(path, "v:0").await;
    let audio = probe_stream_codec(path, "a:0").await;

    let video_ok = matches!(video.as_deref(), Some("h264"));
    let audio_ok = matches!(audio.as_deref(), Some("aac") | Some("mp4a"));

    CodecProbe {
        can_remux_copy: video_ok && audio_ok,
    }
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
