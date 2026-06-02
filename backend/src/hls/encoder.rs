// Human: ffmpeg HLS packaging — H.264 + AAC in clear fMP4, then AES-128-CBC per segment in Rust.
// Agent: SPAWNS ffmpeg without hls_key_info (fMP4 encrypt unsupported); CALLS segment_crypto before upload.

use anyhow::{bail, Context};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Instant;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

use super::hardware::{append_full_transcode_encoder_args, HlsHardwareEncode, ResolvedHardwareEncoder};
use super::playlist::{HLS_INIT_FILENAME, HLS_SEGMENT_EXTENSION};
use super::playlist::HLS_SEGMENT_TARGET_SECS_LARGE;
use super::probe::{fps_to_ffmpeg_rate, CodecProbe, HlsEncodeMode};
use super::segment_crypto::encrypt_hls_segments_dir;

pub struct HlsOutput {
    pub playlist_path: PathBuf,
    pub key_path: PathBuf,
    pub init_path: PathBuf,
    pub segments_dir: PathBuf,
    pub segment_count: usize,
}

pub struct HlsEncoder;

#[derive(Clone, Copy, Debug)]
pub struct HlsEncodeTiming {
    pub duration_seconds: i32,
    pub segment_target_secs: f64,
}

struct FfmpegSessionParams<'a> {
    input_path: &'a Path,
    output_dir: &'a Path,
    key: &'a [u8; 16],
    timing: HlsEncodeTiming,
    codec_probe: &'a CodecProbe,
    segment_target_secs: f64,
    video_encoder: ResolvedHardwareEncoder,
    vaapi_device: &'a str,
    video_crf: u8,
    video_quality: u8,
    full_transcode_quality: u8,
    large_maxrate: &'a str,
    large_bufsize: &'a str,
    progress_tx: Option<tokio::sync::watch::Sender<i32>>,
}

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

        let stderr_tail: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
        let stderr_for_task = stderr_tail.clone();
        let stderr_handle = child.stderr.take().map(|stderr| {
            tokio::spawn(async move {
                let reader = BufReader::new(stderr);
                let mut lines = reader.lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    if let Ok(mut guard) = stderr_for_task.lock() {
                        guard.push(line);
                        if guard.len() > 48 {
                            let drain = guard.len() - 48;
                            guard.drain(0..drain);
                        }
                    }
                }
            })
        });

        let status = child.wait().await.context("waiting for ffmpeg export")?;
        if let Some(handle) = stderr_handle {
            let _ = handle.await;
        }

        if !status.success() {
            let tail = stderr_tail
                .lock()
                .map(|lines| lines.join("\n"))
                .unwrap_or_default();
            tracing::error!(
                exit_code = ?status.code(),
                ffmpeg_stderr_tail = %tail,
                "ffmpeg HLS export remux failed"
            );
            bail!("ffmpeg exited with code: {:?}", status.code());
        }

        let meta = tokio::fs::metadata(output_mp4)
            .await
            .context("reading export mp4 metadata")?;
        if meta.len() < 4096 {
            let tail = stderr_tail
                .lock()
                .map(|lines| lines.join("\n"))
                .unwrap_or_default();
            tracing::error!(
                export_bytes = meta.len(),
                ffmpeg_stderr_tail = %tail,
                "ffmpeg export produced a suspiciously small MP4"
            );
            bail!("ffmpeg export output too small ({} bytes)", meta.len());
        }

        Ok(())
    }

    pub async fn transcode(
        input_path: &Path,
        output_dir: &Path,
        key: &[u8; 16],
        timing: HlsEncodeTiming,
        codec_probe: CodecProbe,
        hardware: &HlsHardwareEncode,
        progress_tx: Option<tokio::sync::watch::Sender<i32>>,
    ) -> anyhow::Result<HlsOutput> {
        let segment_target_secs = timing.segment_target_secs;

        if matches!(codec_probe.encode_mode, HlsEncodeMode::FullTranscode)
            && hardware.use_hardware_for_full_transcode()
        {
            match Self::run_ffmpeg_session(FfmpegSessionParams {
                input_path,
                output_dir,
                key,
                timing,
                codec_probe: &codec_probe,
                segment_target_secs,
                video_encoder: hardware.resolved,
                vaapi_device: &hardware.vaapi_device,
                video_crf: hardware.video_crf,
                video_quality: hardware.video_quality,
                full_transcode_quality: hardware.full_transcode_quality,
                large_maxrate: &hardware.large_maxrate,
                large_bufsize: &hardware.large_bufsize,
                progress_tx: progress_tx.clone(),
            })
            .await
            {
                Ok(output) => return Ok(output),
                Err(error) => {
                    tracing::warn!(
                        %error,
                        encoder = ?hardware.resolved,
                        "hardware ffmpeg failed; falling back to CPU libx264"
                    );
                }
            }
        }

        match Self::run_ffmpeg_session(FfmpegSessionParams {
            input_path,
            output_dir,
            key,
            timing,
            codec_probe: &codec_probe,
            segment_target_secs,
            video_encoder: ResolvedHardwareEncoder::Cpu,
            vaapi_device: &hardware.vaapi_device,
            video_crf: hardware.video_crf,
            video_quality: hardware.video_quality,
            full_transcode_quality: hardware.full_transcode_quality,
            large_maxrate: &hardware.large_maxrate,
            large_bufsize: &hardware.large_bufsize,
            progress_tx: progress_tx.clone(),
        })
        .await
        {
            Ok(output) => Ok(output),
            Err(error) if codec_probe.encode_mode == HlsEncodeMode::RemuxCopy => {
                // Human: Some sources fail stream copy — fall back to GOP-aligned re-encode.
                // Agent: RETRIES AlignSegmentsRetranscode on CPU after RemuxCopy failure.
                tracing::warn!(
                    %error,
                    "HLS remux copy failed; retrying with GOP-aligned H.264 re-encode"
                );
                let _ = tokio::fs::remove_dir_all(output_dir).await;
                let mut fallback = codec_probe.clone();
                fallback.encode_mode = HlsEncodeMode::AlignSegmentsRetranscode;
                Self::run_ffmpeg_session(FfmpegSessionParams {
                    input_path,
                    output_dir,
                    key,
                    timing,
                    codec_probe: &fallback,
                    segment_target_secs,
                    video_encoder: ResolvedHardwareEncoder::Cpu,
                    vaapi_device: &hardware.vaapi_device,
                    video_crf: hardware.video_crf,
                    video_quality: hardware.video_quality,
                    full_transcode_quality: hardware.full_transcode_quality,
                    large_maxrate: &hardware.large_maxrate,
                    large_bufsize: &hardware.large_bufsize,
                    progress_tx,
                })
                .await
            }
            Err(error) => Err(error),
        }
    }

    async fn run_ffmpeg_session(params: FfmpegSessionParams<'_>) -> anyhow::Result<HlsOutput> {
        let FfmpegSessionParams {
            input_path,
            output_dir,
            key,
            timing,
            codec_probe,
            segment_target_secs,
            video_encoder,
            vaapi_device,
            video_crf,
            video_quality,
            full_transcode_quality,
            large_maxrate,
            large_bufsize,
            progress_tx,
        } = params;
        let duration_seconds = timing.duration_seconds;
        let output_fps = codec_probe.avg_frame_rate.unwrap_or(30.0);

        tokio::fs::create_dir_all(output_dir)
            .await
            .context("creating HLS output directory")?;

        let segments_dir = output_dir.join("segments");
        tokio::fs::create_dir_all(&segments_dir)
            .await
            .context("creating segments directory")?;

        let playlist_path = output_dir.join("stream.m3u8");
        let key_path = output_dir.join("key.bin");
        let init_path = output_dir.join(HLS_INIT_FILENAME);

        tokio::fs::write(&key_path, key)
            .await
            .context("writing AES key file")?;

        let segment_pattern = segments_dir.join(format!("%04d.{HLS_SEGMENT_EXTENSION}"));
        let segment_pattern_str = segment_pattern.to_string_lossy();

        let mut pre_input_args: Vec<String> = Vec::new();
        let mut encode_args: Vec<String> = Vec::new();

        // Human: Regenerate PTS on read so bad source timestamps do not break fMP4 HLS packaging.
        // Agent: PREPENDED before `-i`; APPLIES to remux and transcode paths alike.
        append_common_input_args(&mut pre_input_args);

        match codec_probe.encode_mode {
            HlsEncodeMode::RemuxCopy => {
                encode_args.extend([
                    "-c".into(),
                    "copy".into(),
                    "-bsf:a".into(),
                    "aac_adtstoasc".into(),
                    "-avoid_negative_ts".into(),
                    "make_zero".into(),
                ]);
            }
            HlsEncodeMode::CopyVideoTranscodeAudio => {
                encode_args.extend([
                    "-c:v".into(),
                    "copy".into(),
                    "-avoid_negative_ts".into(),
                    "make_zero".into(),
                ]);
                append_hls_audio_encode(&mut encode_args);
                // Human: Do not force CFR `-r:v` on stream-copied video — that corrupts timestamps.
                // Agent: SKIPS append_hls_timestamp_args; audio-only re-encode keeps source video timing.
            }
            HlsEncodeMode::AlignSegmentsRetranscode => {
                let large_cap = if segment_target_secs >= HLS_SEGMENT_TARGET_SECS_LARGE {
                    Some(HlsAlignRateCap {
                        maxrate: large_maxrate,
                        bufsize: large_bufsize,
                    })
                } else {
                    None
                };
                append_align_segments_video_args(
                    &mut pre_input_args,
                    &mut encode_args,
                    output_fps,
                    segment_target_secs,
                    video_encoder,
                    &HlsAlignEncodeOpts {
                        vaapi_device,
                        video_crf,
                        video_quality,
                        large_source_cap: large_cap,
                    },
                );
                append_hls_audio_encode(&mut encode_args);
                append_hls_timestamp_args(&mut encode_args, output_fps);
            }
            HlsEncodeMode::FullTranscode => {
                append_full_transcode_encoder_args(
                    &mut pre_input_args,
                    &mut encode_args,
                    video_encoder,
                    vaapi_device,
                    full_transcode_quality,
                );
                append_hls_gop_args(&mut encode_args, output_fps, segment_target_secs);
                append_hls_timestamp_args(&mut encode_args, output_fps);
            }
        }

        let mut args = pre_input_args;
        args.extend([
            "-i".into(),
            input_path.to_str().context("invalid input path")?.into(),
        ]);
        args.extend(encode_args);
        append_hls_muxer_args(
            &mut args,
            &segment_pattern_str,
            &playlist_path,
            segment_target_secs,
        )?;

        let mut child = Command::new("ffmpeg")
            .args(&args)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .context("spawning ffmpeg")?;

        let ffmpeg_started = Instant::now();
        let duration = duration_seconds as f64;
        let progress_tx_clone = progress_tx.clone();
        let stderr_tail: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
        let stderr_for_task = stderr_tail.clone();
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
                    if let Ok(mut guard) = stderr_for_task.lock() {
                        guard.push(line);
                        if guard.len() > 48 {
                            let drain = guard.len() - 48;
                            guard.drain(0..drain);
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
            let tail = stderr_tail
                .lock()
                .map(|lines| lines.join("\n"))
                .unwrap_or_default();
            tracing::error!(
                exit_code = ?status.code(),
                video_encoder = ?video_encoder,
                encode_mode = ?codec_probe.encode_mode,
                video_codec = ?codec_probe.video_codec,
                audio_codec = ?codec_probe.audio_codec,
                ffmpeg_stderr_tail = %tail,
                "ffmpeg HLS packaging failed"
            );
            bail!("ffmpeg exited with code: {:?}", status.code());
        }

        tracing::info!(
            encode_mode = ?codec_probe.encode_mode,
            avg_frame_rate = ?codec_probe.avg_frame_rate,
            video_encoder = ?video_encoder,
            segment_seconds = segment_target_secs,
            segment_format = "fmp4",
            ffmpeg_elapsed_ms = ffmpeg_started.elapsed().as_millis() as u64,
            "ffmpeg HLS packaging finished"
        );

        encrypt_hls_segments_dir(&segments_dir, &playlist_path, key)
            .await
            .context("encrypting fMP4 HLS segments")?;

        let mut segment_count = 0usize;
        let mut entries = tokio::fs::read_dir(&segments_dir)
            .await
            .context("reading segments directory")?;
        while let Some(entry) = entries.next_entry().await? {
            if entry
                .path()
                .extension()
                .and_then(|e| e.to_str())
                == Some(HLS_SEGMENT_EXTENSION)
            {
                segment_count += 1;
            }
        }

        Ok(HlsOutput {
            playlist_path,
            key_path,
            init_path,
            segments_dir,
            segment_count,
        })
    }
}

