// Human: Resolve effective per-user storage limits from users.storage_quota_gb and app_settings default.
// Agent: READS users + app_settings; RETURNS quota_bytes for dashboard, profile, and admin directory.

use sqlx::PgPool;

use crate::error::AppError;

const GB: i64 = 1024 * 1024 * 1024;

// Human: Load the instance-wide default quota from app_settings (GB → bytes).
// Agent: READS default_storage_quota_gb; RETURNS 50 GB when unset or invalid.
pub async fn load_default_quota_bytes(pool: &PgPool) -> Result<i64, AppError> {
    let quota_gb: Option<(String,)> =
        sqlx::query_as("SELECT value FROM app_settings WHERE key = 'default_storage_quota_gb'")
            .fetch_optional(pool)
            .await?;
    Ok(quota_gb
        .and_then(|(value,)| value.parse::<i64>().ok())
        .unwrap_or(50)
        .max(1)
        .saturating_mul(GB))
}

// Human: Effective quota for one user — override column or instance default.
// Agent: READS users.storage_quota_gb; FALLBACK load_default_quota_bytes when NULL.
pub async fn resolve_user_quota_bytes(pool: &PgPool, user_id: &str) -> Result<i64, AppError> {
    let row: Option<(Option<i32>,)> =
        sqlx::query_as("SELECT storage_quota_gb FROM users WHERE id = $1")
            .bind(user_id)
            .fetch_optional(pool)
            .await?;
    let Some((override_gb,)) = row else {
        return Err(AppError::NotFound);
    };
    if let Some(gb) = override_gb {
        return Ok((gb as i64).max(1).saturating_mul(GB));
    }
    load_default_quota_bytes(pool).await
}

// Human: Sum active file bytes owned by one user — used before storage writes.
// Agent: READS files WHERE user_id AND deleted_at IS NULL; RETURNS COALESCE SUM size_bytes.
pub async fn load_user_used_bytes(pool: &PgPool, user_id: &str) -> Result<i64, AppError> {
    let row: Option<(i64,)> = sqlx::query_as(
        "SELECT COALESCE(SUM(size_bytes), 0)::BIGINT FROM files \
         WHERE user_id = $1 AND deleted_at IS NULL",
    )
    .bind(user_id)
    .fetch_optional(pool)
    .await?;
    Ok(row.map(|(bytes,)| bytes).unwrap_or(0))
}

// Human: Reject storage mutations that would exceed the user's effective quota (SEC-014).
// Agent: READS used_bytes + quota_bytes; RETURNS PayloadTooLarge when incoming would exceed cap.
pub async fn ensure_within_quota(
    pool: &PgPool,
    user_id: &str,
    incoming_bytes: i64,
) -> Result<(), AppError> {
    if incoming_bytes <= 0 {
        return Ok(());
    }
    let quota_bytes = resolve_user_quota_bytes(pool, user_id).await?;
    let used_bytes = load_user_used_bytes(pool, user_id).await?;
    if used_bytes.saturating_add(incoming_bytes) > quota_bytes {
        return Err(AppError::PayloadTooLarge(
            "storage quota exceeded — delete files or contact an administrator".into(),
        ));
    }
    Ok(())
}

// Human: Reject bulk saves when the combined incoming size exceeds quota.
// Agent: SUMS per-file sizes; CALLS ensure_within_quota once with total.
pub async fn ensure_within_quota_for_total(
    pool: &PgPool,
    user_id: &str,
    total_incoming_bytes: i64,
) -> Result<(), AppError> {
    ensure_within_quota(pool, user_id, total_incoming_bytes).await
}

// Human: Minimum GB quota that still fits the user's active library usage.
// Agent: CEIL(used_bytes / GB); USED by admin PATCH validation before lowering caps.
pub fn minimum_quota_gb_for_usage(used_bytes: i64) -> i64 {
    if used_bytes <= 0 {
        return 1;
    }
    used_bytes
        .saturating_add(GB - 1)
        .saturating_div(GB)
        .max(1)
}

// Human: Reject admin quota changes that would leave the user over their new cap.
// Agent: RETURNS BadRequest when quota_gb < minimum_quota_gb_for_usage(used_bytes).
pub fn validate_quota_gb_for_usage(quota_gb: u32, used_bytes: i64) -> Result<(), AppError> {
    let min_gb = minimum_quota_gb_for_usage(used_bytes);
    if (quota_gb as i64) < min_gb {
        return Err(AppError::BadRequest(format!(
            "storage quota must be at least {min_gb} GB based on current usage"
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn minimum_quota_gb_rounds_up_for_partial_usage() {
        assert_eq!(minimum_quota_gb_for_usage(0), 1);
        assert_eq!(minimum_quota_gb_for_usage(1), 1);
        assert_eq!(minimum_quota_gb_for_usage(GB), 1);
        assert_eq!(minimum_quota_gb_for_usage(GB + 1), 2);
    }

    #[test]
    fn validate_quota_rejects_below_usage() {
        let err = validate_quota_gb_for_usage(1, GB + 1).unwrap_err();
        assert!(matches!(err, AppError::BadRequest(_)));
    }
}
