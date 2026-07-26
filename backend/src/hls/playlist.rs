// Human: Build dynamic `.m3u8` manifests with AES-128 segment URIs under the Ownly API.
// Agent: PURE string builder generate(); rewrite_stored_playlist preserves ffmpeg EXTINF timing.

use std::path::Path;

use anyhow::Context;

use super::segment_crypto::{hls_media_sequence_iv, segment_sequence_from_filename};

// Human: Stable order for HLS segment basenames — numeric index first, then full name.
// Agent: USED by generate + parse_segment_manifest sort; HANDLES zero-padded and bare digits.
pub fn compare_segment_paths(left: &str, right: &str) -> std::cmp::Ordering {
    let left_name = left.rsplit('/').next().unwrap_or(left);
    let right_name = right.rsplit('/').next().unwrap_or(right);
    match (
        segment_sequence_from_filename(left_name),
        segment_sequence_from_filename(right_name),
    ) {
        (Some(a), Some(b)) if a != b => a.cmp(&b),
        _ => left_name.cmp(right_name),
    }
}

// Human: Default HLS segment length from ffmpeg `-hls_time` for sources under the large-file threshold.
// Agent: READ by encoder + synthetic playlist fallback; PAIRED with HLS_SEGMENT_TARGET_SECS_LARGE.
pub const HLS_SEGMENT_TARGET_SECS: f64 = 6.0;

// Human: Longer segments for big uploads — fewer HTTP requests and smaller playlists on playback.
// Agent: USED when source_size_bytes > HLS_LARGE_SOURCE_BYTES; MUST match encoder GOP math.
pub const HLS_SEGMENT_TARGET_SECS_LARGE: f64 = 12.0;

// Human: Sources above 500 MiB use the large segment duration tier during HLS ingest.
// Agent: COMPARED against upload/spool file size before ffmpeg spawn.
pub const HLS_LARGE_SOURCE_BYTES: u64 = 500 * 1024 * 1024;

// Human: fMP4 segment + init filenames produced by ffmpeg `-hls_segment_type fmp4`.
// Agent: UPLOADED by encode_job; SERVED by handlers `/init` and `/segments/*.m4s`.
pub const HLS_SEGMENT_EXTENSION: &str = "m4s";
pub const HLS_INIT_FILENAME: &str = "init.mp4";

// Human: Pick `-hls_time` from the uploaded source size before ffmpeg packaging.
// Agent: RETURNS HLS_SEGMENT_TARGET_SECS_LARGE when over HLS_LARGE_SOURCE_BYTES else default 6s.
pub fn hls_segment_target_secs(source_size_bytes: u64) -> f64 {
    if source_size_bytes > HLS_LARGE_SOURCE_BYTES {
        HLS_SEGMENT_TARGET_SECS_LARGE
    } else {
        HLS_SEGMENT_TARGET_SECS
    }
}

// Human: True when a stored playlist targets encrypted fMP4 (EXT-X-MAP or .m4s segment URIs).
// Agent: USED by export_job + synthetic fallback when init.mp4 is missing from storage.
pub fn playlist_uses_fmp4(content: &str) -> bool {
    content.contains("#EXT-X-MAP:") || content.contains(".m4s")
}

// Human: Map legacy `.ts` segment names to `.m4s` when storage holds an fMP4 bundle.
// Agent: USED by rewrite_stored_playlist and synthetic manifest generation; NO-OP when prefer_fmp4 false.
pub fn normalize_playback_segment_basename(name: &str, prefer_fmp4: bool) -> String {
    if prefer_fmp4 {
        if let Some(stem) = name.strip_suffix(".ts") {
            return format!("{stem}.{HLS_SEGMENT_EXTENSION}");
        }
    }
    name.to_string()
}

// Human: Ordered storage keys to try when a segment GET uses the wrong extension.
// Agent: TRIES requested name first, then `.ts`↔`.m4s` alias for migrated bundles.
pub fn hls_segment_storage_aliases(segment_name: &str) -> Vec<String> {
    let primary = segment_name.to_string();
    let mut aliases = vec![primary.clone()];
    if let Some(stem) = segment_name.strip_suffix(".ts") {
        let alt = format!("{stem}.{HLS_SEGMENT_EXTENSION}");
        if alt != primary {
            aliases.push(alt);
        }
    } else if let Some(stem) = segment_name.strip_suffix(&format!(".{HLS_SEGMENT_EXTENSION}")) {
        let alt = format!("{stem}.ts");
        if alt != primary {
            aliases.push(alt);
        }
    }
    aliases
}

