// Human: HTTP client for Nebular OS object storage — authenticated with service JWTs and HMAC presigned URLs.
// Agent: USES reqwest with Bearer service token; IMPLEMENTS Storage trait; READS base/public URLs + bucket.

use futures_util::StreamExt;
use hmac::{Hmac, Mac};
use serde::Deserialize;
use sha2::Sha256;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use crate::storage::{Storage, StorageStream};

#[derive(Debug, Deserialize)]
struct ListApiResult {
    items: Vec<ListApiItem>,
    is_truncated: bool,
    next_start_after: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ListApiItem {
    key: String,
}

type HmacSha256 = Hmac<Sha256>;

fn generate_signature(method: &str, secret: &str, bucket: &str, key: &str, expires: u64) -> anyhow::Result<String> {
    let payload = format!("{}\n{}\n{}\n{}", method.to_uppercase(), bucket, key, expires);
    let mut mac = HmacSha256::new_from_slice(secret.as_bytes())?;
    mac.update(payload.as_bytes());
    Ok(hex::encode(mac.finalize().into_bytes()))
}

#[derive(Clone, Debug)]
pub struct NebulaStorage {
    client: reqwest::Client,
    base_url: String,
    public_base_url: String,
    bucket: String,
    jwt_token: String,
    signing_secret: String,
}

impl NebulaStorage {
    // Human: Bootstrap HTTP client state and mint a long-lived backend JWT for bucket operations.
    // Agent: READS jwt_secret + signing_secret; CALLS generate_service_token; TRIMS base URLs.
    pub fn new(
        base_url: String,
        public_base_url: String,
        bucket: String,
        jwt_secret: &str,
        signing_secret: &str,
    ) -> anyhow::Result<Self> {
        let token = generate_service_token(jwt_secret)?;
        Ok(Self {
            client: reqwest::Client::new(),
            base_url: base_url.trim_end_matches('/').to_string(),
            public_base_url: public_base_url.trim_end_matches('/').to_string(),
            bucket,
            jwt_token: token,
            signing_secret: signing_secret.to_string(),
        })
    }

    fn url(&self, key: &str) -> String {
        format!("{}/{}/{}", self.base_url, self.bucket, key)
    }

    fn public_url(&self, key: &str) -> String {
        format!("{}/{}/{}", self.public_base_url, self.bucket, key)
    }

    fn auth_header(&self) -> reqwest::header::HeaderValue {
        reqwest::header::HeaderValue::from_str(&format!("Bearer {}", self.jwt_token))
            .unwrap_or_else(|_| reqwest::header::HeaderValue::from_static(""))
    }
}

fn generate_service_token(jwt_secret: &str) -> anyhow::Result<String> {
    use jsonwebtoken::{encode, Algorithm, EncodingKey, Header};
    use serde::{Deserialize, Serialize};

    #[derive(Serialize, Deserialize)]
    struct Claims {
        sub: String,
        email: String,
        role: String,
        exp: i64,
        iat: i64,
    }

    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;

    let claims = Claims {
        sub: "mediavault-backend".to_string(),
        email: "backend@mediavault.local".to_string(),
        role: "admin".to_string(),
        exp: now + 86400 * 365,
        iat: now,
    };

    let token = encode(
        &Header::new(Algorithm::HS256),
        &claims,
        &EncodingKey::from_secret(jwt_secret.as_bytes()),
    )?;
    Ok(token)
}

#[async_trait::async_trait]
impl Storage for NebulaStorage {
    async fn get_stream(&self, key: &str) -> anyhow::Result<(StorageStream, u64, String)> {
        let url = self.url(key);
        let response = self
            .client
            .get(&url)
            .header(reqwest::header::AUTHORIZATION, self.auth_header())
            .send()
            .await?;

        if !response.status().is_success() {
            anyhow::bail!("object storage GET failed: {}", response.status());
        }

        let content_length = response.content_length().unwrap_or(0);
        let content_type = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("application/octet-stream")
            .to_string();

        let stream = response.bytes_stream().map(|res| {
            res.map_err(std::io::Error::other)
        });

        Ok((Box::pin(stream), content_length, content_type))
    }

