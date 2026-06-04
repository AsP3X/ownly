// Human: Registration, login, JWT issue/verify, and the /auth/me profile payload.
// Agent: WRITES users table; EMITS JWT Claims; RETURNS AuthResponse JSON; LOGS redacted emails only.

use argon2::{
    password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use axum::{extract::State, http::HeaderMap, Extension, Json};
use chrono::Utc;
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tracing::info;
use uuid::Uuid;

use crate::{audit, error::AppError, rate_limit, redact, AppState};

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
    let now = Utc::now();
    let claims = Claims {
        sub: user_id,
        email,
        role,
        iat: now.timestamp(),
        exp: (now + chrono::Duration::try_hours(24).unwrap()).timestamp(),
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
    Ok(decode::<Claims>(
        token,
        &DecodingKey::from_secret(secret.as_bytes()),
        &Validation::default(),
    )?
    .claims)
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
) -> Result<Json<AuthResponse>, AppError> {
    crate::browser_guard::require_browser_user_creation(&headers)?;
    rate_limit::enforce(&state.auth_register_rl, &rate_limit::client_ip_from_headers(&headers))?;
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

    let session_id = audit::write_audit(
        &state.pool,
        Some(&user_id),
        "auth.register",
        Some("user"),
        Some(&user_id),
        None,
        &headers,
    )
    .await
    .ok();

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

    Ok(Json(AuthResponse {
        token,
        pending_activation: needs_activation,
        user: UserDto {
            id: user_id,
            email,
            role: "user".into(),
            enabled,
        },
    }))
}

// Human: Validate credentials and return a JWT for enabled accounts.
// Agent: READS users by email; WRITES audit auth.login; RETURNS 401 on bad credentials.
pub async fn login(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<LoginRequest>,
) -> Result<Json<AuthResponse>, AppError> {
    rate_limit::enforce(&state.auth_login_rl, &rate_limit::client_ip_from_headers(&headers))?;
    let email = body.email.trim().to_lowercase();

    let row: Option<(String, String, String, bool)> = sqlx::query_as(
        "SELECT id, password_hash, role, enabled FROM users WHERE email = $1",
    )
    .bind(&email)
    .fetch_optional(&state.pool)
    .await?;

    let (user_id, password_hash, role, enabled) = row.ok_or(AppError::Unauthorized)?;
    if !verify_password(&body.password, &password_hash).unwrap_or(false) {
        return Err(AppError::Unauthorized);
    }
    if !enabled {
        return Err(AppError::Forbidden(
            "account is not activated. Contact an administrator.".into(),
        ));
    }

    let session_id = audit::write_audit(
        &state.pool,
        Some(&user_id),
        "auth.login",
        Some("user"),
        Some(&user_id),
        None,
        &headers,
    )
    .await
    .ok();

    let session_version = crate::user_sessions::load_session_epoch(&state.pool, &user_id).await?;
    let token = create_token(
        user_id.clone(),
        email.clone(),
        role.clone(),
        &state.jwt_secret,
        session_id,
        session_version,
    )
    .map_err(AppError::Internal)?;

    Ok(Json(AuthResponse {
        token: Some(token),
        pending_activation: false,
        user: UserDto {
            id: user_id,
            email,
            role,
            enabled,
        },
    }))
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

// Human: Expose whether public registration is enabled for the login page.
// Agent: READS app_settings allow_public_registration; PUBLIC route.
pub async fn public_registration_setting(
    State(state): State<Arc<AppState>>,
) -> Json<serde_json::Value> {
    let allowed = registration_allowed(&state.pool).await.unwrap_or(false);
    Json(serde_json::json!({ "allow_public_registration": allowed }))
}
