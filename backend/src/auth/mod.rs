// Human: Re-export JWT helpers and implement the Axum layer that turns a session cookie or Bearer token into Claims.
// Agent: READS HttpOnly cookie or Authorization header; CALLS decode_token; INSERTS Claims into request extensions.

use axum::{
    extract::{Request, State},
    middleware::Next,
    response::Response,
};
use std::sync::Arc;

pub use handlers::{decode_token, decode_token_for_refresh, Claims};

use crate::{error::AppError, AppState};

pub mod cache;
pub mod handlers;
pub mod session_cookie;

// Human: Parse session cookie or Bearer JWT, verify expiry, confirm the user row still exists and is enabled.
// Agent: READS JWT + postgres users; REQUIRES enabled=true; RELOADS role from DB; MUTATES Request extensions with Claims.
//        Uses in-process cache (30s TTL) to collapse 4–5 DB round trips to 0 for most requests.
pub async fn auth_middleware(
    State(state): State<Arc<AppState>>,
    mut request: Request,
    next: Next,
) -> Result<Response, AppError> {
    let token = session_cookie::bearer_or_session_token(request.headers())
        .ok_or(AppError::Unauthorized)?;

    let mut claims = decode_token(&token, &state.jwt_secret).map_err(|_| AppError::Unauthorized)?;

    if chrono::Utc::now().timestamp() > claims.exp {
        return Err(AppError::Unauthorized);
    }

    // Human: Check the in-process auth cache first — avoids 4–5 DB round trips on every request.
    // Agent: READS cache::get_cached_auth; FALLS BACK to full DB chain on miss or expiry.
    if let Some(cached) = cache::get_cached_auth(&claims.sub) {
        if !cached.enabled {
            return Err(AppError::Forbidden(
                "account is not activated. Contact an administrator.".into(),
            ));
        }
        if claims.ver < cached.session_epoch {
            return Err(AppError::Unauthorized);
        }
        if let Some(ref sid) = claims.sid {
            if cached.revoked_sids.iter().any(|id| id == sid) {
                return Err(AppError::Unauthorized);
            }
        } else if let Some(min_iat) = cached.min_valid_iat {
            if claims.iat < min_iat {
                return Err(AppError::Unauthorized);
            }
        }
        claims.role = if cached.is_admin {
            "admin".into()
        } else {
            cached.role.clone()
        };
        request.extensions_mut().insert(claims);
        return Ok(next.run(request).await);
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

    let is_admin = claims.role == "admin";

    let session_epoch = crate::user_sessions::load_session_epoch(&state.pool, &claims.sub).await?;
    if claims.ver < session_epoch {
        return Err(AppError::Unauthorized);
    }

    let revoked_sids = crate::user_sessions::load_revoked_session_ids(&state.pool, &claims.sub).await?;
    if let Some(ref sid) = claims.sid {
        if revoked_sids.iter().any(|id| id == sid) {
            return Err(AppError::Unauthorized);
        }
    }

    // Human: Populate the cache so subsequent requests from this user skip the DB chain.
    // Agent: WRITES cache::set_cached_auth with all fields the cache check above reads.
    cache::set_cached_auth(
        &claims.sub,
        cache::CachedAuth {
            enabled: user_enabled,
            role: db_role,
            is_admin,
            session_epoch,
            revoked_sids,
            min_valid_iat: None, // only needed for legacy sid-less tokens; not cached here
        },
    );

    request.extensions_mut().insert(claims);
    Ok(next.run(request).await)
}
