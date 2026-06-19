// Human: Extract and score multiple poster-frame candidates from a local video file via ffmpeg.
// Agent: SPAWNS ffmpeg frame grabs; SCORES with Laplacian sharpness + luminance gates; RETURNS top options.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tempfile::TempDir;
use tokio::process::Command;

use crate::hls::probe::probe_duration_seconds;
use crate::media::subprocess::{run_command_with_timeout, FFMPEG_SHORT_TIMEOUT};

use super::{thumbnail_manifest_storage_key, thumbnail_option_storage_key};

/// Human: Number of poster options surfaced in the drive UI (YouTube-style picker).
pub const THUMBNAIL_OPTION_COUNT: usize = 5;

/// Human: Candidate frames analyzed before diversity selection.
pub const MAX_CANDIDATE_FRAMES: usize = 12;

/// Human: Target width for stored poster JPEGs — grid tiles scale down via CSS.
pub const THUMBNAIL_WIDTH: u32 = 640;

/// Human: Minimum Laplacian variance at thumbnail width — rejects motion blur.
const MIN_SHARPNESS: f64 = 45.0;

/// Human: Mean luma gates — skip near-black fades and white flashes.
const MIN_MEAN_LUMA: f64 = 18.0;
const MAX_MEAN_LUMA: f64 = 238.0;

/// Human: Minimum seconds between picked options so the set is visually distinct.
const MIN_PICK_GAP_SECONDS: f64 = 2.0;

/// Human: JSON manifest written to Nebular and mirrored in API responses.
/// Agent: SERIALIZED by thumbnail worker; READ by GET /files/:id/thumbnails.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct VideoThumbnailManifest {
    pub version: u32,
    pub options: Vec<ThumbnailOption>,
    pub selected_index: u32,
}

/// Human: One scored poster candidate stored as `{storage_key}/thumbnails/{index}.jpg`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ThumbnailOption {
    pub index: u32,
    pub timestamp_seconds: f64,
    pub score: f64,
    pub storage_key: String,
}

impl VideoThumbnailManifest {
    pub fn selected_storage_key(&self) -> Option<&str> {
        self.options
            .iter()
            .find(|opt| opt.index == self.selected_index)
            .map(|opt| opt.storage_key.as_str())
    }
}

pub(crate) struct ScoredFrame {
    timestamp_seconds: f64,
    score: f64,
    jpeg_bytes: Vec<u8>,
}

// Human: Compute intro skip — avoid logo/credit leaders at the start of uploads.
// Agent: RETURNS max(3s, 5% of duration).
fn intro_skip_seconds(duration: f64) -> f64 {
    (duration * 0.05).max(3.0)
}

// Human: Evenly spaced probe timestamps across the middle 80% of the timeline.
// Agent: SKIPS intro + outro windows; RETURNS up to MAX_CANDIDATE_FRAMES points.
pub fn evenly_spaced_timestamps(duration: f64, count: usize) -> Vec<f64> {
    let skip = intro_skip_seconds(duration);
    let end = duration * 0.95;
    let window = (end - skip).max(1.0);
    (0..count)
        .map(|i| skip + window * (i as f64 + 0.5) / count as f64)
        .collect()
}