// Human: Relative segment path for synthetic playlists when the stored manifest is missing.
// Agent: EMITS `.m4s` for new ingest; `.ts` for legacy TS-only bundles.
pub fn synthetic_segment_rel_path(index: usize, fmp4: bool) -> String {
    if fmp4 {
        format!("segments/{index:04}.{HLS_SEGMENT_EXTENSION}")
    } else {
        format!("segments/{index:04}.ts")
    }
}

pub struct PlaylistGenerator;

impl PlaylistGenerator {
    /// Human: Rewrite ffmpeg's on-disk playlist so segment/key URIs point at API routes.
    /// Agent: PARSES EXTINF pairs; SORTS by numeric segment index; REBUILDS with filename-based AES IVs.
    pub fn rewrite_stored_playlist(
        content: &str,
        base_url: &str,
        key_uri: &str,
        init_uri: &str,
        prefer_fmp4: bool,
    ) -> anyhow::Result<String> {
        // Human: Prefer structured rebuild so media order is always 0000→N regardless of stored order.
        // Agent: parse_segment_manifest sorts by filename; generate emits KEY IV from basename index.
        let (files, durations) = parse_segment_manifest(content)?;
        if files.is_empty() || files.len() != durations.len() {
            anyhow::bail!("stored playlist has no media segments");
        }
        let fmp4 = prefer_fmp4 || playlist_uses_fmp4(content);
        let segment_files: Vec<String> = files
            .iter()
            .map(|path| normalize_segment_rel_path_for_playback(path, fmp4))
            .collect();
        Ok(Self::generate(
            base_url,
            &segment_files,
            &durations,
            key_uri,
            init_uri,
            fmp4,
        ))
    }

    // Human: Build a VOD playlist for API playback (TS legacy or fMP4 with EXT-X-MAP).
    // Agent: WHEN fmp4=true EMITS version 7 + MAP URI; segment paths are relative `segments/…`.
    pub fn generate(
        base_url: &str,
        segment_files: &[String],
        segment_durations: &[f64],
        key_uri: &str,
        init_uri: &str,
        fmp4: bool,
    ) -> String {
        // Human: Keep media order numeric by filename (0000, 0001, …) even if callers pass unsorted lists.
        // Agent: ZIPS files+durations; SORTS by segment_sequence_from_filename then name.
        let mut paired: Vec<(String, f64)> = segment_files
            .iter()
            .cloned()
            .zip(
                segment_durations
                    .iter()
                    .copied()
                    .chain(std::iter::repeat(HLS_SEGMENT_TARGET_SECS)),
            )
            .collect();
        paired.sort_by(|(left, _), (right, _)| compare_segment_paths(left, right));

        let target_duration = paired
            .iter()
            .map(|(_, d)| *d)
            .fold(0.0f64, f64::max)
            .ceil() as i32;

        let version = if fmp4 { 7 } else { 3 };
        let mut lines = vec![
            "#EXTM3U".to_string(),
            format!("#EXT-X-VERSION:{version}"),
            "#EXT-X-PLAYLIST-TYPE:VOD".to_string(),
            format!("#EXT-X-TARGETDURATION:{target_duration}"),
            "#EXT-X-MEDIA-SEQUENCE:0".to_string(),
        ];
        // Human: EXT-X-MAP must precede EXT-X-KEY so the init segment stays clear (HLS + hls.js).
        // Agent: KEY applies only to media segments after MAP; per-segment IV lines follow below.
        if fmp4 {
            lines.push(format!("#EXT-X-MAP:URI=\"{init_uri}\""));
        }

        for (file, duration) in &paired {
            let basename = file
                .rsplit('/')
                .next()
                .filter(|s| !s.is_empty())
                .unwrap_or(file.as_str());
            // Human: IV must match on-disk encryption — always derive from the segment filename index.
            // Agent: USES segment_sequence_from_filename; FALLBACK 0 only for unparseable names.
            let sequence = segment_sequence_from_filename(basename).unwrap_or(0);
            lines.push(format_ext_x_key_line(key_uri, sequence));
            lines.push(format!("#EXTINF:{duration:.3},"));
            let segment_uri = if file.contains('/') {
                format!("{base_url}/{file}")
            } else {
                format!("{base_url}/segments/{file}")
            };
            lines.push(segment_uri);
        }

        lines.push("#EXT-X-ENDLIST".to_string());
        lines.join("\n") + "\n"
    }

