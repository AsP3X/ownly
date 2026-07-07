// Human: Encrypt sensitive app_settings values at rest (SEC-032).
// Agent: USES AES-256-GCM keyed from SHA-256(SIGNING_SECRET); MIGRATES legacy truncation + plaintext on startup.

use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use anyhow::Context;
use rand::RngCore;
use sha2::{Digest, Sha256};
use sqlx::PgPool;

use crate::setup::redact;

pub const ENCRYPTED_PREFIX: &str = "enc:v1:";
const NONCE_LEN: usize = 12;

#[derive(Clone)]
pub struct AppSettingsSecretStore {
    master_key: [u8; 32],
    legacy_master_key: [u8; 32],
}

/// Derive envelope master key from the full configured secret (aligned with HLS KeyStore SEC-038).
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

impl AppSettingsSecretStore {
    pub fn new(master_secret: &str) -> Self {
        Self {
            master_key: derive_master_key(master_secret),
            legacy_master_key: legacy_truncate_master_key(master_secret),
        }
    }

    pub fn is_encrypted(value: &str) -> bool {
        value.starts_with(ENCRYPTED_PREFIX)
    }

    pub fn secret_is_set(value: Option<&str>) -> bool {
        value.map(str::trim).is_some_and(|v| !v.is_empty())
    }

    fn cipher_for_key(key: &[u8; 32]) -> anyhow::Result<Aes256Gcm> {
        Aes256Gcm::new_from_slice(key).context("creating AES-256-GCM cipher for app_settings secret")
    }

    pub fn encrypt(&self, plaintext: &str) -> anyhow::Result<String> {
        let cipher = Self::cipher_for_key(&self.master_key)?;

        let mut nonce_bytes = [0u8; NONCE_LEN];
        rand::thread_rng().fill_bytes(&mut nonce_bytes);
        let nonce = Nonce::from_slice(&nonce_bytes);

        let ciphertext = cipher
            .encrypt(nonce, plaintext.as_bytes())
            .map_err(|e| anyhow::anyhow!("encrypting app_settings secret: {e:?}"))?;

        let mut blob = Vec::with_capacity(NONCE_LEN + ciphertext.len());
        blob.extend_from_slice(&nonce_bytes);
        blob.extend_from_slice(&ciphertext);

        Ok(format!("{ENCRYPTED_PREFIX}{}", hex::encode(blob)))
    }

    fn decrypt_with_key(stored: &str, key: &[u8; 32]) -> anyhow::Result<String> {
        let encoded = stored
            .strip_prefix(ENCRYPTED_PREFIX)
            .context("invalid encrypted app_settings secret prefix")?;
        let blob = hex::decode(encoded.trim()).context("decoding encrypted app_settings secret")?;
        if blob.len() <= NONCE_LEN {
            anyhow::bail!(
                "encrypted app_settings secret too short ({} bytes)",
                blob.len()
            );
        }
        let (nonce_bytes, ciphertext) = blob.split_at(NONCE_LEN);
        let cipher = Self::cipher_for_key(key)?;
        let nonce = Nonce::from_slice(nonce_bytes);
        let plaintext = cipher
            .decrypt(nonce, ciphertext)
            .map_err(|e| anyhow::anyhow!("decrypting app_settings secret: {e:?}"))?;
        String::from_utf8(plaintext).context("app_settings secret is not valid UTF-8")
    }

    pub fn decrypt(&self, stored: &str) -> anyhow::Result<String> {
        if !Self::is_encrypted(stored) {
            return Ok(stored.to_string());
        }
        match Self::decrypt_with_key(stored, &self.master_key) {
            Ok(value) => Ok(value),
            Err(primary) => Self::decrypt_with_key(stored, &self.legacy_master_key)
                .map_err(|_| primary),
        }
    }
}

fn database_url_has_plaintext_credentials(url: &str) -> bool {
    let url = url.trim();
    let Some((_, rest)) = url.split_once("://") else {
        return false;
    };
    let Some((userinfo, _)) = rest.split_once('@') else {
        return false;
    };
    match userinfo.split_once(':') {
        None => false,
        Some((_, password)) => !password.is_empty() && password != "***",
    }
}

async fn read_raw_setting(pool: &PgPool, key: &str) -> anyhow::Result<Option<String>> {
    let row: Option<(String,)> =
        sqlx::query_as("SELECT value FROM app_settings WHERE key = $1")
            .bind(key)
            .fetch_optional(pool)
            .await
            .with_context(|| format!("reading app_settings key {key}"))?;
    Ok(row.map(|(value,)| value))
}

