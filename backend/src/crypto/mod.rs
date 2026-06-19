// Human: Canonical encryption posture strings for admin security APIs and inline documentation.
// Agent: READS by admin::console security_overview; DESCRIBES AES-256 symmetric + hybrid PQC key exchange.

pub const SYMMETRIC_CIPHER: &str = "AES-256-GCM";
pub const KEY_WRAPPING: &str =
    "AES-256-GCM envelope encryption for per-file content keys (Postgres file_encryption_keys)";
pub const KEY_EXCHANGE: &str =
    "Hybrid post-quantum TLS at the edge (NIST ML-KEM + classical ECDHE/RSA)";
pub const STREAMING_SEGMENT_CIPHER: &str =
    "AES-128-CBC for HLS media segments (EXT-X-KEY player requirement; keys never stored in plaintext)";
pub const PASSWORD_KDF: &str = "Argon2id (password hashing)";
pub const QUANTUM_POSTURE: &str = "Symmetric AES-256-GCM for data-at-rest; hybrid PQC protects key material in transit";
pub const ENCRYPTION_SUMMARY: &str =
    "AES-256-GCM at rest with hybrid ML-KEM TLS key exchange (edge) / Argon2id passwords";

use rand::{rngs::OsRng, RngCore};

/// Fill `buf` with cryptographically secure random bytes from the OS CSPRNG.
pub fn fill_random_bytes(buf: &mut [u8]) {
    OsRng.fill_bytes(buf);
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn fill_random_bytes_preserves_buffer_length() {
        let mut buf = [0u8; 32];
        fill_random_bytes(&mut buf);
        assert_eq!(buf.len(), 32);
    }

    #[test]
    fn fill_random_bytes_produces_unique_values() {
        let samples: HashSet<[u8; 16]> = (0..100)
            .map(|_| {
                let mut buf = [0u8; 16];
                fill_random_bytes(&mut buf);
                buf
            })
            .collect();
        assert_eq!(samples.len(), 100);
    }
}
