// Human: Probe uploaded video duration with ffprobe so ffmpeg progress and DB metadata stay accurate.
// Agent: SPAWNS ffprobe subprocess; RETURNS seconds as i32; DEFAULTS 3600 when probe fails.

use std::path::Path;
use tokio::process::Command;

const DEFAULT_DURATION_SECONDS: i32 = 3600;

/// Human: How ffmpeg should package this source for browser HLS playback.
/// Agent: REMUX_COPY is fastest; COPY_VIDEO transcodes audio only; FULL transcodes both tracks.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HlsEncodeMode {
    RemuxCopy,
    CopyVideoTranscodeAudio,
    FullTranscode,
}

/// Human: Tracks source codecs and the fastest safe ffmpeg strategy for HLS ingest.
/// Agent: READS ffprobe stream codec_name; USED by HlsEncoder before ffmpeg spawn.
#[derive(Debug, Clone)]
pub struct CodecProbe {
    pub video_codec: Option<String>,
    pub audio_codec: Option<String>,
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

    let video_ok = matches!(video.as_deref(), Some("h264"));
    let audio_ok = matches!(audio.as_deref(), Some("aac") | Some("mp4a"));

    let encode_mode = if video_ok && audio_ok {
        HlsEncodeMode::RemuxCopy
    } else if video_ok {
        // Human: Movie rips often ship H.264 + AC3/EAC3 — remux video, transcode audio only.
        // Agent: COPY_VIDEO avoids re-encoding picture; AAC stereo for browser HLS.
        HlsEncodeMode::CopyVideoTranscodeAudio
    } else {
        HlsEncodeMode::FullTranscode
    };

    CodecProbe {
        video_codec: video,
        audio_codec: audio,
        encode_mode,
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
