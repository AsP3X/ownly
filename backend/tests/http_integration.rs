//! HTTP integration tests for setup, auth gates, and error envelope contracts.

mod test_harness;

use axum::body::{to_bytes, Body};
use axum::http::{Request, StatusCode};
use ownly_backend::create_router;
use serde_json::json;
use tower::ServiceExt;

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
    let Some(state) = test_harness::TestHarness::state("setup_status_is_false_before_admin_exists").await else {
        return;
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
    let Some(state) = test_harness::TestHarness::state("protected_route_returns_unauthorized_without_token").await else {
        return;
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
    let Some(state) = test_harness::TestHarness::state("responses_include_request_id_header").await else {
        return;
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
    let Some(state) = test_harness::TestHarness::state("setup_creates_admin_and_returns_token_on_empty_database").await else {
        return;
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
    let Some(state) = test_harness::TestHarness::state("create_share_requires_authentication").await else {
        return;
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
    let Some(state) = test_harness::TestHarness::state("public_share_unknown_token_returns_not_found").await else {
        return;
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
    let Some(state) = test_harness::TestHarness::state("public_share_download_is_scoped_to_shared_file_only").await else {
        return;
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

// Human: Upload duplicate detection should find owned files by content hash across every folder.
// Agent: POST /api/v1/files/check-upload-names; EXPECT duplicates for matching content_hash only.
#[tokio::test]
async fn check_upload_names_finds_library_duplicates_globally() {
    let Some(state) = test_harness::TestHarness::state("check_upload_names_finds_library_duplicates_globally").await else {
        return;
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
        "INSERT INTO files (id, user_id, folder_id, name, storage_key, mime_type, size_bytes, content_hash) \
         VALUES ($1, $2, $3, 'report.pdf', 'storage/report', 'application/pdf', 2048, $4)",
    )
    .bind(&existing_file_id)
    .bind(&user_id)
    .bind(&folder_id)
    .bind("5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8")
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
            {
                "name": "renamed-report.pdf",
                "size_bytes": 4096,
                "content_hash": "5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8"
            },
            {
                "name": "new-file.txt",
                "size_bytes": 128,
                "content_hash": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
            }
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
    assert_eq!(duplicates[0]["upload_name"], "renamed-report.pdf");
    assert_eq!(
        duplicates[0]["upload_content_hash"],
        "5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8"
    );
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
    let Some(state) = test_harness::TestHarness::state("check_upload_names_finds_exact_recycle_bin_matches").await else {
        return;
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
            {
                "name": "report.pdf",
                "size_bytes": 2048,
                "content_hash": "5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8"
            },
            {
                "name": "report.pdf",
                "size_bytes": 4096,
                "content_hash": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
            }
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
    let Some(state) = test_harness::TestHarness::state("check_upload_names_accepts_html_documents").await else {
        return;
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
            {
                "name": "notes/page.html",
                "size_bytes": 4096,
                "content_hash": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
            }
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
    let Some(state) = test_harness::TestHarness::state("soft_delete_moves_file_to_recycle_bin_and_restore_returns_it").await else {
        return;
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

// Human: Recycle-bin permanent delete must preview and purge trashed rows (not 404 active-only gates).
// Agent: DELETE soft-delete; GET deletion-preview + DELETE ?permanent=true on trashed file id.
#[tokio::test]
async fn recycle_bin_permanent_delete_preview_and_purge_trashed_file() {
    let Some(state) = test_harness::TestHarness::state("recycle_bin_permanent_delete_preview_and_purge_trashed_file").await else {
        return;
    };

    let user_id = uuid::Uuid::new_v4().to_string();
    let file_id = uuid::Uuid::new_v4().to_string();
    let email = format!("recycle-perm-{user_id}@example.com");
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
         VALUES ($1, $2, 'trash-perm.txt', 'storage/trash-perm', 'text/plain', 12)",
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

    let preview_response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(format!("/api/v1/files/{file_id}/deletion-preview"))
                .header("authorization", format!("Bearer {token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(preview_response.status(), StatusCode::OK);

    let bin_preview_response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/v1/recycle-bin/deletion-preview")
                .header("authorization", format!("Bearer {token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(bin_preview_response.status(), StatusCode::OK);
    let bin_preview_json = response_json(bin_preview_response).await;
    assert_eq!(bin_preview_json["file_count"], 1);

    let permanent_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("DELETE")
                .uri(format!("/api/v1/files/{file_id}?permanent=true"))
                .header("authorization", format!("Bearer {token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(permanent_response.status(), StatusCode::OK);

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
    let bin_json = response_json(bin_response).await;
    assert_eq!(bin_json["total_count"], 0);

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
    let Some(state) = test_harness::TestHarness::state("public_share_password_and_download_block").await else {
        return;
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

    let overview_denied = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(format!("/api/v1/public/shares/{token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(overview_denied.status(), StatusCode::FORBIDDEN);

    let overview = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(format!("/api/v1/public/shares/{token}"))
                .header("x-share-password", "visitor-pass")
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
    let Some(state) = test_harness::TestHarness::state("admin_users_list_requires_admin_role").await else {
        return;
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
    let Some(state) = test_harness::TestHarness::state("forged_jwt_admin_role_is_denied_when_db_role_is_user").await else {
        return;
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
    let Some(state) = test_harness::TestHarness::state("admin_create_user_succeeds_without_browser_metadata").await else {
        return;
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

// Human: Admins can raise a user's explicit storage quota via PATCH storage_quota_gb.
// Agent: POST/PATCH /api/v1/admin/users; WRITES users.storage_quota_gb; legacy role=admin without group still allowed.
#[tokio::test]
async fn admin_update_user_storage_quota_gb() {
    let Some(state) = test_harness::TestHarness::state("admin_update_user_storage_quota_gb").await else {
        return;
    };

    let admin_id = uuid::Uuid::new_v4().to_string();
    let target_id = uuid::Uuid::new_v4().to_string();
    let password_hash =
        ownly_backend::auth::handlers::hash_password("password123").expect("hash password");

    sqlx::query(
        "INSERT INTO users (id, email, password_hash, role, enabled) VALUES ($1, $2, $3, 'admin', true)",
    )
    .bind(&admin_id)
    .bind(format!("admin-quota-{admin_id}@example.com"))
    .bind(&password_hash)
    .execute(&state.pool)
    .await
    .expect("insert admin");

    sqlx::query(
        "INSERT INTO users (id, email, password_hash, role, enabled, storage_quota_gb) \
         VALUES ($1, $2, $3, 'pro', true, 25)",
    )
    .bind(&target_id)
    .bind(format!("target-quota-{target_id}@example.com"))
    .bind(&password_hash)
    .execute(&state.pool)
    .await
    .expect("insert target");

    let admin_token = ownly_backend::auth::handlers::create_token(
        admin_id.clone(),
        format!("admin-quota-{admin_id}@example.com"),
        "admin".into(),
        &state.jwt_secret,
        None,
        0,
    )
    .expect("admin token");

    let app = create_router(state.clone());
    let patch_body = json!({ "storage_quota_gb": 100 });
    let patch_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("PATCH")
                .uri(format!("/api/v1/admin/users/{target_id}"))
                .header("content-type", "application/json")
                .header("authorization", format!("Bearer {admin_token}"))
                .body(Body::from(patch_body.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(patch_response.status(), StatusCode::OK);

    let stored: (Option<i32>,) =
        sqlx::query_as("SELECT storage_quota_gb FROM users WHERE id = $1")
            .bind(&target_id)
            .fetch_one(&state.pool)
            .await
            .expect("load quota");
    assert_eq!(stored.0, Some(100));

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

// Human: Sole admin-group member with users.role=pro can PATCH storage_quota_gb without last-admin guard.
// Agent: PATCH quota only; READS group_members; MUST NOT return 403 last-admin error.
#[tokio::test]
async fn admin_update_storage_quota_for_group_backed_sole_admin() {
    let Some(state) =
        test_harness::TestHarness::state("admin_update_storage_quota_for_group_backed_sole_admin").await
    else {
        return;
    };

    let admin_id = uuid::Uuid::new_v4().to_string();
    let password_hash =
        ownly_backend::auth::handlers::hash_password("password123").expect("hash password");

    sqlx::query(
        "INSERT INTO users (id, email, password_hash, role, enabled, storage_quota_gb) \
         VALUES ($1, $2, $3, 'pro', true, 50)",
    )
    .bind(&admin_id)
    .bind(format!("sole-admin-quota-{admin_id}@example.com"))
    .bind(&password_hash)
    .execute(&state.pool)
    .await
    .expect("insert sole admin");

    ownly_backend::authz::seed_admin_group_for_user(&state.pool, &admin_id)
        .await
        .expect("seed admin group");

    let admin_token = ownly_backend::auth::handlers::create_token(
        admin_id.clone(),
        format!("sole-admin-quota-{admin_id}@example.com"),
        "pro".into(),
        &state.jwt_secret,
        None,
        0,
    )
    .expect("admin token");

    let app = create_router(state.clone());
    let patch_body = json!({ "storage_quota_gb": 200 });
    let patch_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("PATCH")
                .uri(format!("/api/v1/admin/users/{admin_id}"))
                .header("content-type", "application/json")
                .header("authorization", format!("Bearer {admin_token}"))
                .body(Body::from(patch_body.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(patch_response.status(), StatusCode::OK);

    let stored: (Option<i32>,) =
        sqlx::query_as("SELECT storage_quota_gb FROM users WHERE id = $1")
            .bind(&admin_id)
            .fetch_one(&state.pool)
            .await
            .expect("load quota");
    assert_eq!(stored.0, Some(200));

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
    let Some(state) = test_harness::TestHarness::state("admin_overview_requires_admin_role").await else {
        return;
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
    let Some(state) = test_harness::TestHarness::state("admin_storage_nodes_registry_lists_created_node").await else {
        return;
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
    let Some(state) = test_harness::TestHarness::state("admin_revoked_session_invalidates_jwt").await else {
        return;
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
    let Some(state) = test_harness::TestHarness::state("user_profile_returns_account_and_storage_summary").await else {
        return;
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
    let Some(state) = test_harness::TestHarness::state("user_can_change_own_password").await else {
        return;
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

// Human: Setup info routes require bootstrap token and block after initialization (SEC-001).
// Agent: GET /setup/database without X-Setup-Token; EXPECT 403 on initialized instances.
#[tokio::test]
async fn setup_database_info_requires_bootstrap_token() {
    let Some(state) = test_harness::TestHarness::state("setup_database_info_requires_bootstrap_token").await else {
        return;
    };

    let app = create_router(state);
    let response = app
        .oneshot(
            Request::builder()
                .uri("/api/v1/setup/database")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::FORBIDDEN);
}

// Human: Soft-deleted files must not be downloadable by the owner (SEC-004).
// Agent: GET /files/{id}/download after deleted_at set; EXPECT 404.
#[tokio::test]
async fn trashed_file_download_is_denied() {
    let Some(state) = test_harness::TestHarness::state("trashed_file_download_is_denied").await else {
        return;
    };

    let user_id = uuid::Uuid::new_v4().to_string();
    let file_id = uuid::Uuid::new_v4().to_string();
    let password_hash =
        ownly_backend::auth::handlers::hash_password("password123").expect("hash password");

    sqlx::query(
        "INSERT INTO users (id, email, password_hash, role, enabled) VALUES ($1, $2, $3, 'user', true)",
    )
    .bind(&user_id)
    .bind(format!("trash-dl-{user_id}@example.com"))
    .bind(&password_hash)
    .execute(&state.pool)
    .await
    .expect("insert user");

    sqlx::query(
        "INSERT INTO files (id, user_id, name, storage_key, mime_type, size_bytes, deleted_at) \
         VALUES ($1, $2, 'trashed.txt', 'storage/trashed', 'text/plain', 4, now())",
    )
    .bind(&file_id)
    .bind(&user_id)
    .execute(&state.pool)
    .await
    .expect("insert trashed file");

    let token = ownly_backend::auth::handlers::create_token(
        user_id.clone(),
        format!("trash-dl-{user_id}@example.com"),
        "user".into(),
        &state.jwt_secret,
        None,
        0,
    )
    .expect("token");

    let app = create_router(state.clone());
    let response = app
        .oneshot(
            Request::builder()
                .uri(format!("/api/v1/files/{file_id}/download"))
                .header("authorization", format!("Bearer {token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::NOT_FOUND);

    sqlx::query("DELETE FROM files WHERE id = $1")
        .bind(&file_id)
        .execute(&state.pool)
        .await
        .ok();
    sqlx::query("DELETE FROM users WHERE id = $1")
        .bind(&user_id)
        .execute(&state.pool)
        .await
        .ok();
}

// Human: Demoted admins lose admin API access immediately — DB role wins over JWT claim (SEC-002).
// Agent: PATCH user to pro; reuse pre-demotion JWT on GET /admin/users; EXPECT 403.
#[tokio::test]
async fn demoted_admin_jwt_is_denied_on_admin_routes() {
    let Some(state) = test_harness::TestHarness::state("demoted_admin_jwt_is_denied_on_admin_routes").await else {
        return;
    };

    let demoter_id = uuid::Uuid::new_v4().to_string();
    let subject_id = uuid::Uuid::new_v4().to_string();
    let password_hash =
        ownly_backend::auth::handlers::hash_password("password123").expect("hash password");

    for (id, email) in [
        (demoter_id.as_str(), format!("demoter-{demoter_id}@example.com")),
        (subject_id.as_str(), format!("subject-{subject_id}@example.com")),
    ] {
        sqlx::query(
            "INSERT INTO users (id, email, password_hash, role, enabled) VALUES ($1, $2, $3, 'admin', true)",
        )
        .bind(id)
        .bind(email)
        .bind(&password_hash)
        .execute(&state.pool)
        .await
        .expect("insert admin");
        ownly_backend::authz::sync_user_admin_group_membership(&state.pool, id, "admin")
            .await
            .expect("admin group membership");
    }

    let subject_token = ownly_backend::auth::handlers::create_token(
        subject_id.clone(),
        format!("subject-{subject_id}@example.com"),
        "admin".into(),
        &state.jwt_secret,
        None,
        0,
    )
    .expect("subject token");

    let demoter_token = ownly_backend::auth::handlers::create_token(
        demoter_id.clone(),
        format!("demoter-{demoter_id}@example.com"),
        "admin".into(),
        &state.jwt_secret,
        None,
        0,
    )
    .expect("demoter token");

    let app = create_router(state.clone());
    let patch_body = json!({ "role": "pro" });
    let patch_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("PATCH")
                .uri(format!("/api/v1/admin/users/{subject_id}"))
                .header("content-type", "application/json")
                .header("authorization", format!("Bearer {demoter_token}"))
                .body(Body::from(patch_body.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(patch_response.status(), StatusCode::OK);

    let list_response = app
        .oneshot(
            Request::builder()
                .uri("/api/v1/admin/users")
                .header("authorization", format!("Bearer {subject_token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert!(
        list_response.status() == StatusCode::FORBIDDEN
            || list_response.status() == StatusCode::UNAUTHORIZED,
        "demoted admin token must not list users (got {})",
        list_response.status()
    );

    sqlx::query("DELETE FROM users WHERE id = $1")
        .bind(&subject_id)
        .execute(&state.pool)
        .await
        .ok();
    sqlx::query("DELETE FROM users WHERE id = $1")
        .bind(&demoter_id)
        .execute(&state.pool)
        .await
        .ok();
}

// Human: Grantee with content.read can download an owner's file via atomic permissions.
// Agent: INSERT permission_grants allow; GET download; EXPECT 200 or streaming response.
#[tokio::test]
async fn content_read_grant_allows_file_download() {
    let Some(state) = test_harness::TestHarness::state("content_read_grant_allows_file_download").await else {
        return;
    };

    let owner_id = uuid::Uuid::new_v4().to_string();
    let grantee_id = uuid::Uuid::new_v4().to_string();
    let file_id = uuid::Uuid::new_v4().to_string();
    let storage_key = format!("users/{owner_id}/files/{file_id}/blob");
    let password_hash =
        ownly_backend::auth::handlers::hash_password("password123").expect("hash password");

    for (id, email) in [
        (owner_id.as_str(), format!("owner-{owner_id}@example.com")),
        (grantee_id.as_str(), format!("grantee-{grantee_id}@example.com")),
    ] {
        sqlx::query(
            "INSERT INTO users (id, email, password_hash, role, enabled) VALUES ($1, $2, $3, 'pro', true)",
        )
        .bind(id)
        .bind(email)
        .bind(&password_hash)
        .execute(&state.pool)
        .await
        .expect("insert user");
    }

    sqlx::query(
        "INSERT INTO files (id, user_id, name, storage_key, mime_type, size_bytes) \
         VALUES ($1, $2, 'grant-test.txt', $3, 'text/plain', 4)",
    )
    .bind(&file_id)
    .bind(&owner_id)
    .bind(&storage_key)
    .execute(&state.pool)
    .await
    .expect("insert file");

    let grant_id = uuid::Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO permission_grants \
         (id, subject_type, subject_id, resource_type, resource_id, permission, effect, granted_by) \
         VALUES ($1, 'user', $2, 'file', $3, 'content.read', 'allow', $4)",
    )
    .bind(&grant_id)
    .bind(&grantee_id)
    .bind(&file_id)
    .bind(&owner_id)
    .execute(&state.pool)
    .await
    .expect("insert grant");

    let grantee_token = ownly_backend::auth::handlers::create_token(
        grantee_id.clone(),
        format!("grantee-{grantee_id}@example.com"),
        "pro".into(),
        &state.jwt_secret,
        None,
        0,
    )
    .expect("grantee token");

    let app = create_router(state.clone());
    let response = app
        .oneshot(
            Request::builder()
                .uri(format!("/api/v1/files/{file_id}/download"))
                .header("authorization", format!("Bearer {grantee_token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_ne!(
        response.status(),
        StatusCode::FORBIDDEN,
        "grantee with content.read should not be forbidden"
    );
    assert_ne!(
        response.status(),
        StatusCode::NOT_FOUND,
        "grantee with content.read should resolve the file"
    );

    sqlx::query("DELETE FROM permission_grants WHERE id = $1")
        .bind(&grant_id)
        .execute(&state.pool)
        .await
        .ok();
    sqlx::query("DELETE FROM files WHERE id = $1")
        .bind(&file_id)
        .execute(&state.pool)
        .await
        .ok();
    sqlx::query("DELETE FROM users WHERE id = ANY($1)")
        .bind(&[owner_id, grantee_id])
        .execute(&state.pool)
        .await
        .ok();
}

// Human: Explicit deny on a file beats allow — grantee must not download.
// Agent: INSERT allow + deny content.read; GET download; EXPECT 403 or idempotent ok on delete path.
#[tokio::test]
async fn content_deny_grant_blocks_file_download() {
    let Some(state) = test_harness::TestHarness::state("content_deny_grant_blocks_file_download").await else {
        return;
    };

    let owner_id = uuid::Uuid::new_v4().to_string();
    let grantee_id = uuid::Uuid::new_v4().to_string();
    let file_id = uuid::Uuid::new_v4().to_string();
    let password_hash =
        ownly_backend::auth::handlers::hash_password("password123").expect("hash password");

    for (id, email) in [
        (owner_id.as_str(), format!("owner-{owner_id}@example.com")),
        (grantee_id.as_str(), format!("grantee-{grantee_id}@example.com")),
    ] {
        sqlx::query(
            "INSERT INTO users (id, email, password_hash, role, enabled) VALUES ($1, $2, $3, 'pro', true)",
        )
        .bind(id)
        .bind(email)
        .bind(&password_hash)
        .execute(&state.pool)
        .await
        .expect("insert user");
    }

    sqlx::query(
        "INSERT INTO files (id, user_id, name, storage_key, mime_type, size_bytes) \
         VALUES ($1, $2, 'deny-test.txt', $3, 'text/plain', 4)",
    )
    .bind(&file_id)
    .bind(&owner_id)
    .bind(format!("users/{owner_id}/files/{file_id}/blob"))
    .execute(&state.pool)
    .await
    .expect("insert file");

    for (grant_id, effect) in [
        (uuid::Uuid::new_v4().to_string(), "allow"),
        (uuid::Uuid::new_v4().to_string(), "deny"),
    ] {
        sqlx::query(
            "INSERT INTO permission_grants \
             (id, subject_type, subject_id, resource_type, resource_id, permission, effect, granted_by) \
             VALUES ($1, 'user', $2, 'file', $3, 'content.read', $4::grant_effect, $5)",
        )
        .bind(&grant_id)
        .bind(&grantee_id)
        .bind(&file_id)
        .bind(effect)
        .bind(&owner_id)
        .execute(&state.pool)
        .await
        .expect("insert grant");
    }

    let grantee_token = ownly_backend::auth::handlers::create_token(
        grantee_id.clone(),
        format!("grantee-{grantee_id}@example.com"),
        "pro".into(),
        &state.jwt_secret,
        None,
        0,
    )
    .expect("grantee token");

    let app = create_router(state.clone());
    let response = app
        .oneshot(
            Request::builder()
                .uri(format!("/api/v1/files/{file_id}/download"))
                .header("authorization", format!("Bearer {grantee_token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(
        response.status(),
        StatusCode::FORBIDDEN,
        "deny must win over allow for content.read"
    );

    sqlx::query("DELETE FROM permission_grants WHERE resource_id = $1")
        .bind(&file_id)
        .execute(&state.pool)
        .await
        .ok();
    sqlx::query("DELETE FROM files WHERE id = $1")
        .bind(&file_id)
        .execute(&state.pool)
        .await
        .ok();
    sqlx::query("DELETE FROM users WHERE id = ANY($1)")
        .bind(&[owner_id, grantee_id])
        .execute(&state.pool)
        .await
        .ok();
}

// Human: Folder grant inherits to child files — grantee can fetch file metadata.
// Agent: INSERT folder + nested file + folder content.read grant; GET /files/:id; EXPECT 200 JSON.
#[tokio::test]
async fn folder_read_grant_inherits_to_child_file() {
    let Some(state) = test_harness::TestHarness::state("folder_read_grant_inherits_to_child_file").await else {
        return;
    };

    let owner_id = uuid::Uuid::new_v4().to_string();
    let grantee_id = uuid::Uuid::new_v4().to_string();
    let folder_id = uuid::Uuid::new_v4().to_string();
    let file_id = uuid::Uuid::new_v4().to_string();
    let password_hash =
        ownly_backend::auth::handlers::hash_password("password123").expect("hash password");

    for (id, email) in [
        (owner_id.as_str(), format!("owner-{owner_id}@example.com")),
        (grantee_id.as_str(), format!("grantee-{grantee_id}@example.com")),
    ] {
        sqlx::query(
            "INSERT INTO users (id, email, password_hash, role, enabled) VALUES ($1, $2, $3, 'pro', true)",
        )
        .bind(id)
        .bind(email)
        .bind(&password_hash)
        .execute(&state.pool)
        .await
        .expect("insert user");
    }

    sqlx::query(
        "INSERT INTO folders (id, user_id, name, parent_id) VALUES ($1, $2, 'Shared', NULL)",
    )
    .bind(&folder_id)
    .bind(&owner_id)
    .execute(&state.pool)
    .await
    .expect("insert folder");

    sqlx::query(
        "INSERT INTO files (id, user_id, name, storage_key, mime_type, size_bytes, folder_id) \
         VALUES ($1, $2, 'nested.txt', $3, 'text/plain', 4, $4)",
    )
    .bind(&file_id)
    .bind(&owner_id)
    .bind(format!("users/{owner_id}/files/{file_id}/blob"))
    .bind(&folder_id)
    .execute(&state.pool)
    .await
    .expect("insert file");

    let grant_id = uuid::Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO permission_grants \
         (id, subject_type, subject_id, resource_type, resource_id, permission, effect, granted_by) \
         VALUES ($1, 'user', $2, 'folder', $3, 'content.read', 'allow', $4)",
    )
    .bind(&grant_id)
    .bind(&grantee_id)
    .bind(&folder_id)
    .bind(&owner_id)
    .execute(&state.pool)
    .await
    .expect("insert folder grant");

    let grantee_token = ownly_backend::auth::handlers::create_token(
        grantee_id.clone(),
        format!("grantee-{grantee_id}@example.com"),
        "pro".into(),
        &state.jwt_secret,
        None,
        0,
    )
    .expect("grantee token");

    let app = create_router(state.clone());
    let response = app
        .oneshot(
            Request::builder()
                .uri(format!("/api/v1/files/{file_id}"))
                .header("authorization", format!("Bearer {grantee_token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(
        response.status(),
        StatusCode::OK,
        "folder content.read should inherit to nested file metadata"
    );

    sqlx::query("DELETE FROM permission_grants WHERE id = $1")
        .bind(&grant_id)
        .execute(&state.pool)
        .await
        .ok();
    sqlx::query("DELETE FROM files WHERE id = $1")
        .bind(&file_id)
        .execute(&state.pool)
        .await
        .ok();
    sqlx::query("DELETE FROM folders WHERE id = $1")
        .bind(&folder_id)
        .execute(&state.pool)
        .await
        .ok();
    sqlx::query("DELETE FROM users WHERE id = ANY($1)")
        .bind(&[owner_id, grantee_id])
        .execute(&state.pool)
        .await
        .ok();
}

// Human: Valid credentials must return a JWT the client can use on protected routes.
// Agent: POST /auth/login; EXPECT 200 + token; GET /me succeeds with returned token.
#[tokio::test]
async fn login_returns_token_for_valid_credentials() {
    let Some(state) = test_harness::TestHarness::state("login_returns_token_for_valid_credentials")
        .await
    else {
        return;
    };

    let user_id = uuid::Uuid::new_v4().to_string();
    let email = format!("login-{user_id}@example.com");
    let password_hash =
        ownly_backend::auth::handlers::hash_password("password123").expect("hash password");

    sqlx::query(
        "INSERT INTO users (id, email, password_hash, role, enabled) VALUES ($1, $2, $3, 'user', true)",
    )
    .bind(&user_id)
    .bind(&email)
    .bind(&password_hash)
    .execute(&state.pool)
    .await
    .expect("insert user");

    let app = create_router(state.clone());
    let login = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/auth/login")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({ "email": email, "password": "password123" }).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(login.status(), StatusCode::OK);
    let login_json = response_json(login).await;
    let token = login_json["token"]
        .as_str()
        .expect("login token");

    let me = app
        .oneshot(
            Request::builder()
                .uri("/api/v1/me")
                .header("authorization", format!("Bearer {token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(me.status(), StatusCode::OK);

    sqlx::query("DELETE FROM users WHERE id = $1")
        .bind(&user_id)
        .execute(&state.pool)
        .await
        .ok();
}

// Human: Active sessions should rotate access JWTs without another login POST.
// Agent: POST /auth/refresh with Bearer token; EXPECT 200 + new token usable on /me.
#[tokio::test]
async fn refresh_returns_new_token_for_active_session() {
    let Some(state) = test_harness::TestHarness::state("refresh_returns_new_token_for_active_session")
        .await
    else {
        return;
    };

    let user_id = uuid::Uuid::new_v4().to_string();
    let email = format!("refresh-{user_id}@example.com");
    let password_hash =
        ownly_backend::auth::handlers::hash_password("password123").expect("hash password");

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
    let refreshed = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/auth/refresh")
                .header("authorization", format!("Bearer {token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(refreshed.status(), StatusCode::OK);
    let refreshed_json = response_json(refreshed).await;
    let next_token = refreshed_json["token"]
        .as_str()
        .expect("refresh token");
    assert_ne!(next_token, token);

    let me = app
        .oneshot(
            Request::builder()
                .uri("/api/v1/me")
                .header("authorization", format!("Bearer {next_token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(me.status(), StatusCode::OK);

    sqlx::query("DELETE FROM users WHERE id = $1")
        .bind(&user_id)
        .execute(&state.pool)
        .await
        .ok();
}

// Human: Refresh should still work shortly after hard expiry so clients recover from missed timers.
// Agent: MINT token with exp 30m ago; POST /auth/refresh; EXPECT 200 inside JWT_REFRESH_GRACE_SECS.
#[tokio::test]
async fn refresh_accepts_token_within_grace_after_expiry() {
    let Some(state) =
        test_harness::TestHarness::state("refresh_accepts_token_within_grace_after_expiry").await
    else {
        return;
    };

    let user_id = uuid::Uuid::new_v4().to_string();
    let email = format!("refresh-grace-{user_id}@example.com");

    sqlx::query(
        "INSERT INTO users (id, email, password_hash, role, enabled) VALUES ($1, $2, $3, 'user', true)",
    )
    .bind(&user_id)
    .bind(&email)
    .bind(ownly_backend::auth::handlers::hash_password("password123").expect("hash password"))
    .execute(&state.pool)
    .await
    .expect("insert user");

    let now = chrono::Utc::now().timestamp();
    let token = ownly_backend::auth::handlers::create_token_with_timestamps(
        user_id.clone(),
        email.clone(),
        "user".into(),
        &state.jwt_secret,
        None,
        0,
        now - 86_400,
        now - 1_800,
    )
    .expect("create expired token");

    let app = create_router(state.clone());
    let refreshed = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/auth/refresh")
                .header("authorization", format!("Bearer {token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(refreshed.status(), StatusCode::OK);

    sqlx::query("DELETE FROM users WHERE id = $1")
        .bind(&user_id)
        .execute(&state.pool)
        .await
        .ok();
}

// Human: Tokens expired beyond the grace window must not refresh — forces a fresh login.
// Agent: MINT token with exp 2h ago; POST /auth/refresh; EXPECT 401 unauthorized envelope.
#[tokio::test]
async fn refresh_rejects_token_past_grace_window() {
    let Some(state) =
        test_harness::TestHarness::state("refresh_rejects_token_past_grace_window").await
    else {
        return;
    };

    let user_id = uuid::Uuid::new_v4().to_string();
    let email = format!("refresh-stale-{user_id}@example.com");

    sqlx::query(
        "INSERT INTO users (id, email, password_hash, role, enabled) VALUES ($1, $2, $3, 'user', true)",
    )
    .bind(&user_id)
    .bind(&email)
    .bind(ownly_backend::auth::handlers::hash_password("password123").expect("hash password"))
    .execute(&state.pool)
    .await
    .expect("insert user");

    let now = chrono::Utc::now().timestamp();
    let token = ownly_backend::auth::handlers::create_token_with_timestamps(
        user_id.clone(),
        email.clone(),
        "user".into(),
        &state.jwt_secret,
        None,
        0,
        now - 172_800,
        now - 7_200,
    )
    .expect("create stale token");

    let app = create_router(state.clone());
    let refreshed = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/auth/refresh")
                .header("authorization", format!("Bearer {token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(refreshed.status(), StatusCode::UNAUTHORIZED);
    let json = response_json(refreshed).await;
    assert_eq!(json["error"]["code"], "unauthorized");

    sqlx::query("DELETE FROM users WHERE id = $1")
        .bind(&user_id)
        .execute(&state.pool)
        .await
        .ok();
}

// Human: Wrong passwords must not authenticate callers.
// Agent: POST /auth/login with bad password; EXPECT 401 unauthorized envelope.
#[tokio::test]
async fn login_rejects_invalid_password() {
    let Some(state) = test_harness::TestHarness::state("login_rejects_invalid_password").await
    else {
        return;
    };

    let user_id = uuid::Uuid::new_v4().to_string();
    let email = format!("badpw-{user_id}@example.com");
    let password_hash =
        ownly_backend::auth::handlers::hash_password("password123").expect("hash password");

    sqlx::query(
        "INSERT INTO users (id, email, password_hash, role, enabled) VALUES ($1, $2, $3, 'user', true)",
    )
    .bind(&user_id)
    .bind(&email)
    .bind(&password_hash)
    .execute(&state.pool)
    .await
    .expect("insert user");

    let app = create_router(state.clone());
    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/auth/login")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({ "email": email, "password": "wrong-password" }).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);

    sqlx::query("DELETE FROM users WHERE id = $1")
        .bind(&user_id)
        .execute(&state.pool)
        .await
        .ok();
}

// Human: Resumable chunked upload completes when all parts are received and assembled.
// Agent: POST /uploads; PUT parts; POST complete; EXPECT files row with matching size_bytes.
#[tokio::test]
async fn resumable_upload_assembles_parts_into_file() {
    let Some(state) =
        test_harness::TestHarness::state("resumable_upload_assembles_parts_into_file").await
    else {
        return;
    };

    let user_id = uuid::Uuid::new_v4().to_string();
    let email = format!("chunk-upload-{user_id}@example.com");
    let password_hash =
        ownly_backend::auth::handlers::hash_password("password123").expect("hash password");

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
    .expect("token");

    let app = create_router(state.clone());
    let create = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/uploads")
                .header("authorization", format!("Bearer {token}"))
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "filename": "chunked.bin",
                        "total_size": 100,
                        "chunk_size": 64,
                        "content_type": "application/octet-stream"
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(create.status(), StatusCode::OK);
    let create_json = response_json(create).await;
    let session_id = create_json["session_id"]
        .as_str()
        .expect("session_id")
        .to_string();
    assert_eq!(create_json["total_parts"], 2);

    let part0 = vec![b'a'; 64];
    let put0 = app
        .clone()
        .oneshot(
            Request::builder()
                .method("PUT")
                .uri(format!("/api/v1/uploads/{session_id}/parts/0"))
                .header("authorization", format!("Bearer {token}"))
                .header("content-type", "application/octet-stream")
                .body(Body::from(part0))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(put0.status(), StatusCode::OK);

    let status = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(format!("/api/v1/uploads/{session_id}"))
                .header("authorization", format!("Bearer {token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(status.status(), StatusCode::OK);
    let status_json = response_json(status).await;
    assert_eq!(status_json["parts_received"], json!([0]));
    assert_eq!(status_json["bytes_received"], 64);

    let part1 = vec![b'b'; 36];
    let put1 = app
        .clone()
        .oneshot(
            Request::builder()
                .method("PUT")
                .uri(format!("/api/v1/uploads/{session_id}/parts/1"))
                .header("authorization", format!("Bearer {token}"))
                .header("content-type", "application/octet-stream")
                .body(Body::from(part1))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(put1.status(), StatusCode::OK);

    let complete = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/api/v1/uploads/{session_id}/complete"))
                .header("authorization", format!("Bearer {token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(complete.status(), StatusCode::OK);
    let complete_json = response_json(complete).await;
    let file_id = complete_json["file"]["id"].as_str().expect("file id");
    assert_eq!(complete_json["file"]["size_bytes"], 100);

    let size: i64 = sqlx::query_scalar("SELECT size_bytes FROM files WHERE id = $1")
        .bind(file_id)
        .fetch_one(&state.pool)
        .await
        .expect("file row");
    assert_eq!(size, 100);

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

// Human: Owners can rename files in place without moving them between folders.
// Agent: PATCH /files/{id} { name }; EXPECT 200; LIST reflects new display name.
#[tokio::test]
async fn file_rename_updates_display_name() {
    let Some(state) = test_harness::TestHarness::state("file_rename_updates_display_name").await
    else {
        return;
    };

    let user_id = uuid::Uuid::new_v4().to_string();
    let file_id = uuid::Uuid::new_v4().to_string();
    let email = format!("rename-file-{user_id}@example.com");
    let password_hash =
        ownly_backend::auth::handlers::hash_password("password123").expect("hash password");

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
         VALUES ($1, $2, 'draft.txt', 'storage/draft', 'text/plain', 4)",
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
    .expect("token");

    let app = create_router(state.clone());
    let patch = app
        .oneshot(
            Request::builder()
                .method("PATCH")
                .uri(format!("/api/v1/files/{file_id}"))
                .header("authorization", format!("Bearer {token}"))
                .header("content-type", "application/json")
                .body(Body::from(json!({ "name": "final-report.txt" }).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(patch.status(), StatusCode::OK);
    let patch_json = response_json(patch).await;
    assert_eq!(patch_json["file"]["name"], "final-report.txt");

    sqlx::query("DELETE FROM files WHERE id = $1")
        .bind(&file_id)
        .execute(&state.pool)
        .await
        .ok();
    sqlx::query("DELETE FROM users WHERE id = $1")
        .bind(&user_id)
        .execute(&state.pool)
        .await
        .ok();
}

// Human: Folder rename keeps hierarchy intact and updates the listing name.
// Agent: PATCH /folders/{id} { name }; EXPECT 200 + updated folder DTO.
#[tokio::test]
async fn folder_rename_updates_display_name() {
    let Some(state) = test_harness::TestHarness::state("folder_rename_updates_display_name").await
    else {
        return;
    };

    let user_id = uuid::Uuid::new_v4().to_string();
    let folder_id = uuid::Uuid::new_v4().to_string();
    let email = format!("rename-folder-{user_id}@example.com");
    let password_hash =
        ownly_backend::auth::handlers::hash_password("password123").expect("hash password");

    sqlx::query(
        "INSERT INTO users (id, email, password_hash, role, enabled) VALUES ($1, $2, $3, 'user', true)",
    )
    .bind(&user_id)
    .bind(&email)
    .bind(&password_hash)
    .execute(&state.pool)
    .await
    .expect("insert user");

    sqlx::query("INSERT INTO folders (id, user_id, name) VALUES ($1, $2, 'Old Name')")
        .bind(&folder_id)
        .bind(&user_id)
        .execute(&state.pool)
        .await
        .expect("insert folder");

    let token = ownly_backend::auth::handlers::create_token(
        user_id.clone(),
        email.clone(),
        "user".into(),
        &state.jwt_secret,
        None,
        0,
    )
    .expect("token");

    let app = create_router(state.clone());
    let patch = app
        .oneshot(
            Request::builder()
                .method("PATCH")
                .uri(format!("/api/v1/folders/{folder_id}"))
                .header("authorization", format!("Bearer {token}"))
                .header("content-type", "application/json")
                .body(Body::from(json!({ "name": "Projects" }).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(patch.status(), StatusCode::OK);
    let patch_json = response_json(patch).await;
    assert_eq!(patch_json["folder"]["name"], "Projects");

    sqlx::query("DELETE FROM folders WHERE id = $1")
        .bind(&folder_id)
        .execute(&state.pool)
        .await
        .ok();
    sqlx::query("DELETE FROM users WHERE id = $1")
        .bind(&user_id)
        .execute(&state.pool)
        .await
        .ok();
}

// Human: Global folder search returns name matches across the library tree.
// Agent: GET /folders?q=; EXPECT matching folder rows when parent_id is omitted.
#[tokio::test]
async fn folder_search_finds_matches_by_name() {
    let Some(state) = test_harness::TestHarness::state("folder_search_finds_matches_by_name").await
    else {
        return;
    };

    let user_id = uuid::Uuid::new_v4().to_string();
    let folder_id = uuid::Uuid::new_v4().to_string();
    let email = format!("search-folder-{user_id}@example.com");
    let password_hash =
        ownly_backend::auth::handlers::hash_password("password123").expect("hash password");

    sqlx::query(
        "INSERT INTO users (id, email, password_hash, role, enabled) VALUES ($1, $2, $3, 'user', true)",
    )
    .bind(&user_id)
    .bind(&email)
    .bind(&password_hash)
    .execute(&state.pool)
    .await
    .expect("insert user");

    sqlx::query("INSERT INTO folders (id, user_id, name) VALUES ($1, $2, 'Vacation Photos')")
        .bind(&folder_id)
        .bind(&user_id)
        .execute(&state.pool)
        .await
        .expect("insert folder");

    let token = ownly_backend::auth::handlers::create_token(
        user_id.clone(),
        email,
        "user".into(),
        &state.jwt_secret,
        None,
        0,
    )
    .expect("token");

    let app = create_router(state.clone());
    let response = app
        .oneshot(
            Request::builder()
                .uri("/api/v1/folders?q=vacation")
                .header("authorization", format!("Bearer {token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let json = response_json(response).await;
    let names: Vec<&str> = json["folders"]
        .as_array()
        .expect("folders array")
        .iter()
        .filter_map(|row| row["name"].as_str())
        .collect();
    assert!(names.iter().any(|name| name.contains("Vacation")));

    sqlx::query("DELETE FROM folders WHERE id = $1")
        .bind(&folder_id)
        .execute(&state.pool)
        .await
        .ok();
    sqlx::query("DELETE FROM users WHERE id = $1")
        .bind(&user_id)
        .execute(&state.pool)
        .await
        .ok();
}

// Human: Owners can reparent a folder under another folder via PATCH parent_id.
// Agent: PATCH /folders/{child} { parent_id }; EXPECT 200; child.parent_id updated.
#[tokio::test]
async fn folder_move_updates_parent_id() {
    let Some(state) = test_harness::TestHarness::state("folder_move_updates_parent_id").await else {
        return;
    };

    let user_id = uuid::Uuid::new_v4().to_string();
    let parent_id = uuid::Uuid::new_v4().to_string();
    let child_id = uuid::Uuid::new_v4().to_string();
    let email = format!("move-folder-{user_id}@example.com");
    let password_hash =
        ownly_backend::auth::handlers::hash_password("password123").expect("hash password");

    sqlx::query(
        "INSERT INTO users (id, email, password_hash, role, enabled) VALUES ($1, $2, $3, 'user', true)",
    )
    .bind(&user_id)
    .bind(&email)
    .bind(&password_hash)
    .execute(&state.pool)
    .await
    .expect("insert user");

    sqlx::query("INSERT INTO folders (id, user_id, name) VALUES ($1, $2, 'Parent')")
        .bind(&parent_id)
        .bind(&user_id)
        .execute(&state.pool)
        .await
        .expect("insert parent");

    sqlx::query("INSERT INTO folders (id, user_id, name) VALUES ($1, $2, 'Child')")
        .bind(&child_id)
        .bind(&user_id)
        .execute(&state.pool)
        .await
        .expect("insert child");

    let token = ownly_backend::auth::handlers::create_token(
        user_id.clone(),
        email,
        "user".into(),
        &state.jwt_secret,
        None,
        0,
    )
    .expect("token");

    let app = create_router(state.clone());
    let patch = app
        .oneshot(
            Request::builder()
                .method("PATCH")
                .uri(format!("/api/v1/folders/{child_id}"))
                .header("authorization", format!("Bearer {token}"))
                .header("content-type", "application/json")
                .body(Body::from(json!({ "parent_id": parent_id }).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(patch.status(), StatusCode::OK);
    let patch_json = response_json(patch).await;
    assert_eq!(patch_json["folder"]["parent_id"], parent_id);

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

// Human: Breadcrumb "My Cloud" drops send parent_id null — must move nested folders to drive root.
// Agent: PATCH /folders/{child} { parent_id: null }; EXPECT 200; child.parent_id IS NULL in DB.
#[tokio::test]
async fn folder_move_to_root_with_null_parent_id() {
    let Some(state) = test_harness::TestHarness::state("folder_move_to_root_with_null_parent_id").await
    else {
        return;
    };

    let user_id = uuid::Uuid::new_v4().to_string();
    let parent_id = uuid::Uuid::new_v4().to_string();
    let child_id = uuid::Uuid::new_v4().to_string();
    let email = format!("move-folder-root-{user_id}@example.com");
    let password_hash =
        ownly_backend::auth::handlers::hash_password("password123").expect("hash password");

    sqlx::query(
        "INSERT INTO users (id, email, password_hash, role, enabled) VALUES ($1, $2, $3, 'user', true)",
    )
    .bind(&user_id)
    .bind(&email)
    .bind(&password_hash)
    .execute(&state.pool)
    .await
    .expect("insert user");

    sqlx::query("INSERT INTO folders (id, user_id, name) VALUES ($1, $2, 'Parent')")
        .bind(&parent_id)
        .bind(&user_id)
        .execute(&state.pool)
        .await
        .expect("insert parent");

    sqlx::query("INSERT INTO folders (id, user_id, parent_id, name) VALUES ($1, $2, $3, 'Child')")
        .bind(&child_id)
        .bind(&user_id)
        .bind(&parent_id)
        .execute(&state.pool)
        .await
        .expect("insert nested child");

    let token = ownly_backend::auth::handlers::create_token(
        user_id.clone(),
        email,
        "user".into(),
        &state.jwt_secret,
        None,
        0,
    )
    .expect("token");

    let app = create_router(state.clone());
    let patch = app
        .oneshot(
            Request::builder()
                .method("PATCH")
                .uri(format!("/api/v1/folders/{child_id}"))
                .header("authorization", format!("Bearer {token}"))
                .header("content-type", "application/json")
                .body(Body::from(json!({ "parent_id": null }).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(patch.status(), StatusCode::OK);
    let patch_json = response_json(patch).await;
    assert!(patch_json["folder"]["parent_id"].is_null());

    let stored_parent: Option<String> = sqlx::query_scalar(
        "SELECT parent_id::text FROM folders WHERE id = $1 AND user_id = $2",
    )
    .bind(&child_id)
    .bind(&user_id)
    .fetch_one(&state.pool)
    .await
    .expect("read parent_id");

    assert!(stored_parent.is_none());

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

// Human: Moving a parent folder into its child must be rejected to prevent cycles.
// Agent: PATCH parent into descendant; EXPECT 400 bad_request envelope.
#[tokio::test]
async fn folder_move_rejects_cycle_into_subfolder() {
    let Some(state) = test_harness::TestHarness::state("folder_move_rejects_cycle_into_subfolder")
        .await
    else {
        return;
    };

    let user_id = uuid::Uuid::new_v4().to_string();
    let parent_id = uuid::Uuid::new_v4().to_string();
    let child_id = uuid::Uuid::new_v4().to_string();
    let email = format!("cycle-folder-{user_id}@example.com");
    let password_hash =
        ownly_backend::auth::handlers::hash_password("password123").expect("hash password");

    sqlx::query(
        "INSERT INTO users (id, email, password_hash, role, enabled) VALUES ($1, $2, $3, 'user', true)",
    )
    .bind(&user_id)
    .bind(&email)
    .bind(&password_hash)
    .execute(&state.pool)
    .await
    .expect("insert user");

    sqlx::query("INSERT INTO folders (id, user_id, name) VALUES ($1, $2, 'Parent')")
        .bind(&parent_id)
        .bind(&user_id)
        .execute(&state.pool)
        .await
        .expect("insert parent");

    sqlx::query("INSERT INTO folders (id, user_id, parent_id, name) VALUES ($1, $2, $3, 'Child')")
        .bind(&child_id)
        .bind(&user_id)
        .bind(&parent_id)
        .execute(&state.pool)
        .await
        .expect("insert child");

    let token = ownly_backend::auth::handlers::create_token(
        user_id.clone(),
        email,
        "user".into(),
        &state.jwt_secret,
        None,
        0,
    )
    .expect("token");

    let app = create_router(state.clone());
    let patch = app
        .oneshot(
            Request::builder()
                .method("PATCH")
                .uri(format!("/api/v1/folders/{parent_id}"))
                .header("authorization", format!("Bearer {token}"))
                .header("content-type", "application/json")
                .body(Body::from(json!({ "parent_id": child_id }).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(patch.status(), StatusCode::BAD_REQUEST);

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

// Human: Leaving a user share must revoke content.read grants (SEC-015 exploit regression).
// Agent: DELETE /shares/with-me/{id}; EXPECT subsequent download forbidden for grantee.
#[tokio::test]
async fn leave_shared_with_me_revokes_content_read_grant() {
    let Some(state) = test_harness::TestHarness::state("leave_shared_with_me_revokes_content_read_grant").await else {
        return;
    };

    let owner_id = uuid::Uuid::new_v4().to_string();
    let grantee_id = uuid::Uuid::new_v4().to_string();
    let file_id = uuid::Uuid::new_v4().to_string();
    let share_id = uuid::Uuid::new_v4().to_string();
    let password_hash =
        ownly_backend::auth::handlers::hash_password("password123").expect("hash password");

    for (id, email) in [
        (owner_id.as_str(), format!("owner-{owner_id}@example.com")),
        (grantee_id.as_str(), format!("grantee-{grantee_id}@example.com")),
    ] {
        sqlx::query(
            "INSERT INTO users (id, email, password_hash, role, enabled) VALUES ($1, $2, $3, 'pro', true)",
        )
        .bind(id)
        .bind(email)
        .bind(&password_hash)
        .execute(&state.pool)
        .await
        .expect("insert user");
    }

    sqlx::query(
        "INSERT INTO files (id, user_id, name, storage_key, mime_type, size_bytes) \
         VALUES ($1, $2, 'leave-share.txt', $3, 'text/plain', 4)",
    )
    .bind(&file_id)
    .bind(&owner_id)
    .bind(format!("users/{owner_id}/files/{file_id}/blob"))
    .execute(&state.pool)
    .await
    .expect("insert file");

    sqlx::query(
        "INSERT INTO resource_user_shares \
         (id, owner_user_id, grantee_user_id, resource_type, resource_id, permission) \
         VALUES ($1, $2, $3, 'file', $4, 'read')",
    )
    .bind(&share_id)
    .bind(&owner_id)
    .bind(&grantee_id)
    .bind(&file_id)
    .execute(&state.pool)
    .await
    .expect("insert user share");

    ownly_backend::authz::grant_content_read_for_user_share(
        &state.pool,
        &owner_id,
        &grantee_id,
        "file",
        &file_id,
    )
    .await
    .expect("grant content.read");

    let grantee_token = ownly_backend::auth::handlers::create_token(
        grantee_id.clone(),
        format!("grantee-{grantee_id}@example.com"),
        "pro".into(),
        &state.jwt_secret,
        None,
        0,
    )
    .expect("grantee token");

    let app = create_router(state.clone());
    let leave = app
        .clone()
        .oneshot(
            Request::builder()
                .method("DELETE")
                .uri(format!("/api/v1/shares/with-me/{share_id}"))
                .header("authorization", format!("Bearer {grantee_token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(leave.status(), StatusCode::OK);

    let download = app
        .oneshot(
            Request::builder()
                .uri(format!("/api/v1/files/{file_id}/download"))
                .header("authorization", format!("Bearer {grantee_token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(download.status(), StatusCode::FORBIDDEN);

    sqlx::query("DELETE FROM permission_grants WHERE resource_id = $1")
        .bind(&file_id)
        .execute(&state.pool)
        .await
        .ok();
    sqlx::query("DELETE FROM resource_user_shares WHERE id = $1")
        .bind(&share_id)
        .execute(&state.pool)
        .await
        .ok();
    sqlx::query("DELETE FROM files WHERE id = $1")
        .bind(&file_id)
        .execute(&state.pool)
        .await
        .ok();
    sqlx::query("DELETE FROM users WHERE id = ANY($1)")
        .bind(&[owner_id, grantee_id])
        .execute(&state.pool)
        .await
        .ok();
}

// Human: instance.admin must not be self-granted via permissions API (SEC-016 exploit regression).
#[tokio::test]
async fn instance_admin_grant_via_permissions_api_is_rejected() {
    let Some(state) = test_harness::TestHarness::state("instance_admin_grant_via_permissions_api_is_rejected").await
    else {
        return;
    };

    let manager_id = uuid::Uuid::new_v4().to_string();
    let password_hash =
        ownly_backend::auth::handlers::hash_password("password123").expect("hash password");

    sqlx::query(
        "INSERT INTO users (id, email, password_hash, role, enabled) VALUES ($1, $2, $3, 'pro', true)",
    )
    .bind(&manager_id)
    .bind(format!("perm-mgr-{manager_id}@example.com"))
    .bind(&password_hash)
    .execute(&state.pool)
    .await
    .expect("insert manager");

    let grant_id = uuid::Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO permission_grants \
         (id, subject_type, subject_id, resource_type, resource_id, permission, effect, granted_by) \
         VALUES ($1, 'user', $2, 'instance', NULL, 'instance.permissions.manage', 'allow', $2)",
    )
    .bind(&grant_id)
    .bind(&manager_id)
    .execute(&state.pool)
    .await
    .expect("insert manage grant");

    let token = ownly_backend::auth::handlers::create_token(
        manager_id.clone(),
        format!("perm-mgr-{manager_id}@example.com"),
        "pro".into(),
        &state.jwt_secret,
        None,
        0,
    )
    .expect("manager token");

    let app = create_router(state.clone());
    let body = json!({
        "subject_type": "user",
        "subject_id": manager_id,
        "resource_type": "instance",
        "permission": "instance.admin",
        "effect": "allow"
    });
    let response = app
        .oneshot(
            Request::builder()
                .method("PUT")
                .uri("/api/v1/admin/permissions")
                .header("authorization", format!("Bearer {token}"))
                .header("content-type", "application/json")
                .body(Body::from(body.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::FORBIDDEN);

    sqlx::query("DELETE FROM permission_grants WHERE subject_id = $1")
        .bind(&manager_id)
        .execute(&state.pool)
        .await
        .ok();
    sqlx::query("DELETE FROM users WHERE id = $1")
        .bind(&manager_id)
        .execute(&state.pool)
        .await
        .ok();
}

// Human: Self-service password change must invalidate existing JWTs (SEC-017 exploit regression).
#[tokio::test]
async fn change_password_invalidates_existing_jwt() {
    let Some(state) = test_harness::TestHarness::state("change_password_invalidates_existing_jwt").await else {
        return;
    };

    let user_id = uuid::Uuid::new_v4().to_string();
    let email = format!("pw-change-{user_id}@example.com");
    let password_hash =
        ownly_backend::auth::handlers::hash_password("password123").expect("hash password");

    sqlx::query(
        "INSERT INTO users (id, email, password_hash, role, enabled) VALUES ($1, $2, $3, 'user', true)",
    )
    .bind(&user_id)
    .bind(&email)
    .bind(&password_hash)
    .execute(&state.pool)
    .await
    .expect("insert user");

    let old_token = ownly_backend::auth::handlers::create_token(
        user_id.clone(),
        email.clone(),
        "user".into(),
        &state.jwt_secret,
        None,
        0,
    )
    .expect("old token");

    let app = create_router(state.clone());
    let patch_body = json!({
        "current_password": "password123",
        "new_password": "newpassword456"
    });
    let patch = app
        .clone()
        .oneshot(
            Request::builder()
                .method("PATCH")
                .uri("/api/v1/me/password")
                .header("authorization", format!("Bearer {old_token}"))
                .header("content-type", "application/json")
                .body(Body::from(patch_body.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(patch.status(), StatusCode::OK);

    let me = app
        .oneshot(
            Request::builder()
                .uri("/api/v1/me")
                .header("authorization", format!("Bearer {old_token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(me.status(), StatusCode::UNAUTHORIZED);

    sqlx::query("DELETE FROM users WHERE id = $1")
        .bind(&user_id)
        .execute(&state.pool)
        .await
        .ok();
}

// Human: Stream tickets must not authorize trashed files (SEC-018 exploit regression).
#[tokio::test]
async fn trashed_file_stream_ticket_is_denied() {
    let Some(state) = test_harness::TestHarness::state("trashed_file_stream_ticket_is_denied").await else {
        return;
    };

    let user_id = uuid::Uuid::new_v4().to_string();
    let file_id = uuid::Uuid::new_v4().to_string();
    let password_hash =
        ownly_backend::auth::handlers::hash_password("password123").expect("hash password");

    sqlx::query(
        "INSERT INTO users (id, email, password_hash, role, enabled) VALUES ($1, $2, $3, 'user', true)",
    )
    .bind(&user_id)
    .bind(format!("stream-ticket-{user_id}@example.com"))
    .bind(&password_hash)
    .execute(&state.pool)
    .await
    .expect("insert user");

    sqlx::query(
        "INSERT INTO files (id, user_id, name, storage_key, mime_type, size_bytes, deleted_at) \
         VALUES ($1, $2, 'trashed-stream.txt', 'storage/trashed-stream', 'text/plain', 4, now())",
    )
    .bind(&file_id)
    .bind(&user_id)
    .execute(&state.pool)
    .await
    .expect("insert trashed file");

    let ticket = ownly_backend::stream_ticket::generate_ticket(
        &file_id,
        &user_id,
        &state.signing_secret,
        3600,
    );

    let app = create_router(state.clone());
    let response = app
        .oneshot(
            Request::builder()
                .uri(format!("/api/v1/files/{file_id}/stream?ticket={ticket}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::NOT_FOUND);

    sqlx::query("DELETE FROM files WHERE id = $1")
        .bind(&file_id)
        .execute(&state.pool)
        .await
        .ok();
    sqlx::query("DELETE FROM users WHERE id = $1")
        .bind(&user_id)
        .execute(&state.pool)
        .await
        .ok();
}

// Human: Storage quota must block copy operations that would exceed the cap (SEC-014 exploit regression).
#[tokio::test]
async fn copy_file_rejected_when_quota_exceeded() {
    let Some(state) = test_harness::TestHarness::state("copy_file_rejected_when_quota_exceeded").await else {
        return;
    };

    let user_id = uuid::Uuid::new_v4().to_string();
    let source_id = uuid::Uuid::new_v4().to_string();
    let password_hash =
        ownly_backend::auth::handlers::hash_password("password123").expect("hash password");
    let gb: i64 = 1024 * 1024 * 1024;

    sqlx::query(
        "INSERT INTO users (id, email, password_hash, role, enabled, storage_quota_gb) \
         VALUES ($1, $2, $3, 'user', true, 1)",
    )
    .bind(&user_id)
    .bind(format!("quota-copy-{user_id}@example.com"))
    .bind(&password_hash)
    .execute(&state.pool)
    .await
    .expect("insert user");

    sqlx::query(
        "INSERT INTO files (id, user_id, name, storage_key, mime_type, size_bytes) \
         VALUES ($1, $2, 'big.bin', $3, 'application/octet-stream', $4)",
    )
    .bind(&source_id)
    .bind(&user_id)
    .bind(format!("users/{user_id}/files/{source_id}/blob"))
    .bind(gb - 1024)
    .execute(&state.pool)
    .await
    .expect("insert source file");

    let token = ownly_backend::auth::handlers::create_token(
        user_id.clone(),
        format!("quota-copy-{user_id}@example.com"),
        "user".into(),
        &state.jwt_secret,
        None,
        0,
    )
    .expect("token");

    let app = create_router(state.clone());
    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/api/v1/files/{source_id}/copy"))
                .header("authorization", format!("Bearer {token}"))
                .header("content-type", "application/json")
                .body(Body::from("{}".to_string()))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::PAYLOAD_TOO_LARGE);

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

// Human: Admin user delete must fail closed when audit rows cannot be written (SEC-040).
// Agent: RENAME audit_logs; DELETE /admin/users/:id; EXPECT 500; VERIFY target user still exists.
#[tokio::test]
async fn admin_delete_user_rolls_back_when_audit_write_fails() {
    let Some(state) = test_harness::TestHarness::state("admin_delete_user_rolls_back_when_audit_write_fails")
        .await
    else {
        return;
    };

    let admin_id = uuid::Uuid::new_v4().to_string();
    let target_id = uuid::Uuid::new_v4().to_string();
    let password_hash =
        ownly_backend::auth::handlers::hash_password("password123").expect("hash password");

    sqlx::query(
        "INSERT INTO users (id, email, password_hash, role, enabled) VALUES ($1, $2, $3, 'admin', true)",
    )
    .bind(&admin_id)
    .bind(format!("admin-audit-fail-{admin_id}@example.com"))
    .bind(&password_hash)
    .execute(&state.pool)
    .await
    .expect("insert admin");

    sqlx::query(
        "INSERT INTO users (id, email, password_hash, role, enabled) VALUES ($1, $2, $3, 'pro', true)",
    )
    .bind(&target_id)
    .bind(format!("target-audit-fail-{target_id}@example.com"))
    .bind(&password_hash)
    .execute(&state.pool)
    .await
    .expect("insert target");

    let admin_token = ownly_backend::auth::handlers::create_token(
        admin_id.clone(),
        format!("admin-audit-fail-{admin_id}@example.com"),
        "admin".into(),
        &state.jwt_secret,
        None,
        0,
    )
    .expect("admin token");

    sqlx::query("ALTER TABLE audit_logs RENAME TO audit_logs_sec040_blocked")
        .execute(&state.pool)
        .await
        .expect("block audit_logs table");

    let app = create_router(state.clone());
    let response = app
        .oneshot(
            Request::builder()
                .method("DELETE")
                .uri(format!("/api/v1/admin/users/{target_id}"))
                .header("authorization", format!("Bearer {admin_token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);

    let still_there: Option<(String,)> = sqlx::query_as("SELECT id FROM users WHERE id = $1")
        .bind(&target_id)
        .fetch_optional(&state.pool)
        .await
        .expect("lookup target user");
    assert!(
        still_there.is_some(),
        "user delete must roll back when audit write fails"
    );

    sqlx::query("ALTER TABLE audit_logs_sec040_blocked RENAME TO audit_logs")
        .execute(&state.pool)
        .await
        .expect("restore audit_logs table");

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
