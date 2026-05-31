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