// Human: Input-side flags shared by every HLS ffmpeg session.
// Agent: APPENDS -fflags +genpts before `-i` to repair missing or corrupt source PTS.
fn append_common_input_args(pre_input: &mut Vec<String>) {
    pre_input.extend([
        "-fflags".into(),
        "+genpts+discardcorrupt".into(),
    ]);
}

// Human: fMP4 HLS muxer — CMAF segments + init.mp4 beside stream.m3u8 for hls.js MSE playback.
// Agent: APPENDS -hls_segment_type fmp4; MUST stay aligned with playlist EXT-X-MAP rewrite.
// Human: fMP4 HLS muxer without ffmpeg AES (encrypted fMP4 is not implemented in ffmpeg 5.x).
// Agent: APPENDS -hls_segment_type fmp4; encryption applied in segment_crypto after ffmpeg exits.
fn append_hls_muxer_args(
    args: &mut Vec<String>,
    segment_pattern: &str,
    playlist_path: &Path,
    segment_target_secs: f64,
) -> anyhow::Result<()> {
    let hls_time = segment_target_secs.round().max(1.0) as i32;
    args.extend([
        "-f".into(),
        "hls".into(),
        "-hls_segment_type".into(),
        "fmp4".into(),
        "-hls_fmp4_init_filename".into(),
        HLS_INIT_FILENAME.into(),
        "-hls_time".into(),
        hls_time.to_string(),
        "-hls_list_size".into(),
        "0".into(),
        "-max_muxing_queue_size".into(),
        "1024".into(),
        "-hls_flags".into(),
        "independent_segments".into(),
        "-hls_playlist_type".into(),
        "vod".into(),
        "-hls_segment_filename".into(),
        segment_pattern.to_string(),
        "-y".into(),
        playlist_path
            .to_str()
            .context("invalid playlist path")?
            .into(),
    ]);
    Ok(())
}

