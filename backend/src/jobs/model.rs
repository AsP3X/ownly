// Human: Job kinds, statuses, and typed payloads for the background worker queue.
// Agent: SERIALIZES to background_jobs.payload JSONB; READ by executor to dispatch work.

use serde::{Deserialize, Serialize};

/// Human: Categories of work handled by the shared worker pool.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum JobKind {
    HlsEncode,
    HlsExport,
    AudioWaveform,
    VideoThumbnail,
    ZipBulk,
    ZipFolder,
}

impl JobKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::HlsEncode => "hls_encode",
            Self::HlsExport => "hls_export",
            Self::AudioWaveform => "audio_waveform",
            Self::VideoThumbnail => "video_thumbnail",
            Self::ZipBulk => "zip_bulk",
            Self::ZipFolder => "zip_folder",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "hls_encode" => Some(Self::HlsEncode),
            "hls_export" => Some(Self::HlsExport),
            "audio_waveform" => Some(Self::AudioWaveform),
            "video_thumbnail" => Some(Self::VideoThumbnail),
            "zip_bulk" => Some(Self::ZipBulk),
            "zip_folder" => Some(Self::ZipFolder),
            _ => None,
        }
    }
}

/// Human: Lifecycle states visible to workers and the jobs API.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum JobStatus {
    Queued,
    Running,
    Complete,
    Failed,
    Cancelled,
}

impl JobStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Queued => "queued",
            Self::Running => "running",
            Self::Complete => "complete",
            Self::Failed => "failed",
            Self::Cancelled => "cancelled",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "queued" => Some(Self::Queued),
            "running" => Some(Self::Running),
            "complete" => Some(Self::Complete),
            "failed" => Some(Self::Failed),
            "cancelled" => Some(Self::Cancelled),
            _ => None,
        }
    }
}

/// Human: Row returned from background_jobs after claim or lookup.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct BackgroundJob {
    pub id: String,
    pub user_id: String,
    pub kind: String,
    pub status: String,
    pub progress: i32,
    pub error: Option<String>,
    pub payload: serde_json::Value,
    pub resource_type: Option<String>,
    pub resource_id: Option<String>,
    pub label: String,
    pub locked_by: Option<String>,
    pub locked_at: Option<chrono::DateTime<chrono::Utc>>,
    pub attempts: i32,
    pub max_attempts: i32,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
    pub completed_at: Option<chrono::DateTime<chrono::Utc>>,
}

/// Human: Payload for HLS transcode after video upload.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HlsEncodePayload {
    pub file_id: String,
    pub storage_key: String,
    pub tmp_video: String,
    /// Human: When zero, the worker runs ffprobe on `tmp_video` before ffmpeg starts.
    /// Agent: SET by upload handler after disk spool; UPDATES files.duration_seconds in worker.
    pub duration_seconds: i32,
}

/// Human: Payload for audio waveform peak extraction after audio upload.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AudioWaveformPayload {
    pub file_id: String,
    pub storage_key: String,
}

/// Human: Payload for multi-option video poster extraction after video upload.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VideoThumbnailPayload {
    pub file_id: String,
    pub storage_key: String,
    pub tmp_video: String,
}

/// Human: Payload for remuxing HLS segments into a downloadable MP4.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HlsExportPayload {
    pub file_id: String,
    pub storage_key: String,
    pub segment_count: i32,
}

/// Human: Payload for multi-file zip download jobs.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ZipBulkPayload {
    pub job_id: String,
    pub registry_key: String,
    pub work_dir: String,
    pub archive_name: String,
    pub file_ids: Vec<String>,
}

/// Human: Payload for folder tree zip download jobs.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ZipFolderPayload {
    pub folder_id: String,
    pub folder_name: String,
    pub registry_key: String,
    pub work_dir: String,
    pub archive_name: String,
}

/// Human: API-facing job summary for the drive UI job tray.
#[derive(Debug, Serialize)]
pub struct JobResponse {
    pub id: String,
    pub kind: String,
    pub status: String,
    pub progress: i32,
    pub label: String,
    pub error: Option<String>,
    pub resource_type: Option<String>,
    pub resource_id: Option<String>,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
}

impl From<BackgroundJob> for JobResponse {
    fn from(job: BackgroundJob) -> Self {
        Self {
            id: job.id,
            kind: job.kind,
            status: job.status,
            progress: job.progress,
            label: job.label,
            error: job.error,
            resource_type: job.resource_type,
            resource_id: job.resource_id,
            created_at: job.created_at,
            updated_at: job.updated_at,
        }
    }
}
