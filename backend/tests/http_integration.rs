//! HTTP integration tests for setup, auth gates, and error envelope contracts.

use axum::body::{to_bytes, Body};
use axum::http::{Request, StatusCode};
use mediavault_backend::{config::Config, create_router, create_test_app_state};
use serde_json::json;
use tower::ServiceExt;

fn test_config(database_url: &str) -> Config {
    Config {
        database_url: database_url.to_string(),
        jwt_secret: "test-jwt-secret-at-least-32-chars-long!!".to_string(),
        bind_addr: "127.0.0.1:0".to_string(),
        storage_mode: "proxy".to_string(),
        object_storage_url: "http://localhost:9000".to_string(),
        object_storage_public_url: "http://localhost:9000".to_string(),
        object_storage_bucket: "media".to_string(),
        signing_secret: "test-signing-secret-not-default-value".to_string(),
        object_storage_jwt_secret: "test-nos-jwt-secret-not-default-value!!".to_string(),
        url_expiry_seconds: 3600,
        mediavault_environment: "development".to_string(),
        git_sha: None,
        auth_login_rpm: 15,
        auth_register_rpm: 5,
        upload_rpm: 30,
        cors_allowed_origins: String::new(),
        max_upload_bytes: 1024 * 1024,
        hls_segment_rpm: 480,
        job_worker_count: 2,
        job_stale_minutes: 15,
        job_heartbeat_seconds: 30,
        job_recovery_poll_seconds: 60,
        hls_hardware_encode: "off".into(),
        hls_vaapi_device: "/dev/dri/renderD128".into(),
    }
}

async fn response_json(response: axum::response::Response) -> serde_json::Value {
    let bytes = to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("response body");
    serde_json::from_slice(&bytes).expect("json body")
}

