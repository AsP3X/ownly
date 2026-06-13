// Human: HTTP client for Nebular OS object storage — authenticated with service JWTs and HMAC presigned URLs.
// Agent: USES reqwest with Bearer service token; IMPLEMENTS Storage trait; READS base/public URLs + bucket.

use std::sync::{
    atomic::{AtomicU32, Ordering},
    Arc, RwLock,
};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

// Human: Backend→Nebular service JWT lifetime — short TTL limits blast radius if leaked (SEC-023).
// Agent: READ by generate_service_token; REFRESHED proactively in NebulaStorage::bearer_token before expiry.
const SERVICE_JWT_TTL_SECS: i64 = 4 * 3600;

// Human: Renew the service JWT this many seconds before `exp` so long-running API processes never send stale Bearer tokens.
// Agent: COMPARED in ServiceJwtCache::needs_refresh; PREVENTS 401 on storage GET/PUT after stack uptime exceeds TTL.
const SERVICE_JWT_REFRESH_LEEWAY_SECS: i64 = 300;

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

/// Human: Report from Nebular `POST /_nos/maintenance/migrate_blobs` when the server supports it.
/// Agent: DESERIALIZED from Nebular maintenance JSON; USED by admin storage migration fast path.
#[derive(Debug, Clone, serde::Serialize, Deserialize)]
pub struct MigrateBlobsMaintenanceReport {
    #[serde(default)]
    pub scanned: u64,
    #[serde(default)]
    pub migrated: u64,
    #[serde(default)]
    pub skipped: u64,
    #[serde(default)]
    pub failed: u64,
    pub next_start_after: Option<String>,
    #[serde(default)]
    pub is_truncated: bool,
    /// Human: True when Nebular honoured dry_run and performed no writes.
    #[serde(default)]
    pub dry_run_applied: bool,
}

type HmacSha256 = Hmac<Sha256>;

fn generate_signature(method: &str, secret: &str, bucket: &str, key: &str, expires: u64) -> anyhow::Result<String> {
    let payload = format!("{}\n{}\n{}\n{}", method.to_uppercase(), bucket, key, expires);
    let mut mac = HmacSha256::new_from_slice(secret.as_bytes())?;
    mac.update(payload.as_bytes());
    Ok(hex::encode(mac.finalize().into_bytes()))
}

// Human: Cached Nebular service JWT plus its `exp` claim for proactive refresh.
// Agent: WRAPPED in Arc<RwLock<>> so cloned NebulaStorage clients share one token per node.
#[derive(Clone, Debug)]
struct ServiceJwtCache {
    token: String,
    exp: i64,
}

impl ServiceJwtCache {
    // Human: True when the cached token is missing or within the refresh leeway of expiry.
    // Agent: READS Utc::now vs exp; CALLED from bearer_token before every storage request.
    fn needs_refresh(&self) -> bool {
        let now = chrono::Utc::now().timestamp();
        self.token.is_empty() || now >= self.exp - SERVICE_JWT_REFRESH_LEEWAY_SECS
    }
}