    pub fn scan_local_output(playlist_path: &Path) -> anyhow::Result<(Vec<String>, Vec<f64>)> {
        let content = std::fs::read_to_string(playlist_path)?;
        parse_segment_manifest(&content)
    }
}

// Human: IV attribute for EXT-X-KEY — hls.js requires `0x` prefix on the 32-hex-digit value.
// Agent: DERIVES 16-byte IV from hls_media_sequence_iv; MATCHES segment_crypto encrypt path.
pub fn iv_hex_for_hls_sequence(sequence: u32) -> String {
    let iv = hls_media_sequence_iv(sequence);
    let mut hex = String::with_capacity(34);
    hex.push_str("0x");
    for byte in iv {
        hex.push_str(&format!("{byte:02x}"));
    }
    hex
}

// Human: One EXT-X-KEY line with explicit IV for a single media segment.
// Agent: EMITTED before each #EXTINF in playback playlists so hls.js IV matches Rust encryption.
pub fn format_ext_x_key_line(key_uri: &str, sequence: u32) -> String {
    format!(
        "#EXT-X-KEY:METHOD=AES-128,URI=\"{key_uri}\",IV={}",
        iv_hex_for_hls_sequence(sequence)
    )
}

// Human: Replace global EXT-X-KEY tags with per-segment KEY+IV before each media segment.
// Agent: READS segment_aes_sequence_map; SKIPS init.mp4 URIs; DROPS playlist-level KEY lines.
pub fn inject_per_segment_aes128_keys(content: &str, key_uri: &str) -> anyhow::Result<String> {
    let seq_map = segment_aes_sequence_map(content)?;
    let lines: Vec<&str> = content.lines().collect();
    let mut out = Vec::new();
    let mut i = 0usize;

    while i < lines.len() {
        let line = lines[i];
        if line.starts_with("#EXT-X-KEY:") {
            i += 1;
            continue;
        }
        if line.starts_with("#EXTINF:") {
            let mut j = i + 1;
            while j < lines.len() && (lines[j].starts_with('#') || lines[j].trim().is_empty()) {
                j += 1;
            }
            if j < lines.len() {
                let segment_line = lines[j].trim();
                let name = segment_line
                    .rsplit('/')
                    .next()
                    .filter(|s| !s.is_empty())
                    .unwrap_or(segment_line);
                if name != HLS_INIT_FILENAME {
                    // Human: Same IV rule as encrypt — filename sequence first so decrypt matches.
                    // Agent: PREFERS segment_sequence_from_filename; FALLBACK seq_map then error.
                    let sequence = segment_sequence_from_filename(name)
                        .or_else(|| seq_map.get(name).copied())
                        .with_context(|| format!("no AES sequence for segment {name}"))?;
                    out.push(format_ext_x_key_line(key_uri, sequence));
                }
            }
            out.push(line.to_string());
            i += 1;
            continue;
        }
        out.push(line.to_string());
        i += 1;
    }

    let mut text = out.join("\n");
    if !text.ends_with('\n') {
        text.push('\n');
    }
    Ok(text)
}

