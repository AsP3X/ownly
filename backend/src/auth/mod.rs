// Human: Re-export JWT helpers and implement the Axum layer that turns a Bearer token into Claims.
// Agent: READS Authorization header; CALLS decode_token; READS users.enabled; INSERTS Claims into request extensions.

use axum::{
    extract::{Request, State},
    http::header,
    middleware::Next,
    response::Response,
};
use std::sync::Arc;

pub use handlers::{decode_token, decode_token_for_refresh, Claims};

use crate::{error::AppError, AppState};

pub mod handlers;

// Human: Parse Bearer JWT, verify expiry, confirm the user row still exists and is enabled.
// Agent: READS JWT + postgres users; REQUIRES enabled=true; RELOADS role from DB; MUTATES Request extensions with Claims.
pub async fn auth_middleware(
    State(state): State<Arc<AppState>>,
    mut request: Request,
    next: Next,
) -> Result<Response, AppError> {
    let token = request
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .ok_or(AppError::Unauthorized)?;

    let mut claims = decode_token(token, &state.jwt_secret).map_err(|_| AppError::Unauthorized)?;

    if chrono::Utc::now().timestamp() > claims.exp {
        return Err(AppError::Unauthorized);
    }

    let enabled: Option<(bool, String)> =
        sqlx::query_as("SELECT enabled, role FROM users WHERE id = $1")
            .bind(&claims.sub)
            .fetch_optional(&state.pool)
            .await
            .map_err(AppError::Database)?;

    let (user_enabled, db_role) = enabled.ok_or(AppError::Unauthorized)?;
    if !user_enabled {
        return Err(AppError::Forbidden(
            "account is not activated. Contact an administrator.".into(),
        ));
    }

    // Human: JWT role reflects admin group membership — not users.role alone (atomic permissions Phase 1).
    // Agent: CALLS effective_jwt_role; OVERWRITES claims.role after DB enabled check.
    claims.role =
        crate::authz::effective_jwt_role(&state.pool, &claims.sub, &db_role).await?;

    if !crate::user_sessions::is_token_session_valid(
        &state.pool,
        &claims.sub,
        claims.sid.as_deref(),
        claims.ver,
        claims.iat,
    )
    .await?
    {
        return Err(AppError::Unauthorized);
    }

    request.extensions_mut().insert(claims);
    Ok(next.run(request).await)
}
