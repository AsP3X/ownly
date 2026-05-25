// Human: Build dynamic `.m3u8` manifests with AES-128 segment URIs under the MediaVault API.
// Agent: PURE string builder generate(); rewrite_stored_playlist preserves ffmpeg EXTINF timing.

use std::path::Path;

pub struct PlaylistGenerator;

impl PlaylistGenerator {
    /// Human: Rewrite ffmpeg's on-disk playlist so segment/key URIs point at API routes.
    /// Agent: KEEPS #EXTINF and IV tags from storage; REWRITES KEY URI + segment paths only.
    pub fn rewrite_stored_playlist(
        content: &str,
        base_url: &str,
        key_uri: &str,
    ) -> anyhow::Result<String> {
        let mut out = Vec::new();
        for line in content.lines() {
            if line.starts_with("#EXT-X-KEY:") {
                out.push(rewrite_key_uri(line, key_uri));
            } else if !line.starts_with('#') && !line.trim().is_empty() {
                let name = line
                    .trim()
                    .rsplit('/')
                    .next()
                    .ok_or_else(|| anyhow::anyhow!("invalid segment line in stored playlist"))?;
                out.push(format!("{base_url}/segments/{name}"));
            } else {
                out.push(line.to_string());
            }
        }
        if out.is_empty() {
            anyhow::bail!("stored playlist is empty");
        }
        Ok(out.join("\n") + "\n")
    }

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
        parse_segment_manifest(&content)
    }
}

// Human: Replace the URI="..." portion of an #EXT-X-KEY line while keeping METHOD/IV tags.
// Agent: USED by rewrite_stored_playlist; PREFIX ends at URI= so quotes are not doubled.
fn rewrite_key_uri(line: &str, key_uri: &str) -> String {
    if let Some(uri_start) = line.find("URI=\"") {
        let after_uri = uri_start + 5;
        if let Some(uri_end) = line[after_uri..].find('"') {
            let prefix = &line[..uri_start + 4];
            let suffix = &line[after_uri + uri_end + 1..];
            return format!("{prefix}\"{key_uri}\"{suffix}");
        }
    }
    format!("#EXT-X-KEY:METHOD=AES-128,URI=\"{key_uri}\"")
}

// Human: Extract segment paths and #EXTINF durations from a stored ffmpeg playlist.
// Agent: RETURNS parallel vectors; USED by scan_local_output and synthetic fallback.
pub fn parse_segment_manifest(content: &str) -> anyhow::Result<(Vec<String>, Vec<f64>)> {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rewrite_stored_playlist_preserves_extinf_and_iv() {
        let stored = "\
#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:8
#EXT-X-MEDIA-SEQUENCE:0
#EXT-X-KEY:METHOD=AES-128,URI=\"key.bin\",IV=0x00000000000000000000000000000000
#EXTINF:6.006000,
segments/0000.ts
#EXTINF:3.837000,
segments/0001.ts
#EXT-X-ENDLIST
";
        let out = PlaylistGenerator::rewrite_stored_playlist(
            stored,
            "/api/v1/files/abc",
            "/api/v1/files/abc/key",
        )
        .expect("rewrite");

        assert!(out.contains("#EXTINF:6.006000,"), "out={out}");
        assert!(out.contains("#EXTINF:3.837000,"), "out={out}");
        assert!(
            out.contains("#EXT-X-KEY:METHOD=AES-128,URI=\"/api/v1/files/abc/key\""),
            "out={out}"
        );
        assert!(!out.contains("URI=\"\""), "double-quoted key URI: {out}");
        assert!(out.contains("/api/v1/files/abc/segments/0000.ts"));
        assert!(out.contains("/api/v1/files/abc/segments/0001.ts"));
    }
}
