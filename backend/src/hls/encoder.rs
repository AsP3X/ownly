// Human: ffmpeg HLS packaging for video — H.264 + AAC in AES-128 MPEG-TS segments for browser playback.
// Agent: SPAWNS ffmpeg; WRITES key_info + segments; EMITS HlsOutput; parse_ffmpeg_progress maps stderr time= to percent.

use anyhow::{bail, Context};
use std::path::{Path, PathBuf};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

use super::probe::CodecProbe;

pub struct HlsOutput {
    pub playlist_path: PathBuf,
    pub key_path: PathBuf,
    pub segments_dir: PathBuf,
    pub segment_count: usize,
}

pub struct HlsEncoder;

impl HlsEncoder {
    /// Human: Remux encrypted HLS on disk into one MP4 (stream copy — no quality loss).
    /// Agent: SPAWNS ffmpeg -i stream.m3u8 -c copy; READS work_dir with key.bin + segments/.
    pub async fn package_hls_to_mp4(work_dir: &Path, output_mp4: &Path) -> anyhow::Result<()> {
        let playlist = work_dir.join("stream.m3u8");
        let mut child = Command::new("ffmpeg")
            .args([
                "-allowed_extensions",
                "ALL",
                "-i",
                playlist.to_str().context("invalid playlist path")?,
                "-c",
                "copy",
                "-bsf:a",
                "aac_adtstoasc",
                "-movflags",
                "+faststart",
                "-y",
                output_mp4.to_str().context("invalid output path")?,
            ])
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .context("spawning ffmpeg export")?;

        let status = child.wait().await.context("waiting for ffmpeg export")?;
        if !status.success() {
            bail!("ffmpeg export exited with code: {:?}", status.code());
        }
        Ok(())
    }

    pub async fn transcode(
        input_path: &Path,
        output_dir: &Path,
        key: &[u8; 16],
        duration_seconds: i32,
        codec_probe: CodecProbe,
        progress_tx: Option<tokio::sync::watch::Sender<i32>>,
    ) -> anyhow::Result<HlsOutput> {
        tokio::fs::create_dir_all(output_dir)
            .await
            .context("creating HLS output directory")?;

        let segments_dir = output_dir.join("segments");
        tokio::fs::create_dir_all(&segments_dir)
            .await
            .context("creating segments directory")?;

        let playlist_path = output_dir.join("stream.m3u8");
        let key_path = output_dir.join("key.bin");

        tokio::fs::write(&key_path, key)
            .await
            .context("writing AES key file")?;

        let segment_pattern = segments_dir.join("%04d.ts");
        let segment_pattern_str = segment_pattern.to_string_lossy();

        let key_info_path = output_dir.join("key_info.txt");
        let key_info_content = format!(
            "{}\n{}\n",
            key_path.to_string_lossy(),
            key_path.to_string_lossy(),
        );
        tokio::fs::write(&key_info_path, key_info_content)
            .await
            .context("writing key info file")?;

        let mut args: Vec<String> = vec![
            "-i".into(),
            input_path.to_str().context("invalid input path")?.into(),
        ];

        if codec_probe.can_remux_copy {
            args.extend([
                "-c".into(),
                "copy".into(),
                "-bsf:v".into(),
                "h264_mp4toannexb".into(),
                "-bsf:a".into(),
                "aac_adtstoasc".into(),
            ]);
        } else {
            args.extend([
                "-c:v".into(),
                "libx264".into(),
                "-preset".into(),
                "medium".into(),
                "-crf".into(),
                "23".into(),
                "-vf".into(),
                "scale='min(1920,iw)':-2".into(),
                "-c:a".into(),
                "aac".into(),
                "-b:a".into(),
                "128k".into(),
            ]);
        }

        args.extend([
            "-f".into(),
            "hls".into(),
            "-hls_time".into(),
            "4".into(),
            "-hls_list_size".into(),
            "0".into(),
            "-hls_segment_filename".into(),
            segment_pattern_str.to_string(),
            "-hls_key_info_file".into(),
            key_info_path.to_str().context("invalid key info path")?.into(),
            "-y".into(),
            playlist_path.to_str().context("invalid playlist path")?.into(),
        ]);

        let mut child = Command::new("ffmpeg")
            .args(&args)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .context("spawning ffmpeg")?;

        let duration = duration_seconds as f64;
        let progress_tx_clone = progress_tx.clone();
        let stderr_handle = child.stderr.take().map(|stderr| {
            tokio::spawn(async move {
                let reader = BufReader::new(stderr);
                let mut lines = reader.lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    if let Some(progress) = parse_ffmpeg_progress(&line, duration) {
                        if let Some(ref tx) = progress_tx_clone {
                            let _ = tx.send(progress);
                        }
                    }
                }
            })
        });

        let status = child.wait().await.context("waiting for ffmpeg")?;

        if let Some(handle) = stderr_handle {
            let _ = handle.await;
        }

        if !status.success() {
            bail!("ffmpeg exited with code: {:?}", status.code());
        }

        let mut segment_count = 0usize;
        let mut entries = tokio::fs::read_dir(&segments_dir)
            .await
            .context("reading segments directory")?;
        while let Some(entry) = entries.next_entry().await? {
            if entry.path().extension().and_then(|e| e.to_str()) == Some("ts") {
                segment_count += 1;
            }
        }

        Ok(HlsOutput {
            playlist_path,
            key_path,
            segments_dir,
            segment_count,
        })
    }
}

fn parse_ffmpeg_progress(line: &str, duration: f64) -> Option<i32> {
    let time_prefix = "time=";
    let start = line.find(time_prefix)?;
    let time_str = &line[start + time_prefix.len()..];
    let end = time_str.find(' ').unwrap_or(time_str.len());
    let time_val = &time_str[..end];

    let parts: Vec<&str> = time_val.split(':').collect();
    if parts.len() != 3 {
        return None;
    }

    let hours: f64 = parts[0].parse().ok()?;
    let minutes: f64 = parts[1].parse().ok()?;
    let seconds: f64 = parts[2].parse().ok()?;
    let current = hours * 3600.0 + minutes * 60.0 + seconds;

    if duration <= 0.0 {
        return None;
    }
    let pct = ((current / duration) * 100.0).clamp(0.0, 100.0) as i32;
    Some(pct)
}
