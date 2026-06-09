// Human: HTTP client for Nebular OS object storage — authenticated with service JWTs and HMAC presigned URLs.
// Agent: USES reqwest with Bearer service token; IMPLEMENTS Storage trait; READS base/public URLs + bucket.

use std::sync::{
    atomic::{AtomicU32, Ordering},
    Arc,
};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use futures_util::stream::{self, StreamExt};
use hmac::{Hmac, Mac};
use serde::Deserialize;
use sha2::Sha256;

use crate::storage::{Storage, StorageStream, DELETE_BLOB_CONCURRENCY};

#[derive(Debug, Clone, serde::Serialize, Deserialize)]
pub struct ObjectListItem {
    pub key: String,
    pub size: i64,
    pub mime_type: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, Deserialize)]
pub struct ObjectListPage {
    pub items: Vec<ObjectListItem>,
    pub common_prefixes: Vec<String>,
    pub is_truncated: bool,
    pub next_start_after: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ListApiResult {
    items: Vec<ListApiItem>,
    #[serde(default)]
    common_prefixes: Vec<String>,
    is_truncated: bool,
    next_start_after: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ListApiItem {
    key: String,
    #[serde(default)]
    size: i64,
    mime_type: Option<String>,
}

#[derive(Debug, Deserialize)]
struct DeletePrefixApiResult {
    #[serde(default)]
    deleted: u64,
    #[serde(default)]
    truncated: bool,
    next_start_after: Option<String>,
}

#[derive(Debug, Deserialize)]
struct BatchDeleteApiResult {
    #[serde(default)]
    deleted: u64,
    #[serde(default)]
    failed: Vec<serde_json::Value>,
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

    // Human: Nebular bulk DELETE /{bucket}?prefix=… — paginates when the batch limit truncates.
    // Agent: HTTP DELETE with prefix + start_after; RETURNS None on 404/405/501 for list+parallel fallback.
    async fn try_bulk_delete_prefix(&self, prefix: &str) -> anyhow::Result<Option<u32>> {
        let list_url = format!("{}/{}", self.base_url, self.bucket);
        let mut total_deleted: u64 = 0;
        let mut start_after: Option<String> = None;

        loop {
            let mut request = self
                .client
                .delete(&list_url)
                .header(reqwest::header::AUTHORIZATION, self.auth_header())
                .query(&[("prefix", prefix)]);

            if let Some(ref after) = start_after {
                request = request.query(&[("start_after", after.as_str())]);
            }

            let response = request.send().await?;
            let status = response.status();
            if status.as_u16() == 404 || status.as_u16() == 405 || status.as_u16() == 501 {
                return Ok(None);
            }
            if !status.is_success() {
                anyhow::bail!("object storage bulk DELETE failed: {}", status);
            }

            let body: DeletePrefixApiResult = response.json().await.unwrap_or(DeletePrefixApiResult {
                deleted: 0,
                truncated: false,
                next_start_after: None,
            });
            total_deleted = total_deleted.saturating_add(body.deleted);

            if !body.truncated {
                break;
            }
            start_after = body.next_start_after;
            if start_after.is_none() {
                break;
            }
        }

        Ok(Some(total_deleted.min(u32::MAX as u64) as u32))
    }

    // Human: Delete explicit keys via POST /{bucket}/_batch_delete when Nebular supports it.
    // Agent: CHUNKS keys at 1000; RETURNS None on 404/405 so caller uses per-key DELETE fallback.
    async fn try_batch_delete_keys(&self, keys: &[String]) -> anyhow::Result<Option<u32>> {
        if keys.is_empty() {
            return Ok(Some(0));
        }

        const BATCH_LIMIT: usize = 1000;
        let batch_url = format!("{}/{}/_batch_delete", self.base_url, self.bucket);
        let mut total_deleted: u64 = 0;

        for chunk in keys.chunks(BATCH_LIMIT) {
            let response = self
                .client
                .post(&batch_url)
                .header(reqwest::header::AUTHORIZATION, self.auth_header())
                .header(reqwest::header::CONTENT_TYPE, "application/json")
                .json(&serde_json::json!({ "keys": chunk }))
                .send()
                .await?;
            let status = response.status();
            if status.as_u16() == 404 || status.as_u16() == 405 || status.as_u16() == 501 {
                return Ok(None);
            }
            if !status.is_success() {
                anyhow::bail!("object storage batch DELETE failed: {}", status);
            }
            let body: BatchDeleteApiResult = response.json().await.unwrap_or(BatchDeleteApiResult {
                deleted: 0,
                failed: Vec::new(),
            });
            if !body.failed.is_empty() {
                tracing::warn!(
                    failed = body.failed.len(),
                    chunk_size = chunk.len(),
                    "nebular batch delete reported key failures"
                );
            }
            total_deleted = total_deleted.saturating_add(body.deleted);
        }

        Ok(Some(total_deleted.min(u32::MAX as u64) as u32))
    }

    // Human: List keys under a prefix then batch-delete or fall back to parallel per-key DELETE.
    // Agent: CALLS try_batch_delete_keys; ON miss CALLS list_keys_with_prefix + concurrent delete.
    async fn delete_prefix_parallel_fallback(&self, prefix: &str) -> anyhow::Result<u32> {
        let keys = self.list_keys_with_prefix(prefix).await?;
        self.delete_keys_parallel_fallback(&keys).await
    }

    // Human: Delete a known key list — prefers Nebular _batch_delete, else bounded parallel DELETE.
    // Agent: CALLS try_batch_delete_keys; RETURNS per-key attempt count on fallback.
    async fn delete_keys_parallel_fallback(&self, keys: &[String]) -> anyhow::Result<u32> {
        if let Ok(Some(deleted)) = self.try_batch_delete_keys(keys).await {
            return Ok(deleted);
        }

        let deleted = Arc::new(AtomicU32::new(0));
        let counter = deleted.clone();
        let client = self.clone();
        stream::iter(keys.to_vec())
            .for_each_concurrent(DELETE_BLOB_CONCURRENCY, move |key| {
                let deleted = counter.clone();
                let client = client.clone();
                async move {
                    let _ = client.delete(&key).await;
                    deleted.fetch_add(1, Ordering::Relaxed);
                }
            })
            .await;
        Ok(deleted.load(Ordering::Relaxed))
    }

    // Human: Paginated bucket listing with optional delimiter for admin storage explorer UI.
    // Agent: GET /{bucket}; READS prefix, delimiter, limit, start_after; RETURNS ObjectListPage.
    pub async fn list_objects_page(
        &self,
        prefix: &str,
        delimiter: Option<&str>,
        limit: u64,
        start_after: Option<&str>,
    ) -> anyhow::Result<ObjectListPage> {
        let list_url = format!("{}/{}", self.base_url, self.bucket);
        let limit_param = limit.to_string();
        let mut request = self
            .client
            .get(&list_url)
            .header(reqwest::header::AUTHORIZATION, self.auth_header())
            .query(&[("prefix", prefix), ("limit", limit_param.as_str())]);

        if let Some(delim) = delimiter {
            request = request.query(&[("delimiter", delim)]);
        }
        if let Some(after) = start_after {
            request = request.query(&[("start_after", after)]);
        }

        let response = request.send().await?;
        if !response.status().is_success() {
            anyhow::bail!("object storage LIST failed: {}", response.status());
        }

        let page: ListApiResult = response.json().await?;
        Ok(ObjectListPage {
            items: page
                .items
                .into_iter()
                .map(|item| ObjectListItem {
                    key: item.key,
                    size: item.size,
                    mime_type: item.mime_type,
                })
                .collect(),
            common_prefixes: page.common_prefixes,
            is_truncated: page.is_truncated,
            next_start_after: page.next_start_after,
        })
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
        sub: "ownly-backend".to_string(),
        email: "backend@ownly.local".to_string(),
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

    // Human: Delete all objects under a prefix — bulk Nebular API first, parallel per-key fallback.
    // Agent: CALLS try_bulk_delete_prefix; ON miss CALLS delete_prefix_parallel_fallback.
    async fn delete_prefix(&self, prefix: &str) -> anyhow::Result<u32> {
        match self.try_bulk_delete_prefix(prefix).await {
            Ok(Some(deleted)) if deleted > 0 => Ok(deleted),
            Ok(_) => self.delete_prefix_parallel_fallback(prefix).await,
            Err(error) => {
                tracing::warn!(%prefix, %error, "nebular bulk delete_prefix failed; falling back");
                self.delete_prefix_parallel_fallback(prefix).await
            }
        }
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
        if status.as_u16() == 503 {
            // Human: Defensive handling when storage signals backpressure (legacy Nebular or future limits).
            // Agent: READ Retry-After header; BAILS with retry hint for put_with_retry.
            let retry_after = response
                .headers()
                .get(reqwest::header::RETRY_AFTER)
                .and_then(|value| value.to_str().ok())
                .and_then(|value| value.parse::<u64>().ok())
                .unwrap_or(1);
            tracing::warn!(
                bucket = %self.bucket,
                storage_key = %key,
                size_bytes,
                retry_after_secs = retry_after,
                "nebular storage PUT backpressure — retry after delay"
            );
            anyhow::bail!(
                "object storage PUT backpressure (retry after {}s)",
                retry_after
            );
        }
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
