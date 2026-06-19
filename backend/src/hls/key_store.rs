// Human: Persist per-file content keys using AES-256-GCM envelope encryption (quantum-hardened symmetric layer).
// Agent: WRITES file_encryption_keys; USES AES-256-GCM; READS PgPool; RETURNS 16-byte HLS content key when needed.

use anyhow::Context;
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use uuid::Uuid;

const NONCE_LEN: usize = 12;
const MEDIA_KEY_LEN: usize = 16;
const GCM_TAG_LEN: usize = 16;
const LEGACY_ENCRYPTED_LEN: usize = MEDIA_KEY_LEN + GCM_TAG_LEN;

pub type AesKey = [u8; 16];

#[derive(Clone)]
pub struct KeyStore {
    pool: PgPool,
    /// AES-256-GCM key derived from the full signing secret via SHA-256.
    master_key: [u8; 32],
    /// Pre-SEC-038 truncation of the secret; kept for decrypting existing blobs.
    legacy_master_key: [u8; 32],
}

/// Derive the HLS envelope master key from the full configured secret (SEC-038).
fn derive_master_key(secret: &str) -> [u8; 32] {
    Sha256::digest(secret.as_bytes()).into()
}

/// Legacy master key material: first 32 bytes of the secret, zero-padded.
fn legacy_truncate_master_key(secret: &str) -> [u8; 32] {
    let mut key = [0u8; 32];
    let bytes = secret.as_bytes();
    let len = bytes.len().min(32);
    key[..len].copy_from_slice(&bytes[..len]);
    key
}

impl KeyStore {
    pub fn new(pool: PgPool, master_secret: String) -> Self {
        Self {
            pool,
            master_key: derive_master_key(&master_secret),
            legacy_master_key: legacy_truncate_master_key(&master_secret),
        }
    }

    /// Human: One-time startup migration — re-encrypt legacy zero-nonce blobs to random-nonce envelopes.
    /// Agent: SELECT rows with legacy blob length; DECRYPT via static zero nonce; UPDATE with modern blob.
    pub async fn migrate_legacy_blobs_at_startup(&self) -> anyhow::Result<u64> {
        let rows: Vec<(String, Vec<u8>)> = sqlx::query_as(
            "SELECT file_id, encrypted_key FROM file_encryption_keys \
             WHERE octet_length(encrypted_key) = $1",
        )
        .bind(LEGACY_ENCRYPTED_LEN as i32)
        .fetch_all(&self.pool)
        .await
        .context("listing legacy HLS key blobs for migration")?;

        if rows.is_empty() {
            return Ok(0);
        }

        let mut migrated = 0u64;
        for (file_id, encrypted) in rows {
            let key = self
                .decrypt_legacy_blob(&encrypted)
                .with_context(|| format!("decrypting legacy HLS key for file {file_id}"))?;
            let re_encrypted = self
                .encrypt_key(&key)
                .with_context(|| format!("re-encrypting HLS key for file {file_id}"))?;
            sqlx::query(
                "UPDATE file_encryption_keys SET encrypted_key = $1, rotated_at = now() \
                 WHERE file_id = $2",
            )
            .bind(&re_encrypted[..])
            .bind(&file_id)
            .execute(&self.pool)
            .await
            .with_context(|| format!("persisting migrated HLS key for file {file_id}"))?;
            migrated += 1;
        }

        Ok(migrated)
    }

    // Human: Return an existing AES key for this file or create one — safe across HLS job retries.
    // Agent: READS file_encryption_keys by file_id; INSERT only when row missing; REUSES key on retry.
    pub async fn get_or_create_key_for_file(&self, file_id: &str) -> anyhow::Result<(Uuid, AesKey)> {
        let row: Option<(String, Vec<u8>)> = sqlx::query_as(
            "SELECT key_id, encrypted_key FROM file_encryption_keys WHERE file_id = $1",
        )
        .bind(file_id)
        .fetch_optional(&self.pool)
        .await
        .context("fetching file encryption key")?;

        if let Some((key_id, encrypted)) = row {
            let (key, used_legacy_master) = self.decrypt_key(&encrypted)?;
            if used_legacy_master {
                self.migrate_blob(file_id, &key).await;
            }
            let key_uuid = Uuid::parse_str(&key_id).context("invalid key_id in database")?;
            return Ok((key_uuid, key));
        }

        self.create_key_for_file(file_id).await
    }

