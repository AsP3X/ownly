// Human: Environment-backed configuration for the API process and Docker Compose stack.
// Agent: READS envy/dotenvy at startup; DEFAULTS weak dev placeholders overridden by init-env.sh.

use serde::Deserialize;

#[derive(Clone, Debug, Deserialize)]
pub struct Config {
    #[serde(default = "default_database_url")]
    pub database_url: String,
    #[serde(default = "default_jwt_secret")]
    pub jwt_secret: String,
    /// Human: Bootstrap secret required on POST /setup* mutation routes until setup completes.
    /// Agent: READ from SETUP_TOKEN; COMPARED to X-Setup-Token header in setup handlers.
    #[serde(default = "default_setup_token")]
    pub setup_token: String,
    #[serde(default = "default_bind_addr")]
    pub bind_addr: String,
    #[serde(default = "default_storage_mode")]
    pub storage_mode: String,
    #[serde(default = "default_object_storage_url")]
    pub object_storage_url: String,
    #[serde(default = "default_object_storage_public_url")]
    pub object_storage_public_url: String,
    #[serde(default = "default_object_storage_bucket")]
    pub object_storage_bucket: String,
    #[serde(default = "default_signing_secret")]
    pub signing_secret: String,
    #[serde(default = "default_object_storage_jwt_secret")]
    pub object_storage_jwt_secret: String,
    #[serde(default = "default_url_expiry_seconds")]
    pub url_expiry_seconds: u64,
    #[serde(default = "default_mediavault_environment")]
    pub mediavault_environment: String,
    #[serde(default)]
    pub git_sha: Option<String>,
    #[serde(default = "default_auth_login_rpm")]
    pub auth_login_rpm: u32,
    #[serde(default = "default_auth_register_rpm")]
    pub auth_register_rpm: u32,
    #[serde(default = "default_upload_rpm")]
    pub upload_rpm: u32,
    #[serde(default)]
    pub cors_allowed_origins: String,
    #[serde(default = "default_max_upload_bytes")]
    pub max_upload_bytes: u64,
    #[serde(default = "default_hls_segment_rpm")]
    pub hls_segment_rpm: u32,
    #[serde(default = "default_job_worker_count")]
    pub job_worker_count: u32,
    #[serde(default = "default_job_stale_minutes")]
    pub job_stale_minutes: u64,
    #[serde(default = "default_job_heartbeat_seconds")]
    pub job_heartbeat_seconds: u64,
    #[serde(default = "default_job_recovery_poll_seconds")]
    pub job_recovery_poll_seconds: u64,
    #[serde(default = "default_hls_hardware_encode")]
    pub hls_hardware_encode: String,
    #[serde(default = "default_hls_vaapi_device")]
    pub hls_vaapi_device: String,
    /// Human: libx264 CRF for GOP-aligned HLS re-encode (lower = larger / higher quality).
    /// Agent: READ by hls::encoder append_align_segments_video_args; DEFAULT 20.
    #[serde(default = "default_hls_video_crf")]
    pub hls_video_crf: u8,
    /// Human: NVENC CQ / VAAPI QP / QSV quality for align-path HLS (lower = larger / higher quality).
    /// Agent: READ by hls::encoder and hls::hardware; DEFAULT 22.
    #[serde(default = "default_hls_video_quality")]
    pub hls_video_quality: u8,
    /// Human: Quality for full HLS transcode (CRF/CQ/QP/QSV); higher = smaller files.
    /// Agent: READ by append_full_transcode_encoder_args; DEFAULT 26.
    #[serde(default = "default_hls_full_transcode_quality")]
    pub hls_full_transcode_quality: u8,
    /// Human: ffmpeg -maxrate when source exceeds HLS_LARGE_SOURCE_BYTES (e.g. 4M, 5M).
    #[serde(default = "default_hls_large_maxrate")]
    pub hls_large_maxrate: String,
    /// Human: ffmpeg -bufsize paired with hls_large_maxrate.
    #[serde(default = "default_hls_large_bufsize")]
    pub hls_large_bufsize: String,
    /// Human: `nebular` (default) or `ownly` — whether blob index lives in Nebular or Ownly Postgres.
    /// Agent: WRITTEN to app_settings on setup; READ by placement::read_metadata_mode.
    #[serde(default = "default_storage_metadata_mode")]
    pub storage_metadata_mode: String,
}

impl Config {
    // Human: Parse all API settings from process environment (and optional `.env` file).
    // Agent: CALLS dotenvy then envy; RETURNS Config; ERRORS on missing required typed fields.
    pub fn from_env() -> anyhow::Result<Self> {
        dotenvy::dotenv().ok();
        Ok(envy::from_env()?)
    }
}

fn default_database_url() -> String {
    "postgres://mediavault:mediavault@localhost:5432/mediavault".into()
}

fn default_jwt_secret() -> String {
    "change-me-in-production".into()
}

fn default_setup_token() -> String {
    "change-me-in-production".into()
}

fn default_bind_addr() -> String {
    "0.0.0.0:3000".into()
}

fn default_storage_mode() -> String {
    "proxy".into()
}

fn default_object_storage_url() -> String {
    "http://localhost:9000".into()
}

fn default_object_storage_public_url() -> String {
    "http://localhost:9000".into()
}

fn default_object_storage_bucket() -> String {
    "media".into()
}

fn default_signing_secret() -> String {
    "change-me-in-production".into()
}

fn default_object_storage_jwt_secret() -> String {
    "dev-nos-jwt-secret-change-me".into()
}

fn default_url_expiry_seconds() -> u64 {
    3600
}

fn default_mediavault_environment() -> String {
    "development".into()
}

fn default_auth_login_rpm() -> u32 {
    15
}

fn default_auth_register_rpm() -> u32 {
    5
}

fn default_upload_rpm() -> u32 {
    // Human: Bulk folder uploads run ~3 concurrent; small files on localhost exceed ~3/s sustained.
    // Agent: DEFAULT 600/min (~10/s rolling average); override with UPLOAD_RPM in Compose/.env.
    600
}

fn default_max_upload_bytes() -> u64 {
    // Human: Default cap for a single upload — 10 GiB; override with MAX_UPLOAD_BYTES.
    // Agent: MUST stay <= nginx client_max_body_size and NOS_MAX_BODY_SIZE in Compose.
    10 * 1024 * 1024 * 1024
}

fn default_hls_segment_rpm() -> u32 {
    480
}

fn default_job_worker_count() -> u32 {
    4
}

fn default_job_stale_minutes() -> u64 {
    15
}

fn default_job_heartbeat_seconds() -> u64 {
    30
}

fn default_job_recovery_poll_seconds() -> u64 {
    60
}

fn default_hls_hardware_encode() -> String {
    // Human: Try GPU encoders when device nodes exist; set `off` to force CPU-only ingest.
    // Agent: VALUES auto|off|nvenc|vaapi|qsv; READ by hls::hardware at startup.
    "auto".into()
}

fn default_hls_vaapi_device() -> String {
    "/dev/dri/renderD128".into()
}

fn default_hls_video_crf() -> u8 {
    20
}

fn default_hls_video_quality() -> u8 {
    22
}

fn default_hls_full_transcode_quality() -> u8 {
    26
}

fn default_hls_large_maxrate() -> String {
    "5M".into()
}

fn default_hls_large_bufsize() -> String {
    "10M".into()
}

fn default_storage_metadata_mode() -> String {
    "nebular".into()
}