// Human: Extract one JPEG frame at `timestamp_seconds` using ffmpeg double-seek for accuracy.
// Agent: WRITES output_path; RETURNS Err when ffmpeg fails.
async fn extract_frame_at(
    input: &Path,
    timestamp_seconds: f64,
    output_path: &Path,
) -> Result<(), String> {
    let coarse = timestamp_seconds.floor().max(0.0);
    let fine = (timestamp_seconds - coarse).max(0.0);
    let input_str = input.to_str().unwrap_or("");
    let output_str = output_path.to_str().unwrap_or("");

    let mut command = Command::new("ffmpeg");
    command.args([
        "-hide_banner",
        "-loglevel",
        "error",
        "-ss",
        &coarse.to_string(),
        "-i",
        input_str,
        "-ss",
        &fine.to_string(),
        "-frames:v",
        "1",
        "-vf",
        &format!("scale={THUMBNAIL_WIDTH}:-1"),
        "-q:v",
        "3",
        "-y",
        output_str,
    ]);
    let output =
        run_command_with_timeout(&mut command, FFMPEG_SHORT_TIMEOUT, "ffmpeg frame extract")
            .await
            .map_err(|e| format!("ffmpeg frame extract: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("ffmpeg frame extract failed: {}", stderr.trim()));
    }

    if !output_path.is_file() {
        return Err("ffmpeg produced no output frame".into());
    }

    Ok(())
}

// Human: Scene-change candidate extraction across the analyzable window.
// Agent: SPAWNS ffmpeg select=gt(scene); COLLECTS JPEG paths from temp dir.
async fn extract_scene_candidates(
    input: &Path,
    duration: f64,
    temp_dir: &Path,
) -> Result<Vec<(f64, PathBuf)>, String> {
    let skip = intro_skip_seconds(duration);
    let analyze_seconds = ((duration * 0.95) - skip).max(1.0);
    let pattern = temp_dir.join("scene_%03d.jpg");
    let input_str = input.to_str().unwrap_or("");
    let pattern_str = pattern.to_str().unwrap_or("");

    let mut command = Command::new("ffmpeg");
    command.args([
        "-hide_banner",
        "-loglevel",
        "error",
        "-ss",
        &skip.to_string(),
        "-i",
        input_str,
        "-t",
        &analyze_seconds.to_string(),
        "-vf",
        &format!("select=gt(scene\\,0.3),scale={THUMBNAIL_WIDTH}:-1"),
        "-frames:v",
        &MAX_CANDIDATE_FRAMES.to_string(),
        "-vsync",
        "vfr",
        "-q:v",
        "3",
        "-y",
        pattern_str,
    ]);
    let output =
        run_command_with_timeout(&mut command, FFMPEG_SHORT_TIMEOUT, "ffmpeg scene extract")
            .await
            .map_err(|e| format!("ffmpeg scene extract: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("ffmpeg scene extract failed: {}", stderr.trim()));
    }

    let mut frames = Vec::new();
    for i in 1..=MAX_CANDIDATE_FRAMES {
        let path = temp_dir.join(format!("scene_{i:03}.jpg"));
        if !path.is_file() {
            break;
        }
        // Human: Scene frames lack exact PTS here — approximate evenly inside the analyzed window.
        let ts = skip + analyze_seconds * (i as f64) / (MAX_CANDIDATE_FRAMES as f64 + 1.0);
        frames.push((ts, path));
    }

    Ok(frames)
}

// Human: Laplacian variance on grayscale — higher means sharper (less motion blur).
// Agent: READS luma8 pixels; RETURNS scalar score used in candidate ranking.
pub fn laplacian_variance(gray: &image::GrayImage) -> f64 {
    let (width, height) = gray.dimensions();
    if width < 3 || height < 3 {
        return 0.0;
    }

    let mut sum = 0.0;
    let mut sum_sq = 0.0;
    let mut count = 0u64;

    for y in 1..height - 1 {
        for x in 1..width - 1 {
            let center = gray.get_pixel(x, y)[0] as f64;
            let left = gray.get_pixel(x - 1, y)[0] as f64;
            let right = gray.get_pixel(x + 1, y)[0] as f64;
            let up = gray.get_pixel(x, y - 1)[0] as f64;
            let down = gray.get_pixel(x, y + 1)[0] as f64;
            let lap = (4.0 * center) - left - right - up - down;
            sum += lap;
            sum_sq += lap * lap;
            count += 1;
        }
    }

    if count == 0 {
        return 0.0;
    }

    let mean = sum / count as f64;
    (sum_sq / count as f64) - (mean * mean)
}

// Human: Score one JPEG candidate — reject black/white/blur frames before ranking.
// Agent: READS image bytes; RETURNS None when frame fails quality gates.
pub fn score_jpeg_bytes(bytes: &[u8]) -> Result<Option<f64>, String> {
    let img = image::load_from_memory(bytes).map_err(|e| format!("jpeg decode failed: {e}"))?;
    let gray = img.to_luma8();
    let (width, height) = gray.dimensions();
    if width == 0 || height == 0 {
        return Ok(None);
    }

    let mut luma_sum = 0.0;
    let pixel_count = (width as u64) * (height as u64);
    for pixel in gray.pixels() {
        luma_sum += pixel[0] as f64;
    }
    let mean_luma = luma_sum / pixel_count as f64;
    if !(MIN_MEAN_LUMA..=MAX_MEAN_LUMA).contains(&mean_luma) {
        return Ok(None);
    }

    let sharpness = laplacian_variance(&gray);
    if sharpness < MIN_SHARPNESS {
        return Ok(None);
    }

    let richness = (bytes.len() as f64).ln();
    Ok(Some(sharpness + richness * 8.0))
}

// Human: Pick up to THUMBNAIL_OPTION_COUNT frames spread apart in time.
// Agent: SORTS by score desc; ENFORCES MIN_PICK_GAP_SECONDS between selections.
pub(crate) fn pick_diverse_options(mut scored: Vec<ScoredFrame>) -> Vec<ScoredFrame> {
    scored.sort_by(|a, b| {
        b.score
            .partial_cmp(&a.score)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    let mut picked: Vec<ScoredFrame> = Vec::with_capacity(THUMBNAIL_OPTION_COUNT);
    for frame in scored {
        if picked.len() >= THUMBNAIL_OPTION_COUNT {
            break;
        }
        if picked
            .iter()
            .any(|p| (p.timestamp_seconds - frame.timestamp_seconds).abs() < MIN_PICK_GAP_SECONDS)
        {
            continue;
        }
        picked.push(frame);
    }

    picked.sort_by(|a, b| {
        a.timestamp_seconds
            .partial_cmp(&b.timestamp_seconds)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    picked
}

// Human: Build the full candidate set — scene cuts plus evenly spaced fallbacks.
// Agent: EXTRACTS frames to temp dir; SCORES; RETURNS ranked diverse options.
pub(crate) async fn extract_thumbnail_options(input: &Path) -> Result<Vec<ScoredFrame>, String> {
    let duration = probe_duration_seconds(input).await.max(1) as f64;
    let temp_dir = TempDir::new().map_err(|e| format!("temp dir create failed: {e}"))?;
    let temp_path = temp_dir.path();

    let mut candidate_paths: Vec<(f64, PathBuf)> =
        extract_scene_candidates(input, duration, temp_path)
            .await
            .unwrap_or_default();

    for (idx, ts) in evenly_spaced_timestamps(duration, MAX_CANDIDATE_FRAMES)
        .into_iter()
        .enumerate()
    {
        let path = temp_path.join(format!("even_{idx:03}.jpg"));
        if extract_frame_at(input, ts, &path).await.is_ok() {
            candidate_paths.push((ts, path));
        }
    }

    let mut scored = Vec::new();
    for (ts, path) in candidate_paths {
        let bytes = tokio::fs::read(&path)
            .await
            .map_err(|e| format!("read candidate jpeg: {e}"))?;
        if let Some(score) = score_jpeg_bytes(&bytes)? {
            scored.push(ScoredFrame {
                timestamp_seconds: ts,
                score,
                jpeg_bytes: bytes,
            });
        }
    }

    if scored.is_empty() {
        // Human: Last resort — grab one mid-roll frame even if soft, so grid is never empty.
        let fallback_ts =
            intro_skip_seconds(duration) + ((duration * 0.95) - intro_skip_seconds(duration)) * 0.5;
        let fallback_path = temp_path.join("fallback.jpg");
        extract_frame_at(input, fallback_ts, &fallback_path).await?;
        let bytes = tokio::fs::read(&fallback_path)
            .await
            .map_err(|e| format!("read fallback jpeg: {e}"))?;
        scored.push(ScoredFrame {
            timestamp_seconds: fallback_ts,
            score: 1.0,
            jpeg_bytes: bytes,
        });
    }

    Ok(pick_diverse_options(scored))
}

// Human: Upload scored options + manifest JSON to Nebular for one video file row.
// Agent: PUTS thumbnails/{index}.jpg; WRITES manifest; RETURNS manifest struct.
pub(crate) async fn build_and_upload_manifest(
    storage: std::sync::Arc<dyn crate::storage::Storage>,
    storage_key: &str,
    options: Vec<ScoredFrame>,
) -> Result<VideoThumbnailManifest, String> {
    let mut manifest_options = Vec::with_capacity(options.len());
    for (index, frame) in options.into_iter().enumerate() {
        let key = thumbnail_option_storage_key(storage_key, index as u32);
        storage
            .put(&key, "image/jpeg", frame.jpeg_bytes)
            .await
            .map_err(|e| format!("thumbnail PUT failed: {e}"))?;
        manifest_options.push(ThumbnailOption {
            index: index as u32,
            timestamp_seconds: frame.timestamp_seconds,
            score: frame.score,
            storage_key: key,
        });
    }

    let manifest = VideoThumbnailManifest {
        version: 1,
        selected_index: 0,
        options: manifest_options,
    };

    let payload = serde_json::to_vec(&manifest).map_err(|e| format!("manifest json: {e}"))?;
    let manifest_key = thumbnail_manifest_storage_key(storage_key);
    storage
        .put(&manifest_key, "application/json", payload)
        .await
        .map_err(|e| format!("manifest PUT failed: {e}"))?;

    Ok(manifest)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn evenly_spaced_timestamps_skip_intro_and_outro() {
        let points = evenly_spaced_timestamps(100.0, 4);
        assert_eq!(points.len(), 4);
        assert!(points[0] >= 5.0);
        assert!(points[3] <= 95.0);
    }

    #[test]
    fn pick_diverse_options_enforces_gap() {
        let scored = vec![
            ScoredFrame {
                timestamp_seconds: 10.0,
                score: 100.0,
                jpeg_bytes: vec![],
            },
            ScoredFrame {
                timestamp_seconds: 10.5,
                score: 90.0,
                jpeg_bytes: vec![],
            },
            ScoredFrame {
                timestamp_seconds: 20.0,
                score: 80.0,
                jpeg_bytes: vec![],
            },
        ];
        let picked = pick_diverse_options(scored);
        assert_eq!(picked.len(), 2);
        assert!((picked[0].timestamp_seconds - 10.0).abs() < f64::EPSILON);
        assert!((picked[1].timestamp_seconds - 20.0).abs() < f64::EPSILON);
    }

    #[test]
    fn laplacian_variance_is_zero_on_flat_image() {
        let gray = image::GrayImage::from_pixel(32, 32, image::Luma([128]));
        assert!(laplacian_variance(&gray).abs() < f64::EPSILON);
    }
}
