// Human: Derive 32-bar waveform peaks from decoded PCM — matches Pencil mobile player bar count/heights.
// Agent: SPAWNS ffmpeg s16le decode; COMPUTES bucket maxima; NORMALIZES to 1..MAX_BAR_HEIGHT.

use std::path::Path;

use serde::{Deserialize, Serialize};
use tokio::process::Command;

pub const BAR_COUNT: usize = 32;
pub const MAX_BAR_HEIGHT: u32 = 64;

/// Human: JSON sidecar written to Nebular `{storage_key}/waveform.json`.
/// Agent: SERIALIZED by waveform worker; READ by GET /files/:id/waveform handlers.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AudioWaveformArtifact {
    pub version: u32,
    pub bar_count: u32,
    pub max_height: u32,
    pub bars: Vec<u32>,
}

impl AudioWaveformArtifact {
    pub fn new(bars: Vec<u32>) -> Self {
        Self {
            version: 1,
            bar_count: BAR_COUNT as u32,
            max_height: MAX_BAR_HEIGHT,
            bars,
        }
    }
}

// Human: Decode audio to mono PCM via ffmpeg and bucket samples into BAR_COUNT peak bars.
// Agent: READS input path; RETURNS normalized bar heights; ERR on ffmpeg failure or empty PCM.
pub async fn extract_waveform_bars(input: &Path) -> Result<Vec<u32>, String> {
    let pcm = decode_mono_pcm(input).await?;
    if pcm.is_empty() {
        return Err("audio decode produced no samples".into());
    }
    Ok(compute_peak_bars(&pcm))
}

async fn decode_mono_pcm(input: &Path) -> Result<Vec<i16>, String> {
    let output = Command::new("ffmpeg")
        .args([
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            input.to_str().unwrap_or(""),
            "-vn",
            "-ac",
            "1",
            "-ar",
            "8000",
            "-f",
            "s16le",
            "-",
        ])
        .output()
        .await
        .map_err(|e| format!("ffmpeg spawn failed: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("ffmpeg decode failed: {}", stderr.trim()));
    }

    let bytes = output.stdout;
    if bytes.len() < 2 {
        return Ok(Vec::new());
    }

    let mut samples = Vec::with_capacity(bytes.len() / 2);
    for chunk in bytes.chunks_exact(2) {
        samples.push(i16::from_le_bytes([chunk[0], chunk[1]]));
    }
    Ok(samples)
}

// Human: Split PCM into BAR_COUNT buckets and take the max absolute amplitude per bucket.
// Agent: MAPS peaks to 1..MAX_BAR_HEIGHT; PRESERVES relative dynamics for the mobile UI.
fn compute_peak_bars(samples: &[i16]) -> Vec<u32> {
    let bucket_size = (samples.len() / BAR_COUNT).max(1);
    let mut peaks = Vec::with_capacity(BAR_COUNT);

    for bucket in 0..BAR_COUNT {
        let start = bucket * bucket_size;
        if start >= samples.len() {
            peaks.push(1);
            continue;
        }
        let end = ((bucket + 1) * bucket_size).min(samples.len());
        let max_abs = samples[start..end]
            .iter()
            .map(|sample| sample.unsigned_abs() as u32)
            .max()
            .unwrap_or(0);
        peaks.push(max_abs);
    }

    normalize_peaks(&peaks)
}

fn normalize_peaks(raw: &[u32]) -> Vec<u32> {
    let max_peak = raw.iter().copied().max().unwrap_or(0);
    if max_peak == 0 {
        return vec![1; BAR_COUNT];
    }

    raw.iter()
        .map(|peak| {
            let scaled = (*peak as f64 / max_peak as f64) * MAX_BAR_HEIGHT as f64;
            scaled.round().clamp(1.0, MAX_BAR_HEIGHT as f64) as u32
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_peaks_scales_to_max_height() {
        let raw = vec![10, 20, 40, 80];
        let bars = normalize_peaks(&raw);
        assert_eq!(bars.len(), 4);
        assert_eq!(*bars.iter().max().unwrap(), MAX_BAR_HEIGHT);
        assert_eq!(bars[0], 8);
    }

    #[test]
    fn compute_peak_bars_returns_bar_count_buckets() {
        let samples: Vec<i16> = (0..3200).map(|i| (i % 100) as i16).collect();
        let bars = compute_peak_bars(&samples);
        assert_eq!(bars.len(), BAR_COUNT);
        assert!(bars.iter().all(|h| (1..=MAX_BAR_HEIGHT).contains(h)));
    }

    #[test]
    fn artifact_serializes_expected_shape() {
        let artifact = AudioWaveformArtifact::new(vec![20; BAR_COUNT]);
        let json = serde_json::to_string(&artifact).expect("serialize");
        assert!(json.contains("\"bar_count\":32"));
        assert!(json.contains("\"max_height\":64"));
    }
}
