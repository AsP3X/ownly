// Human: Append semantic audit rows for mutations and security-sensitive actions.
// Agent: WRITES audit_logs; READS ip/user-agent from headers; NO secrets in context JSON.

use std::time::Duration;

use axum::http::HeaderMap;
use serde_json::Value;
use sqlx::{PgPool, Postgres};
use tracing::error;
use uuid::Uuid;

use crate::{error::AppError, rate_limit::client_ip_from_headers};

const AUDIT_WRITE_ATTEMPTS: u32 = 3;
const AUDIT_RETRY_DELAY: Duration = Duration::from_millis(25);

// Human: Persist who did what with optional resource metadata for the admin audit trail.
// Agent: INSERT audit_logs; READS headers for ip/user_agent; context is JSONB optional.
pub async fn write_audit<'e, E>(
    executor: E,
    user_id: Option<&str>,
    action: &str,
    resource_type: Option<&str>,
    resource_id: Option<&str>,
    context: Option<Value>,
    headers: &HeaderMap,
) -> Result<String, sqlx::Error>
where
    E: sqlx::Executor<'e, Database = Postgres>,
{
    let id = Uuid::new_v4().to_string();
    let ip = client_ip_from_headers(headers, crate::rate_limit::trust_proxy_from_env());
    let user_agent = headers
        .get(axum::http::header::USER_AGENT)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();

    sqlx::query(
        "INSERT INTO audit_logs (id, user_id, action, resource_type, resource_id, context, ip, user_agent) \
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
    )
    .bind(&id)
    .bind(user_id)
    .bind(action)
    .bind(resource_type)
    .bind(resource_id)
    .bind(context)
    .bind(ip)
    .bind(user_agent)
    .execute(executor)
    .await?;

    Ok(id)
}

// Human: Retry transient audit insert failures and surface the last error to callers.
// Agent: USED for security-critical mutations that must fail closed when audit cannot be written.
pub async fn write_audit_with_retry(
    pool: &PgPool,
    user_id: Option<&str>,
    action: &str,
    resource_type: Option<&str>,
    resource_id: Option<&str>,
    context: Option<Value>,
    headers: &HeaderMap,
) -> Result<String, sqlx::Error> {
    let mut last_error = None;

    for attempt in 1..=AUDIT_WRITE_ATTEMPTS {
        match write_audit(
            pool,
            user_id,
            action,
            resource_type,
            resource_id,
            context.clone(),
            headers,
        )
        .await
        {
            Ok(id) => return Ok(id),
            Err(err) => {
                log_audit_write_failure(
                    action,
                    resource_type,
                    resource_id,
                    user_id,
                    attempt,
                    &err,
                );
                last_error = Some(err);
                if attempt < AUDIT_WRITE_ATTEMPTS {
                    tokio::time::sleep(AUDIT_RETRY_DELAY).await;
                }
            }
        }
    }

    Err(last_error.expect("audit retry loop always records an error"))
}

// Human: Best-effort audit write for flows that can proceed without a session id (login/register).
// Agent: RETRIES then logs at error; RETURNS None when all attempts fail.
pub async fn write_audit_logged(
    pool: &PgPool,
    user_id: Option<&str>,
    action: &str,
    resource_type: Option<&str>,
    resource_id: Option<&str>,
    context: Option<Value>,
    headers: &HeaderMap,
) -> Option<String> {
    write_audit_with_retry(
        pool,
        user_id,
        action,
        resource_type,
        resource_id,
        context,
        headers,
    )
    .await
    .ok()
}

// Human: Required audit write for security-sensitive mutations — propagates failure to the handler.
// Agent: RETRIES; MAPS final failure to AppError::Internal after error-level logging.
pub async fn write_audit_required(
    pool: &PgPool,
    user_id: Option<&str>,
    action: &str,
    resource_type: Option<&str>,
    resource_id: Option<&str>,
    context: Option<Value>,
    headers: &HeaderMap,
) -> Result<String, AppError> {
    write_audit_with_retry(
        pool,
        user_id,
        action,
        resource_type,
        resource_id,
        context,
        headers,
    )
    .await
    .map_err(|err| {
        AppError::Internal(anyhow::anyhow!(
            "audit log write failed after {AUDIT_WRITE_ATTEMPTS} attempts: {err}"
        ))
    })
}

// Human: Required audit write inside an open transaction — rolls back on persistent failure.
// Agent: RETRIES within the same TX; MAPS final failure to AppError::Internal.
pub async fn write_audit_required_in_tx(
    tx: &mut sqlx::Transaction<'_, Postgres>,
    user_id: Option<&str>,
    action: &str,
    resource_type: Option<&str>,
    resource_id: Option<&str>,
    context: Option<Value>,
    headers: &HeaderMap,
) -> Result<String, AppError> {
    let mut last_error = None;

    for attempt in 1..=AUDIT_WRITE_ATTEMPTS {
        match write_audit(
            &mut **tx,
            user_id,
            action,
            resource_type,
            resource_id,
            context.clone(),
            headers,
        )
        .await
        {
            Ok(id) => return Ok(id),
            Err(err) => {
                log_audit_write_failure(
                    action,
                    resource_type,
                    resource_id,
                    user_id,
                    attempt,
                    &err,
                );
                last_error = Some(err);
                if attempt < AUDIT_WRITE_ATTEMPTS {
                    tokio::time::sleep(AUDIT_RETRY_DELAY).await;
                }
            }
        }
    }

    Err(AppError::Internal(anyhow::anyhow!(
        "audit log write failed after {AUDIT_WRITE_ATTEMPTS} attempts: {}",
        last_error.expect("audit retry loop always records an error")
    )))
}

fn log_audit_write_failure(
    action: &str,
    resource_type: Option<&str>,
    resource_id: Option<&str>,
    user_id: Option<&str>,
    attempt: u32,
    err: &sqlx::Error,
) {
    error!(
        audit_action = action,
        audit_resource_type = resource_type,
        audit_resource_id = resource_id,
        audit_user_id = user_id,
        audit_attempt = attempt,
        audit_max_attempts = AUDIT_WRITE_ATTEMPTS,
        error = %err,
        "audit log write failed"
    );
}

#[cfg(test)]
mod tests {
    use super::{log_audit_write_failure, AUDIT_WRITE_ATTEMPTS};

    // Human: Contract test — audit failure logs include action metadata for log aggregation.
    // Agent: Invokes log helper with synthetic sqlx error; ASSERTS no panic (tracing is side-effect only).
    #[test]
    fn audit_failure_log_helper_accepts_metadata() {
        let err = sqlx::Error::RowNotFound;
        log_audit_write_failure(
            "admin.users.delete",
            Some("user"),
            Some("user-123"),
            Some("admin-456"),
            AUDIT_WRITE_ATTEMPTS,
            &err,
        );
    }
}
