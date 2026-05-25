use axum::{
    body::Body,
    extract::{Path, Request, State},
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use futures_util::StreamExt;
use serde::Deserialize;
use serde_json::{json, Map};
use std::io;
use std::pin::Pin;
use std::sync::Arc;
use std::task::{Context, Poll};
use std::time::Instant;
use tokio::io::{AsyncRead, ReadBuf};

use crate::routes::errors::{map_storage_error, PayloadTooLarge};
use crate::routes::helpers::{
    apply_object_headers, parse_if_modified_since, parse_if_none_match,
};
use crate::routes::AppState;
use crate::storage::engine::GetObjectOutcome;
use crate::storage::error::StorageError;

pub(crate) struct LimitReader<R> {
    pub inner: R,
    pub remaining: usize,
}

impl<R: AsyncRead + Unpin> AsyncRead for LimitReader<R> {
    fn poll_read(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        let before = buf.filled().len();
        let result = Pin::new(&mut self.inner).poll_read(cx, buf);
        let after = buf.filled().len();
        let read = after - before;
        if read > self.remaining {
            return Poll::Ready(Err(io::Error::other(PayloadTooLarge)));
        }
        self.remaining -= read;
        result
    }
}

#[derive(Debug, Deserialize)]
pub struct ObjectParams {
    bucket: String,
    key: String,
}

fn extract_custom_meta(headers: &HeaderMap) -> Option<String> {
    let mut custom_meta_map = Map::new();
    for (k, v) in headers.iter() {
        let name = k.as_str();
        if let Some(key) = name.strip_prefix("x-nd-custom-meta-")
            && let Ok(val) = v.to_str() {
                custom_meta_map.insert(key.to_string(), serde_json::Value::String(val.to_string()));
            }
    }
    if custom_meta_map.is_empty() {
        None
    } else {
        Some(serde_json::to_string(&custom_meta_map).unwrap_or_default())
    }
}

fn parse_copy_source(headers: &HeaderMap) -> Option<(String, String)> {
    let raw = headers.get("x-nd-copy-source")?.to_str().ok()?;
    let (bucket, key) = raw.split_once('/')?;
    if bucket.is_empty() || key.is_empty() {
        return None;
    }
    Some((bucket.to_string(), key.to_string()))
}

pub async fn put_object(
    State(state): State<Arc<AppState>>,
    Path(params): Path<ObjectParams>,
    req: Request,
) -> Response {
    let put_started = Instant::now();
    let content_length = req
        .headers()
        .get(header::CONTENT_LENGTH)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("unknown");
    tracing::info!(
        bucket = %params.bucket,
        key = %params.key,
        content_length = %content_length,
        max_body_size = state.max_body_size,
        "put_object started"
    );
    let headers = req.headers().clone();
    let custom_meta = extract_custom_meta(&headers);

    if let Some((src_bucket, src_key)) = parse_copy_source(&headers) {
        tracing::info!(
            src_bucket = %src_bucket,
            src_key = %src_key,
            dst_bucket = %params.bucket,
            dst_key = %params.key,
            "put_object server-side copy started"
        );
        match state
            .storage
            .copy_object(&src_bucket, &src_key, &params.bucket, &params.key)
            .await
        {
            Ok(meta) => {
                state.metrics.add_uploaded(meta.size as u64);
                tracing::info!(
                    dst_bucket = %params.bucket,
                    dst_key = %params.key,
                    logical_size_bytes = meta.size,
                    elapsed_ms = put_started.elapsed().as_millis() as u64,
                    "put_object server-side copy complete"
                );
                return (
                    StatusCode::CREATED,
                    Json(json!({ "etag": meta.etag })),
                )
                    .into_response();
            }
            Err(e) => {
                state.metrics.inc_errors();
                tracing::error!(
                    dst_bucket = %params.bucket,
                    dst_key = %params.key,
                    elapsed_ms = put_started.elapsed().as_millis() as u64,
                    error = %e,
                    "put_object server-side copy failed"
                );
                return map_storage_error(e).into_response();
            }
        }
    }

    let content_type = headers
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());

    let body_stream = req.into_body().into_data_stream();
    let body_reader = tokio_util::io::StreamReader::new(
        body_stream.map(|result| {
            result.map_err(io::Error::other)
        }),
    );
    let body_reader = LimitReader {
        inner: body_reader,
        remaining: state.max_body_size,
    };

    match state
        .storage
        .put_object(
            &params.bucket,
            &params.key,
            content_type.as_deref(),
            custom_meta.as_deref(),
            body_reader,
        )
        .await
    {
        Ok(meta) => {
            state.metrics.add_uploaded(meta.size as u64);
            tracing::info!(
                bucket = %params.bucket,
                key = %params.key,
                logical_size_bytes = meta.size,
                elapsed_ms = put_started.elapsed().as_millis() as u64,
                "put_object complete"
            );
            let mut resp = (StatusCode::CREATED, Json(json!({ "etag": meta.etag }))).into_response();
            if let Some(etag) = meta.etag
                && let Ok(etag_header) = etag.parse() {
                    resp.headers_mut().insert(header::ETAG, etag_header);
                }
            resp
        }
        Err(e @ StorageError::PayloadTooLarge) => {
            state.metrics.inc_errors();
            tracing::warn!(
                bucket = %params.bucket,
                key = %params.key,
                elapsed_ms = put_started.elapsed().as_millis() as u64,
                "put_object rejected: payload too large"
            );
            map_storage_error(e).into_response()
        }
        Err(e) => {
            state.metrics.inc_errors();
            tracing::error!(
                bucket = %params.bucket,
                key = %params.key,
                elapsed_ms = put_started.elapsed().as_millis() as u64,
                error = %e,
                "put_object failed"
            );
            map_storage_error(e).into_response()
        }
    }
}