// Human: CFR output + zero mux delay so audio/video PTS stay aligned across fMP4 segments.
// Agent: APPENDS -fps_mode cfr and -r from probe; SKIPPED on stream-copy remux paths.
fn append_hls_timestamp_args(encode_args: &mut Vec<String>, fps: f64) {
    // Human: CFR on the video stream only — avoids forcing the AAC encoder through video `-r`.
    // Agent: USES :v stream specifiers; PAIRED with probed fps_to_ffmpeg_rate for film NTSC.
    encode_args.extend([
        "-fps_mode:v".into(),
        "cfr".into(),
        "-r:v".into(),
        fps_to_ffmpeg_rate(fps),
        "-muxdelay".into(),
        "0".into(),
        "-muxpreload".into(),
        "0".into(),
    ]);
}

// Human: Always stereo AAC on re-encode paths — avoids drift from copied source audio timestamps.
// Agent: REPLACES prior AAC stream-copy; USED by AlignSegments and CopyVideoTranscodeAudio.
fn append_hls_audio_encode(encode_args: &mut Vec<String>) {
    encode_args.extend([
        "-c:a".into(),
        "aac".into(),
        "-b:a".into(),
        "128k".into(),
        "-ac".into(),
        "2".into(),
        // Human: Resample audio to the video clock so A/V stay aligned across fMP4 segments.
        // Agent: async=1 stretches/compresses audio slightly; first_pts=0 anchors at zero.
        "-af".into(),
        "aresample=async=1:first_pts=0".into(),
    ]);
}

