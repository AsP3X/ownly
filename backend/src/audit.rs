// Human: Append semantic audit rows for mutations and security-sensitive actions.
// Agent: WRITES audit_logs; READS ip/user-agent from headers; NO secrets in context JSON.

use axum::http::HeaderMap;
use serde_json::Value;
use sqlx::PgPool;
use uuid::Uuid;

use crate::rate_limit::client_ip_from_headers;

// Human: Persist who did what with optional resource metadata for the admin audit trail.
// Agent: INSERT audit_logs; READS headers for ip/user_agent; context is JSONB optional.
pub async fn write_audit(
    pool: &PgPool,
    user_id: Option<&str>,
    action: &str,
    resource_type: Option<&str>,
    resource_id: Option<&str>,
    context: Option<Value>,
    headers: &HeaderMap,
) -> Result<String, sqlx::Error> {
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
    .execute(pool)
    .await?;

    Ok(id)
}