// Human: EXT-X-MAP must appear before the first EXT-X-KEY so init.mp4 stays unencrypted.
// Agent: REORDERS when ffmpeg or legacy rewrite put KEY above MAP; REQUIRED for hls.js fMP4.
#[cfg(test)]
fn normalize_aes128_map_before_key(content: &str) -> String {
    let lines: Vec<&str> = content.lines().collect();
    let key_idx = lines.iter().position(|l| l.starts_with("#EXT-X-KEY:"));
    let map_idx = lines.iter().position(|l| l.starts_with("#EXT-X-MAP:"));
    let (Some(key_i), Some(map_i)) = (key_idx, map_idx) else {
        return content.to_string();
    };
    if map_i < key_i {
        return content.to_string();
    }

    let key_line = lines[key_i].to_string();
    let mut out: Vec<String> = lines
        .iter()
        .enumerate()
        .filter_map(|(i, line)| {
            if i == key_i {
                None
            } else {
                Some(line.to_string())
            }
        })
        .collect();
    let insert_at = out
        .iter()
        .position(|l| l.starts_with("#EXT-X-MAP:"))
        .map(|map_pos| map_pos + 1)
        .unwrap_or(out.len());
    out.insert(insert_at, key_line);
    let mut text = out.join("\n");
    if !text.ends_with('\n') {
        text.push('\n');
    }
    text
}

pub fn normalize_segment_rel_path(path: &str) -> String {
    let trimmed = path.trim();
    if trimmed.contains('/') {
        trimmed.to_string()
    } else {
        format!("segments/{trimmed}")
    }
}

// Human: Normalize a manifest segment path and upgrade `.ts` basenames when serving fMP4.
// Agent: USED when regenerating playlists from stored ffmpeg manifests.
pub fn normalize_segment_rel_path_for_playback(path: &str, prefer_fmp4: bool) -> String {
    let rel = normalize_segment_rel_path(path);
    if !prefer_fmp4 {
        return rel;
    }
    if let Some((dir, base)) = rel.rsplit_once('/') {
        let base = normalize_playback_segment_basename(base, true);
        format!("{dir}/{base}")
    } else {
        normalize_playback_segment_basename(&rel, true)
    }
}

// Human: `#EXT-X-MEDIA-SEQUENCE` base used for AES-128 IV derivation on each media segment.
// Agent: READS stored ffmpeg playlist; DEFAULT 0 when tag missing.
pub fn parse_media_sequence(content: &str) -> u32 {
    for line in content.lines() {
        if let Some(rest) = line.strip_prefix("#EXT-X-MEDIA-SEQUENCE:") {
            return rest.trim().parse().unwrap_or(0);
        }
    }
    0
}

// Human: Map each segment basename to its HLS media sequence number for AES IVs.
// Agent: PREFERS numeric filename index (matches encrypt_hls_segments_dir); FALLBACK manifest order.
pub fn segment_aes_sequence_map(
    content: &str,
) -> anyhow::Result<std::collections::HashMap<String, u32>> {
    use std::collections::HashMap;

    let base = parse_media_sequence(content);
    let (files, _) = parse_segment_manifest(content)?;
    let mut map = HashMap::new();
    let mut index = 0u32;
    for path in files {
        let name = path
            .rsplit('/')
            .next()
            .filter(|s| !s.is_empty())
            .unwrap_or(path.as_str());
        if name == HLS_INIT_FILENAME {
            continue;
        }
        // Human: Filename index is the source of truth for on-disk AES IV (0007.m4s → sequence 7).
        // Agent: AVOIDS order-based IVs when playlist lines are reordered or synthetic.
        let sequence = segment_sequence_from_filename(name).unwrap_or_else(|| base.saturating_add(index));
        map.insert(name.to_string(), sequence);
        index = index.saturating_add(1);
    }
    Ok(map)
}