    async fn exists(&self, key: &str) -> anyhow::Result<bool> {
        let response = self
            .client
            .head(self.url(key))
            .header(reqwest::header::AUTHORIZATION, self.auth_header())
            .send()
            .await?;
        Ok(response.status().is_success())
    }

    async fn delete(&self, key: &str) -> anyhow::Result<()> {
        let response = self
            .client
            .delete(self.url(key))
            .header(reqwest::header::AUTHORIZATION, self.auth_header())
            .send()
            .await?;
        let status = response.status();
        if !status.is_success() && status.as_u16() != 404 {
            anyhow::bail!("object storage DELETE failed: {}", status);
        }
        Ok(())
    }

    async fn list_keys_with_prefix(&self, prefix: &str) -> anyhow::Result<Vec<String>> {
        let list_url = format!("{}/{}", self.base_url, self.bucket);
        let mut keys = Vec::new();
        let mut start_after: Option<String> = None;

        loop {
            let mut request = self
                .client
                .get(&list_url)
                .header(reqwest::header::AUTHORIZATION, self.auth_header())
                .query(&[("prefix", prefix), ("limit", "1000")]);

            if let Some(ref after) = start_after {
                request = request.query(&[("start_after", after.as_str())]);
            }

            let response = request.send().await?;
            if !response.status().is_success() {
                anyhow::bail!("object storage LIST failed: {}", response.status());
            }

            let page: ListApiResult = response.json().await?;
            keys.extend(page.items.into_iter().map(|item| item.key));

            if !page.is_truncated {
                break;
            }
            start_after = page.next_start_after;
            if start_after.is_none() {
                break;
            }
        }

        Ok(keys)
    }

    async fn put(&self, key: &str, content_type: &str, data: Vec<u8>) -> anyhow::Result<()> {
        let size_bytes = data.len();
        let url = self.url(key);
        tracing::info!(
            bucket = %self.bucket,
            storage_key = %key,
            size_bytes,
            content_type = %content_type,
            object_storage_url = %self.base_url,
            "nebular storage PUT starting"
        );
        let started = Instant::now();
        let response = self
            .client
            .put(&url)
            .header(reqwest::header::AUTHORIZATION, self.auth_header())
            .header(reqwest::header::CONTENT_TYPE, content_type)
            .body(data)
            .send()
            .await
            .map_err(|e| {
                tracing::error!(
                    bucket = %self.bucket,
                    storage_key = %key,
                    size_bytes,
                    elapsed_ms = started.elapsed().as_millis() as u64,
                    error = %e,
                    "nebular storage PUT transport error"
                );
                e
            })?;
        let status = response.status();
        let elapsed_ms = started.elapsed().as_millis() as u64;
        if !status.is_success() {
            let body_snippet = response.text().await.unwrap_or_default();
            let body_snippet = body_snippet.chars().take(512).collect::<String>();
            tracing::error!(
                bucket = %self.bucket,
                storage_key = %key,
                size_bytes,
                status = %status,
                elapsed_ms,
                response_body = %body_snippet,
                "nebular storage PUT failed"
            );
            anyhow::bail!("object storage PUT failed: {}", status);
        }
        tracing::info!(
            bucket = %self.bucket,
            storage_key = %key,
            size_bytes,
            status = %status,
            elapsed_ms,
            "nebular storage PUT complete"
        );
        Ok(())
    }

    fn presigned_url(&self, key: &str, expiry_seconds: u64) -> anyhow::Result<String> {
        let expires = SystemTime::now().duration_since(UNIX_EPOCH)?.as_secs() + expiry_seconds;
        let signature = generate_signature("GET", &self.signing_secret, &self.bucket, key, expires)?;
        Ok(format!(
            "{}?signature={}&expires={}",
            self.public_url(key),
            signature,
            expires
        ))
    }
}
