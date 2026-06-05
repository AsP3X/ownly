//! Regression tests for HLS fMP4 playback and segment upload reliability.
//!
//! Guards against two production failures:
//! 1. Playback 404 — manifest referenced `.ts` while Nebular stored `.m4s` segments.
//! 2. Incomplete ingest marked `hls_ready` — object storage OOM/transport errors during parallel PUTs.
//!
//! Run: `cargo test -p ownly-backend hls_playback_regression`

use crate::hls::handlers::{build_playlist_for_playback, open_hls_segment, storage_hls_uses_fmp4};
use crate::hls::playlist::{
    hls_segment_storage_aliases, normalize_playback_segment_basename, playlist_uses_fmp4,
    PlaylistGenerator, HLS_INIT_FILENAME, HLS_SEGMENT_EXTENSION,
};
use crate::hls::segment_upload::{
    plan_segment_upload, segment_upload_failure_message, validate_segment_upload_outcome,
    verify_hls_segments_in_storage, DynamicUploadLimiter, SegmentUploadOutcome,
    HLS_UPLOAD_MAX_PARALLEL_SEGMENTS,
};
use crate::storage::memory::MemoryStorage;
use crate::storage::Storage;

const STORAGE_KEY: &str = "users/test-user/files/test-file";

// Human: Seed a minimal fMP4 HLS bundle in MemoryStorage for handler regression tests.
// Agent: WRITES init.mp4, stream.m3u8 with legacy .ts URIs, and .m4s segment blobs.
async fn seed_fmp4_bundle_with_legacy_ts_playlist(
    storage: &MemoryStorage,
    segment_count: usize,
) {
    storage
        .put(
            &format!("{STORAGE_KEY}/{HLS_INIT_FILENAME}"),
            "video/mp4",
            b"init".to_vec(),
        )
        .await
        .expect("put init");
    let mut playlist = String::from(
        "#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:8\n#EXT-X-MEDIA-SEQUENCE:0\n",
    );
    for i in 0..segment_count {
        playlist.push_str(&format!("#EXTINF:6.000,\nsegments/{i:04}.ts\n"));
    }
    playlist.push_str("#EXT-X-ENDLIST\n");
    storage
        .put(
            &format!("{STORAGE_KEY}/stream.m3u8"),
            "application/vnd.apple.mpegurl",
            playlist.into_bytes(),
        )
        .await
        .expect("put playlist");
    for i in 0..segment_count {
        storage
            .put(
                &format!("{STORAGE_KEY}/segments/{i:04}.{HLS_SEGMENT_EXTENSION}"),
                "video/mp4",
                format!("segment-{i}").into_bytes(),
            )
            .await
            .expect("put segment");
    }
}

// Human: REGRESSION — stored ffmpeg manifest lists .ts but blobs are .m4s (hls.js fragLoadError 404).
// Agent: ASSERTS rewrite_stored_playlist emits .m4s API paths when prefer_fmp4.
#[test]
fn hls_playback_regression_legacy_ts_playlist_rewrites_to_m4s() {
    let stored = "\
#EXTM3U
#EXT-X-VERSION:3
#EXTINF:6.000,
segments/0000.ts
#EXTINF:6.000,
segments/0001.ts
#EXT-X-ENDLIST
";
    let out = PlaylistGenerator::rewrite_stored_playlist(
        stored,
        "/api/v1/files/id",
        "/api/v1/files/id/key",
        "/api/v1/files/id/init",
        true,
    )
    .expect("rewrite");

    assert!(
        out.contains("/api/v1/files/id/segments/0000.m4s"),
        "expected m4s segment URL, got:\n{out}"
    );
    assert!(
        out.contains("/api/v1/files/id/segments/0001.m4s"),
        "expected m4s segment URL, got:\n{out}"
    );
    assert!(
        !out.contains("0000.ts"),
        "legacy .ts must not remain in playback manifest:\n{out}"
    );
}

// Human: REGRESSION — segment GET must resolve .m4s when the client requests a legacy .ts name.
// Agent: CALLS open_hls_segment; READS only .m4s keys from MemoryStorage.
#[tokio::test]
async fn hls_playback_regression_segment_alias_loads_m4s_blob() {
    let storage = MemoryStorage::new();
    storage
        .put(
            &format!("{STORAGE_KEY}/segments/0000.{HLS_SEGMENT_EXTENSION}"),
            "video/mp4",
            b"encrypted-segment".to_vec(),
        )
        .await
        .expect("put segment");

    let aliases = hls_segment_storage_aliases("0000.ts");
    assert_eq!(aliases, vec!["0000.ts", "0000.m4s"]);

    let (_stream, size, resolved) = open_hls_segment(&storage, STORAGE_KEY, "0000.ts")
        .await
        .expect("segment should resolve via alias");
    assert_eq!(resolved, format!("0000.{HLS_SEGMENT_EXTENSION}"));
    assert_eq!(size, b"encrypted-segment".len() as u64);
}

