//! Copy-on-write content history: dedup isolation, version capture, restore, and autosave suppression.

mod test_harness;

use axum::body::{to_bytes, Body};
use axum::http::{Request, StatusCode};
use ownly_backend::create_router;
use tower::ServiceExt;

async fn response_json(response: axum::response::Response) -> serde_json::Value {
    let bytes = to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("response body");
    serde_json::from_slice(&bytes).expect("json body")
}

fn multipart_upload_body(boundary: &str, filename: &str, content: &[u8]) -> Vec<u8> {
    let mut body = Vec::new();
    body.extend_from_slice(format!("--{boundary}\r\n").as_bytes());
    body.extend_from_slice(
        format!("Content-Disposition: form-data; name=\"file\"; filename=\"{filename}\"\r\n")
            .as_bytes(),
    );
    body.extend_from_slice(b"Content-Type: text/plain\r\n\r\n");
    body.extend_from_slice(content);
    body.extend_from_slice(b"\r\n");
    body.extend_from_slice(format!("--{boundary}--\r\n").as_bytes());
    body
}

/// Human: Create an enabled user and return (user_id, bearer token).
async fn seed_user(state: &std::sync::Arc<ownly_backend::AppState>, label: &str) -> String {
    let user_id = uuid::Uuid::new_v4().to_string();
    let email = format!("{label}-{user_id}@example.com");
    let password_hash =
        ownly_backend::auth::handlers::hash_password("password123").expect("hash password");

    sqlx::query(
        "INSERT INTO users (id, email, password_hash, role, enabled) \
         VALUES ($1, $2, $3, 'user', true)",
    )
    .bind(&user_id)
    .bind(&email)
    .bind(&password_hash)
    .execute(&state.pool)
    .await
    .expect("insert user");

    ownly_backend::auth::handlers::create_token(
        user_id,
        email,
        "user".into(),
        &state.jwt_secret,
        None,
        0,
    )
    .expect("token")
}

async fn upload_text(
    app: &axum::Router,
    token: &str,
    filename: &str,
    content: &[u8],
) -> String {
    let boundary = "----ownlyversiontest";
    let body = multipart_upload_body(boundary, filename, content);
    let upload = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/files/upload")
                .header("authorization", format!("Bearer {token}"))
                .header(
                    "content-type",
                    format!("multipart/form-data; boundary={boundary}"),
                )
                .body(Body::from(body))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = upload.status();
    let json = response_json(upload).await;
    assert_eq!(status, StatusCode::OK, "upload {filename}: {json}");
    json["file"]["id"].as_str().expect("file id").to_string()
}

