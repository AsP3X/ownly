// Human: AES-128-CBC encryption for HLS media segments — ffmpeg cannot encrypt fMP4 in HLS muxer.
// Agent: IV matches ffmpeg/hls.js (sequence in last 4 bytes BE); PKCS7 padding; init.mp4 stays clear.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use aes::cipher::{block_padding::Pkcs7, BlockDecryptMut, BlockEncryptMut, KeyIvInit};
use tokio::sync::Semaphore;
use tokio::task::JoinSet;
use anyhow::Context;
use cbc::cipher::BlockSizeUser;

use super::playlist::segment_aes_sequence_map;

type Aes128CbcEnc = cbc::Encryptor<aes::Aes128>;
type Aes128CbcDec = cbc::Decryptor<aes::Aes128>;

// Human: 16-byte IV for segment N when EXT-X-KEY has no IV attribute (hls.js + ffmpeg convention).
// Agent: BYTES 0..12 zero; BYTES 12..16 big-endian u32 media sequence number.
pub fn hls_media_sequence_iv(sequence: u32) -> [u8; 16] {
    let mut iv = [0u8; 16];
    iv[12..16].copy_from_slice(&sequence.to_be_bytes());
    iv
}

// Human: Encrypt one fMP4 media segment for HLS AES-128 playback.
// Agent: CALLS after clear ffmpeg output; OVERWRITES .m4s on disk before Nebular upload.
pub fn encrypt_hls_media_segment(
    plaintext: &[u8],
    key: &[u8; 16],
    sequence: u32,
) -> anyhow::Result<Vec<u8>> {
    let iv = hls_media_sequence_iv(sequence);
    let cipher = Aes128CbcEnc::new_from_slices(key, &iv)
        .map_err(|e| anyhow::anyhow!("AES-128 encrypt segment {sequence}: {e}"))?;
    let block_size = Aes128CbcEnc::block_size();
    let pad_len = block_size - (plaintext.len() % block_size);
    let mut buf = vec![0u8; plaintext.len() + pad_len];
    buf[..plaintext.len()].copy_from_slice(plaintext);
    let enc = cipher
        .encrypt_padded_mut::<Pkcs7>(&mut buf, plaintext.len())
        .map_err(|e| anyhow::anyhow!("AES-128 encrypt segment {sequence}: {e}"))?;
    Ok(enc.to_vec())
}

// Human: Decrypt a stored HLS media segment (MP4 export remux path).
// Agent: READS encrypted bytes from storage; USES same IV layout as encrypt_hls_media_segment.
pub fn decrypt_hls_media_segment(
    ciphertext: &[u8],
    key: &[u8; 16],
    sequence: u32,
) -> anyhow::Result<Vec<u8>> {
    let iv = hls_media_sequence_iv(sequence);
    let cipher = Aes128CbcDec::new_from_slices(key, &iv)
        .map_err(|e| anyhow::anyhow!("AES-128 decrypt segment {sequence}: {e}"))?;
    let mut buf = ciphertext.to_vec();
    let plain = cipher
        .decrypt_padded_mut::<Pkcs7>(&mut buf)
        .map_err(|e| anyhow::anyhow!("AES-128 decrypt segment {sequence}: {e}"))?;
    Ok(plain.to_vec())
}

// Human: Parse `0007.m4s` style names into the HLS media sequence index for IV derivation.
// Agent: RETURNS None for init.mp4 or non-numeric stems.
pub fn segment_sequence_from_filename(name: &str) -> Option<u32> {
    let stem = name
        .strip_suffix(".m4s")
        .or_else(|| name.strip_suffix(".ts"))?;
    stem.parse::<u32>().ok()
}

// Human: Max concurrent segment encrypt tasks — CPU-bound AES work after ffmpeg packaging.
// Agent: LIMITS JoinSet parallelism; TUNE if hosts have more cores and fast local disk.
const HLS_SEGMENT_ENCRYPT_PARALLEL: usize = 4;