#[derive(Clone, Debug)]
pub struct NebulaStorage {
    client: reqwest::Client,
    base_url: String,
    public_base_url: String,
    bucket: String,
    jwt_secret: String,
    jwt_cache: Arc<RwLock<ServiceJwtCache>>,
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
        // Human: Default API clients get a finite PUT timeout so hung Nebular I/O cannot block the PUT gate forever.
        // Agent: DEFAULT 900s; OVERRIDE via new_with_request_timeout(None) only when callers need unbounded I/O.
        Self::new_with_request_timeout(
            base_url,
            public_base_url,
            bucket,
            jwt_secret,
            signing_secret,
            Some(Duration::from_secs(900)),
        )
    }

    // Human: Same as `new` but with a finite per-request timeout — used for long admin migration batches.
    // Agent: BUILDS reqwest client with connect + request timeouts; PREVENTS infinite hang on stuck Nebular PUT.
    pub fn new_with_request_timeout(
        base_url: String,
        public_base_url: String,
        bucket: String,
        jwt_secret: &str,
        signing_secret: &str,
        request_timeout: Option<Duration>,
    ) -> anyhow::Result<Self> {
        let issued = generate_service_token(jwt_secret)?;
        let mut builder = reqwest::Client::builder().connect_timeout(Duration::from_secs(30));
        if let Some(timeout) = request_timeout {
            builder = builder.timeout(timeout);
        }
        let client = builder.build()?;
        Ok(Self {
            client,
            base_url: base_url.trim_end_matches('/').to_string(),
            public_base_url: public_base_url.trim_end_matches('/').to_string(),
            bucket,
            jwt_secret: jwt_secret.to_string(),
            jwt_cache: Arc::new(RwLock::new(ServiceJwtCache {
                token: issued.token,
                exp: issued.exp,
            })),
            signing_secret: signing_secret.to_string(),
        })
    }

    fn url(&self, key: &str) -> String {
        format!("{}/{}/{}", self.base_url, self.bucket, key)
    }

    fn public_url(&self, key: &str) -> String {
        format!("{}/{}/{}", self.public_base_url, self.bucket, key)
    }

    // Human: Mint or reuse the backend service JWT so Nebular auth survives multi-day API uptime.
    // Agent: READS jwt_cache; WRITES refreshed token when within SERVICE_JWT_REFRESH_LEEWAY_SECS of exp.
    fn bearer_token(&self) -> anyhow::Result<String> {
        {
            let cache = self
                .jwt_cache
                .read()
                .map_err(|_| anyhow::anyhow!("service jwt cache lock poisoned"))?;
            if !cache.needs_refresh() {
                return Ok(cache.token.clone());
            }
        }

        let issued = generate_service_token(&self.jwt_secret)?;
        let mut cache = self
            .jwt_cache
            .write()
            .map_err(|_| anyhow::anyhow!("service jwt cache lock poisoned"))?;
        if cache.needs_refresh() {
            cache.token = issued.token;
            cache.exp = issued.exp;
        }
        Ok(cache.token.clone())
    }

    fn auth_header(&self) -> reqwest::header::HeaderValue {
        let token = self
            .bearer_token()
            .unwrap_or_else(|error| {
                tracing::error!(%error, "failed to mint Nebular service JWT");
                String::new()
            });
        reqwest::header::HeaderValue::from_str(&format!("Bearer {token}"))
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

    // Human: Read the first bytes of an object — used to detect legacy compression without full GET.
    // Agent: HTTP GET with Range when possible; RETURNS up to max_bytes prefix.
    pub async fn get_object_prefix(&self, key: &str, max_bytes: u64) -> anyhow::Result<Vec<u8>> {
        let url = self.url(key);
        let end = max_bytes.saturating_sub(1);
        let range = format!("bytes=0-{end}");
        let response = self
            .client
            .get(&url)
            .header(reqwest::header::AUTHORIZATION, self.auth_header())
            .header(reqwest::header::RANGE, range)
            .send()
            .await?;

        if !response.status().is_success() {
            anyhow::bail!("object storage ranged GET failed: {}", response.status());
        }

        let bytes = response.bytes().await?;
        Ok(bytes.to_vec())
    }

    // Human: Server-side legacy blob migration when Nebular ships `/_nos/maintenance/migrate_blobs`.
    // Agent: POST admin JWT; RETURNS None on 404/405 so caller can fall back to client rewrite.
    pub async fn try_migrate_blobs_maintenance(
        &self,
        limit: u64,
        start_after: Option<&str>,
        dry_run: bool,
    ) -> anyhow::Result<Option<MigrateBlobsMaintenanceReport>> {
        let url = format!("{}/_nos/maintenance/migrate_blobs", self.base_url);
        let limit_param = limit.to_string();
        let dry_run_param = if dry_run { "true" } else { "false" };
        let mut request = self
            .client
            .post(&url)
            .header(reqwest::header::AUTHORIZATION, self.auth_header())
            .query(&[
                ("limit", limit_param.as_str()),
                ("dry_run", dry_run_param),
            ]);

        if let Some(after) = start_after {
            request = request.query(&[("start_after", after)]);
        }

        let response = request.send().await?;
        let status = response.status();
        if status.as_u16() == 404 || status.as_u16() == 405 {
            return Ok(None);
        }
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            anyhow::bail!(
                "nebular migrate_blobs maintenance failed: {} {}",
                status,
                body.chars().take(256).collect::<String>()
            );
        }

        let report: MigrateBlobsMaintenanceReport = response.json().await?;
        Ok(Some(report))
    }

    // Human: Stream PUT without buffering the whole object — used for legacy blob rewrite migration.
    // Agent: HTTP PUT with Content-Length when known; SURFACES 503 backpressure like Storage::put.
    async fn put_stream(
        &self,
        key: &str,
        content_type: &str,
        content_length: Option<u64>,
        body: reqwest::Body,
    ) -> anyhow::Result<()> {
        let url = self.url(key);
        let started = Instant::now();
        let mut request = self
            .client
            .put(&url)
            .header(reqwest::header::AUTHORIZATION, self.auth_header())
            .header(reqwest::header::CONTENT_TYPE, content_type)
            .body(body);

        if let Some(len) = content_length {
            request = request.header(reqwest::header::CONTENT_LENGTH, len);
        }

        let response = request.send().await.map_err(|e| {
            tracing::error!(
                storage_key = %key,
                elapsed_ms = started.elapsed().as_millis() as u64,
                error = %e,
                "nebular storage streaming PUT transport error"
            );
            e
        })?;

        let status = response.status();
        if status.as_u16() == 503 {
            let retry_after = response
                .headers()
                .get(reqwest::header::RETRY_AFTER)
                .and_then(|value| value.to_str().ok())
                .and_then(|value| value.parse::<u64>().ok())
                .unwrap_or(1);
            anyhow::bail!(
                "object storage PUT backpressure (retry after {}s)",
                retry_after
            );
        }
        if status.as_u16() == 507 {
            anyhow::bail!("object storage PUT failed: insufficient storage capacity on node");
        }
        if !status.is_success() {
            let body_snippet = response.text().await.unwrap_or_default();
            anyhow::bail!(
                "object storage PUT failed: {} {}",
                status,
                body_snippet.chars().take(256).collect::<String>()
            );
        }
        Ok(())
    }

    // Human: Rewrite one object in place — streams GET body to PUT so Nebular moves legacy layout + re-encodes.
    // Agent: CALLS get_stream then put_stream same key; IDEMPOTENT when blob already uses flat encoded paths.
    pub async fn rewrite_object_stream(&self, key: &str) -> anyhow::Result<()> {
        let (stream, content_length, content_type) = self.get_stream(key).await?;
        let body = reqwest::Body::wrap_stream(stream);
        let len = if content_length > 0 {
            Some(content_length)
        } else {
            None
        };
        self.put_stream(key, &content_type, len, body).await
    }
}

