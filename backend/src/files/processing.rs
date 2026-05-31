// Human: Detect files still undergoing server-side ingest (HLS video or audio waveform analysis).
// Agent: READS mime_type + hls_* + audio_* columns; USED to reject download/delete/move while processing.

use sqlx::PgPool;

use crate::error::AppError;

/// Human: True while a video row exists but HLS ingest has not finished successfully.
// Agent: READS mime_type, hls_ready, hls_encode_status; FALSE when failed or ready.
pub fn is_video_processing(
    mime_type: &Option<String>,
    hls_ready: bool,
    hls_encode_status: &Option<String>,
) -> bool {
    mime_type
        .as_deref()
        .is_some_and(|m| m.starts_with("video/"))
        && !hls_ready
        && hls_encode_status.as_deref() != Some("failed")
        && hls_encode_status.as_deref() != Some("cancelled")
}

/// Human: True while an audio row is queued or actively generating its waveform sidecar.
// Agent: READS mime_type, audio_waveform_ready, audio_encode_status; FALSE when failed or ready.
pub fn is_audio_processing(
    mime_type: &Option<String>,
    audio_waveform_ready: bool,
    audio_encode_status: &Option<String>,
) -> bool {
    mime_type
        .as_deref()
        .is_some_and(|m| m.starts_with("audio/"))
        && !audio_waveform_ready
        && audio_encode_status.as_deref() != Some("failed")
        && audio_encode_status.as_deref() != Some("cancelled")
}

/// Human: True when either video HLS ingest or audio waveform analysis is still running.
// Agent: OR-combines is_video_processing and is_audio_processing.
pub fn is_file_processing(
    mime_type: &Option<String>,
    hls_ready: bool,
    hls_encode_status: &Option<String>,
    audio_waveform_ready: bool,
    audio_encode_status: &Option<String>,
) -> bool {
    is_video_processing(mime_type, hls_ready, hls_encode_status)
        || is_audio_processing(mime_type, audio_waveform_ready, audio_encode_status)
}

/// Human: Guard destructive or export actions until processing completes.
// Agent: RETURNS Conflict when is_file_processing; NO-OP otherwise.
pub fn ensure_file_not_processing(
    mime_type: &Option<String>,
    hls_ready: bool,
    hls_encode_status: &Option<String>,
    audio_waveform_ready: bool,
    audio_encode_status: &Option<String>,
) -> Result<(), AppError> {
    if is_file_processing(
        mime_type,
        hls_ready,
        hls_encode_status,
        audio_waveform_ready,
        audio_encode_status,
    ) {
        return Err(AppError::Conflict(
            "this file is still processing and cannot be modified yet".into(),
        ));
    }
    Ok(())
}

/// Human: Reject bulk delete jobs when any selected file is still ingesting on the server.
// Agent: READS files rows for user_id + ids; RETURNS Conflict on first processing match.
pub async fn ensure_files_not_processing(
    pool: &PgPool,
    user_id: &str,
    file_ids: &[String],
) -> Result<(), AppError> {
    let rows: Vec<(Option<String>, bool, Option<String>, bool, Option<String>)> = sqlx::query_as(
        "SELECT mime_type, hls_ready, hls_encode_status, audio_waveform_ready, audio_encode_status \
         FROM files WHERE user_id = $1 AND id = ANY($2)",
    )
    .bind(user_id)
    .bind(file_ids)
    .fetch_all(pool)
    .await?;

    for (mime_type, hls_ready, hls_encode_status, audio_waveform_ready, audio_encode_status) in rows
    {
        ensure_file_not_processing(
            &mime_type,
            hls_ready,
            &hls_encode_status,
            audio_waveform_ready,
            &audio_encode_status,
        )?;
    }

    Ok(())
}
