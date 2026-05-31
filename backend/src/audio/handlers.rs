// Human: Authenticated waveform artifact routes — read 32-bar JSON sidecars from Nebular OS.
// Agent: GET /files/:id/waveform; READS audio_waveform_key; RETURNS AudioWaveformArtifact JSON.

use std::sync::Arc;

use axum::{
    extract::{Path, State},
    Extension, Json,
};
use futures_util::StreamExt;

use crate::{
    audio::waveform::AudioWaveformArtifact,
    auth::handlers::Claims,
    error::AppError,
    files::processing::ensure_file_not_processing,
};

// Human: Return stored waveform peaks for the mobile audio player UI.
// Agent: READS files row; STREAMS waveform sidecar bytes; DESERIALIZES JSON envelope.
pub async fn get_waveform(
    State(state): State<Arc<crate::AppState>>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<String>,
) -> Result<Json<AudioWaveformArtifact>, AppError> {
    let row: Option<(
        Option<String>,
        bool,
        Option<String>,
        bool,
        Option<String>,
        Option<String>,
        Option<String>,
    )> = sqlx::query_as(
        "SELECT mime_type, hls_ready, hls_encode_status, audio_waveform_ready, audio_encode_status, \
         audio_waveform_key, audio_encode_error FROM files WHERE id = $1 AND user_id = $2",
    )
    .bind(&id)
    .bind(&claims.sub)
    .fetch_optional(&state.pool)
    .await?;

    let (
        mime_type,
        hls_ready,
        hls_encode_status,
        waveform_ready,
        encode_status,
        waveform_key,
        encode_error,
    ) = row.ok_or(AppError::NotFound)?;

    ensure_file_not_processing(
        &mime_type,
        hls_ready,
        &hls_encode_status,
        waveform_ready,
        &encode_status,
    )?;

    if !mime_type
        .as_deref()
        .is_some_and(|m| m.starts_with("audio/"))
    {
        return Err(AppError::BadRequest("file is not an audio track".into()));
    }

    if !waveform_ready {
        let message = encode_error.unwrap_or_else(|| {
            if encode_status.as_deref() == Some("failed") {
                "waveform analysis failed".into()
            } else {
                "waveform is not ready yet".into()
            }
        });
        return Err(AppError::Conflict(message));
    }

    let key = waveform_key.ok_or(AppError::NotFound)?;

    let (mut stream, _, _) = state
        .storage
        .get_stream(&key)
        .await
        .map_err(|e| AppError::Storage(e.to_string()))?;

    let mut data = Vec::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| AppError::Storage(e.to_string()))?;
        data.extend_from_slice(&chunk);
    }

    let artifact: AudioWaveformArtifact = serde_json::from_slice(&data)
        .map_err(|e| AppError::Internal(anyhow::anyhow!("invalid waveform sidecar: {e}")))?;

    Ok(Json(artifact))
}