#[derive(Debug, Clone)]
struct IssuedServiceJwt {
    token: String,
    exp: i64,
}

// Human: Mint a short-lived admin JWT for backend→Nebular object-storage calls.
// Agent: EMITS HS256 token; RETURNS token + exp for ServiceJwtCache refresh decisions.
fn generate_service_token(jwt_secret: &str) -> anyhow::Result<IssuedServiceJwt> {
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

    let exp = now + SERVICE_JWT_TTL_SECS;
    let claims = Claims {
        sub: "ownly-backend".to_string(),
        email: "backend@ownly.local".to_string(),
        role: "admin".to_string(),
        exp,
        iat: now,
    };

    let token = encode(
        &Header::new(Algorithm::HS256),
        &claims,
        &EncodingKey::from_secret(jwt_secret.as_bytes()),
    )?;
    Ok(IssuedServiceJwt { token, exp })
}

#[cfg(test)]
mod service_jwt_tests {
    use super::*;

    // Human: Service JWT refresh must trigger inside the leeway window, not only after hard expiry.
    // Agent: ASSERTS needs_refresh true when now >= exp - SERVICE_JWT_REFRESH_LEEWAY_SECS.
    #[test]
    fn service_jwt_cache_needs_refresh_inside_leeway() {
        let now = chrono::Utc::now().timestamp();
        let cache = ServiceJwtCache {
            token: "token".into(),
            exp: now + SERVICE_JWT_REFRESH_LEEWAY_SECS,
        };
        assert!(cache.needs_refresh());
    }

    // Human: Fresh tokens should be reused until the leeway window opens.
    // Agent: ASSERTS needs_refresh false when exp is far in the future.
    #[test]
    fn service_jwt_cache_reuses_fresh_token() {
        let now = chrono::Utc::now().timestamp();
        let cache = ServiceJwtCache {
            token: "token".into(),
            exp: now + SERVICE_JWT_TTL_SECS,
        };
        assert!(!cache.needs_refresh());
    }

    // Human: Cloned storage clients must share one JWT cache so router node clients do not drift.
    // Agent: CLONES NebulaStorage; MUTATES one cache; EXPECTS other clone to see refreshed token.
    #[test]
    fn cloned_nebula_storage_shares_service_jwt_cache() {
        let storage = NebulaStorage::new(
            "http://127.0.0.1:9000".into(),
            "http://127.0.0.1:9000".into(),
            "ownly".into(),
            "test-jwt-secret",
            "test-signing-secret",
        )
        .expect("storage client");

        let clone = storage.clone();
        {
            let mut cache = storage
                .jwt_cache
                .write()
                .expect("jwt cache write");
            cache.token = "rotated".into();
            cache.exp = chrono::Utc::now().timestamp() + SERVICE_JWT_TTL_SECS;
        }

        let cache = clone.jwt_cache.read().expect("jwt cache read");
        assert_eq!(cache.token, "rotated");
    }
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
            // Human: Nebular upload budget exceeded — aggregate in-flight PUT bytes over cap.
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
        if status.as_u16() == 507 {
            // Human: Nebular NOS_MAX_LOGICAL_BYTES cap reached on this node.
            // Agent: SURFACES as storage error; placement layer may retry another node on multi-node setups.
            tracing::warn!(
                bucket = %self.bucket,
                storage_key = %key,
                size_bytes,
                "nebular storage PUT rejected — node logical byte cap exceeded"
            );
            anyhow::bail!("object storage PUT failed: insufficient storage capacity on node");
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
