//! HTTP integration tests for the shared collab engine (document + spreadsheet + public).

mod test_harness;

use axum::body::{to_bytes, Body};
use axum::http::{Request, StatusCode};
use ownly_backend::create_router;
use serde_json::{json, Value};
use tower::ServiceExt;

async fn response_json(response: axum::response::Response) -> Value {
    let bytes = to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("response body");
    serde_json::from_slice(&bytes).expect("json body")
}

struct SeededUser {
    user_id: String,
    token: String,
    file_id: String,
}

async fn seed_user_with_file(
    state: &ownly_backend::AppState,
    label: &str,
) -> SeededUser {
    let user_id = uuid::Uuid::new_v4().to_string();
    let file_id = uuid::Uuid::new_v4().to_string();
    let email = format!("{label}-{user_id}@example.com");
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
         VALUES ($1, $2, $3, $4, 'text/rtf', 32)",
    )
    .bind(&file_id)
    .bind(&user_id)
    .bind(format!("{label}.rtf"))
    .bind(format!("storage/{file_id}"))
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

    let _ = email;
    SeededUser {
        user_id,
        token,
        file_id,
    }
}

async fn join_document(
    app: axum::Router,
    token: &str,
    file_id: &str,
    display_name: &str,
    seed_text: &str,
) -> Value {
    let body = json!({
        "room_kind": "document",
        "file_id": file_id,
        "display_name": display_name,
        "initial_html": format!("<p>{seed_text}</p>"),
        "initial_text": seed_text,
    });
    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/collab/sessions")
                .header("content-type", "application/json")
                .header("authorization", format!("Bearer {token}"))
                .body(Body::from(body.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK, "join should succeed");
    response_json(response).await
}

async fn post_op(
    app: axum::Router,
    token: &str,
    session_id: &str,
    base_seq: u64,
    op_type: &str,
    payload: Value,
) -> axum::response::Response {
    let body = json!({
        "base_seq": base_seq,
        "op_type": op_type,
        "payload": payload,
        "client_op_id": uuid::Uuid::new_v4().to_string(),
    });
    app.oneshot(
        Request::builder()
            .method("POST")
            .uri(format!(
                "/api/v1/collab/sessions/{}/ops",
                session_id
            ))
            .header("content-type", "application/json")
            .header("authorization", format!("Bearer {token}"))
            .body(Body::from(body.to_string()))
            .unwrap(),
    )
    .await
    .unwrap()
}

async fn cleanup_user(state: &ownly_backend::AppState, user_id: &str) {
    let _ = sqlx::query("DELETE FROM public_shares WHERE user_id = $1")
        .bind(user_id)
        .execute(&state.pool)
        .await;
    let _ = sqlx::query("DELETE FROM permission_grants WHERE subject_id = $1 OR granted_by = $1")
        .bind(user_id)
        .execute(&state.pool)
        .await;
    let _ = sqlx::query("DELETE FROM files WHERE user_id = $1")
        .bind(user_id)
        .execute(&state.pool)
        .await;
    let _ = sqlx::query("DELETE FROM users WHERE id = $1")
        .bind(user_id)
        .execute(&state.pool)
        .await;
}

/// Human: Grant content.write (+ read) on a file to another user for multi-actor collab tests.
async fn grant_file_edit(
    state: &ownly_backend::AppState,
    grantee_user_id: &str,
    file_id: &str,
    granted_by: &str,
) {
    for permission in ["content.read", "content.write"] {
        sqlx::query(
            "INSERT INTO permission_grants \
             (id, subject_type, subject_id, resource_type, resource_id, permission, effect, granted_by) \
             VALUES ($1, 'user', $2, 'file', $3, $4, 'allow', $5) \
             ON CONFLICT DO NOTHING",
        )
        .bind(uuid::Uuid::new_v4().to_string())
        .bind(grantee_user_id)
        .bind(file_id)
        .bind(permission)
        .bind(granted_by)
        .execute(&state.pool)
        .await
        .expect("insert permission grant");
    }
}

// Human: Unauthenticated callers cannot open collab sessions.
// Agent: POST /api/v1/collab/sessions without auth; EXPECT 401.
#[tokio::test]
async fn collab_join_requires_authentication() {
    let Some(state) =
        test_harness::TestHarness::state("collab_join_requires_authentication").await
    else {
        return;
    };
    let app = create_router(state);
    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/collab/sessions")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "room_kind": "document",
                        "file_id": "x",
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

// Human: Owner can join a document room, post a replace, and list the op log.
// Agent: JOIN → POST replace → GET ops; EXPECT seq 1 and updated snapshot text.
#[tokio::test]
async fn collab_document_join_replace_and_list_ops() {
    let Some(state) =
        test_harness::TestHarness::state("collab_document_join_replace_and_list_ops").await
    else {
        return;
    };
    let user = seed_user_with_file(&state, "collab-doc").await;
    let app = create_router(state.clone());

    let session = join_document(
        app.clone(),
        &user.token,
        &user.file_id,
        "Alice",
        "hello world",
    )
    .await;
    assert_eq!(session["room_kind"], "document");
    assert_eq!(session["file_id"], user.file_id);
    assert_eq!(session["document_text"], "hello world");
    assert_eq!(session["latest_seq"], 0);
    let session_id = session["id"].as_str().expect("session id").to_string();
    assert!(session["participants"]
        .as_array()
        .unwrap()
        .iter()
        .any(|p| p["user_id"] == user.user_id));

    let op_resp = post_op(
        app.clone(),
        &user.token,
        &session_id,
        0,
        "replace",
        json!({ "index": 0, "delete": 0, "insert": "X" }),
    )
    .await;
    assert_eq!(op_resp.status(), StatusCode::OK);
    let op = response_json(op_resp).await;
    assert_eq!(op["seq"], 1);
    assert_eq!(op["op_type"], "replace");
    assert_eq!(op["payload"]["insert"], "X");

    let list_resp = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(format!(
                    "/api/v1/collab/sessions/{session_id}/ops?after_seq=0"
                ))
                .header("authorization", format!("Bearer {}", user.token))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(list_resp.status(), StatusCode::OK);
    let ops = response_json(list_resp).await;
    let ops = ops.as_array().expect("ops array");
    assert_eq!(ops.len(), 1);
    assert_eq!(ops[0]["seq"], 1);

    let get_resp = app
        .oneshot(
            Request::builder()
                .uri(format!("/api/v1/collab/sessions/{session_id}"))
                .header("authorization", format!("Bearer {}", user.token))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(get_resp.status(), StatusCode::OK);
    let snap = response_json(get_resp).await;
    assert_eq!(snap["latest_seq"], 1);
    assert_eq!(snap["document_text"], "Xhello world");

    cleanup_user(&state, &user.user_id).await;
}

// Human: Concurrent replace ops from two users converge via server OT.
// Agent: A inserts at start with base 0; B inserts at end with base 0 after A applied.
#[tokio::test]
async fn collab_document_concurrent_replace_converges() {
    let Some(state) =
        test_harness::TestHarness::state("collab_document_concurrent_replace_converges").await
    else {
        return;
    };
    let alice = seed_user_with_file(&state, "collab-a").await;
    let bob_id = uuid::Uuid::new_v4().to_string();
    let bob_email = format!("collab-b-{bob_id}@example.com");
    let password_hash =
        ownly_backend::auth::handlers::hash_password("password123").expect("hash");
    sqlx::query(
        "INSERT INTO users (id, email, password_hash, role, enabled) VALUES ($1, $2, $3, 'user', true)",
    )
    .bind(&bob_id)
    .bind(&bob_email)
    .bind(&password_hash)
    .execute(&state.pool)
    .await
    .expect("insert bob");
    grant_file_edit(&state, &bob_id, &alice.file_id, &alice.user_id).await;

    let bob_token = ownly_backend::auth::handlers::create_token(
        bob_id.clone(),
        bob_email,
        "user".into(),
        &state.jwt_secret,
        None,
        0,
    )
    .expect("bob token");

    let app = create_router(state.clone());
    let session = join_document(
        app.clone(),
        &alice.token,
        &alice.file_id,
        "Alice",
        "hello world",
    )
    .await;
    let session_id = session["id"].as_str().unwrap().to_string();

    // Bob joins same room
    let bob_join = join_document(app.clone(), &bob_token, &alice.file_id, "Bob", "hello world")
        .await;
    assert_eq!(bob_join["id"], session_id);

    let a = post_op(
        app.clone(),
        &alice.token,
        &session_id,
        0,
        "replace",
        json!({ "index": 0, "delete": 0, "insert": "X" }),
    )
    .await;
    assert_eq!(a.status(), StatusCode::OK);

    // Bob still believes base_seq=0 (concurrent) — server transforms through Alice's op.
    let b = post_op(
        app.clone(),
        &bob_token,
        &session_id,
        0,
        "replace",
        json!({ "index": 11, "delete": 0, "insert": "Y" }),
    )
    .await;
    assert_eq!(
        b.status(),
        StatusCode::OK,
        "bob op failed: {:?}",
        response_json(b).await
    );

    let snap = app
        .oneshot(
            Request::builder()
                .uri(format!("/api/v1/collab/sessions/{session_id}"))
                .header("authorization", format!("Bearer {}", alice.token))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let json = response_json(snap).await;
    assert_eq!(json["document_text"], "Xhello worldY");
    assert_eq!(json["latest_seq"], 2);

    cleanup_user(&state, &alice.user_id).await;
    cleanup_user(&state, &bob_id).await;
}

// Human: Exclusive range locks block foreign replace ops with 409.
// Agent: lock [0,3) then foreign replace inside range EXPECT conflict.
#[tokio::test]
async fn collab_document_lock_blocks_foreign_replace() {
    let Some(state) =
        test_harness::TestHarness::state("collab_document_lock_blocks_foreign_replace").await
    else {
        return;
    };
    let alice = seed_user_with_file(&state, "collab-lock").await;
    let bob_id = uuid::Uuid::new_v4().to_string();
    let bob_email = format!("lock-b-{bob_id}@example.com");
    let password_hash =
        ownly_backend::auth::handlers::hash_password("password123").expect("hash");
    sqlx::query(
        "INSERT INTO users (id, email, password_hash, role, enabled) VALUES ($1, $2, $3, 'user', true)",
    )
    .bind(&bob_id)
    .bind(&bob_email)
    .bind(&password_hash)
    .execute(&state.pool)
    .await
    .expect("insert bob");
    grant_file_edit(&state, &bob_id, &alice.file_id, &alice.user_id).await;

    let bob_token = ownly_backend::auth::handlers::create_token(
        bob_id.clone(),
        bob_email,
        "user".into(),
        &state.jwt_secret,
        None,
        0,
    )
    .expect("bob token");

    let app = create_router(state.clone());
    let session = join_document(app.clone(), &alice.token, &alice.file_id, "Alice", "abcdef")
        .await;
    let session_id = session["id"].as_str().unwrap().to_string();
    let _ = join_document(app.clone(), &bob_token, &alice.file_id, "Bob", "abcdef").await;

    let lock = post_op(
        app.clone(),
        &alice.token,
        &session_id,
        0,
        "lock",
        json!({ "start": 0, "end": 3 }),
    )
    .await;
    assert_eq!(lock.status(), StatusCode::OK);

    let blocked = post_op(
        app.clone(),
        &bob_token,
        &session_id,
        1,
        "replace",
        json!({ "index": 1, "delete": 1, "insert": "Z" }),
    )
    .await;
    assert_eq!(blocked.status(), StatusCode::CONFLICT);
    let err = response_json(blocked).await;
    assert_eq!(err["error"]["code"], "conflict");

    cleanup_user(&state, &alice.user_id).await;
    cleanup_user(&state, &bob_id).await;
}

// Human: format_commit requires matching plain text or returns conflict.
// Agent: POST format_commit with wrong text EXPECT 409 text mismatch.
#[tokio::test]
async fn collab_document_format_commit_text_mismatch() {
    let Some(state) =
        test_harness::TestHarness::state("collab_document_format_commit_text_mismatch").await
    else {
        return;
    };
    let user = seed_user_with_file(&state, "collab-fmt").await;
    let app = create_router(state.clone());
    let session = join_document(app.clone(), &user.token, &user.file_id, "A", "abc").await;
    let session_id = session["id"].as_str().unwrap().to_string();

    let bad = post_op(
        app.clone(),
        &user.token,
        &session_id,
        0,
        "format_commit",
        json!({ "html": "<p><b>abX</b></p>", "text": "abX" }),
    )
    .await;
    assert_eq!(bad.status(), StatusCode::CONFLICT);

    let good = post_op(
        app,
        &user.token,
        &session_id,
        0,
        "format_commit",
        json!({ "html": "<p><b>abc</b></p>", "text": "abc" }),
    )
    .await;
    assert_eq!(good.status(), StatusCode::OK);

    cleanup_user(&state, &user.user_id).await;
}

// Human: Spreadsheet room accepts cell_edit ops under the same engine.
// Agent: JOIN spreadsheet → POST cell_edit; EXPECT seq 1.
#[tokio::test]
async fn collab_spreadsheet_join_and_cell_edit() {
    let Some(state) =
        test_harness::TestHarness::state("collab_spreadsheet_join_and_cell_edit").await
    else {
        return;
    };
    let user = seed_user_with_file(&state, "collab-ss").await;
    // Fix mime for spreadsheet-ish name
    sqlx::query("UPDATE files SET name = 'sheet.xlsx', mime_type = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' WHERE id = $1")
        .bind(&user.file_id)
        .execute(&state.pool)
        .await
        .expect("update mime");

    let app = create_router(state.clone());
    let join_body = json!({
        "room_kind": "spreadsheet",
        "file_id": user.file_id,
        "display_name": "SheetUser",
    });
    let join_resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/collab/sessions")
                .header("content-type", "application/json")
                .header("authorization", format!("Bearer {}", user.token))
                .body(Body::from(join_body.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(join_resp.status(), StatusCode::OK);
    let session = response_json(join_resp).await;
    assert_eq!(session["room_kind"], "spreadsheet");
    let session_id = session["id"].as_str().unwrap().to_string();

    let op_resp = post_op(
        app,
        &user.token,
        &session_id,
        0,
        "cell_edit",
        json!({ "sheet": "Sheet1", "cell": "A1", "value": "42" }),
    )
    .await;
    assert_eq!(op_resp.status(), StatusCode::OK);
    let op = response_json(op_resp).await;
    assert_eq!(op["seq"], 1);
    assert_eq!(op["op_type"], "cell_edit");

    cleanup_user(&state, &user.user_id).await;
}

// Human: Public allow_edit share guests can join document collab and submit ops.
// Agent: SEED share allow_edit; POST public join + op with guest_id.
#[tokio::test]
async fn collab_public_document_guest_join_and_op() {
    let Some(state) =
        test_harness::TestHarness::state("collab_public_document_guest_join_and_op").await
    else {
        return;
    };
    let user = seed_user_with_file(&state, "collab-pub").await;
    let share_id = uuid::Uuid::new_v4().to_string();
    let token = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";

    sqlx::query(
        "INSERT INTO public_shares (id, token, user_id, resource_type, resource_id, allow_edit) \
         VALUES ($1, $2, $3, 'file', $4, true)",
    )
    .bind(&share_id)
    .bind(token)
    .bind(&user.user_id)
    .bind(&user.file_id)
    .execute(&state.pool)
    .await
    .expect("insert public share");

    let guest_id = uuid::Uuid::new_v4().to_string();
    let app = create_router(state.clone());

    let join_body = json!({
        "file_id": user.file_id,
        "display_name": "Guest",
        "guest_id": guest_id,
        "room_kind": "document",
        "initial_html": "<p>shared</p>",
        "initial_text": "shared",
    });
    let join_resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/api/v1/public/shares/{token}/collab/sessions"))
                .header("content-type", "application/json")
                .body(Body::from(join_body.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(
        join_resp.status(),
        StatusCode::OK,
        "public join: {:?}",
        // avoid consuming body twice
        join_resp.status()
    );
    let session = response_json(join_resp).await;
    let session_id = session["id"].as_str().unwrap().to_string();
    assert!(session["participants"]
        .as_array()
        .unwrap()
        .iter()
        .any(|p| p["user_id"].as_str().unwrap_or("").starts_with("guest:")));

    let op_body = json!({
        "base_seq": 0,
        "op_type": "replace",
        "payload": { "index": 0, "delete": 0, "insert": "!" },
        "guest_id": guest_id,
        "client_op_id": "guest-op-1",
    });
    let op_resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!(
                    "/api/v1/public/shares/{token}/collab/sessions/{session_id}/ops"
                ))
                .header("content-type", "application/json")
                .body(Body::from(op_body.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(op_resp.status(), StatusCode::OK);
    let op = response_json(op_resp).await;
    assert_eq!(op["seq"], 1);

    let list_resp = app
        .oneshot(
            Request::builder()
                .uri(format!(
                    "/api/v1/public/shares/{token}/collab/sessions/{session_id}/ops?after_seq=0&guest_id={guest_id}"
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(list_resp.status(), StatusCode::OK);
    let ops = response_json(list_resp).await;
    assert_eq!(ops.as_array().unwrap().len(), 1);

    cleanup_user(&state, &user.user_id).await;
}

// Human: Heartbeat updates presence fields on document sessions.
// Agent: POST heartbeat with selection; GET session EXPECT selection on participant.
#[tokio::test]
async fn collab_document_heartbeat_presence() {
    let Some(state) =
        test_harness::TestHarness::state("collab_document_heartbeat_presence").await
    else {
        return;
    };
    let user = seed_user_with_file(&state, "collab-hb").await;
    let app = create_router(state.clone());
    let session = join_document(app.clone(), &user.token, &user.file_id, "HB", "text").await;
    let session_id = session["id"].as_str().unwrap().to_string();

    let hb = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!(
                    "/api/v1/collab/sessions/{session_id}/heartbeat"
                ))
                .header("content-type", "application/json")
                .header("authorization", format!("Bearer {}", user.token))
                .body(Body::from(
                    json!({
                        "selection_start": 1,
                        "selection_end": 2,
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(hb.status(), StatusCode::OK);
    let view = response_json(hb).await;
    let me = view["participants"]
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["user_id"] == user.user_id)
        .expect("self participant");
    assert_eq!(me["selection_start"], 1);
    assert_eq!(me["selection_end"], 2);

    cleanup_user(&state, &user.user_id).await;
}