pub async fn get_object(
    State(state): State<Arc<AppState>>,
    Path(params): Path<ObjectParams>,
    req: Request,
) -> Response {
    let get_started = Instant::now();
    let headers = req.headers();
    let range_header = headers.get(header::RANGE).and_then(|v| v.to_str().ok());
    let if_none_match = parse_if_none_match(headers);
    let if_modified_since = parse_if_modified_since(headers);

    tracing::info!(
        bucket = %params.bucket,
        key = %params.key,
        has_range = range_header.is_some(),
        "get_object started"
    );

    match state
        .storage
        .get_object(
            &params.bucket,
            &params.key,
            range_header,
            if_none_match.as_deref(),
            if_modified_since,
        )
        .await
    {
        Ok(GetObjectOutcome::NotModified(meta)) => {
            tracing::info!(
                bucket = %params.bucket,
                key = %params.key,
                elapsed_ms = get_started.elapsed().as_millis() as u64,
                "get_object not modified"
            );
            let mut resp = Response::new(Body::empty());
            *resp.status_mut() = StatusCode::NOT_MODIFIED;
            apply_object_headers(resp.headers_mut(), &meta);
            resp
        }
        Ok(GetObjectOutcome::Content {
            stream,
            content_length,
            total_size,
            meta,
        }) => {
            state.metrics.add_downloaded(content_length);
            tracing::info!(
                bucket = %params.bucket,
                key = %params.key,
                content_length,
                total_size,
                partial = range_header.is_some(),
                elapsed_ms = get_started.elapsed().as_millis() as u64,
                "get_object complete"
            );
            let body = Body::from_stream(stream);
            let mut resp = Response::new(body);
            apply_object_headers(resp.headers_mut(), &meta);
            if let Ok(ar) = "bytes".parse() {
                resp.headers_mut().insert(header::ACCEPT_RANGES, ar);
            }
            if let Some(range_hdr) = range_header {
                let start = super::helpers::parse_range(range_hdr, total_size)
                    .map(|(s, _)| s)
                    .unwrap_or(0);
                let end = start + content_length.saturating_sub(1);
                let value = format!("bytes {}-{}/{}", start, end, total_size);
                if let Ok(cr) = value.parse() {
                    resp.headers_mut().insert(header::CONTENT_RANGE, cr);
                }
                *resp.status_mut() = StatusCode::PARTIAL_CONTENT;
            }
            resp
        }
        Err(e) => {
            state.metrics.inc_errors();
            tracing::error!(
                bucket = %params.bucket,
                key = %params.key,
                elapsed_ms = get_started.elapsed().as_millis() as u64,
                error = %e,
                "get_object failed"
            );
            map_storage_error(e).into_response()
        }
    }
}

pub async fn head_object(
    State(state): State<Arc<AppState>>,
    Path(params): Path<ObjectParams>,
    req: Request,
) -> Response {
    let head_started = Instant::now();
    let headers = req.headers();
    let if_none_match = parse_if_none_match(headers);
    let if_modified_since = parse_if_modified_since(headers);

    tracing::debug!(
        bucket = %params.bucket,
        key = %params.key,
        "head_object started"
    );

    match state
        .storage
        .head_object(
            &params.bucket,
            &params.key,
            if_none_match.as_deref(),
            if_modified_since,
        )
        .await
    {
        Ok(None) => {
            tracing::debug!(
                bucket = %params.bucket,
                key = %params.key,
                elapsed_ms = head_started.elapsed().as_millis() as u64,
                "head_object not modified"
            );
            let mut resp = Response::new(Body::empty());
            *resp.status_mut() = StatusCode::NOT_MODIFIED;
            resp
        }
        Ok(Some(meta)) => {
            tracing::debug!(
                bucket = %params.bucket,
                key = %params.key,
                logical_size_bytes = meta.size,
                elapsed_ms = head_started.elapsed().as_millis() as u64,
                "head_object complete"
            );
            let mut resp = Response::new(Body::empty());
            apply_object_headers(resp.headers_mut(), &meta);
            resp
        }
        Err(e) => {
            state.metrics.inc_errors();
            tracing::warn!(
                bucket = %params.bucket,
                key = %params.key,
                elapsed_ms = head_started.elapsed().as_millis() as u64,
                error = %e,
                "head_object failed"
            );
            map_storage_error(e).into_response()
        }
    }
}

pub async fn delete_object(
    State(state): State<Arc<AppState>>,
    Path(params): Path<ObjectParams>,
) -> Response {
    tracing::info!(
        bucket = %params.bucket,
        key = %params.key,
        "delete_object started"
    );
    let delete_started = Instant::now();
    match state.storage.delete_object(&params.bucket, &params.key).await {
        Ok(()) => {
            tracing::info!(
                bucket = %params.bucket,
                key = %params.key,
                elapsed_ms = delete_started.elapsed().as_millis() as u64,
                "delete_object complete"
            );
            StatusCode::NO_CONTENT.into_response()
        }
        Err(e) => {
            state.metrics.inc_errors();
            tracing::error!(
                bucket = %params.bucket,
                key = %params.key,
                elapsed_ms = delete_started.elapsed().as_millis() as u64,
                error = %e,
                "delete_object failed"
            );
            map_storage_error(e).into_response()
        }
    }
}
