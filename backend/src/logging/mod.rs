// Human: Runtime tracing filter — presets, per-category levels, and hot reload for admin tuning.
// Agent: READS app_settings logging_config; WRITES EnvFilter via reload handle; CALLED at startup + admin PATCH.

pub mod handlers;

use std::collections::HashMap;
use std::sync::OnceLock;

use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use tracing_subscriber::{reload, EnvFilter};
use tracing_subscriber::prelude::*;

pub const LOGGING_CONFIG_KEY: &str = "logging_config";

static FILTER_HANDLE: OnceLock<reload::Handle<EnvFilter, tracing_subscriber::Registry>> =
    OnceLock::new();

/// Human: Preset bundles that map to coordinated category levels.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LogPreset {
    Prod,
    Default,
    Debug,
    Custom,
}

impl LogPreset {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Prod => "prod",
            Self::Default => "default",
            Self::Debug => "debug",
            Self::Custom => "custom",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "prod" => Some(Self::Prod),
            "default" => Some(Self::Default),
            "debug" => Some(Self::Debug),
            "custom" => Some(Self::Custom),
            _ => None,
        }
    }
}

/// Human: Maximum verbosity for a tracing target group.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LogLevel {
    Off,
    Error,
    Warn,
    Info,
    Debug,
    Trace,
}

impl LogLevel {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Off => "off",
            Self::Error => "error",
            Self::Warn => "warn",
            Self::Info => "info",
            Self::Debug => "debug",
            Self::Trace => "trace",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "off" => Some(Self::Off),
            "error" => Some(Self::Error),
            "warn" => Some(Self::Warn),
            "info" => Some(Self::Info),
            "debug" => Some(Self::Debug),
            "trace" => Some(Self::Trace),
            _ => None,
        }
    }
}

/// Human: Metadata for one atomic log category exposed in the admin dialog.
#[derive(Debug, Clone, Serialize)]
pub struct LogCategoryInfo {
    pub id: String,
    pub label: String,
    pub description: String,
    pub target: String,
}

/// Human: Persisted + API shape for logging configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoggingConfig {
    pub preset: LogPreset,
    #[serde(default)]
    pub categories: HashMap<String, LogLevel>,
}

/// Human: Admin GET response — preset, effective levels, and category catalog.
#[derive(Debug, Serialize)]
pub struct LoggingConfigResponse {
    pub preset: String,
    pub categories: HashMap<String, String>,
    pub available_categories: Vec<LogCategoryInfo>,
    pub available_levels: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub struct LoggingConfigPatch {
    pub preset: Option<String>,
    pub categories: Option<HashMap<String, String>>,
}

struct CategoryDef {
    id: &'static str,
    label: &'static str,
    description: &'static str,
    target: &'static str,
}

const CATEGORY_DEFS: &[CategoryDef] = &[
    CategoryDef {
        id: "server_core",
        label: "Server core",
        description: "API startup, routing, and general backend messages.",
        target: "ownly_backend",
    },
    CategoryDef {
        id: "http_requests",
        label: "HTTP requests",
        description: "Tower HTTP trace layer — every request/response line.",
        target: "tower_http",
    },
    CategoryDef {
        id: "sql_queries",
        label: "SQL queries",
        description: "sqlx query summaries (including idle job polling).",
        target: "sqlx",
    },
    CategoryDef {
        id: "background_jobs",
        label: "Background jobs",
        description: "Worker pool claim, execute, recovery, and heartbeats.",
        target: "ownly_backend::jobs",
    },
    CategoryDef {
        id: "file_operations",
        label: "File operations",
        description: "Upload, download, delete, zip, and recycle-bin activity.",
        target: "ownly_backend::files",
    },
    CategoryDef {
        id: "hls_transcode",
        label: "HLS transcode",
        description: "Video encode, export, probe, and segment upload.",
        target: "ownly_backend::hls",
    },
    CategoryDef {
        id: "media_processing",
        label: "Media processing",
        description: "Audio waveform, image, and video thumbnail jobs.",
        target: "ownly_backend::audio",
    },
    CategoryDef {
        id: "storage_client",
        label: "Storage client",
        description: "Nebular OS HTTP client and placement routing.",
        target: "ownly_backend::storage",
    },
    CategoryDef {
        id: "auth",
        label: "Authentication",
        description: "Login, registration, sessions, and token validation.",
        target: "ownly_backend::auth",
    },
    CategoryDef {
        id: "admin",
        label: "Admin console",
        description: "Admin handlers, storage migration, and settings.",
        target: "ownly_backend::admin",
    },
    CategoryDef {
        id: "maintenance",
        label: "Maintenance",
        description: "Temp cleanup, GIF preview janitor, and recycle purger.",
        target: "ownly_backend::temp_cleanup",
    },
];

fn preset_level(preset: LogPreset, category_id: &str) -> LogLevel {
    match preset {
        LogPreset::Prod => match category_id {
            "http_requests" | "background_jobs" | "server_core" => LogLevel::Warn,
            "file_operations" | "hls_transcode" | "media_processing" | "storage_client"
            | "auth" | "admin" | "maintenance" => LogLevel::Warn,
            "sql_queries" => LogLevel::Error,
            _ => LogLevel::Error,
        },
        LogPreset::Default => match category_id {
            "sql_queries" => LogLevel::Warn,
            "http_requests" | "background_jobs" | "file_operations" | "hls_transcode"
            | "media_processing" | "storage_client" | "auth" | "admin" | "maintenance"
            | "server_core" => LogLevel::Info,
            _ => LogLevel::Info,
        },
        LogPreset::Debug => LogLevel::Debug,
        LogPreset::Custom => LogLevel::Info,
    }
}

impl LoggingConfig {
    pub fn factory_default() -> Self {
        Self {
            preset: LogPreset::Default,
            categories: HashMap::new(),
        }
    }