async fn upsert_raw_setting(pool: &PgPool, key: &str, value: &str) -> anyhow::Result<()> {
    sqlx::query(
        "INSERT INTO app_settings (key, value) VALUES ($1, $2) \
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
    )
    .bind(key)
    .bind(value)
    .execute(pool)
    .await
    .with_context(|| format!("upserting app_settings key {key}"))?;
    Ok(())
}

// Human: Re-encrypt app_settings secrets that were sealed with the legacy truncated master key.
// Agent: READS enc:v1 rows; DECRYPT with legacy key; RE-ENCRYPT with SHA-256 derived key.
pub async fn migrate_legacy_encrypted_secrets(
    pool: &PgPool,
    store: &AppSettingsSecretStore,
) -> anyhow::Result<u64> {
    let rows: Vec<(String, String)> =
        sqlx::query_as("SELECT key, value FROM app_settings WHERE value LIKE 'enc:v1:%'")
            .fetch_all(pool)
            .await
            .context("listing encrypted app_settings rows")?;

    let mut migrated = 0u64;
    for (key, value) in rows {
        if AppSettingsSecretStore::decrypt_with_key(&value, &store.master_key).is_ok() {
            continue;
        }
        let plaintext = AppSettingsSecretStore::decrypt_with_key(&value, &store.legacy_master_key)
            .with_context(|| format!("decrypting legacy app_settings key {key}"))?;
        let re_encrypted = store.encrypt(&plaintext)?;
        upsert_raw_setting(pool, &key, &re_encrypted).await?;
        migrated += 1;
    }

    if migrated > 0 {
        tracing::info!(
            migrated,
            "Re-encrypted app_settings secrets with SHA-256 derived master key (SEC-032)"
        );
    }
    Ok(migrated)
}

// Human: One-time startup migration for deployments that stored plaintext secrets before SEC-032.
// Agent: RE-ENCRYPTS smtp_password; REDACTS database_url credentials; LOGS counts only.
pub async fn migrate_plaintext_secrets(
    pool: &PgPool,
    store: &AppSettingsSecretStore,
) -> anyhow::Result<()> {
    let mut migrated_smtp = false;
    let mut migrated_database_url = false;

    if let Some(raw) = read_raw_setting(pool, "smtp_password").await? {
        if !raw.is_empty() && !AppSettingsSecretStore::is_encrypted(&raw) {
            let encrypted = store.encrypt(&raw)?;
            upsert_raw_setting(pool, "smtp_password", &encrypted).await?;
            migrated_smtp = true;
        }
    }

    if let Some(raw) = read_raw_setting(pool, "database_url").await? {
        if database_url_has_plaintext_credentials(&raw) {
            let redacted = redact::redact_database_url(&raw);
            upsert_raw_setting(pool, "database_url", &redacted).await?;
            migrated_database_url = true;
        }
    }

    if migrated_smtp || migrated_database_url {
        tracing::info!(
            smtp_password_encrypted = migrated_smtp,
            database_url_redacted = migrated_database_url,
            "Migrated legacy plaintext app_settings secrets (SEC-032)"
        );
    }

    migrate_legacy_encrypted_secrets(pool, store).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_store() -> AppSettingsSecretStore {
        AppSettingsSecretStore::new("test-signing-secret-32-chars-minimum!!")
    }

    #[test]
    fn encrypt_decrypt_roundtrip() {
        let store = test_store();
        let encrypted = store.encrypt("smtp-secret-value").expect("encrypt");
        assert!(AppSettingsSecretStore::is_encrypted(&encrypted));
        let decrypted = store.decrypt(&encrypted).expect("decrypt");
        assert_eq!(decrypted, "smtp-secret-value");
    }

    #[test]
    fn decrypt_legacy_plaintext_passthrough() {
        let store = test_store();
        let decrypted = store.decrypt("legacy-plaintext").expect("decrypt legacy");
        assert_eq!(decrypted, "legacy-plaintext");
    }

    #[test]
    fn legacy_truncated_key_decrypts_old_ciphertext() {
        let store = test_store();
        let legacy = AppSettingsSecretStore {
            master_key: legacy_truncate_master_key("test-signing-secret-32-chars-minimum!!"),
            legacy_master_key: legacy_truncate_master_key("test-signing-secret-32-chars-minimum!!"),
        };
        let encrypted = legacy.encrypt("old-secret").expect("legacy encrypt");
        let decrypted = store.decrypt(&encrypted).expect("dual-key decrypt");
        assert_eq!(decrypted, "old-secret");
    }

    #[test]
    fn detects_plaintext_database_credentials() {
        assert!(database_url_has_plaintext_credentials(
            "postgres://ownly:secret@postgres:5432/ownly"
        ));
        assert!(!database_url_has_plaintext_credentials(
            "postgres://ownly:***@postgres:5432/ownly"
        ));
        assert!(!database_url_has_plaintext_credentials(
            "postgres://localhost/ownly"
        ));
    }
}
