// Human: Canonical encryption posture copy for admin UI and public security pages.
// Agent: READS by AdminSystemSettingsPanel, StorageSpecsPage, FaqPage; DESCRIBES AES-256 + hybrid PQC model.

export const SYMMETRIC_CIPHER = "AES-256-GCM";

export const KEY_WRAPPING =
  "AES-256-GCM envelope encryption for per-file content keys (Postgres file_encryption_keys)";

export const KEY_EXCHANGE =
  "Hybrid post-quantum TLS at the edge (NIST ML-KEM + classical ECDHE/RSA)";

export const STREAMING_SEGMENT_CIPHER =
  "AES-128-CBC for HLS media segments (EXT-X-KEY player requirement; keys wrapped with AES-256-GCM)";

export const PASSWORD_KDF = "Argon2id (password hashing)";

export const QUANTUM_POSTURE =
  "Symmetric AES-256-GCM for data-at-rest; hybrid PQC protects key material in transit";

export const ENCRYPTION_SUMMARY =
  "AES-256-GCM at rest with hybrid ML-KEM TLS key exchange (edge) / Argon2id passwords";

/** Human: Two pillars of quantum-resistant encryption — symmetric + key exchange. */
export const QUANTUM_RESISTANCE_PILLARS = [
  {
    title: "Symmetric encryption (AES-256)",
    body:
      "Grover's algorithm reduces a brute-force search against AES-256 to roughly 2^128 operations — still computationally infeasible. Ownly mandates AES-256-GCM for envelope key wrapping and at-rest protection; legacy AES-128 is not used for content keys.",
  },
  {
    title: "Key exchange & signatures (hybrid PQC)",
    body:
      "Classical RSA/ECC key exchange is vulnerable to Shor's algorithm on future quantum computers. Deployments should terminate TLS with hybrid mechanisms that combine classical handshakes and NIST post-quantum algorithms such as ML-KEM (key encapsulation) and ML-DSA (signatures) to mitigate harvest-now, decrypt-later attacks.",
  },
] as const;

/** Human: Operator checklist for quantum-ready deployments. */
export const QUANTUM_READINESS_CHECKLIST = [
  "Upgrade TLS, IPsec, and SSH to hybrid post-quantum key exchange where supported.",
  "Mandate AES-256-GCM for all new data and retire AES-128 except HLS segment payloads required by players.",
  "Adopt NIST-approved PQC schemes (ML-KEM, ML-DSA) for certificates and public-key infrastructure.",
] as const;

export type EncryptionProfile = {
  symmetric_cipher: string;
  key_wrapping: string;
  key_exchange: string;
  streaming_segment_cipher: string;
  password_kdf: string;
  quantum_posture: string;
};

/** Human: Default profile when the admin security API has not loaded yet. */
export const DEFAULT_ENCRYPTION_PROFILE: EncryptionProfile = {
  symmetric_cipher: SYMMETRIC_CIPHER,
  key_wrapping: KEY_WRAPPING,
  key_exchange: KEY_EXCHANGE,
  streaming_segment_cipher: STREAMING_SEGMENT_CIPHER,
  password_kdf: PASSWORD_KDF,
  quantum_posture: QUANTUM_POSTURE,
};
