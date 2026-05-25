use super::error::{internal, StorageError};

// Human: Every stored blob is prefixed with a magic tag and logical size so reads can tell compressed from legacy raw files.
// Agent: BLOB_MAGIC="NOSZ"; HEADER_LEN=12 (magic + uncompressed_size u64 LE); legacy blobs without magic are served raw.
pub const BLOB_MAGIC: &[u8; 4] = b"NOSZ";
pub const HEADER_LEN: usize = 12;

// Human: zstd level 22 for small blobs; large uploads use lower levels so multi-GB files finish in reasonable time.
// Agent: zstd_level_for_bytes scales down by size; NOS_ZSTD_LEVEL overrides the small-file default.
const ZSTD_LEVEL_MAX: i32 = 22;
const LARGE_FILE_THRESHOLD: usize = 100 * 1024 * 1024;
const HUGE_FILE_THRESHOLD: usize = 500 * 1024 * 1024;

/// Picks a zstd level that balances disk savings vs CPU time for the given logical byte length.
pub fn zstd_level_for_bytes(uncompressed_len: usize) -> i32 {
    if uncompressed_len >= HUGE_FILE_THRESHOLD {
        3
    } else if uncompressed_len >= LARGE_FILE_THRESHOLD {
        6
    } else if uncompressed_len >= 10 * 1024 * 1024 {
        9
    } else {
        std::env::var("NOS_ZSTD_LEVEL")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(ZSTD_LEVEL_MAX)
    }
}

// Human: Compress arbitrary bytes with zstd and wrap them in the Nebular blob header.
// Agent: WRITES magic+uncompressed_size LE + zstd payload; level from zstd_level_for_bytes.
pub fn compress_blob(uncompressed: &[u8]) -> Result<Vec<u8>, StorageError> {
    let level = zstd_level_for_bytes(uncompressed.len());
    let mut out = Vec::with_capacity(HEADER_LEN + uncompressed.len() / 2 + 64);
    out.extend_from_slice(BLOB_MAGIC);
    out.extend_from_slice(&(uncompressed.len() as u64).to_le_bytes());

    let compressed = zstd::encode_all(uncompressed, level).map_err(internal)?;
    out.extend_from_slice(&compressed);
    Ok(out)
}

/// Returns true when `data` begins with the Nebular compressed-blob header.
pub fn is_compressed_blob(data: &[u8]) -> bool {
    data.len() >= HEADER_LEN && data.starts_with(BLOB_MAGIC)
}

// Human: Pick zstd-wrapped storage when smaller than raw; otherwise keep bytes unwrapped for incompressible payloads.
// Agent: CALLS compress_blob; IF compressed.len < raw.len THEN NOSZ ELSE raw Vec (no header).
pub fn encode_blob_for_storage(uncompressed: &[u8]) -> Result<Vec<u8>, StorageError> {
    let compressed = compress_blob(uncompressed)?;
    if compressed.len() < uncompressed.len() {
        Ok(compressed)
    } else {
        Ok(uncompressed.to_vec())
    }
}

// Human: Stream-compress a spooled raw file to disk — avoids holding multi-GB payloads in RAM.
// Agent: READS raw_path; WRITES NOSZ header + zstd stream to out_path; RETURNS stored byte length.
pub fn write_compressed_blob_file(
    raw_path: &std::path::Path,
    logical_size: u64,
    out_path: &std::path::Path,
) -> Result<usize, StorageError> {
    use std::fs::File;
    use std::io::Write;
    use zstd::stream::write::Encoder;

    let level = zstd_level_for_bytes(logical_size as usize);
    let mut out_file = File::create(out_path).map_err(internal)?;
    out_file.write_all(BLOB_MAGIC).map_err(internal)?;
    out_file
        .write_all(&logical_size.to_le_bytes())
        .map_err(internal)?;

    let mut encoder = Encoder::new(out_file, level).map_err(internal)?;
    let mut raw_file = File::open(raw_path).map_err(internal)?;
    std::io::copy(&mut raw_file, &mut encoder).map_err(internal)?;
    let out_file = encoder.finish().map_err(internal)?;
    Ok(out_file.metadata().map_err(internal)?.len() as usize)
}

// Human: Pick compressed blob on disk when smaller than raw; otherwise store raw bytes at out_path.
// Agent: CALLS write_compressed_blob_file; COMPARES file sizes; RETURNS (stored_bytes, used_compression).
pub fn materialize_blob_from_raw_file(
    raw_path: &std::path::Path,
    logical_size: u64,
    out_path: &std::path::Path,
) -> Result<(usize, bool), StorageError> {
    let raw_len = std::fs::metadata(raw_path).map_err(internal)?.len();
    let compressed_len = write_compressed_blob_file(raw_path, logical_size, out_path)?;
    if compressed_len < raw_len as usize {
        Ok((compressed_len, true))
    } else {
        std::fs::copy(raw_path, out_path).map_err(internal)?;
        Ok((raw_len as usize, false))
    }
}

// Human: Turn on-disk bytes back into the original object payload, or pass through legacy raw blobs unchanged.
// Agent: IF magic NOSZ THEN zstd decode and verify len==expected_size ELSE return data as-is (pre-compression objects).
pub fn decompress_blob(blob: &[u8], expected_size: u64) -> Result<Vec<u8>, StorageError> {
    if !is_compressed_blob(blob) {
        return Ok(blob.to_vec());
    }

    let stored_size = u64::from_le_bytes(
        blob[4..HEADER_LEN]
            .try_into()
            .map_err(|_| internal(anyhow::anyhow!("blob header truncated")))?,
    );
    if stored_size != expected_size {
        return Err(internal(anyhow::anyhow!(
            "blob header size mismatch: header={stored_size} metadata={expected_size}"
        )));
    }

    let decompressed = zstd::decode_all(&blob[HEADER_LEN..]).map_err(internal)?;
    if decompressed.len() as u64 != expected_size {
        return Err(internal(anyhow::anyhow!(
            "decompressed size mismatch: got {} expected {expected_size}",
            decompressed.len()
        )));
    }
    Ok(decompressed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip_compresses_and_restores() {
        let original = b"hello world ".repeat(500);
        let blob = compress_blob(&original).unwrap();
        assert!(is_compressed_blob(&blob));
        assert!(blob.len() < original.len());
        let restored = decompress_blob(&blob, original.len() as u64).unwrap();
        assert_eq!(restored, original);
    }

    #[test]
    fn legacy_raw_blob_passes_through() {
        let raw = b"legacy uncompressed payload";
        let restored = decompress_blob(raw, raw.len() as u64).unwrap();
        assert_eq!(restored, raw);
        assert!(!is_compressed_blob(raw));
    }

    #[test]
    fn incompressible_payload_stays_raw() {
        let payload = b"x".to_vec();
        let compressed = compress_blob(&payload).unwrap();
        assert!(compressed.len() > payload.len());
        let stored = encode_blob_for_storage(&payload).unwrap();
        assert!(!is_compressed_blob(&stored));
        assert_eq!(stored, payload);
    }

    #[test]
    fn large_files_use_faster_zstd_level() {
        assert_eq!(zstd_level_for_bytes(HUGE_FILE_THRESHOLD), 3);
        assert_eq!(zstd_level_for_bytes(LARGE_FILE_THRESHOLD), 6);
        assert_eq!(zstd_level_for_bytes(10 * 1024 * 1024), 9);
    }
}
