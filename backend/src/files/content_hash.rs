// Human: Compute SHA-256 digests for uploaded file bytes stored on disk.
// Agent: READS spool paths in chunks; RETURNS lowercase hex strings for DB + duplicate checks.

use std::path::Path;

use sha2::{Digest, Sha256};
use tokio::io::AsyncReadExt;

use crate::error::AppError;

const HASH_READ_BUFFER_BYTES: usize = 1024 * 1024;

// Human: Stream a spooled upload file through SHA-256 without loading it entirely into RAM.
// Agent: READS path via tokio::fs::File; RETURNS 64-char lowercase hex digest.
pub async fn hash_file_sha256(path: &Path) -> Result<String, AppError> {
    let mut file = tokio::fs::File::open(path).await.map_err(|error| {
        AppError::Internal(anyhow::anyhow!("open upload spool for hashing: {error}"))
    })?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; HASH_READ_BUFFER_BYTES];

    loop {
        let read_bytes = file.read(&mut buffer).await.map_err(|error| {
            AppError::Internal(anyhow::anyhow!("read upload spool for hashing: {error}"))
        })?;
        if read_bytes == 0 {
            break;
        }
        hasher.update(&buffer[..read_bytes]);
    }

    Ok(hex::encode(hasher.finalize()))
}

#[cfg(test)]
mod tests {
    use super::hash_file_sha256;
    use sha2::{Digest, Sha256};
    use std::io::Write;

    // Human: REGRESSION — hashing must match a known SHA-256 digest for fixed bytes.
    // Agent: WRITES temp file; ASSERTS hash_file_sha256 equals manual digest.
    #[tokio::test]
    async fn hash_file_sha256_matches_expected_digest() {
        let mut temp = tempfile::NamedTempFile::new().expect("temp file");
        temp.write_all(b"ownly-content-hash-test")
            .expect("write temp");
        temp.flush().expect("flush temp");

        let expected = hex::encode(Sha256::digest(b"ownly-content-hash-test"));
        let actual = hash_file_sha256(temp.path())
            .await
            .expect("hash temp file");

        assert_eq!(actual, expected);
    }
}
