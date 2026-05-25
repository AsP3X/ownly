// Human: Environment-backed configuration for the API process and Docker Compose stack.
// Agent: READS envy/dotenvy at startup; DEFAULTS weak dev placeholders overridden by init-env.sh.

use serde::Deserialize;

#[derive(Clone, Debug, Deserialize)]
pub struct Config {
    #[serde(default = "default_database_url")]
    pub database_url: String,
    #[serde(default = "default_jwt_secret")]
    pub jwt_secret: String,
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
    30
}

fn default_max_upload_bytes() -> u64 {
    // Human: Default cap for a single upload — 10 GiB; override with MAX_UPLOAD_BYTES.
    // Agent: MUST stay <= nginx client_max_body_size and NOS_MAX_BODY_SIZE in Compose.
    10 * 1024 * 1024 * 1024
}
