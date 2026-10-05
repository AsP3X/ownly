//! Human: Live check of Ownly's Nebular client against a running Nebular OS node — run after bumping `nebular-os`.
//! Agent: IGNORED by default; NEEDS NEBULAR_LIVE_URL, NOS_JWT_SECRET, NOS_SIGNING_SECRET, and
//! OBJECT_STORAGE_JWT_ISSUER / OBJECT_STORAGE_JWT_AUDIENCE matching the node's NOS_JWT_* (Compose nodes always set
//! ownly / nebular-os). Writes and deletes keys under `ownly-live-test/`.
//!
//! ```text
//! NEBULAR_LIVE_URL=http://127.0.0.1:9000 NOS_JWT_SECRET=... NOS_SIGNING_SECRET=... \
//!   OBJECT_STORAGE_JWT_ISSUER=ownly OBJECT_STORAGE_JWT_AUDIENCE=nebular-os \
//!   cargo test --test nebular_live -- --ignored --nocapture
//! ```

use futures_util::StreamExt;
use ownly_backend::storage::nebula::{NebulaStorage, ServiceAuthCheck};
use ownly_backend::storage::Storage;

fn live_storage() -> (NebulaStorage, String) {
    let base_url = std::env::var("NEBULAR_LIVE_URL").expect("set NEBULAR_LIVE_URL to a running Nebular OS node");
    let jwt_secret = std::env::var("NOS_JWT_SECRET").expect("set NOS_JWT_SECRET");
    let signing_secret = std::env::var("NOS_SIGNING_SECRET").expect("set NOS_SIGNING_SECRET");
    let bucket = std::env::var("NEBULAR_LIVE_BUCKET").unwrap_or_else(|_| "media".into());
    let storage = NebulaStorage::new(base_url.clone(), base_url.clone(), bucket, &jwt_secret, &signing_secret)
        .expect("nebula client");
    (storage, base_url)
}

async fn read_all(storage: &NebulaStorage, key: &str) -> Vec<u8> {
    let (mut stream, _, _) = storage.get_stream(key).await.expect("get_stream");
    let mut body = Vec::new();
    while let Some(chunk) = stream.next().await {
        body.extend_from_slice(&chunk.expect("chunk"));
    }
    body
}

// Human: Every Storage call Ownly makes — buffered PUT (Content-MD5), streaming PUT, GET, HEAD, range prefix,
// presigned GET/PUT, list, batch and prefix delete — must keep working on the pinned Nebular release.
// Agent: ASSERTS round-trip bytes and status codes; CLEANS UP the prefix on success.
#[tokio::test]
#[ignore = "needs a running Nebular OS node (NEBULAR_LIVE_URL)"]
async fn ownly_client_round_trips_against_live_nebular() {
    let (storage, _) = live_storage();
    let run = uuid::Uuid::new_v4();
    let prefix = format!("ownly-live-test/{run}/");
    let http = reqwest::Client::new();

    assert_eq!(
        storage.verify_service_auth().await.expect("auth check"),
        ServiceAuthCheck::Accepted,
        "node refused the service JWT — check NOS_JWT_SECRET and OBJECT_STORAGE_JWT_ISSUER/AUDIENCE"
    );

    // Compressible payload above the blocking-pool MD5 threshold, so the NOSI block path is exercised too.
    let buffered_key = format!("{prefix}buffered.txt");
    let buffered: Vec<u8> = b"ownly nebular live check\n".repeat(20_000);
    storage
        .put(&buffered_key, "text/plain", buffered.clone())
        .await
        .expect("buffered PUT with Content-MD5");
    assert_eq!(read_all(&storage, &buffered_key).await, buffered);
    assert!(storage.exists(&buffered_key).await.expect("HEAD"));
    assert_eq!(storage.object_size(&buffered_key).await.expect("size"), buffered.len() as u64);
    let head = storage.get_object_prefix(&buffered_key, 16).await.expect("range GET");
    assert_eq!(head, &buffered[..16]);

    let streamed_key = format!("{prefix}streamed.bin");
    let streamed: Vec<u8> = (0..3_000_000u32).map(|i| (i % 251) as u8).collect();
    let chunks: Vec<std::io::Result<bytes::Bytes>> = streamed
        .chunks(256 * 1024)
        .map(|chunk| Ok(bytes::Bytes::copy_from_slice(chunk)))
        .collect();
    storage
        .put_stream(
            &streamed_key,
            "application/octet-stream",
            streamed.len() as u64,
            Box::pin(futures_util::stream::iter(chunks)),
        )
        .await
        .expect("streaming PUT");
    assert_eq!(read_all(&storage, &streamed_key).await, streamed);

    // Presigned GET (download links) and presigned PUT (browser-direct upload parts).
    let url = storage.presigned_url(&buffered_key, 600).expect("presign GET");
    let response = http.get(&url).send().await.expect("presigned GET");
    assert_eq!(response.status(), 200);
    assert_eq!(
        response
            .headers()
            .get("x-content-type-options")
            .and_then(|value| value.to_str().ok()),
        Some("nosniff")
    );
    assert_eq!(response.bytes().await.expect("body").as_ref(), buffered.as_slice());

    let part_key = format!("{prefix}staging/part-1");
    let put_url = storage.presigned_put_url(&part_key, 600).expect("presign PUT");
    let response = http
        .put(&put_url)
        .header("content-type", "application/octet-stream")
        .body(vec![42u8; 4096])
        .send()
        .await
        .expect("presigned PUT");
    assert!(response.status().is_success(), "presigned PUT: {}", response.status());
    assert_eq!(read_all(&storage, &part_key).await, vec![42u8; 4096]);

    // A GET signature must not authorize a PUT to the same key.
    let response = http.put(&url).body("x").send().await.expect("PUT with GET signature");
    assert_eq!(response.status(), 401);

    let mut keys = storage.list_keys_with_prefix(&prefix).await.expect("list");
    keys.sort();
    assert_eq!(keys, vec![buffered_key.clone(), part_key.clone(), streamed_key.clone()]);

    let deleted = storage
        .delete_prefix(&format!("{prefix}staging/"))
        .await
        .expect("prefix delete");
    assert_eq!(deleted, 1);
    assert!(!storage.exists(&part_key).await.expect("HEAD after delete"));

    storage.delete(&buffered_key).await.expect("delete");
    storage.delete(&streamed_key).await.expect("delete");
    assert!(storage.list_keys_with_prefix(&prefix).await.expect("list").is_empty());
}