    pub async fn create_key_for_file(&self, file_id: &str) -> anyhow::Result<(Uuid, AesKey)> {
        let key = generate_media_key();
        let key_id = Uuid::new_v4();

        let encrypted = self.encrypt_key(&key)?;

        sqlx::query(
            "INSERT INTO file_encryption_keys (file_id, key_id, encrypted_key) VALUES ($1, $2, $3)",
        )
        .bind(file_id)
        .bind(key_id.to_string())
        .bind(&encrypted[..])
        .execute(&self.pool)
        .await
        .context("inserting file encryption key")?;

        Ok((key_id, key))
    }

    pub async fn get_key(&self, file_id: &str) -> anyhow::Result<Option<AesKey>> {
        let row: Option<(Vec<u8>,)> = sqlx::query_as(
            "SELECT encrypted_key FROM file_encryption_keys WHERE file_id = $1",
        )
        .bind(file_id)
        .fetch_optional(&self.pool)
        .await
        .context("fetching file encryption key")?;

        match row {
            Some((encrypted,)) => {
                let legacy_blob = is_legacy_encrypted_blob(&encrypted);
                let (key, used_legacy_master) = self.decrypt_key(&encrypted)?;
                if legacy_blob || used_legacy_master {
                    self.migrate_blob(file_id, &key).await;
                }
                Ok(Some(key))
            }
            None => Ok(None),
        }
    }

    fn encrypt_key(&self, key: &AesKey) -> anyhow::Result<Vec<u8>> {
        self.encrypt_key_with_master(key, &self.master_key)
    }

    fn encrypt_key_with_master(
        &self,
        key: &AesKey,
        master_key: &[u8; 32],
    ) -> anyhow::Result<Vec<u8>> {
        use aes_gcm::{
            aead::{Aead, KeyInit},
            Aes256Gcm, Nonce,
        };

        let cipher =
            Aes256Gcm::new_from_slice(master_key).context("creating AES-256-GCM cipher")?;

        let mut nonce_bytes = [0u8; NONCE_LEN];
        crate::crypto::fill_random_bytes(&mut nonce_bytes);
        let nonce = Nonce::from_slice(&nonce_bytes);

        let ciphertext = cipher
            .encrypt(nonce, key.as_ref())
            .map_err(|e| anyhow::anyhow!("encrypting AES key: {e:?}"))?;

        let mut stored = Vec::with_capacity(NONCE_LEN + ciphertext.len());
        stored.extend_from_slice(&nonce_bytes);
        stored.extend_from_slice(&ciphertext);
        Ok(stored)
    }

    #[cfg(test)]
    fn encrypt_key_with_master_and_nonce(
        &self,
        key: &AesKey,
        master_key: &[u8; 32],
        nonce_bytes: &[u8; NONCE_LEN],
    ) -> anyhow::Result<Vec<u8>> {
        use aes_gcm::{
            aead::{Aead, KeyInit},
            Aes256Gcm, Nonce,
        };

        let cipher =
            Aes256Gcm::new_from_slice(master_key).context("creating AES-256-GCM cipher")?;
        let nonce = Nonce::from_slice(nonce_bytes);
        let ciphertext = cipher
            .encrypt(nonce, key.as_ref())
            .map_err(|e| anyhow::anyhow!("encrypting AES key: {e:?}"))?;
        Ok(ciphertext)
    }

    /// Decrypt a stored blob. Returns `(plaintext, used_legacy_master_key)`.
    fn decrypt_key(&self, encrypted: &[u8]) -> anyhow::Result<(AesKey, bool)> {
        match self.decrypt_key_with_master(encrypted, &self.master_key) {
            Ok(key) => Ok((key, false)),
            Err(derived_err) => self
                .decrypt_key_with_master(encrypted, &self.legacy_master_key)
                .map(|key| (key, true))
                .map_err(|_| derived_err),
        }
    }

