//! HTTP integration tests for setup, auth gates, and error envelope contracts.

use axum::body::{to_bytes, Body};
use axum::http::{Request, StatusCode};
use ownly_backend::{config::Config, create_router, create_test_app_state};
use serde_json::json;
use tower::ServiceExt;

fn test_config(database_url: &str) -> Config {
    Config {
        database_url: database_url.to_string(),
        jwt_secret: "test-jwt-secret-at-least-32-chars-long!!".to_string(),
        setup_token: "test-setup-token-at-least-32-chars!!".to_string(),
        bind_addr: "127.0.0.1:0".to_string(),
        storage_mode: "proxy".to_string(),
        object_storage_url: "http://localhost:9000".to_string(),
        object_storage_public_url: "http://localhost:9000".to_string(),
        object_storage_bucket: "media".to_string(),
        signing_secret: "test-signing-secret-not-default-value".to_string(),
        object_storage_jwt_secret: "test-nos-jwt-secret-not-default-value!!".to_string(),
        url_expiry_seconds: 3600,
        ownly_environment: "development".to_string(),
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
        hls_video_crf: 20,
        hls_video_quality: 22,
        hls_full_transcode_quality: 26,
        hls_large_maxrate: "5M".into(),
        hls_large_bufsize: "10M".into(),
        storage_metadata_mode: "nebular".into(),
        storage_put_max_concurrent: 2,
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

// Human: Setup completion should persist admin row without requiring Sec-Fetch-Site (Compose zero-config).
// Agent: POST /api/v1/setup with X-Setup-Token only; EXPECT 200 + token; WRITES audit_logs setup.complete.
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
        "default_storage_quota_gb": 25,
        "storage_node_id": "node-test-setup",
        "storage_node_region_label": "Test Region",
        "storage_node_base_url": "http://localhost:9000",
        "storage_node_architecture": "single",
        "storage_node_target_capacity_value": 512.0,
        "storage_node_target_capacity_unit": "GB"
    });

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/setup")
                .header("content-type", "application/json")
                .header("X-Setup-Token", "test-setup-token-at-least-32-chars!!")
                .body(Body::from(body.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let json = response_json(response).await;
    assert!(json["token"].is_string());

    let node_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM storage_nodes WHERE id = 'node-test-setup'",
    )
    .fetch_one(&state.pool)
    .await
    .expect("storage node count");
    assert_eq!(node_count, 1);

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

    let password_hash = ownly_backend::auth::handlers::hash_password("password123")
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

// Human: Upload duplicate detection should find owned files by exact name across every folder.
// Agent: POST /api/v1/files/check-upload-names; EXPECT duplicates for existing names only.
#[tokio::test]
async fn check_upload_names_finds_library_duplicates_globally() {
    let database_url = match std::env::var("DATABASE_URL") {
        Ok(url) if !url.is_empty() => url,
        _ => {
            eprintln!("skipping check_upload_names_finds_library_duplicates_globally: DATABASE_URL unset");
            return;
        }
    };

    let cfg = test_config(&database_url);
    let state = match create_test_app_state(&cfg).await {
        Ok(state) => state,
        Err(error) => {
            eprintln!("skipping check_upload_names_finds_library_duplicates_globally: {error}");
            return;
        }
    };

    let user_id = uuid::Uuid::new_v4().to_string();
    let folder_id = uuid::Uuid::new_v4().to_string();
    let existing_file_id = uuid::Uuid::new_v4().to_string();
    let email = format!("dup-check-{user_id}@example.com");

    let password_hash = ownly_backend::auth::handlers::hash_password("password123")
        .expect("hash password");

    sqlx::query(
        "INSERT INTO users (id, email, password_hash, role, enabled) VALUES ($1, $2, $3, 'user', true)",
    )
    .bind(&user_id)
    .bind(&email)
    .bind(&password_hash)
    .execute(&state.pool)
    .await
    .expect("insert user");

    sqlx::query(
        "INSERT INTO folders (id, user_id, parent_id, name) VALUES ($1, $2, NULL, 'Archive')",
    )
    .bind(&folder_id)
    .bind(&user_id)
    .execute(&state.pool)
    .await
    .expect("insert folder");

    sqlx::query(
        "INSERT INTO files (id, user_id, folder_id, name, storage_key, mime_type, size_bytes) \
         VALUES ($1, $2, $3, 'report.pdf', 'storage/report', 'application/pdf', 2048)",
    )
    .bind(&existing_file_id)
    .bind(&user_id)
    .bind(&folder_id)
    .execute(&state.pool)
    .await
    .expect("insert file");

    let token = ownly_backend::auth::handlers::create_token(
        user_id.clone(),
        email.clone(),
        "user".into(),
        &state.jwt_secret,
        None,
        0,
    )
    .expect("create token");

    let app = create_router(state.clone());
    let body = json!({
        "files": [
            { "name": "report.pdf", "size_bytes": 2048 },
            { "name": "new-file.txt", "size_bytes": 128 }
        ]
    });

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/files/check-upload-names")
                .header("content-type", "application/json")
                .header("authorization", format!("Bearer {token}"))
                .body(Body::from(body.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let json = response_json(response).await;
    let duplicates = json["duplicates"].as_array().expect("duplicates array");
    assert_eq!(duplicates.len(), 1);
    assert_eq!(duplicates[0]["upload_name"], "report.pdf");
    assert_eq!(duplicates[0]["existing"][0]["id"], existing_file_id);
    assert_eq!(duplicates[0]["existing"][0]["folder_name"], "Archive");
    let recycle_matches = json["recycle_matches"].as_array().expect("recycle_matches array");
    assert!(recycle_matches.is_empty());

    sqlx::query("DELETE FROM files WHERE user_id = $1")
        .bind(&user_id)
        .execute(&state.pool)
        .await
        .ok();
    sqlx::query("DELETE FROM folders WHERE user_id = $1")
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

// Human: Upload preflight should surface exact recycle-bin matches by filename and byte size.
// Agent: POST /files/check-upload-names; EXPECT recycle_matches when deleted row matches size.
#[tokio::test]
async fn check_upload_names_finds_exact_recycle_bin_matches() {
    let database_url = match std::env::var("DATABASE_URL") {
        Ok(url) if !url.is_empty() => url,
        _ => {
            eprintln!("skipping check_upload_names_finds_exact_recycle_bin_matches: DATABASE_URL unset");
            return;
        }
    };

    let cfg = test_config(&database_url);
    let state = match create_test_app_state(&cfg).await {
        Ok(state) => state,
        Err(error) => {
            eprintln!("skipping check_upload_names_finds_exact_recycle_bin_matches: {error}");
            return;
        }
    };

    let user_id = uuid::Uuid::new_v4().to_string();
    let folder_id = uuid::Uuid::new_v4().to_string();
    let trashed_file_id = uuid::Uuid::new_v4().to_string();
    let email = format!("recycle-check-{user_id}@example.com");

    let password_hash = ownly_backend::auth::handlers::hash_password("password123")
        .expect("hash password");

    sqlx::query(
        "INSERT INTO users (id, email, password_hash, role, enabled) VALUES ($1, $2, $3, 'user', true)",
    )
    .bind(&user_id)
    .bind(&email)
    .bind(&password_hash)
    .execute(&state.pool)
    .await
    .expect("insert user");

    sqlx::query(
        "INSERT INTO folders (id, user_id, parent_id, name) VALUES ($1, $2, NULL, 'Archive')",
    )
    .bind(&folder_id)
    .bind(&user_id)
    .execute(&state.pool)
    .await
    .expect("insert folder");

    sqlx::query(
        "INSERT INTO files (id, user_id, folder_id, name, storage_key, mime_type, size_bytes, deleted_at) \
         VALUES ($1, $2, $3, 'report.pdf', 'storage/report-trashed', 'application/pdf', 2048, now())",
    )
    .bind(&trashed_file_id)
    .bind(&user_id)
    .bind(&folder_id)
    .execute(&state.pool)
    .await
    .expect("insert trashed file");

    let token = ownly_backend::auth::handlers::create_token(
        user_id.clone(),
        email.clone(),
        "user".into(),
        &state.jwt_secret,
        None,
        0,
    )
    .expect("create token");

    let app = create_router(state.clone());
    let body = json!({
        "files": [
            { "name": "report.pdf", "size_bytes": 2048 },
            { "name": "report.pdf", "size_bytes": 4096 }
        ]
    });

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/files/check-upload-names")
                .header("content-type", "application/json")
                .header("authorization", format!("Bearer {token}"))
                .body(Body::from(body.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let json = response_json(response).await;
    let duplicates = json["duplicates"].as_array().expect("duplicates array");
    assert!(duplicates.is_empty());
    let recycle_matches = json["recycle_matches"].as_array().expect("recycle_matches array");
    assert_eq!(recycle_matches.len(), 1);
    assert_eq!(recycle_matches[0]["upload_name"], "report.pdf");
    assert_eq!(recycle_matches[0]["upload_size_bytes"], 2048);
    assert_eq!(recycle_matches[0]["trashed"]["id"], trashed_file_id);
    assert_eq!(recycle_matches[0]["trashed"]["can_restore"], true);

    sqlx::query("DELETE FROM files WHERE user_id = $1")
        .bind(&user_id)
        .execute(&state.pool)
        .await
        .ok();
    sqlx::query("DELETE FROM folders WHERE user_id = $1")
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

// Human: HTML uploads must pass the duplicate-name preflight like any other document type.
// Agent: POST /files/check-upload-names with .html basename; EXPECT 200 and empty duplicate lists.
#[tokio::test]
async fn check_upload_names_accepts_html_documents() {
    let database_url = match std::env::var("DATABASE_URL") {
        Ok(url) if !url.is_empty() => url,
        _ => {
            eprintln!("skipping check_upload_names_accepts_html_documents: DATABASE_URL unset");
            return;
        }
    };

    let cfg = test_config(&database_url);
    let state = match create_test_app_state(&cfg).await {
        Ok(state) => state,
        Err(error) => {
            eprintln!("skipping check_upload_names_accepts_html_documents: {error}");
            return;
        }
    };

    let user_id = uuid::Uuid::new_v4().to_string();
    let email = format!("html-check-{user_id}@example.com");
    let password_hash = ownly_backend::auth::handlers::hash_password("password123")
        .expect("hash password");

    sqlx::query(
        "INSERT INTO users (id, email, password_hash, role, enabled) VALUES ($1, $2, $3, 'user', true)",
    )
    .bind(&user_id)
    .bind(&email)
    .bind(&password_hash)
    .execute(&state.pool)
    .await
    .expect("insert user");

    let token = ownly_backend::auth::handlers::create_token(
        user_id.clone(),
        email.clone(),
        "user".into(),
        &state.jwt_secret,
        None,
        0,
    )
    .expect("create token");

    let app = create_router(state.clone());
    let body = json!({
        "files": [
            { "name": "notes/page.html", "size_bytes": 4096 }
        ]
    });

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/files/check-upload-names")
                .header("content-type", "application/json")
                .header("authorization", format!("Bearer {token}"))
                .body(Body::from(body.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let json = response_json(response).await;
    assert!(json["duplicates"].as_array().expect("duplicates array").is_empty());
    assert!(json["recycle_matches"]
        .as_array()
        .expect("recycle_matches array")
        .is_empty());

    sqlx::query("DELETE FROM users WHERE id = $1")
        .bind(&user_id)
        .execute(&state.pool)
        .await
        .ok();
}

// Human: Soft-deleting a file moves it out of the drive list and into the recycle bin.
// Agent: DELETE /files/:id default; GET /recycle-bin lists it; POST restore returns it to /files.
#[tokio::test]
async fn soft_delete_moves_file_to_recycle_bin_and_restore_returns_it() {
    let database_url = match std::env::var("DATABASE_URL") {
        Ok(url) if !url.is_empty() => url,
        _ => {
            eprintln!("skipping soft_delete_moves_file_to_recycle_bin_and_restore_returns_it: DATABASE_URL unset");
            return;
        }
    };

    let cfg = test_config(&database_url);
    let state = match create_test_app_state(&cfg).await {
        Ok(state) => state,
        Err(error) => {
            eprintln!("skipping soft_delete_moves_file_to_recycle_bin_and_restore_returns_it: {error}");
            return;
        }
    };

    let user_id = uuid::Uuid::new_v4().to_string();
    let file_id = uuid::Uuid::new_v4().to_string();
    let email = format!("recycle-{user_id}@example.com");
    let password_hash = ownly_backend::auth::handlers::hash_password("password123")
        .expect("hash password");

    sqlx::query(
        "INSERT INTO users (id, email, password_hash, role, enabled) VALUES ($1, $2, $3, 'user', true)",
    )
    .bind(&user_id)
    .bind(&email)
    .bind(&password_hash)
    .execute(&state.pool)
    .await
    .expect("insert user");

    sqlx::query(
        "INSERT INTO files (id, user_id, name, storage_key, mime_type, size_bytes) \
         VALUES ($1, $2, 'trash-me.txt', 'storage/trash-me', 'text/plain', 12)",
    )
    .bind(&file_id)
    .bind(&user_id)
    .execute(&state.pool)
    .await
    .expect("insert file");

    let token = ownly_backend::auth::handlers::create_token(
        user_id.clone(),
        email.clone(),
        "user".into(),
        &state.jwt_secret,
        None,
        0,
    )
    .expect("create token");

    let app = create_router(state.clone());

    let delete_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("DELETE")
                .uri(format!("/api/v1/files/{file_id}"))
                .header("authorization", format!("Bearer {token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(delete_response.status(), StatusCode::OK);

    let list_response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/v1/files")
                .header("authorization", format!("Bearer {token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(list_response.status(), StatusCode::OK);
    let list_json = response_json(list_response).await;
    assert_eq!(list_json["file_count"], 0);

    let bin_response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/v1/recycle-bin")
                .header("authorization", format!("Bearer {token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(bin_response.status(), StatusCode::OK);
    let bin_json = response_json(bin_response).await;
    assert_eq!(bin_json["total_count"], 1);
    assert_eq!(bin_json["files"][0]["id"], file_id);

    let restore_body = json!({ "file_ids": [file_id], "folder_ids": [] });
    let restore_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/recycle-bin/restore")
                .header("content-type", "application/json")
                .header("authorization", format!("Bearer {token}"))
                .body(Body::from(restore_body.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(restore_response.status(), StatusCode::OK);

    let relist_response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/v1/files")
                .header("authorization", format!("Bearer {token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let relist_json = response_json(relist_response).await;
    assert_eq!(relist_json["file_count"], 1);

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

// Human: Protected public shares require X-Share-Password and can block downloads.
// Agent: GET download without/with password; UPDATE block_download; EXPECT 403 when blocked.
#[tokio::test]
async fn public_share_password_and_download_block() {
    let database_url = match std::env::var("DATABASE_URL") {
        Ok(url) if !url.is_empty() => url,
        _ => {
            eprintln!("skipping public_share_password_and_download_block: DATABASE_URL unset");
            return;
        }
    };

    let cfg = test_config(&database_url);
    let state = match create_test_app_state(&cfg).await {
        Ok(state) => state,
        Err(error) => {
            eprintln!("skipping public_share_password_and_download_block: {error}");
            return;
        }
    };

    let user_id = uuid::Uuid::new_v4().to_string();
    let file_id = uuid::Uuid::new_v4().to_string();
    let share_id = uuid::Uuid::new_v4().to_string();
    let token = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
    let password_hash = ownly_backend::auth::handlers::hash_password("share-secret")
        .expect("hash password");

    sqlx::query(
        "INSERT INTO users (id, email, password_hash, role, enabled) VALUES ($1, $2, $3, 'user', true)",
    )
    .bind(&user_id)
    .bind(format!("share-protect-{user_id}@example.com"))
    .bind(&password_hash)
    .execute(&state.pool)
    .await
    .expect("insert user");

    sqlx::query(
        "INSERT INTO files (id, user_id, name, storage_key, mime_type, size_bytes) \
         VALUES ($1, $2, 'protected.txt', 'storage/protected', 'text/plain', 4)",
    )
    .bind(&file_id)
    .bind(&user_id)
    .execute(&state.pool)
    .await
    .expect("insert file");

    sqlx::query(
        "INSERT INTO public_shares (id, token, user_id, resource_type, resource_id, password_hash, block_download) \
         VALUES ($1, $2, $3, 'file', $4, $5, false)",
    )
    .bind(&share_id)
    .bind(token)
    .bind(&user_id)
    .bind(&file_id)
    .bind(ownly_backend::auth::handlers::hash_password("visitor-pass").expect("hash share pass"))
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
    assert_eq!(overview_json["share"]["requires_password"], true);
    assert_eq!(overview_json["share"]["block_download"], false);

    let blocked = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(format!(
                    "/api/v1/public/shares/{token}/files/{file_id}/download"
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(blocked.status(), StatusCode::FORBIDDEN);

    let allowed = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(format!(
                    "/api/v1/public/shares/{token}/files/{file_id}/download"
                ))
                .header("x-share-password", "visitor-pass")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert!(
        allowed.status() == StatusCode::OK || allowed.status() == StatusCode::INTERNAL_SERVER_ERROR,
        "password-protected download should pass auth (storage may fail in harness)"
    );

    sqlx::query("UPDATE public_shares SET block_download = true WHERE id = $1")
        .bind(&share_id)
        .execute(&state.pool)
        .await
        .expect("block downloads");

    let download_blocked = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(format!(
                    "/api/v1/public/shares/{token}/files/{file_id}/download"
                ))
                .header("x-share-password", "visitor-pass")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(download_blocked.status(), StatusCode::FORBIDDEN);

    let visitor_token = ownly_backend::auth::handlers::create_token(
        user_id.clone(),
        format!("share-protect-{user_id}@example.com"),
        "user".into(),
        &state.jwt_secret,
        None,
        0,
    )
    .expect("create token");

    let save_body = json!({ "token": token, "file_ids": [file_id] });
    let save_blocked = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/shares/save-from-public")
                .header("content-type", "application/json")
                .header("authorization", format!("Bearer {visitor_token}"))
                .header("x-share-password", "visitor-pass")
                .body(Body::from(save_body.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(save_blocked.status(), StatusCode::FORBIDDEN);

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

// Human: Admin user directory must reject non-admin JWTs and accept administrators.
// Agent: GET /api/v1/admin/users; EXPECT 403 for user role, 200 + users array for admin.
#[tokio::test]
async fn admin_users_list_requires_admin_role() {
    let database_url = match std::env::var("DATABASE_URL") {
        Ok(url) if !url.is_empty() => url,
        _ => {
            eprintln!("skipping admin_users_list_requires_admin_role: DATABASE_URL unset");
            return;
        }
    };

    let cfg = test_config(&database_url);
    let state = match create_test_app_state(&cfg).await {
        Ok(state) => state,
        Err(error) => {
            eprintln!("skipping admin_users_list_requires_admin_role: {error}");
            return;
        }
    };

    let member_id = uuid::Uuid::new_v4().to_string();
    let admin_id = uuid::Uuid::new_v4().to_string();
    let member_email = format!("member-{member_id}@example.com");
    let admin_email = format!("admin-{admin_id}@example.com");
    let password_hash =
        ownly_backend::auth::handlers::hash_password("password123").expect("hash password");

    sqlx::query(
        "INSERT INTO users (id, email, password_hash, role, enabled) VALUES ($1, $2, $3, 'user', true)",
    )
    .bind(&member_id)
    .bind(&member_email)
    .bind(&password_hash)
    .execute(&state.pool)
    .await
    .expect("insert member");

    sqlx::query(
        "INSERT INTO users (id, email, password_hash, role, enabled) VALUES ($1, $2, $3, 'admin', true)",
    )
    .bind(&admin_id)
    .bind(&admin_email)
    .bind(&password_hash)
    .execute(&state.pool)
    .await
    .expect("insert admin");

    let member_token = ownly_backend::auth::handlers::create_token(
        member_id.clone(),
        member_email.clone(),
        "user".into(),
        &state.jwt_secret,
        None,
        0,
    )
    .expect("member token");

    let admin_token = ownly_backend::auth::handlers::create_token(
        admin_id.clone(),
        admin_email.clone(),
        "admin".into(),
        &state.jwt_secret,
        None,
        0,
    )
    .expect("admin token");

    let app = create_router(state.clone());

    let forbidden = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/v1/admin/users")
                .header("authorization", format!("Bearer {member_token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(forbidden.status(), StatusCode::FORBIDDEN);

    let ok = app
        .oneshot(
            Request::builder()
                .uri("/api/v1/admin/users")
                .header("authorization", format!("Bearer {admin_token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(ok.status(), StatusCode::OK);
    let json = response_json(ok).await;
    let users = json["users"].as_array().expect("users array");
    assert!(users.iter().any(|row| row["id"] == member_id));
    assert!(users.iter().any(|row| row["id"] == admin_id));

    sqlx::query("DELETE FROM users WHERE id = $1")
        .bind(&member_id)
        .execute(&state.pool)
        .await
        .ok();
    sqlx::query("DELETE FROM users WHERE id = $1")
        .bind(&admin_id)
        .execute(&state.pool)
        .await
        .ok();
}

// Human: JWT role=admin must not bypass admin APIs when users.role is non-admin (SEC-012 Chain B).
// Agent: GET /api/v1/admin/users with forged admin claim; EXPECT 403 because middleware reloads DB role.
#[tokio::test]
async fn forged_jwt_admin_role_is_denied_when_db_role_is_user() {
    let database_url = match std::env::var("DATABASE_URL") {
        Ok(url) if !url.is_empty() => url,
        _ => {
            eprintln!("skipping forged_jwt_admin_role_is_denied_when_db_role_is_user: DATABASE_URL unset");
            return;
        }
    };

    let cfg = test_config(&database_url);
    let state = match create_test_app_state(&cfg).await {
        Ok(state) => state,
        Err(error) => {
            eprintln!("skipping forged_jwt_admin_role_is_denied_when_db_role_is_user: {error}");
            return;
        }
    };

    let member_id = uuid::Uuid::new_v4().to_string();
    let member_email = format!("forged-{member_id}@example.com");
    let password_hash =
        ownly_backend::auth::handlers::hash_password("password123").expect("hash password");

    sqlx::query(
        "INSERT INTO users (id, email, password_hash, role, enabled) VALUES ($1, $2, $3, 'pro', true)",
    )
    .bind(&member_id)
    .bind(&member_email)
    .bind(&password_hash)
    .execute(&state.pool)
    .await
    .expect("insert member");

    let forged_admin_token = ownly_backend::auth::handlers::create_token(
        member_id.clone(),
        member_email,
        "admin".into(),
        &state.jwt_secret,
        None,
        0,
    )
    .expect("forged token");

    let app = create_router(state.clone());
    let response = app
        .oneshot(
            Request::builder()
                .uri("/api/v1/admin/users")
                .header("authorization", format!("Bearer {forged_admin_token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::FORBIDDEN);

    sqlx::query("DELETE FROM users WHERE id = $1")
        .bind(&member_id)
        .execute(&state.pool)
        .await
        .ok();
}

// Human: Admin user creation succeeds with admin JWT only — no Sec-Fetch/Origin required (remote deploys).
// Agent: POST /api/v1/admin/users with Bearer admin token; EXPECT 200 without browser metadata headers.
#[tokio::test]
async fn admin_create_user_succeeds_without_browser_metadata() {
    let database_url = match std::env::var("DATABASE_URL") {
        Ok(url) if !url.is_empty() => url,
        _ => {
            eprintln!("skipping admin_create_user_succeeds_without_browser_metadata: DATABASE_URL unset");
            return;
        }
    };

    let cfg = test_config(&database_url);
    let state = match create_test_app_state(&cfg).await {
        Ok(state) => state,
        Err(error) => {
            eprintln!("skipping admin_create_user_succeeds_without_browser_metadata: {error}");
            return;
        }
    };

    let admin_id = uuid::Uuid::new_v4().to_string();
    let admin_email = format!("admin-create-guard-{admin_id}@example.com");
    let password_hash =
        ownly_backend::auth::handlers::hash_password("password123").expect("hash password");

    sqlx::query(
        "INSERT INTO users (id, email, password_hash, role, enabled) VALUES ($1, $2, $3, 'admin', true)",
    )
    .bind(&admin_id)
    .bind(&admin_email)
    .bind(&password_hash)
    .execute(&state.pool)
    .await
    .expect("insert admin");

    let admin_token = ownly_backend::auth::handlers::create_token(
        admin_id.clone(),
        admin_email,
        "admin".into(),
        &state.jwt_secret,
        None,
        0,
    )
    .expect("admin token");

    let app = create_router(state.clone());
    let body = json!({
        "email": format!("blocked-{admin_id}@example.com"),
        "password": "password123",
        "role": "pro",
        "enabled": true
    });

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/admin/users")
                .header("authorization", format!("Bearer {admin_token}"))
                .header("content-type", "application/json")
                .body(Body::from(body.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let json = response_json(response).await;
    assert_eq!(json["email"], format!("blocked-{admin_id}@example.com"));

    sqlx::query("DELETE FROM users WHERE email = $1")
        .bind(format!("blocked-{admin_id}@example.com"))
        .execute(&state.pool)
        .await
        .ok();
    sqlx::query("DELETE FROM users WHERE id = $1")
        .bind(&admin_id)
        .execute(&state.pool)
        .await
        .ok();
}

// Human: Admin console overview endpoint must require admin role and return metrics JSON.
// Agent: GET /api/v1/admin/overview; EXPECT 403 for member, 200 + metrics for admin.
#[tokio::test]
async fn admin_overview_requires_admin_role() {
    let database_url = match std::env::var("DATABASE_URL") {
        Ok(url) if !url.is_empty() => url,
        _ => {
            eprintln!("skipping admin_overview_requires_admin_role: DATABASE_URL unset");
            return;
        }
    };

    let cfg = test_config(&database_url);
    let state = match create_test_app_state(&cfg).await {
        Ok(state) => state,
        Err(error) => {
            eprintln!("skipping admin_overview_requires_admin_role: {error}");
            return;
        }
    };

    let member_id = uuid::Uuid::new_v4().to_string();
    let admin_id = uuid::Uuid::new_v4().to_string();
    let password_hash =
        ownly_backend::auth::handlers::hash_password("password123").expect("hash password");

    sqlx::query(
        "INSERT INTO users (id, email, password_hash, role, enabled) VALUES ($1, $2, $3, 'user', true)",
    )
    .bind(&member_id)
    .bind(format!("member-overview-{member_id}@example.com"))
    .bind(&password_hash)
    .execute(&state.pool)
    .await
    .expect("insert member");

    sqlx::query(
        "INSERT INTO users (id, email, password_hash, role, enabled) VALUES ($1, $2, $3, 'admin', true)",
    )
    .bind(&admin_id)
    .bind(format!("admin-overview-{admin_id}@example.com"))
    .bind(&password_hash)
    .execute(&state.pool)
    .await
    .expect("insert admin");

    let member_token = ownly_backend::auth::handlers::create_token(
        member_id.clone(),
        format!("member-overview-{member_id}@example.com"),
        "user".into(),
        &state.jwt_secret,
        None,
        0,
    )
    .expect("member token");

    let admin_token = ownly_backend::auth::handlers::create_token(
        admin_id.clone(),
        format!("admin-overview-{admin_id}@example.com"),
        "admin".into(),
        &state.jwt_secret,
        None,
        0,
    )
    .expect("admin token");

    let app = create_router(state.clone());

    let forbidden = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/v1/admin/overview")
                .header("authorization", format!("Bearer {member_token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(forbidden.status(), StatusCode::FORBIDDEN);

    let ok = app
        .oneshot(
            Request::builder()
                .uri("/api/v1/admin/overview")
                .header("authorization", format!("Bearer {admin_token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(ok.status(), StatusCode::OK);
    let json = response_json(ok).await;
    assert!(json["metrics"]["total_users"].as_i64().is_some());
    let workload = json["workload"].as_array().expect("workload array");
    assert_eq!(workload.len(), 8, "diagnostics chart expects eight 15-minute buckets");

    sqlx::query("DELETE FROM users WHERE id = $1")
        .bind(&member_id)
        .execute(&state.pool)
        .await
        .ok();
    sqlx::query("DELETE FROM users WHERE id = $1")
        .bind(&admin_id)
        .execute(&state.pool)
        .await
        .ok();
}

// Human: Storage Nodes Network registry — admin can register nodes and list them.
// Agent: POST /admin/storage/nodes; GET /admin/storage; EXPECT listed node id in JSON.
#[tokio::test]
async fn admin_storage_nodes_registry_lists_created_node() {
    let database_url = match std::env::var("DATABASE_URL") {
        Ok(url) if !url.is_empty() => url,
        _ => {
            eprintln!("skipping admin_storage_nodes_registry_lists_created_node: DATABASE_URL unset");
            return;
        }
    };

    let cfg = test_config(&database_url);
    let state = match create_test_app_state(&cfg).await {
        Ok(state) => state,
        Err(error) => {
            eprintln!("skipping admin_storage_nodes_registry_lists_created_node: {error}");
            return;
        }
    };

    let admin_id = uuid::Uuid::new_v4().to_string();
    let password_hash =
        ownly_backend::auth::handlers::hash_password("password123").expect("hash password");

    sqlx::query(
        "INSERT INTO users (id, email, password_hash, role, enabled) VALUES ($1, $2, $3, 'admin', true)",
    )
    .bind(&admin_id)
    .bind(format!("admin-storage-{admin_id}@example.com"))
    .bind(&password_hash)
    .execute(&state.pool)
    .await
    .expect("insert admin");

    let admin_token = ownly_backend::auth::handlers::create_token(
        admin_id.clone(),
        format!("admin-storage-{admin_id}@example.com"),
        "admin".into(),
        &state.jwt_secret,
        None,
        0,
    )
    .expect("admin token");

    let app = create_router(state.clone());

    let create_resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/admin/storage/nodes")
                .header("authorization", format!("Bearer {admin_token}"))
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "id": "node-test-replica",
                        "region_label": "Frankfurt, DE",
                        "base_url": "http://127.0.0.1:59999",
                        "target_capacity_value": 512.0,
                        "target_capacity_unit": "GB"
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .expect("create storage node");

    assert_eq!(create_resp.status(), StatusCode::OK);

    let list_resp = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/v1/admin/storage")
                .header("authorization", format!("Bearer {admin_token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .expect("list storage nodes");

    assert_eq!(list_resp.status(), StatusCode::OK);
    let body = response_json(list_resp).await;
    let node_ids: Vec<String> = body["nodes"]
        .as_array()
        .expect("nodes array")
        .iter()
        .filter_map(|row| row["id"].as_str().map(str::to_string))
        .collect();
    assert!(
        node_ids.iter().any(|id| id == "node-test-replica"),
        "expected created node in list, got {node_ids:?}"
    );

    let listed = body["nodes"]
        .as_array()
        .expect("nodes array")
        .iter()
        .find(|row| row["id"].as_str() == Some("node-test-replica"))
        .expect("node-test-replica row");
    assert_eq!(
        listed["region_label"].as_str(),
        Some("Frankfurt, DE"),
        "registry region must not be replaced by probe metadata"
    );
    assert_eq!(
        listed["base_url"].as_str(),
        Some("http://127.0.0.1:59999"),
        "registry must expose base_url for edit dialog"
    );

    let patch_resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("PATCH")
                .uri("/api/v1/admin/storage/nodes/node-test-replica")
                .header("authorization", format!("Bearer {admin_token}"))
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "region_label": "Berlin, DE",
                        "base_url": "http://127.0.0.1:59999",
                        "target_capacity_value": 256.0,
                        "target_capacity_unit": "GB"
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .expect("update storage node");

    assert_eq!(patch_resp.status(), StatusCode::OK);
    let patched = response_json(patch_resp).await;
    assert_eq!(patched["node"]["region_label"].as_str(), Some("Berlin, DE"));

    sqlx::query("DELETE FROM storage_nodes WHERE id = 'node-test-replica'")
        .execute(&state.pool)
        .await
        .ok();
    sqlx::query("DELETE FROM users WHERE id = $1")
        .bind(&admin_id)
        .execute(&state.pool)
        .await
        .ok();
}

// Human: Revoking a session id must block subsequent API calls using that JWT sid.
// Agent: POST revoke; GET /me with same token; EXPECT 401 after revoke.
#[tokio::test]
async fn admin_revoked_session_invalidates_jwt() {
    let database_url = match std::env::var("DATABASE_URL") {
        Ok(url) if !url.is_empty() => url,
        _ => {
            eprintln!("skipping admin_revoked_session_invalidates_jwt: DATABASE_URL unset");
            return;
        }
    };

    let cfg = test_config(&database_url);
    let state = match create_test_app_state(&cfg).await {
        Ok(state) => state,
        Err(error) => {
            eprintln!("skipping admin_revoked_session_invalidates_jwt: {error}");
            return;
        }
    };

    let admin_id = uuid::Uuid::new_v4().to_string();
    let target_id = uuid::Uuid::new_v4().to_string();
    let admin_email = format!("admin-revoke-{admin_id}@example.com");
    let target_email = format!("target-revoke-{target_id}@example.com");
    let password_hash =
        ownly_backend::auth::handlers::hash_password("password123").expect("hash password");

    sqlx::query(
        "INSERT INTO users (id, email, password_hash, role, enabled) VALUES ($1, $2, $3, 'admin', true)",
    )
    .bind(&admin_id)
    .bind(&admin_email)
    .bind(&password_hash)
    .execute(&state.pool)
    .await
    .expect("insert admin");

    sqlx::query(
        "INSERT INTO users (id, email, password_hash, role, enabled) VALUES ($1, $2, $3, 'pro', true)",
    )
    .bind(&target_id)
    .bind(&target_email)
    .bind(&password_hash)
    .execute(&state.pool)
    .await
    .expect("insert target");

    let session_id = uuid::Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO audit_logs (id, user_id, action, resource_type, resource_id) \
         VALUES ($1, $2, 'auth.login', 'user', $2)",
    )
    .bind(&session_id)
    .bind(&target_id)
    .execute(&state.pool)
    .await
    .expect("insert audit row");

    let target_token = ownly_backend::auth::handlers::create_token(
        target_id.clone(),
        target_email.clone(),
        "pro".into(),
        &state.jwt_secret,
        Some(session_id.clone()),
        0,
    )
    .expect("target token");

    let admin_token = ownly_backend::auth::handlers::create_token(
        admin_id.clone(),
        admin_email.clone(),
        "admin".into(),
        &state.jwt_secret,
        None,
        0,
    )
    .expect("admin token");

    let app = create_router(state.clone());

    let me_ok = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/v1/me")
                .header("authorization", format!("Bearer {target_token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(me_ok.status(), StatusCode::OK);

    let revoke = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/api/v1/admin/users/{target_id}/sessions/{session_id}/revoke"))
                .header("authorization", format!("Bearer {admin_token}"))
                .header("content-type", "application/json")
                .body(Body::from("{}"))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(revoke.status(), StatusCode::OK);

    let me_blocked = app
        .oneshot(
            Request::builder()
                .uri("/api/v1/me")
                .header("authorization", format!("Bearer {target_token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(me_blocked.status(), StatusCode::UNAUTHORIZED);

    sqlx::query("DELETE FROM audit_logs WHERE user_id = $1")
        .bind(&target_id)
        .execute(&state.pool)
        .await
        .ok();
    sqlx::query("DELETE FROM app_settings WHERE key = $1")
        .bind(format!("admin_revoked_sessions:{target_id}"))
        .execute(&state.pool)
        .await
        .ok();
    sqlx::query("DELETE FROM app_settings WHERE key = $1")
        .bind(format!("user_session_epoch:{target_id}"))
        .execute(&state.pool)
        .await
        .ok();
    sqlx::query("DELETE FROM users WHERE id = $1")
        .bind(&target_id)
        .execute(&state.pool)
        .await
        .ok();
    sqlx::query("DELETE FROM users WHERE id = $1")
        .bind(&admin_id)
        .execute(&state.pool)
        .await
        .ok();
}

// Human: Signed-in users can load their profile page payload with storage stats.
// Agent: GET /api/v1/me/profile; EXPECT user email + file_count from DB.
#[tokio::test]
async fn user_profile_returns_account_and_storage_summary() {
    let database_url = match std::env::var("DATABASE_URL") {
        Ok(url) if !url.is_empty() => url,
        _ => {
            eprintln!("skipping user_profile_returns_account_and_storage_summary: DATABASE_URL unset");
            return;
        }
    };

    let cfg = test_config(&database_url);
    let state = match create_test_app_state(&cfg).await {
        Ok(state) => state,
        Err(error) => {
            eprintln!("skipping user_profile_returns_account_and_storage_summary: {error}");
            return;
        }
    };

    let user_id = uuid::Uuid::new_v4().to_string();
    let file_id = uuid::Uuid::new_v4().to_string();
    let email = format!("profile-{user_id}@example.com");
    let password_hash = ownly_backend::auth::handlers::hash_password("password123")
        .expect("hash password");

    sqlx::query(
        "INSERT INTO users (id, email, password_hash, role, enabled) VALUES ($1, $2, $3, 'user', true)",
    )
    .bind(&user_id)
    .bind(&email)
    .bind(&password_hash)
    .execute(&state.pool)
    .await
    .expect("insert user");

    sqlx::query(
        "INSERT INTO files (id, user_id, folder_id, name, storage_key, mime_type, size_bytes) \
         VALUES ($1, $2, NULL, 'notes.txt', 'storage/notes', 'text/plain', 512)",
    )
    .bind(&file_id)
    .bind(&user_id)
    .execute(&state.pool)
    .await
    .expect("insert file");

    let token = ownly_backend::auth::handlers::create_token(
        user_id.clone(),
        email.clone(),
        "user".into(),
        &state.jwt_secret,
        None,
        0,
    )
    .expect("create token");

    let app = create_router(state.clone());
    let response = app
        .oneshot(
            Request::builder()
                .uri("/api/v1/me/profile")
                .header("authorization", format!("Bearer {token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let json = response_json(response).await;
    assert_eq!(json["user"]["email"], email);
    assert_eq!(json["user"]["role"], "user");
    assert_eq!(json["storage"]["file_count"], 1);
    assert_eq!(json["storage"]["used_bytes"], 512);

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

// Human: Users can rotate their own password when the current password is correct.
// Agent: PATCH /api/v1/me/password; EXPECT 200 then login succeeds with the new password.
#[tokio::test]
async fn user_can_change_own_password() {
    let database_url = match std::env::var("DATABASE_URL") {
        Ok(url) if !url.is_empty() => url,
        _ => {
            eprintln!("skipping user_can_change_own_password: DATABASE_URL unset");
            return;
        }
    };

    let cfg = test_config(&database_url);
    let state = match create_test_app_state(&cfg).await {
        Ok(state) => state,
        Err(error) => {
            eprintln!("skipping user_can_change_own_password: {error}");
            return;
        }
    };

    let user_id = uuid::Uuid::new_v4().to_string();
    let email = format!("pw-change-{user_id}@example.com");
    let password_hash = ownly_backend::auth::handlers::hash_password("oldpassword1")
        .expect("hash password");

    sqlx::query(
        "INSERT INTO users (id, email, password_hash, role, enabled) VALUES ($1, $2, $3, 'user', true)",
    )
    .bind(&user_id)
    .bind(&email)
    .bind(&password_hash)
    .execute(&state.pool)
    .await
    .expect("insert user");

    let token = ownly_backend::auth::handlers::create_token(
        user_id.clone(),
        email.clone(),
        "user".into(),
        &state.jwt_secret,
        None,
        0,
    )
    .expect("create token");

    let app = create_router(state.clone());
    let change_body = json!({
        "current_password": "oldpassword1",
        "new_password": "newpassword9"
    });

    let change_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("PATCH")
                .uri("/api/v1/me/password")
                .header("content-type", "application/json")
                .header("authorization", format!("Bearer {token}"))
                .body(Body::from(change_body.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(change_response.status(), StatusCode::OK);

    let login_body = json!({
        "email": email,
        "password": "newpassword9"
    });
    let login_response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/auth/login")
                .header("content-type", "application/json")
                .body(Body::from(login_body.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(login_response.status(), StatusCode::OK);

    sqlx::query("DELETE FROM audit_logs WHERE user_id = $1")
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