    /// Human: Resolve effective level per category — preset table plus custom overrides.
    pub fn effective_levels(&self) -> HashMap<String, LogLevel> {
        let mut levels = HashMap::new();
        for def in CATEGORY_DEFS {
            let level = if self.preset == LogPreset::Custom {
                self.categories
                    .get(def.id)
                    .copied()
                    .unwrap_or(LogLevel::Info)
            } else if self.categories.is_empty() {
                preset_level(self.preset, def.id)
            } else {
                self.categories
                    .get(def.id)
                    .copied()
                    .unwrap_or_else(|| preset_level(self.preset, def.id))
            };
            levels.insert(def.id.to_string(), level);
        }
        levels
    }

    /// Human: Build tracing EnvFilter directive string from effective category levels.
    pub fn to_env_filter_string(&self) -> String {
        let levels = self.effective_levels();
        let base = match self.preset {
            LogPreset::Prod => LogLevel::Error,
            LogPreset::Default => LogLevel::Info,
            LogPreset::Debug => LogLevel::Debug,
            LogPreset::Custom => LogLevel::Info,
        };

        let mut parts = vec![base.as_str().to_string()];
        for def in CATEGORY_DEFS {
            if let Some(level) = levels.get(def.id) {
                parts.push(format!("{}={}", def.target, level.as_str()));
            }
        }
        // Human: Thumbnail/video/image modules share the media_processing category level.
        if let Some(level) = levels.get("media_processing") {
            parts.push(format!("ownly_backend::video={}", level.as_str()));
            parts.push(format!("ownly_backend::image={}", level.as_str()));
        }
        // Human: Recycle purger logs under files — align with maintenance when both differ.
        if let Some(level) = levels.get("maintenance") {
            parts.push(format!("ownly_backend::files::recycle_bin={}", level.as_str()));
        }
        parts.join(",")
    }

    pub fn to_response(&self) -> LoggingConfigResponse {
        let effective = self.effective_levels();
        LoggingConfigResponse {
            preset: self.preset.as_str().to_string(),
            categories: effective
                .into_iter()
                .map(|(id, level)| (id, level.as_str().to_string()))
                .collect(),
            available_categories: CATEGORY_DEFS
                .iter()
                .map(|def| LogCategoryInfo {
                    id: def.id.to_string(),
                    label: def.label.to_string(),
                    description: def.description.to_string(),
                    target: def.target.to_string(),
                })
                .collect(),
            available_levels: [
                LogLevel::Off,
                LogLevel::Error,
                LogLevel::Warn,
                LogLevel::Info,
                LogLevel::Debug,
                LogLevel::Trace,
            ]
            .iter()
            .map(|level| level.as_str().to_string())
            .collect(),
        }
    }