// Human: Encrypt every clear `.m4s` under `segments/` in place after ffmpeg packaging.
// Agent: SKIPS init.mp4; USES filename index as sequence; PARALLEL encrypt via bounded JoinSet.
pub async fn encrypt_hls_segments_dir(
    dir: &Path,
    playlist_path: &Path,
    key: &[u8; 16],
) -> anyhow::Result<()> {
    let playlist = tokio::fs::read_to_string(playlist_path)
        .await
        .with_context(|| format!("read playlist {}", playlist_path.display()))?;
    let seq_map: HashMap<String, u32> = segment_aes_sequence_map(&playlist)?;

    let mut segments: Vec<(PathBuf, u32)> = Vec::new();
    let mut entries = tokio::fs::read_dir(dir)
        .await
        .context("reading segments directory for encryption")?;

    while let Some(entry) = entries.next_entry().await? {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("m4s") {
            continue;
        }
        let name = path
            .file_name()
            .and_then(|n| n.to_str())
            .context("segment path missing filename")?;
        let sequence = seq_map
            .get(name)
            .copied()
            .or_else(|| segment_sequence_from_filename(name))
            .with_context(|| format!("no AES sequence for segment {name}"))?;
        segments.push((path, sequence));
    }

    if segments.is_empty() {
        return Ok(());
    }

    let gate = Arc::new(Semaphore::new(HLS_SEGMENT_ENCRYPT_PARALLEL));
    let key = Arc::new(*key);
    let mut tasks = JoinSet::new();

    for (path, sequence) in segments {
        let permit = gate
            .clone()
            .acquire_owned()
            .await
            .context("acquire HLS segment encrypt slot")?;
        let key = key.clone();
        tasks.spawn(async move {
            let _permit = permit;
            let plain = tokio::fs::read(&path)
                .await
                .with_context(|| format!("read clear segment {}", path.display()))?;
            let encrypted = encrypt_hls_media_segment(&plain, &key, sequence)?;
            tokio::fs::write(&path, &encrypted)
                .await
                .with_context(|| format!("write encrypted segment {}", path.display()))?;
            Ok::<(), anyhow::Error>(())
        });
    }

    while let Some(result) = tasks.join_next().await {
        result.context("HLS segment encrypt task join")??;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encrypt_decrypt_roundtrip() {
        let key = [0x55u8; 16];
        let plain = b"hello hls segment padding test!!";
        let seq = 42u32;
        let enc = encrypt_hls_media_segment(plain, &key, seq).expect("encrypt");
        let dec = decrypt_hls_media_segment(&enc, &key, seq).expect("decrypt");
        assert_eq!(dec.as_slice(), plain);
    }

    #[test]
    fn iv_places_sequence_in_last_four_bytes() {
        let iv = hls_media_sequence_iv(0x0102_0304);
        assert_eq!(iv[12], 0x01);
        assert_eq!(iv[13], 0x02);
        assert_eq!(iv[14], 0x03);
        assert_eq!(iv[15], 0x04);
    }

    #[test]
    fn segment_sequence_from_m4s_name() {
        assert_eq!(segment_sequence_from_filename("0007.m4s"), Some(7));
        assert_eq!(segment_sequence_from_filename("0007.ts"), Some(7));
        assert_eq!(segment_sequence_from_filename("init.mp4"), None);
    }

    #[test]
    fn encrypt_decrypt_matches_playlist_iv_hex() {
        use super::super::playlist::iv_hex_for_hls_sequence;

        let key = [0x42u8; 16];
        let plain = b"fmp4-like segment payload for aes roundtrip!!";
        let seq = 3u32;
        let enc = encrypt_hls_media_segment(plain, &key, seq).expect("encrypt");
        let dec = decrypt_hls_media_segment(&enc, &key, seq).expect("decrypt");
        assert_eq!(dec.as_slice(), plain.as_slice());
        assert_eq!(
            iv_hex_for_hls_sequence(seq),
            "0x00000000000000000000000000000003"
        );
    }
}
