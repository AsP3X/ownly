// Human: Build dynamic `.m3u8` manifests with AES-128 segment URIs under the MediaVault API.
// Agent: PURE string builder generate(); scan_local_output READS ffmpeg stream.m3u8 when needed.

use std::path::Path;

pub struct PlaylistGenerator;

impl PlaylistGenerator {
    pub fn generate(
        base_url: &str,
        segment_files: &[String],
        segment_durations: &[f64],
        key_uri: &str,
    ) -> String {
        let target_duration = segment_durations
            .iter()
            .copied()
            .fold(0.0f64, f64::max)
            .ceil() as i32;

        let mut lines = vec![
            "#EXTM3U".to_string(),
            "#EXT-X-VERSION:3".to_string(),
            format!("#EXT-X-TARGETDURATION:{target_duration}"),
            "#EXT-X-MEDIA-SEQUENCE:0".to_string(),
            format!("#EXT-X-KEY:METHOD=AES-128,URI=\"{key_uri}\""),
        ];

        for (i, file) in segment_files.iter().enumerate() {
            let duration = segment_durations.get(i).copied().unwrap_or(4.0);
            lines.push(format!("#EXTINF:{duration:.3},"));
            lines.push(format!("{base_url}/{file}"));
        }

        lines.push("#EXT-X-ENDLIST".to_string());
        lines.join("\n") + "\n"
    }

    pub fn scan_local_output(playlist_path: &Path) -> anyhow::Result<(Vec<String>, Vec<f64>)> {
        let content = std::fs::read_to_string(playlist_path)?;
        let mut files = Vec::new();
        let mut durations = Vec::new();

        for line in content.lines() {
            if line.starts_with("#EXTINF:") {
                let dur = line
                    .trim_start_matches("#EXTINF:")
                    .trim_end_matches(',')
                    .parse::<f64>()?;
                durations.push(dur);
            } else if !line.starts_with('#') && !line.trim().is_empty() {
                files.push(line.trim().to_string());
            }
        }

        Ok((files, durations))
    }
}