    pub fn normalize_patch(
        mut current: Self,
        patch: LoggingConfigPatch,
    ) -> Result<Self, String> {
        if let Some(preset_raw) = patch.preset {
            let preset = LogPreset::parse(preset_raw.trim())
                .ok_or_else(|| format!("unknown logging preset: {preset_raw}"))?;
            if preset != LogPreset::Custom {
                current.preset = preset;
                current.categories.clear();
            }
        }

        if let Some(categories) = patch.categories {
            current.preset = LogPreset::Custom;
            current.categories.clear();
            for (id, level_raw) in categories {
                if !CATEGORY_DEFS.iter().any(|def| def.id == id.as_str()) {
                    return Err(format!("unknown logging category: {id}"));
                }
                let level = LogLevel::parse(level_raw.trim())
                    .ok_or_else(|| format!("unknown log level for {id}: {level_raw}"))?;
                current.categories.insert(id, level);
            }
        }

        Ok(current)
    }
}

/// Human: Install fmt subscriber with a reloadable EnvFilter layer.
// Agent: CALLED once from run(); STORES reload handle for apply_config.
pub fn init_subscriber() {
    let initial = EnvFilter::try_from_default_env().unwrap_or_else(|_| {
        EnvFilter::new(LoggingConfig::factory_default().to_env_filter_string())
    });

    let (filter_layer, handle) = reload::Layer::new(initial);
    let _ = FILTER_HANDLE.set(handle);

    tracing_subscriber::registry()
        .with(filter_layer)
        .with(tracing_subscriber::fmt::layer())
        .init();
}

/// Human: Apply a config to the live tracing filter without restart.
pub fn apply_config(config: &LoggingConfig) -> Result<(), String> {
    let handle = FILTER_HANDLE
        .get()
        .ok_or_else(|| "logging subscriber is not initialized".to_string())?;
    let filter = EnvFilter::try_new(config.to_env_filter_string())
        .map_err(|error| format!("invalid logging filter: {error}"))?;
    handle
        .reload(filter)
        .map_err(|error| format!("failed to reload logging filter: {error}"))
}

async fn read_config_raw(pool: &PgPool) -> Option<String> {
    let row: Option<(String,)> =
        sqlx::query_as("SELECT value FROM app_settings WHERE key = $1")
            .bind(LOGGING_CONFIG_KEY)
            .fetch_optional(pool)
            .await
            .ok()?;
    row.map(|(value,)| value)
}

pub async fn load_config(pool: &PgPool) -> LoggingConfig {
    let Some(raw) = read_config_raw(pool).await else {
        return LoggingConfig::factory_default();
    };
    serde_json::from_str(&raw).unwrap_or_else(|error| {
        tracing::warn!(%error, "invalid logging_config JSON — using factory default");
        LoggingConfig::factory_default()
    })
}

async fn persist_config(pool: &PgPool, config: &LoggingConfig) -> Result<(), sqlx::Error> {
    let json = serde_json::to_string(config).map_err(|error| {
        sqlx::Error::Protocol(format!("serialize logging config: {error}"))
    })?;
    sqlx::query(
        "INSERT INTO app_settings (key, value) VALUES ($1, $2) \
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
    )
    .bind(LOGGING_CONFIG_KEY)
    .bind(json)
    .execute(pool)
    .await?;
    Ok(())
}

/// Human: Load persisted config from DB and apply to the running subscriber.
pub async fn load_and_apply(pool: &PgPool) {
    let config = load_config(pool).await;
    match apply_config(&config) {
        Ok(()) => {
            tracing::info!(
                preset = config.preset.as_str(),
                "applied logging configuration from database"
            );
        }
        Err(error) => {
            tracing::warn!(%error, "failed to apply logging configuration from database");
        }
    }
}

/// Human: Persist config, apply live, and return API response.
pub async fn save_and_apply(pool: &PgPool, config: &LoggingConfig) -> Result<(), String> {
    apply_config(config)?;
    persist_config(pool, config)
        .await
        .map_err(|error| error.to_string())?;
    Ok(())
}