    fn decrypt_key_with_master(
        &self,
        encrypted: &[u8],
        master_key: &[u8; 32],
    ) -> anyhow::Result<AesKey> {
        if is_legacy_encrypted_blob(encrypted) {
            return self.decrypt_with_nonce(encrypted, &[0u8; NONCE_LEN], master_key);
        }
        if encrypted.len() <= NONCE_LEN {
            anyhow::bail!(
                "encrypted key blob too short ({} bytes)",
                encrypted.len()
            );
        }
        let (nonce_bytes, ciphertext) = encrypted.split_at(NONCE_LEN);
        self.decrypt_with_nonce(ciphertext, nonce_bytes, master_key)
    }

    /// Human: Legacy envelope used a fixed all-zero GCM nonce — only for one-time startup migration.
    fn decrypt_legacy_blob(&self, encrypted: &[u8]) -> anyhow::Result<AesKey> {
        if !is_legacy_encrypted_blob(encrypted) {
            anyhow::bail!(
                "not a legacy HLS key blob (expected {LEGACY_ENCRYPTED_LEN} bytes, got {})",
                encrypted.len()
            );
        }
        self.decrypt_with_nonce(
            encrypted,
            &[0u8; NONCE_LEN],
            &self.legacy_master_key,
        )
    }

    fn decrypt_with_nonce(
        &self,
        ciphertext: &[u8],
        nonce_bytes: &[u8],
        master_key: &[u8; 32],
    ) -> anyhow::Result<AesKey> {
        use aes_gcm::{
            aead::{Aead, KeyInit},
            Aes256Gcm, Nonce,
        };

        if nonce_bytes.len() != NONCE_LEN {
            anyhow::bail!("invalid GCM nonce length {}", nonce_bytes.len());
        }

        let cipher =
            Aes256Gcm::new_from_slice(master_key).context("creating AES-256-GCM cipher")?;
        let nonce = Nonce::from_slice(nonce_bytes);

        let plaintext = cipher
            .decrypt(nonce, ciphertext)
            .map_err(|e| anyhow::anyhow!("decrypting AES key: {e:?}"))?;

        if plaintext.len() != MEDIA_KEY_LEN {
            anyhow::bail!(
                "unexpected decrypted key length {} (want {MEDIA_KEY_LEN})",
                plaintext.len()
            );
        }

        let mut key = [0u8; MEDIA_KEY_LEN];
        key.copy_from_slice(&plaintext);
        Ok(key)
    }

    async fn migrate_blob(&self, file_id: &str, key: &AesKey) {
        match self.encrypt_key(key) {
            Ok(re_encrypted) => {
                if let Err(e) = sqlx::query(
                    "UPDATE file_encryption_keys SET encrypted_key = $1 WHERE file_id = $2",
                )
                .bind(&re_encrypted[..])
                .bind(file_id)
                .execute(&self.pool)
                .await
                {
                    tracing::warn!(
                        %file_id,
                        error = %e,
                        "failed to migrate HLS encryption blob"
                    );
                }
            }
            Err(e) => {
                tracing::warn!(
                    %file_id,
                    error = %e,
                    "failed to re-encrypt HLS key for migration"
                );
            }
        }
    }
}

fn is_legacy_encrypted_blob(encrypted: &[u8]) -> bool {
    encrypted.len() == LEGACY_ENCRYPTED_LEN
}

