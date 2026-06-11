// Human: Canonical HTTP errors and JSON bodies for `/api/v1`.
// Agent: EMITS `{ error: { code, message, fields? } }` JSON; MAPS AppError variants to HTTP status; LOGS internals only in tracing.

use axum::{
    http::{HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use serde::Serialize;
use serde_json::Value;
use thiserror::Error;
use tracing::error;

#[derive(Serialize)]
struct ErrorBody {
    error: ErrorDetail,
}

#[derive(Serialize)]
struct ErrorDetail {
    code: &'static str,
    message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    fields: Option<Value>,
}

#[derive(Error, Debug)]
pub enum AppError {
    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),

    #[error("not found")]
    NotFound,

    #[error("unauthorized")]
    Unauthorized,

    #[error("forbidden: {0}")]
    Forbidden(String),

    #[error("bad request: {0}")]
    BadRequest(String),

    #[error("validation failed: {0}")]
    Validation(String, Value),

    #[error("rate limit exceeded")]
    RateLimited {
        retry_after_secs: u64,
    },

    #[error("conflict: {0}")]
    Conflict(String),

    #[error("payload too large: {0}")]
    PayloadTooLarge(String),

    #[error("internal error: {0}")]
    Internal(#[from] anyhow::Error),

    #[error("storage error: {0}")]
    Storage(String),
}

impl AppError {
    // Human: Build a validation failure with structured field errors for the SPA to highlight inputs.
    // Agent: RETURNS Validation variant; SERIALIZES fields in error JSON; HTTP 400.
    pub fn validation(message: impl Into<String>, fields: Value) -> Self {
        AppError::Validation(message.into(), fields)
    }

    // Human: Rate-limit rejection with a Retry-After hint for upload/auth throttling.
    // Agent: RETURNS RateLimited variant; HTTP 429; EMITS Retry-After header in into_response.
    pub fn rate_limited(retry_after_secs: u64) -> Self {
        AppError::RateLimited {
            retry_after_secs: retry_after_secs.max(1),
        }
    }

    fn code(&self) -> &'static str {
        match self {
            AppError::Database(_) => "database_error",
            AppError::NotFound => "not_found",
            AppError::Unauthorized => "unauthorized",
            AppError::Forbidden(_) => "forbidden",
            AppError::BadRequest(_) => "bad_request",
            AppError::Validation(_, _) => "validation_error",
            AppError::RateLimited { .. } => "rate_limited",
            AppError::Conflict(_) => "conflict",
            AppError::PayloadTooLarge(_) => "payload_too_large",
            AppError::Internal(_) => "internal_error",
            AppError::Storage(_) => "storage_error",
        }
    }

    fn client_message(&self) -> String {
        match self {
            AppError::Database(_) => "internal database error".into(),
            AppError::NotFound => "not found".into(),
            AppError::Unauthorized => "unauthorized".into(),
            AppError::Forbidden(msg) => msg.clone(),
            AppError::BadRequest(msg) => msg.clone(),
            AppError::Validation(msg, _) => msg.clone(),
            AppError::RateLimited { .. } => "rate limit exceeded; try again shortly".into(),
            AppError::Conflict(msg) => msg.clone(),
            AppError::PayloadTooLarge(msg) => msg.clone(),
            AppError::Internal(_) => "internal server error".into(),
            AppError::Storage(_) => "storage error".into(),
        }
    }

    fn client_fields(&self) -> Option<Value> {
        match self {
            AppError::Validation(_, fields) => Some(fields.clone()),
            _ => None,
        }
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let status = match &self {
            AppError::Database(_) => StatusCode::INTERNAL_SERVER_ERROR,
            AppError::NotFound => StatusCode::NOT_FOUND,
            AppError::Unauthorized => StatusCode::UNAUTHORIZED,
            AppError::Forbidden(_) => StatusCode::FORBIDDEN,
            AppError::BadRequest(_) | AppError::Validation(_, _) => StatusCode::BAD_REQUEST,
            AppError::RateLimited { .. } => StatusCode::TOO_MANY_REQUESTS,
            AppError::Conflict(_) => StatusCode::CONFLICT,
            AppError::PayloadTooLarge(_) => StatusCode::PAYLOAD_TOO_LARGE,
            AppError::Internal(_) => StatusCode::INTERNAL_SERVER_ERROR,
            AppError::Storage(_) => StatusCode::INTERNAL_SERVER_ERROR,
        };

        match &self {
            AppError::Database(e) => error!("Database error: {}", e),
            AppError::Internal(e) => error!("Internal error: {}", e),
            AppError::Storage(msg) => error!("Storage error: {}", msg),
            _ => {}
        }

        let body = Json(ErrorBody {
            error: ErrorDetail {
                code: self.code(),
                message: self.client_message(),
                fields: self.client_fields(),
            },
        });

        let mut response = (status, body).into_response();
        if let AppError::RateLimited { retry_after_secs } = &self {
            if let Ok(value) = HeaderValue::from_str(&retry_after_secs.to_string()) {
                response
                    .headers_mut()
                    .insert(axum::http::header::RETRY_AFTER, value);
            }
        }
        response
    }
}

#[cfg(test)]
mod tests {
    use super::AppError;
    use axum::body::to_bytes;
    use axum::http::header::RETRY_AFTER;
    use axum::response::IntoResponse;

    // Human: Contract test — validation errors must expose field map to clients.
    // Agent: Builds Validation AppError; ASSERTS JSON code + fields keys.
    #[tokio::test]
    async fn validation_error_includes_fields_in_json() {
        let err = AppError::validation(
            "invalid input",
            serde_json::json!({ "email": "required" }),
        );
        let response = err.into_response();
        let bytes = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("body");
        let json: serde_json::Value = serde_json::from_slice(&bytes).expect("json");
        assert_eq!(json["error"]["code"], "validation_error");
        assert_eq!(json["error"]["fields"]["email"], "required");
    }

    // Human: Throttled clients rely on Retry-After to back off without hammering upload endpoints.
    // Agent: Builds rate_limited AppError; ASSERTS HTTP 429 and Retry-After header value.
    #[tokio::test]
    async fn rate_limited_error_includes_retry_after_header() {
        let err = AppError::rate_limited(12);
        let response = err.into_response();
        assert_eq!(response.status(), axum::http::StatusCode::TOO_MANY_REQUESTS);
        assert_eq!(response.headers().get(RETRY_AFTER).unwrap(), "12");
    }
}