fn append_hls_gop_args(encode_args: &mut Vec<String>, fps: f64, segment_target_secs: f64) {
    let gop = ((fps * segment_target_secs).round() as i32).max(12);
    let segment_secs = segment_target_secs.round().max(1.0) as i32;
    encode_args.extend([
        "-g".into(),
        gop.to_string(),
        "-keyint_min".into(),
        gop.to_string(),
        "-flags".into(),
        "+cgop".into(),
        "-force_key_frames".into(),
        format!("expr:gte(t,n_forced*{segment_secs})"),
    ]);
}

/// Human: ffmpeg quality + optional large-source bitrate cap for GOP-aligned HLS.
struct HlsAlignEncodeOpts<'a> {
    vaapi_device: &'a str,
    video_crf: u8,
    video_quality: u8,
    large_source_cap: Option<HlsAlignRateCap<'a>>,
}

/// Human: Optional ffmpeg bitrate cap for large-source HLS (see HLS_LARGE_MAXRATE).
struct HlsAlignRateCap<'a> {
    maxrate: &'a str,
    bufsize: &'a str,
}

fn append_align_segments_video_args(
    pre_input: &mut Vec<String>,
    encode_args: &mut Vec<String>,
    fps: f64,
    segment_target_secs: f64,
    video_encoder: ResolvedHardwareEncoder,
    opts: &HlsAlignEncodeOpts<'_>,
) {
    let vaapi_device = opts.vaapi_device;
    let video_crf = opts.video_crf;
    let video_quality = opts.video_quality;
    let crf = video_crf.to_string();
    let quality = video_quality.to_string();
    match video_encoder {
        ResolvedHardwareEncoder::Cpu => {
            encode_args.extend([
                "-vf".into(),
                "format=yuv420p".into(),
                "-c:v".into(),
                "libx264".into(),
                "-preset".into(),
                "veryfast".into(),
                "-crf".into(),
                crf,
            ]);
        }
        ResolvedHardwareEncoder::Nvenc => {
            encode_args.extend([
                "-vf".into(),
                "format=yuv420p".into(),
                "-c:v".into(),
                "h264_nvenc".into(),
                "-preset".into(),
                "p4".into(),
                "-rc".into(),
                "vbr".into(),
                "-cq".into(),
                quality.clone(),
            ]);
        }
        ResolvedHardwareEncoder::Vaapi => {
            pre_input.extend([
                "-vaapi_device".into(),
                vaapi_device.to_string(),
            ]);
            encode_args.extend([
                "-vf".into(),
                "format=yuv420p,format=nv12,hwupload".into(),
                "-c:v".into(),
                "h264_vaapi".into(),
                "-qp".into(),
                quality.clone(),
            ]);
        }
        ResolvedHardwareEncoder::Qsv => {
            pre_input.extend([
                "-init_hw_device".into(),
                "qsv=hw".into(),
                "-filter_hw_device".into(),
                "hw".into(),
            ]);
            encode_args.extend([
                "-vf".into(),
                "format=nv12,hwupload=extra_hw_frames=64".into(),
                "-c:v".into(),
                "h264_qsv".into(),
                "-preset".into(),
                "veryfast".into(),
                "-global_quality".into(),
                quality,
            ]);
        }
    }
    append_hls_gop_args(encode_args, fps, segment_target_secs);
    if let Some(cap) = &opts.large_source_cap {
        encode_args.extend([
            "-maxrate".into(),
            cap.maxrate.to_string(),
            "-bufsize".into(),
            cap.bufsize.to_string(),
        ]);
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn muxer_args_include_fmp4_segment_type() {
        let mut args = Vec::new();
        append_hls_muxer_args(
            &mut args,
            "segments/%04d.m4s",
            Path::new("/tmp/stream.m3u8"),
            12.0,
        )
        .expect("muxer args");
        assert!(args.windows(2).any(|w| w[0] == "-hls_segment_type" && w[1] == "fmp4"));
    }
}