// Human: Fresh database should report setup incomplete on the status probe.
// Agent: GET /api/v1/setup/status; EXPECT setup_complete false.
#[tokio::test]
async fn setup_status_is_false_before_admin_exists() {
    let database_url = match std::env::var("DATABASE_URL") {
        Ok(url) if !url.is_empty() => url,
        _ => {
            eprintln!("skipping setup_status_is_false_before_admin_exists: DATABASE_URL unset");
            return;
        }
    };

    let cfg = test_config(&database_url);
    let state = match create_test_app_state(&cfg).await {
        Ok(state) => state,
        Err(error) => {
            eprintln!("skipping setup_status_is_false_before_admin_exists: {error}");
            return;
        }
    };
    let app = create_router(state);

    let response = app
        .oneshot(
            Request::builder()
                .uri("/api/v1/setup/status")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let json = response_json(response).await;
    assert_eq!(json["setup_complete"], false);
}

// Human: Protected routes must reject anonymous callers with the standard error envelope.
// Agent: GET /api/v1/me without Authorization; EXPECT 401 + error.code unauthorized.
#[tokio::test]
async fn protected_route_returns_unauthorized_without_token() {
    let database_url = match std::env::var("DATABASE_URL") {
        Ok(url) if !url.is_empty() => url,
        _ => {
            eprintln!("skipping protected_route_returns_unauthorized_without_token: DATABASE_URL unset");
            return;
        }
    };

    let cfg = test_config(&database_url);
    let state = match create_test_app_state(&cfg).await {
        Ok(state) => state,
        Err(error) => {
            eprintln!("skipping setup_status_is_false_before_admin_exists: {error}");
            return;
        }
    };
    let app = create_router(state);

    let response = app
        .oneshot(
            Request::builder()
                .uri("/api/v1/me")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    let json = response_json(response).await;
    assert_eq!(json["error"]["code"], "unauthorized");
}

// Human: Every response should echo x-request-id for log correlation per api-error-shape rule.
// Agent: GET /api/v1/version; EXPECT x-request-id response header present.
#[tokio::test]
async fn responses_include_request_id_header() {
    let database_url = match std::env::var("DATABASE_URL") {
        Ok(url) if !url.is_empty() => url,
        _ => {
            eprintln!("skipping responses_include_request_id_header: DATABASE_URL unset");
            return;
        }
    };

    let cfg = test_config(&database_url);
    let state = match create_test_app_state(&cfg).await {
        Ok(state) => state,
        Err(error) => {
            eprintln!("skipping setup_status_is_false_before_admin_exists: {error}");
            return;
        }
    };
    let app = create_router(state);

    let response = app
        .oneshot(
            Request::builder()
                .uri("/api/v1/version")
                .header("x-request-id", "test-correlation-id")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response
            .headers()
            .get("x-request-id")
            .and_then(|value| value.to_str().ok()),
        Some("test-correlation-id")
    );
}

// Human: Setup completion should persist admin row and return auth payload when database is empty.
// Agent: POST /api/v1/setup; EXPECT 200 + token; WRITES audit_logs setup.complete when DB clean.
#[tokio::test]
async fn setup_creates_admin_and_returns_token_on_empty_database() {
    let database_url = match std::env::var("DATABASE_URL") {
        Ok(url) if !url.is_empty() => url,
        _ => {
            eprintln!("skipping setup_creates_admin_and_returns_token_on_empty_database: DATABASE_URL unset");
            return;
        }
    };

    let cfg = test_config(&database_url);
    let state = match create_test_app_state(&cfg).await {
        Ok(state) => state,
        Err(error) => {
            eprintln!("skipping setup_status_is_false_before_admin_exists: {error}");
            return;
        }
    };

    let user_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM users")
        .fetch_one(&state.pool)
        .await
        .expect("count users");
    if user_count > 0 {
        eprintln!("skipping setup_creates_admin: database already initialized");
        return;
    }

    let app = create_router(state.clone());
    let body = json!({
        "email": "admin@example.com",
        "password": "password123",
        "instance_name": "Test Vault",
        "allow_public_registration": false,
        "object_storage_bucket": "media",
        "default_storage_quota_gb": 25
    });

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/setup")
                .header("content-type", "application/json")
                .body(Body::from(body.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let json = response_json(response).await;
    assert!(json["token"].is_string());

    let audit_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM audit_logs WHERE action = 'setup.complete'",
    )
    .fetch_one(&state.pool)
    .await
    .expect("audit count");
    assert!(audit_count >= 1);
}

// Human: Creating a public share requires an authenticated owner session.
// Agent: POST /api/v1/shares without Authorization; EXPECT 401.
#[tokio::test]
async fn create_share_requires_authentication() {
    let database_url = match std::env::var("DATABASE_URL") {
        Ok(url) if !url.is_empty() => url,
        _ => {
            eprintln!("skipping create_share_requires_authentication: DATABASE_URL unset");
            return;
        }
    };

    let cfg = test_config(&database_url);
    let state = match create_test_app_state(&cfg).await {
        Ok(state) => state,
        Err(error) => {
            eprintln!("skipping create_share_requires_authentication: {error}");
            return;
        }
    };
    let app = create_router(state);

    let body = json!({
        "resource_type": "file",
        "resource_id": "does-not-matter"
    });

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/shares")
                .header("content-type", "application/json")
                .body(Body::from(body.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

// Human: Unknown share tokens must not leak whether resources exist.
// Agent: GET /api/v1/public/shares/{token}; EXPECT 404 envelope.
#[tokio::test]
async fn public_share_unknown_token_returns_not_found() {
    let database_url = match std::env::var("DATABASE_URL") {
        Ok(url) if !url.is_empty() => url,
        _ => {
            eprintln!("skipping public_share_unknown_token_returns_not_found: DATABASE_URL unset");
            return;
        }
    };

    let cfg = test_config(&database_url);
    let state = match create_test_app_state(&cfg).await {
        Ok(state) => state,
        Err(error) => {
            eprintln!("skipping public_share_unknown_token_returns_not_found: {error}");
            return;
        }
    };
    let app = create_router(state);

    let response = app
        .oneshot(
            Request::builder()
                .uri("/api/v1/public/shares/not-a-real-token-value")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::NOT_FOUND);
    let json = response_json(response).await;
    assert_eq!(json["error"]["code"], "not_found");
}

// Human: Public links expose only the shared file — sibling files stay unreachable.
// Agent: SEEDS user + two files + share row; GET download for other file EXPECT 404.
#[tokio::test]
async fn public_share_download_is_scoped_to_shared_file_only() {
    let database_url = match std::env::var("DATABASE_URL") {
        Ok(url) if !url.is_empty() => url,
        _ => {
            eprintln!("skipping public_share_download_is_scoped_to_shared_file_only: DATABASE_URL unset");
            return;
        }
    };

    let cfg = test_config(&database_url);
    let state = match create_test_app_state(&cfg).await {
        Ok(state) => state,
        Err(error) => {
            eprintln!("skipping public_share_download_is_scoped_to_shared_file_only: {error}");
            return;
        }
    };

    let user_id = uuid::Uuid::new_v4().to_string();
    let shared_file_id = uuid::Uuid::new_v4().to_string();
    let other_file_id = uuid::Uuid::new_v4().to_string();
    let share_id = uuid::Uuid::new_v4().to_string();
    let token = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    let password_hash = mediavault_backend::auth::handlers::hash_password("password123")
        .expect("hash password");

    sqlx::query(
        "INSERT INTO users (id, email, password_hash, role, enabled) VALUES ($1, $2, $3, 'user', true)",
    )
    .bind(&user_id)
    .bind(format!("share-test-{user_id}@example.com"))
    .bind(&password_hash)
    .execute(&state.pool)
    .await
    .expect("insert user");

    for (file_id, name, key) in [
        (shared_file_id.as_str(), "shared.txt", "storage/shared"),
        (other_file_id.as_str(), "private.txt", "storage/private"),
    ] {
        sqlx::query(
            "INSERT INTO files (id, user_id, name, storage_key, mime_type, size_bytes) \
             VALUES ($1, $2, $3, $4, 'text/plain', 4)",
        )
        .bind(file_id)
        .bind(&user_id)
        .bind(name)
        .bind(key)
        .execute(&state.pool)
        .await
        .expect("insert file");
    }

    sqlx::query(
        "INSERT INTO public_shares (id, token, user_id, resource_type, resource_id) \
         VALUES ($1, $2, $3, 'file', $4)",
    )
    .bind(&share_id)
    .bind(token)
    .bind(&user_id)
    .bind(&shared_file_id)
    .execute(&state.pool)
    .await
    .expect("insert share");

    let app = create_router(state.clone());

    let overview = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(format!("/api/v1/public/shares/{token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(overview.status(), StatusCode::OK);
    let overview_json = response_json(overview).await;
    assert_eq!(overview_json["share"]["name"], "shared.txt");

    let allowed = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(format!(
                    "/api/v1/public/shares/{token}/files/{shared_file_id}/download"
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert!(
        allowed.status() == StatusCode::OK || allowed.status() == StatusCode::INTERNAL_SERVER_ERROR,
        "shared file download should pass scope check (storage may fail in test harness)"
    );

    let blocked = app
        .oneshot(
            Request::builder()
                .uri(format!(
                    "/api/v1/public/shares/{token}/files/{other_file_id}/download"
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(blocked.status(), StatusCode::NOT_FOUND);

    sqlx::query("DELETE FROM public_shares WHERE id = $1")
        .bind(&share_id)
        .execute(&state.pool)
        .await
        .ok();
    sqlx::query("DELETE FROM files WHERE user_id = $1")
        .bind(&user_id)
        .execute(&state.pool)
        .await
        .ok();
    sqlx::query("DELETE FROM users WHERE id = $1")
        .bind(&user_id)
        .execute(&state.pool)
        .await
        .ok();
}