fn generate_media_key() -> AesKey {
    let mut key = [0u8; MEDIA_KEY_LEN];
    crate::crypto::fill_random_bytes(&mut key);
    key
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::PgPool;
    use std::collections::HashSet;

    #[test]
    fn media_key_has_expected_length() {
        let key = generate_media_key();
        assert_eq!(key.len(), MEDIA_KEY_LEN);
    }

    #[test]
    fn media_keys_are_unique() {
        let keys: HashSet<AesKey> = (0..100).map(|_| generate_media_key()).collect();
        assert_eq!(keys.len(), 100);
    }

    #[test]
    fn derive_master_key_is_deterministic() {
        let secret = "signing-secret-longer-than-32-bytes-for-kdf-test";
        assert_eq!(derive_master_key(secret), derive_master_key(secret));
    }

    #[test]
    fn derive_master_key_differs_from_truncation_for_long_secrets() {
        let secret = "signing-secret-longer-than-32-bytes-for-kdf-test";
        assert_ne!(
            derive_master_key(secret),
            legacy_truncate_master_key(secret),
            "KDF must use the full secret, not truncate to 32 bytes"
        );
    }

    #[test]
    fn derive_master_key_uses_full_secret_not_prefix() {
        let prefix = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
        let extended = format!("{prefix}extra-material-beyond-32-bytes");
        assert_ne!(
            derive_master_key(&extended),
            derive_master_key(prefix),
            "bytes beyond the first 32 must affect the derived key"
        );
    }

    fn test_store(secret: &str) -> KeyStore {
        KeyStore {
            pool: PgPool::connect_lazy("postgres://localhost/ownly_test").unwrap(),
            master_key: derive_master_key(secret),
            legacy_master_key: legacy_truncate_master_key(secret),
        }
    }

    fn test_keystore(pool: PgPool) -> KeyStore {
        KeyStore::new(pool, test_signing_secret())
    }

    fn test_signing_secret() -> String {
        "test-signing-secret-not-default-value".into()
    }

    fn encrypt_legacy_blob(master_key: &[u8; 32], key: &AesKey) -> Vec<u8> {
        use aes_gcm::{
            aead::{Aead, KeyInit},
            Aes256Gcm, Nonce,
        };

        let cipher = Aes256Gcm::new_from_slice(master_key).expect("cipher");
        let nonce = Nonce::from_slice(&[0u8; NONCE_LEN]);
        cipher
            .encrypt(nonce, key.as_ref())
            .expect("legacy encrypt")
    }

    #[tokio::test]
    async fn encrypt_with_derived_key_round_trips() {
        let store = test_store("test-secret");
        let media_key = [0xAB; MEDIA_KEY_LEN];
        let encrypted = store.encrypt_key(&media_key).expect("encrypt");
        let (decrypted, used_legacy) = store.decrypt_key(&encrypted).expect("decrypt");
        assert_eq!(decrypted, media_key);
        assert!(!used_legacy);
    }

    #[tokio::test]
    async fn decrypts_blobs_encrypted_with_legacy_truncated_master_key() {
        let secret = "legacy-signing-secret-that-is-definitely-longer-than-32";
        let store = test_store(secret);
        let media_key = [0xCD; MEDIA_KEY_LEN];
        let encrypted = store
            .encrypt_key_with_master(&media_key, &store.legacy_master_key)
            .expect("encrypt with legacy master");
        let (decrypted, used_legacy) = store.decrypt_key(&encrypted).expect("decrypt");
        assert_eq!(decrypted, media_key);
        assert!(used_legacy);
    }

    #[tokio::test]
    async fn decrypts_legacy_zero_nonce_blobs_with_truncated_master_key() {
        let secret = "another-legacy-secret-over-32-characters-long";
        let store = test_store(secret);
        let media_key = [0xEF; MEDIA_KEY_LEN];
        let zero_nonce_blob = store
            .encrypt_key_with_master_and_nonce(
                &media_key,
                &store.legacy_master_key,
                &[0u8; NONCE_LEN],
            )
            .expect("encrypt legacy zero-nonce blob");
        assert!(is_legacy_encrypted_blob(&zero_nonce_blob));
        let (decrypted, used_legacy) = store
            .decrypt_key(&zero_nonce_blob)
            .expect("decrypt legacy blob");
        assert_eq!(decrypted, media_key);
        assert!(used_legacy);
    }

    #[tokio::test]
    async fn legacy_blob_decrypts_via_dedicated_migration_path() {
        let secret = test_signing_secret();
        let store = KeyStore::new(
            PgPool::connect_lazy("postgres://unused").expect("lazy pool"),
            secret.clone(),
        );
        let plaintext = [0xABu8; MEDIA_KEY_LEN];
        let legacy = encrypt_legacy_blob(&store.legacy_master_key, &plaintext);

        assert!(is_legacy_encrypted_blob(&legacy));
        assert_eq!(
            store.decrypt_legacy_blob(&legacy).expect("legacy decrypt"),
            plaintext
        );
    }

    #[tokio::test]
    async fn legacy_blob_migrates_to_modern_envelope() {
        let secret = test_signing_secret();
        let store = KeyStore::new(
            PgPool::connect_lazy("postgres://unused").expect("lazy pool"),
            secret.clone(),
        );
        let plaintext = [0xCDu8; MEDIA_KEY_LEN];
        let legacy = encrypt_legacy_blob(&store.legacy_master_key, &plaintext);

        let decrypted = store.decrypt_legacy_blob(&legacy).expect("legacy decrypt");
        assert_eq!(decrypted, plaintext);

        let modern = store.encrypt_key(&decrypted).expect("modern encrypt");
        assert!(!is_legacy_encrypted_blob(&modern));
        assert!(modern.len() > LEGACY_ENCRYPTED_LEN);

        let (roundtrip, used_legacy) = store.decrypt_key(&modern).expect("modern decrypt");
        assert_eq!(roundtrip, plaintext);
        assert!(!used_legacy);
    }

    #[tokio::test]
    async fn startup_migrates_legacy_hls_key_blob_in_database() {
        let database_url = match std::env::var("DATABASE_URL") {
            Ok(url) if !url.is_empty() => url,
            _ => {
                eprintln!("skipping startup_migrates_legacy_hls_key_blob_in_database: DATABASE_URL unset");
                return;
            }
        };

        let pool = crate::db::init_pool(&database_url)
            .await
            .expect("connect test database");
        let store = test_keystore(pool.clone());

        let user_id = format!("hls-migrate-user-{}", Uuid::new_v4());
        let file_id = format!("hls-migrate-file-{}", Uuid::new_v4());
        let key_id = Uuid::new_v4().to_string();
        let plaintext = [0x42u8; MEDIA_KEY_LEN];
        let legacy = encrypt_legacy_blob(&store.legacy_master_key, &plaintext);

        sqlx::query(
            "INSERT INTO users (id, email, password_hash, role, enabled) \
             VALUES ($1, $2, 'hash', 'user', true) ON CONFLICT DO NOTHING",
        )
        .bind(&user_id)
        .bind(format!("{user_id}@example.com"))
        .execute(&pool)
        .await
        .expect("insert user");

        sqlx::query(
            "INSERT INTO files (id, user_id, name, storage_key, mime_type, size_bytes) \
             VALUES ($1, $2, 'video.mp4', 'storage/key-migrate', 'video/mp4', 1)",
        )
        .bind(&file_id)
        .bind(&user_id)
        .execute(&pool)
        .await
        .expect("insert file");

        sqlx::query(
            "INSERT INTO file_encryption_keys (file_id, key_id, encrypted_key) VALUES ($1, $2, $3)",
        )
        .bind(&file_id)
        .bind(&key_id)
        .bind(&legacy[..])
        .execute(&pool)
        .await
        .expect("insert legacy blob");

        let migrated = store
            .migrate_legacy_blobs_at_startup()
            .await
            .expect("startup migration");
        assert_eq!(migrated, 1);

        let row: (Vec<u8>,) = sqlx::query_as(
            "SELECT encrypted_key FROM file_encryption_keys WHERE file_id = $1",
        )
        .bind(&file_id)
        .fetch_one(&pool)
        .await
        .expect("fetch migrated blob");
        assert!(!is_legacy_encrypted_blob(&row.0));

        let key = store.get_key(&file_id).await.expect("get key");
        assert_eq!(key, Some(plaintext));

        sqlx::query("DELETE FROM files WHERE id = $1")
            .bind(&file_id)
            .execute(&pool)
            .await
            .expect("cleanup file");
        sqlx::query("DELETE FROM users WHERE id = $1")
            .bind(&user_id)
            .execute(&pool)
            .await
            .expect("cleanup user");
    }
}
