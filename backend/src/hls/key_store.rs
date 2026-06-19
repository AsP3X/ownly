// Human: Persist per-file content keys using AES-256-GCM envelope encryption (quantum-hardened symmetric layer).
// Agent: WRITES file_encryption_keys; USES AES-256-GCM; READS PgPool; RETURNS 16-byte HLS content key when needed.

use anyhow::Context;
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
    master_secret: [u8; 32],
}

impl KeyStore {
    pub fn new(pool: PgPool, master_secret: String) -> Self {
        let mut secret = [0u8; 32];
        let bytes = master_secret.as_bytes();
        let len = bytes.len().min(32);
        secret[..len].copy_from_slice(&bytes[..len]);
        Self {
            pool,
            master_secret: secret,
        }
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
            let key = self.decrypt_key(&encrypted)?;
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
                let legacy = is_legacy_encrypted_blob(&encrypted);
                let key = self.decrypt_key(&encrypted)?;
                if legacy {
                    self.migrate_legacy_blob(file_id, &key).await;
                }
                Ok(Some(key))
            }
            None => Ok(None),
        }
    }

    fn encrypt_key(&self, key: &AesKey) -> anyhow::Result<Vec<u8>> {
        use aes_gcm::{
            aead::{Aead, KeyInit},
            Aes256Gcm, Nonce,
        };

        let cipher = Aes256Gcm::new_from_slice(&self.master_secret)
            .context("creating AES-256-GCM cipher")?;

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

    fn decrypt_key(&self, encrypted: &[u8]) -> anyhow::Result<AesKey> {
        if is_legacy_encrypted_blob(encrypted) {
            return self.decrypt_with_nonce(encrypted, &[0u8; NONCE_LEN]);
        }
        if encrypted.len() <= NONCE_LEN {
            anyhow::bail!(
                "encrypted key blob too short ({} bytes)",
                encrypted.len()
            );
        }
        let (nonce_bytes, ciphertext) = encrypted.split_at(NONCE_LEN);
        self.decrypt_with_nonce(ciphertext, nonce_bytes)
    }

    fn decrypt_with_nonce(
        &self,
        ciphertext: &[u8],
        nonce_bytes: &[u8],
    ) -> anyhow::Result<AesKey> {
        use aes_gcm::{
            aead::{Aead, KeyInit},
            Aes256Gcm, Nonce,
        };

        if nonce_bytes.len() != NONCE_LEN {
            anyhow::bail!("invalid GCM nonce length {}", nonce_bytes.len());
        }

        let cipher = Aes256Gcm::new_from_slice(&self.master_secret)
            .context("creating AES-256-GCM cipher")?;
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

    async fn migrate_legacy_blob(&self, file_id: &str, key: &AesKey) {
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
                        "failed to migrate legacy HLS encryption blob"
                    );
                }
            }
            Err(e) => {
                tracing::warn!(
                    %file_id,
                    error = %e,
                    "failed to re-encrypt legacy HLS key for migration"
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
}
