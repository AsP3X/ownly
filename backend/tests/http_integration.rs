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
