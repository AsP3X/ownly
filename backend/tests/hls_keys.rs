//! HLS content keys for rows that reuse another row's encrypted segments (dedup, copy, share save).

mod test_harness;

use std::sync::Arc;

use ownly_backend::AppState;

async fn seed_user(state: &Arc<AppState>) -> String {
    let user_id = uuid::Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO users (id, email, password_hash, role, enabled) \
         VALUES ($1, $2, 'x', 'user', true)",
    )
    .bind(&user_id)
    .bind(format!("hls-keys-{user_id}@example.com"))
    .execute(&state.pool)
    .await
    .expect("insert user");
    user_id
}

async fn seed_ready_video(state: &Arc<AppState>, user_id: &str, storage_key: &str, hash: &str) -> String {
    let id = uuid::Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO files (id, user_id, name, storage_key, mime_type, size_bytes, content_hash, \
         hls_ready, segment_count) VALUES ($1, $2, $3, $4, 'video/mp4', 10, $5, true, 1)",
    )
    .bind(&id)
    .bind(user_id)
    .bind(format!("{id}.mp4"))
    .bind(storage_key)
    .bind(hash)
    .execute(&state.pool)
    .await
    .expect("insert video");
    id
}

// Human: A deduped/copied video must decrypt with the source's key, or it never plays.
#[tokio::test]
async fn copy_key_for_file_gives_the_copy_the_source_key() {
    let Some(state) = test_harness::TestHarness::state("copy_key_for_file").await else {
        return;
    };
    let user = seed_user(&state).await;
    let hash = uuid::Uuid::new_v4().to_string();
    let src = seed_ready_video(&state, &user, &format!("users/{user}/files/src"), &hash).await;
    let dup = seed_ready_video(&state, &user, &format!("users/{user}/files/src"), &hash).await;
    let keys = &state.hls_key_store;

    let (_, src_key) = keys.create_key_for_file(&src).await.expect("source key");

    // Human: The backfill test runs DB-wide in parallel and may copy first — assert the outcome.
    keys.copy_key_for_file(&src, &dup).await.expect("copy");
    assert_eq!(keys.get_key(&dup).await.expect("lookup"), Some(src_key));
    // Human: Idempotent — an existing key is never replaced.
    assert!(!keys.copy_key_for_file(&src, &dup).await.expect("copy again"));
}

// Human: Rows created before the fix are repaired at startup — dedup siblings and unambiguous copies.
#[tokio::test]
async fn backfill_restores_keys_for_dedup_and_copied_rows() {
    let Some(state) = test_harness::TestHarness::state("backfill_missing_keys").await else {
        return;
    };
    let user = seed_user(&state).await;
    let hash = uuid::Uuid::new_v4().to_string();
    let shared_key = format!("users/{user}/files/src");
    let src = seed_ready_video(&state, &user, &shared_key, &hash).await;
    let dup = seed_ready_video(&state, &user, &shared_key, &hash).await;
    let copy = seed_ready_video(&state, &user, &format!("users/{user}/files/copy"), &hash).await;
    let keys = &state.hls_key_store;

    let (_, src_key) = keys.create_key_for_file(&src).await.expect("source key");
    keys.backfill_missing_keys_at_startup().await.expect("backfill");

    assert_eq!(keys.get_key(&dup).await.expect("dup"), Some(src_key));
    assert_eq!(keys.get_key(&copy).await.expect("copy"), Some(src_key));
}
