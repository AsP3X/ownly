// Human: Wall-clock timeouts for ffmpeg/ffprobe subprocesses — kill children on expiry (SEC-021).
// Agent: WRAPS tokio::process Command/Child; USED across HLS, thumbnails, waveform, previews.

use std::process::{ExitStatus, Output};
use std::time::Duration;

use tokio::process::{Child, Command};

/// Human: Default ffprobe wall-clock budget for metadata reads.
pub const FFPROBE_TIMEOUT: Duration = Duration::from_secs(30);

/// Human: Default ffmpeg budget for short jobs (single frame, PCM decode, overlay PNG).
pub const FFMPEG_SHORT_TIMEOUT: Duration = Duration::from_secs(120);

/// Human: Animated preview ffmpeg budget — aligned with gif_preview transcode wrapper.
pub const FFMPEG_ANIMATED_PREVIEW_TIMEOUT: Duration = Duration::from_secs(60);

// Human: Scale HLS ffmpeg timeout from source duration — min 5 min, max 2 h, ~4× realtime.
// Agent: CALLED by HlsEncoder before child.wait; PREVENTS infinite hangs on crafted inputs.
pub fn ffmpeg_transcode_timeout(duration_seconds: i32) -> Duration {
    let secs = duration_seconds.max(0) as u64;
    Duration::from_secs(secs.saturating_mul(4).clamp(300, 7200))
}

// Human: Spawn a command, wait for output, and kill the child when the wall clock expires.
// Agent: USES wait_with_output; SUITABLE for ffprobe and one-shot ffmpeg invocations.
pub async fn run_command_with_timeout(
    command: &mut Command,
    timeout: Duration,
    label: &str,
) -> Result<Output, String> {
    command.kill_on_drop(true);
    let child = command
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("{label} spawn failed: {e}"))?;

    match tokio::time::timeout(timeout, child.wait_with_output()).await {
        Ok(Ok(output)) => Ok(output),
        Ok(Err(error)) => Err(format!("{label} wait failed: {error}")),
        Err(_) => Err(format!(
            "{label} timed out after {} seconds",
            timeout.as_secs()
        )),
    }
}

// Human: Wait for an already-spawned child with a wall-clock kill on expiry.
// Agent: CALLED when stderr is drained in a companion task before wait completes.
pub async fn wait_child_with_timeout(
    child: &mut Child,
    timeout: Duration,
    label: &str,
) -> Result<ExitStatus, String> {
    match tokio::time::timeout(timeout, child.wait()).await {
        Ok(Ok(status)) => Ok(status),
        Ok(Err(error)) => Err(format!("{label} wait failed: {error}")),
        Err(_) => {
            let _ = child.kill().await;
            let _ = child.wait().await;
            Err(format!(
                "{label} timed out after {} seconds",
                timeout.as_secs()
            ))
        }
    }
}

// Human: Run a short ffmpeg command to completion and map non-zero exits to Err strings.
// Agent: CONVENIENCE over run_command_with_timeout for status-only helpers.
pub async fn run_ffmpeg_status_with_timeout(
    command: &mut Command,
    timeout: Duration,
    label: &str,
) -> Result<(), String> {
    let output = run_command_with_timeout(command, timeout, label).await?;
    if output.status.success() {
        Ok(())
    } else {
        Err(format!(
            "{label} failed exit={:?} stderr={}",
            output.status.code(),
            String::from_utf8_lossy(&output.stderr).trim()
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ffmpeg_transcode_timeout_scales_and_clamps() {
        assert_eq!(ffmpeg_transcode_timeout(0), Duration::from_secs(300));
        assert_eq!(ffmpeg_transcode_timeout(60), Duration::from_secs(300));
        assert_eq!(ffmpeg_transcode_timeout(3600), Duration::from_secs(7200));
    }
}