async fn download_bytes(app: &axum::Router, token: &str, file_id: &str) -> Vec<u8> {
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(format!("/api/v1/files/{file_id}/download"))
                .header("authorization", format!("Bearer {token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK, "download {file_id}");
    to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("download body")
        .to_vec()
}

async fn put_content(app: &axum::Router, token: &str, file_id: &str, body: &[u8]) -> StatusCode {
    app.clone()
        .oneshot(
            Request::builder()
                .method("PUT")
                .uri(format!("/api/v1/files/{file_id}/content"))
                .header("authorization", format!("Bearer {token}"))
                .body(Body::from(body.to_vec()))
                .unwrap(),
        )
        .await
        .unwrap()
        .status()
}

// Human: REGRESSION — editing one of two content-deduped files must not rewrite the other's bytes.
// Agent: Migration 035 lets rows share a storage_key; the old in-place PUT corrupted every sibling.
//        ALSO asserts history captures the replaced bytes and restore returns them.
#[tokio::test]
async fn content_edit_isolates_deduped_sibling_and_records_history() {
    let Some(state) =
        test_harness::TestHarness::state("content_edit_isolates_deduped_sibling").await
    else {
        return;
    };

    const ORIGINAL: &[u8] = b"revision one contents";
    const UPDATED: &[u8] = b"revision two contents, rewritten by the editor";

    let token = seed_user(&state, "versioning").await;
    let app = create_router(state.clone());

    // Human: Two uploads of identical bytes — the second dedups onto the first blob.
    let file_a = upload_text(&app, &token, "notes-a.txt", ORIGINAL).await;
    let file_b = upload_text(&app, &token, "notes-b.txt", ORIGINAL).await;

    let ids = vec![file_a.clone(), file_b.clone()];
    let keys: Vec<(String,)> =
        sqlx::query_as("SELECT storage_key FROM files WHERE id = ANY($1) ORDER BY name ASC")
            .bind(&ids)
            .fetch_all(&state.pool)
            .await
            .expect("storage keys");
    assert_eq!(
        keys[0].0, keys[1].0,
        "precondition: identical uploads must share one storage_key"
    );

    assert_eq!(
        put_content(&app, &token, &file_a, UPDATED).await,
        StatusCode::OK
    );

    assert_eq!(
        download_bytes(&app, &token, &file_a).await,
        UPDATED,
        "edited file A serves its new bytes"
    );
    assert_eq!(
        download_bytes(&app, &token, &file_b).await,
        ORIGINAL,
        "sibling B must keep its own bytes when A is edited"
    );

    // Human: B's metadata must be untouched too — a stale size truncates its download.
    let (b_size, b_hash): (i64, Option<String>) =
        sqlx::query_as("SELECT size_bytes, content_hash FROM files WHERE id = $1")
            .bind(&file_b)
            .fetch_one(&state.pool)
            .await
            .expect("sibling row");
    assert_eq!(b_size, ORIGINAL.len() as i64, "sibling size_bytes");

    // Human: A's hash must track its new bytes, or a later upload dedups onto edited content.
    let (a_size, a_hash): (i64, Option<String>) =
        sqlx::query_as("SELECT size_bytes, content_hash FROM files WHERE id = $1")
            .bind(&file_a)
            .fetch_one(&state.pool)
            .await
            .expect("edited row");
    assert_eq!(a_size, UPDATED.len() as i64, "edited size_bytes");
    assert_ne!(
        a_hash, b_hash,
        "edited file must not keep the pre-edit content_hash"
    );

    // Human: History holds exactly the bytes that were replaced.
    let versions = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(format!("/api/v1/files/{file_a}/versions"))
                .header("authorization", format!("Bearer {token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(versions.status(), StatusCode::OK);
    let versions_json = response_json(versions).await;
    assert_eq!(versions_json["current_revision"], 2);
    let entries = versions_json["versions"]
        .as_array()
        .expect("versions array")
        .clone();
    assert_eq!(entries.len(), 1, "one archived revision after one edit");
    assert_eq!(entries[0]["revision"], 1);
    assert_eq!(entries[0]["size_bytes"], ORIGINAL.len() as i64);
    let version_id = entries[0]["id"].as_str().unwrap().to_string();

    let version_content = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(format!(
                    "/api/v1/files/{file_a}/versions/{version_id}/content"
                ))
                .header("authorization", format!("Bearer {token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(version_content.status(), StatusCode::OK);
    let archived = to_bytes(version_content.into_body(), usize::MAX)
        .await
        .expect("version body");
    assert_eq!(archived.as_ref(), ORIGINAL, "archived revision bytes");

    // Human: Restore makes the archived revision current and is itself undoable.
    let restore = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!(
                    "/api/v1/files/{file_a}/versions/{version_id}/restore"
                ))
                .header("authorization", format!("Bearer {token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(restore.status(), StatusCode::OK);

    assert_eq!(
        download_bytes(&app, &token, &file_a).await,
        ORIGINAL,
        "restored file A returns the archived bytes"
    );
    assert_eq!(
        download_bytes(&app, &token, &file_b).await,
        ORIGINAL,
        "sibling B is still untouched after restore"
    );
}

// Human: REGRESSION — an unchanged autosave must not pile up identical revisions.
// Agent: Editors PUT on a timer; only a real byte change may archive a version.
#[tokio::test]
async fn repeated_identical_content_writes_do_not_create_versions() {
    let Some(state) =
        test_harness::TestHarness::state("identical_content_writes_no_versions").await
    else {
        return;
    };

    const BODY: &[u8] = b"unchanged autosave payload";

    let token = seed_user(&state, "autosave").await;
    let app = create_router(state.clone());
    let file_id = upload_text(&app, &token, "autosave.txt", BODY).await;

    for _ in 0..3 {
        assert_eq!(
            put_content(&app, &token, &file_id, BODY).await,
            StatusCode::OK
        );
    }

    let (version_count,): (i64,) =
        sqlx::query_as("SELECT COUNT(*)::BIGINT FROM file_versions WHERE file_id = $1")
            .bind(&file_id)
            .fetch_one(&state.pool)
            .await
            .expect("version count");
    assert_eq!(
        version_count, 0,
        "identical rewrites must not archive revisions"
    );
}

// Human: REGRESSION — deleting a file must not strand its revision blobs in object storage.
// Agent: file_versions cascades on DELETE; keys are captured beforehand and purged after.
#[tokio::test]
async fn permanent_delete_purges_archived_revision_blobs() {
    let Some(state) = test_harness::TestHarness::state("delete_purges_revision_blobs").await else {
        return;
    };

    let token = seed_user(&state, "purge").await;
    let app = create_router(state.clone());
    let file_id = upload_text(&app, &token, "purge-me.txt", b"first").await;

    assert_eq!(
        put_content(&app, &token, &file_id, b"second").await,
        StatusCode::OK
    );

    let version_keys: Vec<(String,)> =
        sqlx::query_as("SELECT storage_key FROM file_versions WHERE file_id = $1")
            .bind(&file_id)
            .fetch_all(&state.pool)
            .await
            .expect("version keys");
    assert_eq!(version_keys.len(), 1, "one archived revision");
    let archived_key = version_keys[0].0.clone();
    assert!(
        state.storage.exists(&archived_key).await.unwrap_or(false),
        "archived blob should exist before delete"
    );

    let delete = app
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
    assert!(
        delete.status().is_success(),
        "permanent delete: {}",
        delete.status()
    );

    let (remaining,): (i64,) =
        sqlx::query_as("SELECT COUNT(*)::BIGINT FROM file_versions WHERE file_id = $1")
            .bind(&file_id)
            .fetch_one(&state.pool)
            .await
            .expect("version rows after delete");
    assert_eq!(remaining, 0, "version rows cascade with the file");
    assert!(
        !state.storage.exists(&archived_key).await.unwrap_or(false),
        "archived revision blob must be purged with the file"
    );
}