// Human: Pair each #EXTINF with the next media URI; sort by numeric segment index for stable order.
// Agent: SKIPS comments between EXTINF and URI; DROPS init.mp4; SORTS via compare_segment_paths.
pub fn parse_segment_manifest(content: &str) -> anyhow::Result<(Vec<String>, Vec<f64>)> {
    let lines: Vec<&str> = content.lines().collect();
    let mut pairs: Vec<(String, f64)> = Vec::new();
    let mut i = 0usize;

    while i < lines.len() {
        let line = lines[i];
        if line.starts_with("#EXTINF:") {
            let dur_str = line
                .trim_start_matches("#EXTINF:")
                .split(',')
                .next()
                .unwrap_or("0")
                .trim();
            let dur = dur_str
                .parse::<f64>()
                .with_context(|| format!("invalid EXTINF duration: {line}"))?;
            let mut j = i + 1;
            while j < lines.len() && (lines[j].starts_with('#') || lines[j].trim().is_empty()) {
                j += 1;
            }
            if j < lines.len() {
                let uri = lines[j].trim().to_string();
                let name = uri
                    .rsplit('/')
                    .next()
                    .filter(|s| !s.is_empty())
                    .unwrap_or(uri.as_str());
                if name != HLS_INIT_FILENAME {
                    pairs.push((uri, dur));
                }
                i = j + 1;
                continue;
            }
        }
        i += 1;
    }

    pairs.sort_by(|(left, _), (right, _)| compare_segment_paths(left, right));
    let files = pairs.iter().map(|(f, _)| f.clone()).collect();
    let durations = pairs.iter().map(|(_, d)| *d).collect();
    Ok((files, durations))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rewrite_stored_playlist_injects_per_segment_iv() {
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
            "/api/v1/files/abc/init",
            false,
        )
        .expect("rewrite");

        assert!(out.contains("#EXTINF:6.006,"), "out={out}");
        assert!(out.contains("#EXTINF:3.837,"), "out={out}");
        // Human: KEY must appear before each media segment with filename-derived IV (0000→0, 0001→1).
        let key0 = out.find(
            "#EXT-X-KEY:METHOD=AES-128,URI=\"/api/v1/files/abc/key\",IV=0x00000000000000000000000000000000",
        );
        let key1 = out.find(
            "#EXT-X-KEY:METHOD=AES-128,URI=\"/api/v1/files/abc/key\",IV=0x00000000000000000000000000000001",
        );
        let seg0 = out.find("/api/v1/files/abc/segments/0000.ts");
        let seg1 = out.find("/api/v1/files/abc/segments/0001.ts");
        assert!(key0.is_some() && key1.is_some() && seg0.is_some() && seg1.is_some(), "out={out}");
        assert!(key0.unwrap() < seg0.unwrap() && seg0.unwrap() < key1.unwrap() && key1.unwrap() < seg1.unwrap(), "out={out}");
    }

    #[test]
    fn rewrite_stored_playlist_rewrites_fmp4_map_and_segments() {
        let stored = "\
#EXTM3U
#EXT-X-VERSION:7
#EXT-X-MAP:URI=\"init.mp4\"
#EXT-X-KEY:METHOD=AES-128,URI=\"key.bin\"
#EXTINF:12.000,
segments/0000.m4s
#EXT-X-ENDLIST
";
        let out = PlaylistGenerator::rewrite_stored_playlist(
            stored,
            "/api/v1/files/abc",
            "/api/v1/files/abc/key",
            "/api/v1/files/abc/init",
            true,
        )
        .expect("rewrite");

        assert!(out.contains("#EXT-X-MAP:URI=\"/api/v1/files/abc/init\""), "out={out}");
        assert!(out.contains("/api/v1/files/abc/segments/0000.m4s"), "out={out}");
        let map_pos = out.find("#EXT-X-MAP:").expect("map");
        let key_pos = out.find("#EXT-X-KEY:").expect("key");
        assert!(map_pos < key_pos, "MAP must precede KEY, out={out}");
    }

    #[test]
    fn hls_segment_target_secs_tiers_by_source_size() {
        assert_eq!(hls_segment_target_secs(0), HLS_SEGMENT_TARGET_SECS);
        assert_eq!(
            hls_segment_target_secs(HLS_LARGE_SOURCE_BYTES + 1),
            HLS_SEGMENT_TARGET_SECS_LARGE
        );
    }

    #[test]
    fn generate_fmp4_includes_map_and_version_seven() {
        let out = PlaylistGenerator::generate(
            "/api/v1/files/x",
            &["segments/0000.m4s".to_string()],
            &[12.0],
            "/api/v1/files/x/key",
            "/api/v1/files/x/init",
            true,
        );
        assert!(out.contains("#EXT-X-VERSION:7"));
        assert!(out.contains("#EXT-X-MAP:URI=\"/api/v1/files/x/init\""));
        let map_pos = out.find("#EXT-X-MAP:").expect("map");
        let key_pos = out.find("#EXT-X-KEY:").expect("key");
        assert!(map_pos < key_pos, "out={out}");
        assert!(out.contains("IV=0x00000000000000000000000000000000"));
    }

    #[test]
    fn rewrite_skips_init_mp4_media_segment_line() {
        let stored = "\
#EXTM3U
#EXT-X-VERSION:7
#EXT-X-MAP:URI=\"init.mp4\"
#EXTINF:0.000,
init.mp4
#EXTINF:6.000,
0000.m4s
#EXT-X-ENDLIST
";
        let out = PlaylistGenerator::rewrite_stored_playlist(
            stored,
            "/api/v1/files/abc",
            "/api/v1/files/abc/key",
            "/api/v1/files/abc/init",
            true,
        )
        .expect("rewrite");

        assert!(out.contains("#EXT-X-MAP:URI=\"/api/v1/files/abc/init\""));
        assert!(out.contains("/api/v1/files/abc/segments/0000.m4s"));
        assert!(
            !out.lines().any(|line| {
                line == "/api/v1/files/abc/init"
                    && !line.starts_with("#EXT-X-MAP")
            }),
            "init must not appear as a media segment URI, out={out}"
        );
    }

    #[test]
    fn segment_aes_sequence_map_uses_media_sequence_base() {
        let stored = "\
#EXTM3U
#EXT-X-VERSION:7
#EXT-X-MEDIA-SEQUENCE:2
#EXTINF:6.0,
segments/0002.m4s
#EXTINF:6.0,
segments/0003.m4s
";
        let map = segment_aes_sequence_map(stored).expect("map");
        assert_eq!(map.get("0002.m4s"), Some(&2));
        assert_eq!(map.get("0003.m4s"), Some(&3));
    }

    #[test]
    fn rewrite_upgrades_legacy_ts_segments_when_prefer_fmp4() {
        let stored = "\
#EXTM3U
#EXT-X-VERSION:3
#EXTINF:6.000,
segments/0000.ts
#EXT-X-ENDLIST
";
        let out = PlaylistGenerator::rewrite_stored_playlist(
            stored,
            "/api/v1/files/abc",
            "/api/v1/files/abc/key",
            "/api/v1/files/abc/init",
            true,
        )
        .expect("rewrite");

        assert!(out.contains("/api/v1/files/abc/segments/0000.m4s"), "out={out}");
        assert!(!out.contains("0000.ts"), "out={out}");
    }

    #[test]
    fn iv_hex_for_sequence_uses_0x_prefix() {
        assert_eq!(
            iv_hex_for_hls_sequence(0),
            "0x00000000000000000000000000000000"
        );
        assert_eq!(
            iv_hex_for_hls_sequence(1),
            "0x00000000000000000000000000000001"
        );
    }

    #[test]
    fn normalize_moves_map_before_key() {
        let stored = "\
#EXTM3U
#EXT-X-VERSION:7
#EXT-X-KEY:METHOD=AES-128,URI=\"key\"
#EXT-X-MAP:URI=\"init.mp4\"
";
        let out = normalize_aes128_map_before_key(stored);
        let map_pos = out.find("#EXT-X-MAP:").expect("map");
        let key_pos = out.find("#EXT-X-KEY:").expect("key");
        assert!(map_pos < key_pos, "out={out}");
    }

    #[test]
    fn rewrite_sorts_out_of_order_segment_lines() {
        let stored = "\
#EXTM3U
#EXT-X-VERSION:7
#EXT-X-MAP:URI=\"init.mp4\"
#EXTINF:4.000,
segments/0002.m4s
#EXTINF:6.000,
segments/0000.m4s
#EXTINF:5.000,
segments/0001.m4s
#EXT-X-ENDLIST
";
        let out = PlaylistGenerator::rewrite_stored_playlist(
            stored,
            "/api/v1/files/abc",
            "/api/v1/files/abc/key",
            "/api/v1/files/abc/init",
            true,
        )
        .expect("rewrite");
        let p0 = out.find("segments/0000.m4s").expect("0000");
        let p1 = out.find("segments/0001.m4s").expect("0001");
        let p2 = out.find("segments/0002.m4s").expect("0002");
        assert!(p0 < p1 && p1 < p2, "out={out}");
        assert!(out.contains("#EXTINF:6.000,"), "duration stays with 0000, out={out}");
    }
}