// Human: REGRESSION — dynamic playback manifest must not emit .ts when fMP4 exists on storage.
// Agent: CALLS build_playlist_for_playback with legacy on-disk stream.m3u8.
#[tokio::test]
async fn hls_playback_regression_build_playlist_upgrades_ts_when_fmp4_on_disk() {
    let storage = MemoryStorage::new();
    seed_fmp4_bundle_with_legacy_ts_playlist(&storage, 3).await;

    assert!(storage_hls_uses_fmp4(&storage, STORAGE_KEY).await);

    let playlist = build_playlist_for_playback(
        &storage,
        STORAGE_KEY,
        "/api/v1/files/id",
        "/api/v1/files/id/key",
        "/api/v1/files/id/init",
        3,
        0,
    )
    .await
    .expect("build playlist");

    assert!(
        playlist.contains("/api/v1/files/id/segments/0000.m4s"),
        "playlist must reference m4s:\n{playlist}"
    );
    assert!(
        !playlist.contains("0000.ts"),
        "playlist must not reference ts:\n{playlist}"
    );
}

// Human: REGRESSION — partial Nebular upload must not pass validation (was marked hls_ready).
// Agent: ASSERTS validate_segment_upload_outcome and failure message shape.
#[test]
fn hls_playback_regression_partial_upload_must_not_validate() {
    let partial = SegmentUploadOutcome {
        expected: 150,
        uploaded: 12,
        failed: 138,
        bytes: 2_000_111,
    };
    let err = validate_segment_upload_outcome(&partial).expect_err("partial upload must fail");
    assert!(err.contains("12 of 150"));
    assert!(err.contains("138 failed"));

    let complete = SegmentUploadOutcome {
        expected: 3,
        uploaded: 3,
        failed: 0,
        bytes: 900,
    };
    validate_segment_upload_outcome(&complete).expect("full upload must validate");
}

// Human: REGRESSION — storage listing must catch missing segments after PUT counter drift.
// Agent: PUT only 2 of 3 segments; verify_hls_segments_in_storage returns Err.
#[tokio::test]
async fn hls_playback_regression_storage_list_gate_catches_missing_segments() {
    let storage = MemoryStorage::new();
    for i in 0..2 {
        storage
            .put(
                &format!("{STORAGE_KEY}/segments/{i:04}.{HLS_SEGMENT_EXTENSION}"),
                "video/mp4",
                b"x".to_vec(),
            )
            .await
            .expect("put");
    }

    let outcome = SegmentUploadOutcome {
        expected: 3,
        uploaded: 3,
        failed: 0,
        bytes: 3,
    };
    let err = verify_hls_segments_in_storage(&storage, STORAGE_KEY, outcome)
        .await
        .expect_err("missing third segment must fail verification");
    assert!(err.contains("2 of 3") || err.contains("uploaded 2 of 3"));
}

// Human: REGRESSION — large segments must not use 12-way parallel upload (object-storage OOM).
// Agent: ASSERTS plan_segment_upload parallel_hint stays below historical broken default.
#[test]
fn hls_playback_regression_dynamic_plan_limits_parallel_for_large_segments() {
    let sizes: Vec<u64> = (0..150).map(|_| 6 * 1024 * 1024).collect();
    let plan = plan_segment_upload(&sizes);
    assert!(
        plan.parallel_hint < 12,
        "parallel_hint={} must stay below the fixed 12 that OOM-killed object-storage",
        plan.parallel_hint
    );
    assert!(plan.parallel_hint <= HLS_UPLOAD_MAX_PARALLEL_SEGMENTS);
}

// Human: REGRESSION — in-flight upload budget must shrink after storage transport pressure.
// Agent: CALLS record_storage_pressure; ASSERTS budget_permille drops.
#[test]
fn hls_playback_regression_budget_shrinks_on_storage_pressure() {
    let plan = plan_segment_upload(&[6 * 1024 * 1024; 10]);
    let limiter = DynamicUploadLimiter::from_plan(&plan);
    assert_eq!(limiter.budget_permille(), 1000);
    limiter.record_storage_pressure();
    assert!(limiter.budget_permille() < 1000);
}

// Human: REGRESSION — basename normalization used by rewrite and synthetic manifests.
// Agent: PURE function contract for .ts → .m4s when prefer_fmp4.
#[test]
fn hls_playback_regression_normalize_basename_upgrades_ts() {
    assert_eq!(
        normalize_playback_segment_basename("0045.ts", true),
        format!("0045.{HLS_SEGMENT_EXTENSION}")
    );
    assert_eq!(
        normalize_playback_segment_basename("0045.ts", false),
        "0045.ts"
    );
}

// Human: REGRESSION — failure message must mention partial counts for UI and support logs.
#[test]
fn hls_playback_regression_failure_message_documents_partial_counts() {
    let msg = segment_upload_failure_message(&SegmentUploadOutcome {
        expected: 10,
        uploaded: 4,
        failed: 6,
        bytes: 0,
    });
    assert!(msg.contains("4 of 10"));
    assert!(msg.contains("re-upload"));
}

// Human: REGRESSION — fMP4 detection must work when only segments exist (no init yet).
#[tokio::test]
async fn hls_playback_regression_detects_fmp4_from_first_m4s_segment() {
    let storage = MemoryStorage::new();
    storage
        .put(
            &format!("{STORAGE_KEY}/segments/0000.{HLS_SEGMENT_EXTENSION}"),
            "video/mp4",
            b"s".to_vec(),
        )
        .await
        .expect("put");
    assert!(storage_hls_uses_fmp4(&storage, STORAGE_KEY).await);

    let legacy = "\
#EXTM3U
#EXT-X-VERSION:3
#EXTINF:6.0,
segments/0000.ts
";
    assert!(!playlist_uses_fmp4(legacy));
}
