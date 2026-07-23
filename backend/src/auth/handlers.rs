// Human: Registration, login, JWT issue/verify, and the /auth/me profile payload.
// Agent: WRITES users table; EMITS JWT Claims; RETURNS AuthResponse JSON; LOGS redacted emails only.

use argon2::{
    password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use axum::{
    extract::{Path, State},
    http::{header, HeaderMap},
    response::{AppendHeaders, IntoResponse, Response},
    Extension, Json,
};
use chrono::Utc;
use std::sync::OnceLock;

use jsonwebtoken::{decode, encode, Algorithm, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tracing::info;
use uuid::Uuid;

use crate::{audit, auth::session_cookie, error::AppError, rate_limit, redact, AppState};

// Human: Access JWT lifetime issued at login, register, and refresh.
// Agent: READ by create_token; FRONTEND proactive refresh should run well before this window ends.
pub const JWT_ACCESS_TTL_HOURS: i64 = 24;

// Human: Allow refresh shortly after hard expiry so a missed client timer does not force re-login.
// Agent: COMPARED in refresh handler; REJECTS tokens older than exp + grace.
pub const JWT_REFRESH_GRACE_SECS: i64 = 3600;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Claims {
    pub sub: String,
    pub email: String,
    pub role: String,
    pub exp: i64,
    pub iat: i64,
    /// Human: Audit log id from auth.login — used for admin session revoke.
    #[serde(default)]
    pub sid: Option<String>,
    /// Human: Session epoch from app_settings — bumped when the newest login session is revoked.
    #[serde(default)]
    pub ver: u64,
}

#[derive(Debug, Deserialize)]
pub struct RegisterRequest {
    pub email: String,
    pub password: String,
}

#[derive(Debug, Deserialize)]
pub struct LoginRequest {
    pub email: String,
    pub password: String,
}

#[derive(Debug, Serialize)]
pub struct AuthResponse {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub token: Option<String>,
    pub user: UserDto,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub pending_activation: bool,
    /// Human: Readable CSRF token for X-CSRF-Token when the cookie is not visible to document.cookie yet.
    /// Agent: SET on login/register/setup/refresh; MIRROR of ownly_csrf Set-Cookie for SPA clients.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub csrf_token: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct UserDto {
    pub id: String,
    pub email: String,
    pub role: String,
    pub enabled: bool,
}

pub fn hash_password(password: &str) -> Result<String, argon2::password_hash::Error> {
    let salt = SaltString::generate(&mut OsRng);
    Ok(Argon2::default()
        .hash_password(password.as_bytes(), &salt)?
        .to_string())
}

pub fn verify_password(password: &str, hash: &str) -> Result<bool, argon2::password_hash::Error> {
    let parsed = PasswordHash::new(hash)?;
    Ok(Argon2::default()
        .verify_password(password.as_bytes(), &parsed)
        .is_ok())
}

pub fn create_token(
    user_id: String,
    email: String,
    role: String,
    secret: &str,
    session_id: Option<String>,
    session_version: u64,
) -> anyhow::Result<String> {
    let now = Utc::now().timestamp();
    create_token_with_timestamps(
        user_id,
        email,
        role,
        secret,
        session_id,
        session_version,
        now,
        now + chrono::Duration::try_hours(JWT_ACCESS_TTL_HOURS).unwrap().num_seconds(),
    )
}

// Human: Mint a JWT with explicit iat/exp — used by refresh and integration tests simulating expiry.
// Agent: EMITS Claims JSON; PRESERVES sid + ver so refresh does not spawn a new admin session row.
pub fn create_token_with_timestamps(
    user_id: String,
    email: String,
    role: String,
    secret: &str,
    session_id: Option<String>,
    session_version: u64,
    iat: i64,
    exp: i64,
) -> anyhow::Result<String> {
    let claims = Claims {
        sub: user_id,
        email,
        role,
        iat,
        exp,
        sid: session_id,
        ver: session_version,
    };
    Ok(encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(secret.as_bytes()),
    )?)
}

pub fn decode_token(token: &str, secret: &str) -> anyhow::Result<Claims> {
    let mut validation = Validation::new(Algorithm::HS256);
    validation.validate_exp = true;
    decode_token_with_validation(token, secret, &validation)
}

// Human: Parse a JWT for refresh while ignoring exp — signature and shape must still be valid.
// Agent: CALLED by refresh handler; CALLER enforces grace window + session revocation gates.
pub fn decode_token_for_refresh(token: &str, secret: &str) -> anyhow::Result<Claims> {
    let mut validation = Validation::new(Algorithm::HS256);
    validation.validate_exp = false;
    decode_token_with_validation(token, secret, &validation)
}

fn decode_token_with_validation(
    token: &str,
    secret: &str,
    validation: &Validation,
) -> anyhow::Result<Claims> {
    Ok(decode::<Claims>(
        token,
        &DecodingKey::from_secret(secret.as_bytes()),
        validation,
    )?
    .claims)
}

pub(crate) fn auth_response_with_session_cookie(
    state: &AppState,
    headers: &HeaderMap,
    token: String,
    mut auth: AuthResponse,
) -> Result<Response, AppError> {
    let csrf_token = crate::csrf::generate_csrf_token();
    auth.csrf_token = Some(csrf_token.clone());
    let cookies = issue_session_auth_cookies(state, headers, &token, &csrf_token)?;
    Ok((cookies, Json(auth)).into_response())
}

// Human: Build HttpOnly session, readable CSRF, and legacy CSRF clear Set-Cookie headers.
// Agent: AppendHeaders; REQUIRED so Axum emits multiple Set-Cookie lines without overwriting.
pub(crate) fn issue_session_auth_cookies(
    state: &AppState,
    headers: &HeaderMap,
    token: &str,
    csrf_token: &str,
) -> Result<
    AppendHeaders<[(header::HeaderName, header::HeaderValue); 3]>,
    AppError,
> {
    let session_cookie = session_cookie::session_set_cookie(state, headers, token)
        .map_err(|e| AppError::Internal(anyhow::anyhow!(e)))?;
    let csrf_cookie = crate::csrf::csrf_set_cookie(state, headers, csrf_token)
        .map_err(|e| AppError::Internal(anyhow::anyhow!(e)))?;
    let legacy_csrf_clear = crate::csrf::csrf_clear_legacy_path_cookie(state, headers)
        .map_err(|e| AppError::Internal(anyhow::anyhow!(e)))?;
    Ok(AppendHeaders([
        (header::SET_COOKIE, session_cookie),
        (header::SET_COOKIE, csrf_cookie),
        (header::SET_COOKIE, legacy_csrf_clear),
    ]))
}

async fn registration_allowed(pool: &sqlx::PgPool) -> Result<bool, AppError> {
    let value: Option<(String,)> =
        sqlx::query_as("SELECT value FROM app_settings WHERE key = 'allow_public_registration'")
            .fetch_optional(pool)
            .await?;
    Ok(value.map(|(v,)| v == "true").unwrap_or(false))
}

async fn activation_required(pool: &sqlx::PgPool) -> Result<bool, AppError> {
    let value: Option<(String,)> =
        sqlx::query_as("SELECT value FROM app_settings WHERE key = 'require_account_activation'")
            .fetch_optional(pool)
            .await?;
    Ok(value.map(|(v,)| v == "true").unwrap_or(false))
}

// Human: Create a user account when public registration is enabled.
// Agent: READS app_settings; WRITES users; RETURNS JWT or pending_activation; HTTP 403 when disabled.
pub async fn register(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<RegisterRequest>,
) -> Result<Response, AppError> {
    crate::browser_guard::require_browser_user_creation(&headers)?;
    rate_limit::enforce(
        &state.auth_register_rl,
        &rate_limit::client_ip_from_headers(&headers, state.trust_proxy_headers),
    )?;
    info!(email_redacted = %redact::email_for_log(&body.email), "register attempt");

    if !registration_allowed(&state.pool).await? {
        return Err(AppError::Forbidden("public registration is disabled".into()));
    }

    let email = body.email.trim().to_lowercase();
    if !email.contains('@') {
        return Err(AppError::BadRequest("invalid email address".into()));
    }
    if body.password.len() < 8 {
        return Err(AppError::BadRequest("password must be at least 8 characters".into()));
    }

    let password_hash = hash_password(&body.password).map_err(|e| AppError::Internal(anyhow::anyhow!(e)))?;
    let user_id = Uuid::new_v4().to_string();
    let needs_activation = activation_required(&state.pool).await?;
    let enabled = !needs_activation;

    sqlx::query(
        "INSERT INTO users (id, email, password_hash, role, enabled) VALUES ($1, $2, $3, 'user', $4)",
    )
    .bind(&user_id)
    .bind(&email)
    .bind(&password_hash)
    .bind(enabled)
    .execute(&state.pool)
    .await
    .map_err(|e| match e {
        sqlx::Error::Database(db) if db.is_unique_violation() => {
            AppError::Conflict("email already exists".into())
        }
        _ => AppError::Database(e),
    })?;

    let session_id = audit::write_audit_logged(
        &state.pool,
        Some(&user_id),
        "auth.register",
        Some("user"),
        Some(&user_id),
        None,
        &headers,
    )
    .await;

    let session_version = crate::user_sessions::load_session_epoch(&state.pool, &user_id).await?;
    let token = if enabled {
        Some(
            create_token(
                user_id.clone(),
                email.clone(),
                "user".into(),
                &state.jwt_secret,
                session_id,
                session_version,
            )
            .map_err(AppError::Internal)?,
        )
    } else {
        None
    };

    let response = AuthResponse {
        token,
        pending_activation: needs_activation,
        csrf_token: None,
        user: UserDto {
            id: user_id,
            email,
            role: "user".into(),
            enabled,
        },
    };

    if let Some(session_token) = response.token.clone() {
        return auth_response_with_session_cookie(&state, &headers, session_token, response);
    }

    Ok(Json(response).into_response())
}

// Human: Validate credentials and return a JWT for enabled accounts.
// Agent: READS users by email; WRITES audit auth.login; RETURNS 401 on bad credentials.
pub async fn login(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<LoginRequest>,
) -> Result<Response, AppError> {
    rate_limit::enforce(
        &state.auth_login_rl,
        &rate_limit::client_ip_from_headers(&headers, state.trust_proxy_headers),
    )?;
    let email = body.email.trim().to_lowercase();

    let row: Option<(String, String, String, bool)> = sqlx::query_as(
        "SELECT id, password_hash, role, enabled FROM users WHERE email = $1",
    )
    .bind(&email)
    .fetch_optional(&state.pool)
    .await?;

    let (user_id, password_hash, role, enabled) = match row {
        Some(values) => values,
        None => {
            // Human: Constant-time-ish path when email is unknown — reduces account enumeration timing (SEC-028).
            // Agent: RUNS dummy Argon2 verify; RETURNS generic 401.
            let _ = verify_password(&body.password, dummy_login_hash());
            return Err(AppError::Unauthorized);
        }
    };

    if !verify_password(&body.password, &password_hash).unwrap_or(false) {
        return Err(AppError::Unauthorized);
    }
    if !enabled {
        return Err(AppError::Unauthorized);
    }

    let session_id = audit::write_audit_logged(
        &state.pool,
        Some(&user_id),
        "auth.login",
        Some("user"),
        Some(&user_id),
        None,
        &headers,
    )
    .await;

    let session_version = crate::user_sessions::load_session_epoch(&state.pool, &user_id).await?;
    let effective_role =
        crate::authz::effective_jwt_role(&state.pool, &user_id, &role).await?;
    let token = create_token(
        user_id.clone(),
        email.clone(),
        effective_role.clone(),
        &state.jwt_secret,
        session_id,
        session_version,
    )
    .map_err(AppError::Internal)?;

    auth_response_with_session_cookie(
        &state,
        &headers,
        token.clone(),
        AuthResponse {
            token: Some(token),
            pending_activation: false,
            csrf_token: None,
            user: UserDto {
                id: user_id,
                email,
                role: effective_role,
                enabled,
            },
        },
    )
}

// Human: Extend an active session without re-entering credentials — same sid/ver, new 24h exp.
// Agent: POST /auth/refresh PUBLIC; READS session cookie or Bearer JWT; RETURNS AuthResponse; NO audit row per refresh.
pub async fn refresh(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Response, AppError> {
    let token = session_cookie::bearer_or_session_token(&headers).ok_or(AppError::Unauthorized)?;

    let claims =
        decode_token_for_refresh(&token, &state.jwt_secret).map_err(|_| AppError::Unauthorized)?;

    let now = Utc::now().timestamp();
    if now > claims.exp + JWT_REFRESH_GRACE_SECS {
        return Err(AppError::Unauthorized);
    }

    let row: Option<(String, bool, String)> = sqlx::query_as(
        "SELECT email, enabled, role FROM users WHERE id = $1",
    )
    .bind(&claims.sub)
    .fetch_optional(&state.pool)
    .await?;

    let (email, user_enabled, db_role) = row.ok_or(AppError::Unauthorized)?;
    if !user_enabled {
        return Err(AppError::Forbidden(
            "account is not activated. Contact an administrator.".into(),
        ));
    }

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

    let effective_role =
        crate::authz::effective_jwt_role(&state.pool, &claims.sub, &db_role).await?;
    let session_version = crate::user_sessions::load_session_epoch(&state.pool, &claims.sub).await?;
    let new_iat = now.max(claims.iat.saturating_add(1));
    let token = create_token_with_timestamps(
        claims.sub.clone(),
        email.clone(),
        effective_role.clone(),
        &state.jwt_secret,
        claims.sid,
        session_version,
        new_iat,
        new_iat + chrono::Duration::try_hours(JWT_ACCESS_TTL_HOURS).unwrap().num_seconds(),
    )
    .map_err(AppError::Internal)?;

    auth_response_with_session_cookie(
        &state,
        &headers,
        token.clone(),
        AuthResponse {
            token: Some(token),
            pending_activation: false,
            csrf_token: None,
            user: UserDto {
                id: claims.sub,
                email,
                role: effective_role,
                enabled: user_enabled,
            },
        },
    )
}

// Human: Return the authenticated user's profile from JWT claims.
// Agent: READS Claims extension; NO DB query required beyond middleware gate.
pub async fn me(Extension(claims): Extension<Claims>) -> Json<UserDto> {
    Json(UserDto {
        id: claims.sub,
        email: claims.email,
        role: claims.role,
        enabled: true,
    })
}

// Human: Instance-level permissions for frontend admin route gating.
// Agent: GET /me/permissions; READS authz::list_effective_instance_permissions.
pub async fn me_permissions(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<serde_json::Value>, AppError> {
    let permissions =
        crate::authz::list_effective_instance_permissions(&state.pool, &claims.sub).await?;
    Ok(Json(serde_json::json!({ "permissions": permissions })))
}

// Human: List the caller's own active sign-in sessions for Settings → Authorized Sessions.
// Agent: GET /me/sessions; READS list_active_sessions; MARKS is_current from JWT sid.
pub async fn me_sessions(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<crate::user_sessions::SessionListResponse>, AppError> {
    let sessions = crate::user_sessions::list_active_sessions(
        &state.pool,
        &claims.sub,
        claims.sid.as_deref(),
    )
    .await?;
    Ok(Json(crate::user_sessions::SessionListResponse { sessions }))
}

// Human: Self-service revoke of one other device/session (not the caller's current JWT).
// Agent: POST /me/sessions/:id/revoke; REJECTS current sid; AUDIT auth.sessions.revoke.
pub async fn me_revoke_session(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    headers: HeaderMap,
    Path(session_id): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    if claims.sid.as_deref() == Some(session_id.as_str()) {
        return Err(AppError::BadRequest(
            "cannot revoke the current session; sign out instead".into(),
        ));
    }
    if !crate::user_sessions::session_belongs_to_user(&state.pool, &claims.sub, &session_id)
        .await?
    {
        return Err(AppError::NotFound);
    }

    crate::user_sessions::revoke_session_id(&state.pool, &claims.sub, &session_id).await?;

    audit::write_audit_logged(
        &state.pool,
        Some(&claims.sub),
        "auth.sessions.revoke",
        Some("user"),
        Some(&claims.sub),
        Some(serde_json::json!({ "session_id": session_id })),
        &headers,
    )
    .await;

    Ok(Json(serde_json::json!({ "ok": true })))
}

// Human: Self-service revoke of every session except the caller's current JWT sid.
// Agent: POST /me/sessions/revoke-others; KEEPS claims.sid when present; AUDIT auth.sessions.revoke_others.
pub async fn me_revoke_other_sessions(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, AppError> {
    crate::user_sessions::revoke_all_except_session(
        &state.pool,
        &claims.sub,
        claims.sid.as_deref(),
    )
    .await?;

    audit::write_audit_logged(
        &state.pool,
        Some(&claims.sub),
        "auth.sessions.revoke_others",
        Some("user"),
        Some(&claims.sub),
        None,
        &headers,
    )
    .await;

    Ok(Json(serde_json::json!({ "ok": true })))
}

#[derive(Debug, Serialize)]
pub struct UserProfileResponse {
    pub user: UserProfileDto,
    pub storage: UserProfileStorageDto,
}

#[derive(Debug, Serialize)]
pub struct UserProfileDto {
    pub id: String,
    pub email: String,
    pub role: String,
    pub enabled: bool,
    pub created_at: String,
}

#[derive(Debug, Serialize)]
pub struct UserProfileStorageDto {
    pub instance_name: String,
    pub file_count: i64,
    pub used_bytes: i64,
    pub quota_bytes: i64,
}

#[derive(Debug, Deserialize)]
pub struct ChangePasswordRequest {
    pub current_password: String,
    pub new_password: String,
}

// Human: Rich profile payload for the signed-in user's account page.
// Agent: READS users + files + app_settings; RETURNS account + storage summary JSON.
pub async fn profile(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<UserProfileResponse>, AppError> {
    let row: Option<(String, String, bool, chrono::DateTime<chrono::Utc>)> = sqlx::query_as(
        "SELECT email, role, enabled, created_at FROM users WHERE id = $1",
    )
    .bind(&claims.sub)
    .fetch_optional(&state.pool)
    .await?;

    let (email, role, enabled, created_at) = row.ok_or(AppError::NotFound)?;

    let instance_name: Option<(String,)> =
        sqlx::query_as("SELECT value FROM app_settings WHERE key = 'instance_name'")
            .fetch_optional(&state.pool)
            .await?;

    let stats: (i64, i64) = sqlx::query_as(
        "SELECT COALESCE(COUNT(*), 0), COALESCE(SUM(size_bytes), 0)::BIGINT FROM files WHERE user_id = $1",
    )
    .bind(&claims.sub)
    .fetch_one(&state.pool)
    .await?;

    let quota_bytes = crate::quota::resolve_user_quota_bytes(&state.pool, &claims.sub).await?;

    Ok(Json(UserProfileResponse {
        user: UserProfileDto {
            id: claims.sub,
            email,
            role,
            enabled,
            created_at: created_at.to_rfc3339(),
        },
        storage: UserProfileStorageDto {
            instance_name: instance_name
                .map(|(name,)| name)
                .unwrap_or_else(|| "Ownly".into()),
            file_count: stats.0,
            used_bytes: stats.1,
            quota_bytes,
        },
    }))
}

// Human: Let a signed-in user rotate their own password after verifying the current one.
// Agent: READS users.password_hash; WRITES new hash; AUDIT auth.password_change.
pub async fn change_password(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    headers: HeaderMap,
    Json(body): Json<ChangePasswordRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    if body.new_password.len() < 8 {
        return Err(AppError::BadRequest(
            "password must be at least 8 characters".into(),
        ));
    }

    let row: Option<(String,)> =
        sqlx::query_as("SELECT password_hash FROM users WHERE id = $1")
            .bind(&claims.sub)
            .fetch_optional(&state.pool)
            .await?;
    let (password_hash,) = row.ok_or(AppError::NotFound)?;

    if !verify_password(&body.current_password, &password_hash).unwrap_or(false) {
        return Err(AppError::Unauthorized);
    }

    let next_hash =
        hash_password(&body.new_password).map_err(|e| AppError::Internal(anyhow::anyhow!(e)))?;

    sqlx::query("UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2")
        .bind(&next_hash)
        .bind(&claims.sub)
        .execute(&state.pool)
        .await?;

    // Human: Invalidate all other sessions when the password rotates (SEC-017).
    // Agent: CALLS bump_session_epoch; auth_middleware rejects stale JWT sids/epochs.
    crate::user_sessions::bump_session_epoch(&state.pool, &claims.sub).await?;

    audit::write_audit_required(
        &state.pool,
        Some(&claims.sub),
        "auth.password_change",
        Some("user"),
        Some(&claims.sub),
        None,
        &headers,
    )
    .await?;

    Ok(Json(serde_json::json!({ "ok": true })))
}

// Human: Timing-fill hash for login attempts against unknown emails (SEC-028).
// Agent: LAZY OnceLock; NEVER matches a real user password.
fn dummy_login_hash() -> &'static str {
    static DUMMY: OnceLock<String> = OnceLock::new();
    DUMMY.get_or_init(|| {
        hash_password("ownly-login-timing-fill-not-a-real-account")
            .expect("dummy login hash")
    })
}

// Human: Best-effort session revoke — always clears cookies even when JWT is missing or stale.
// Agent: POST /auth/logout PUBLIC; OPTIONAL decode via decode_token_for_refresh; AUDIT when revoke succeeds.
pub async fn logout(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Response, AppError> {
    if let Some(token) = session_cookie::bearer_or_session_token(&headers) {
        if let Ok(claims) = decode_token_for_refresh(&token, &state.jwt_secret) {
            if let Some(sid) = claims.sid.as_deref() {
                crate::user_sessions::revoke_session_id(&state.pool, &claims.sub, sid).await?;
            }

            audit::write_audit_required(
                &state.pool,
                Some(&claims.sub),
                "auth.logout",
                Some("user"),
                Some(&claims.sub),
                None,
                &headers,
            )
            .await?;
        }
    }

    let session_cookie = session_cookie::session_clear_cookie(&state, &headers)
        .map_err(|e| AppError::Internal(anyhow::anyhow!(e)))?;
    let csrf_cookie = crate::csrf::csrf_clear_cookie(&state, &headers)
        .map_err(|e| AppError::Internal(anyhow::anyhow!(e)))?;
    let legacy_csrf_clear = crate::csrf::csrf_clear_legacy_path_cookie(&state, &headers)
        .map_err(|e| AppError::Internal(anyhow::anyhow!(e)))?;
    Ok((
        AppendHeaders([
            (header::SET_COOKIE, session_cookie),
            (header::SET_COOKIE, csrf_cookie),
            (header::SET_COOKIE, legacy_csrf_clear),
        ]),
        Json(serde_json::json!({ "ok": true })),
    )
        .into_response())
}

// Human: Expose whether public registration is enabled for the login page.
// Agent: READS app_settings allow_public_registration; PUBLIC route.
pub async fn public_registration_setting(
    State(state): State<Arc<AppState>>,
) -> Json<serde_json::Value> {
    let allowed = registration_allowed(&state.pool).await.unwrap_or(false);
    Json(serde_json::json!({ "allow_public_registration": allowed }))
}
