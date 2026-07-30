// Human: Shared collab engine types — sessions, ops, presence, room kinds, errors.
// Agent: USED by store/engine/domains/http/ws; SERIALIZED for Redis + HTTP/WS JSON.

use std::collections::{HashMap, VecDeque};

use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const PROTOCOL_VERSION: u32 = 1;
pub const DEFAULT_MAX_OPS: usize = 1024;
pub const SESSION_IDLE_TTL_SECS: u64 = 3600;
pub const PARTICIPANT_TTL_SECS: u64 = 90;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RoomKind {
    Document,
    Spreadsheet,
}

impl RoomKind {
    pub fn as_str(self) -> &'static str {
        match self {
            RoomKind::Document => "document",
            RoomKind::Spreadsheet => "spreadsheet",
        }
    }

    pub fn parse(raw: &str) -> Option<Self> {
        match raw.trim().to_ascii_lowercase().as_str() {
            "document" | "doc" | "rtf" => Some(RoomKind::Document),
            "spreadsheet" | "sheet" | "excel" => Some(RoomKind::Spreadsheet),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Participant {
    pub user_id: String,
    pub display_name: String,
    pub color: String,
    pub last_seen: u64,
    /// Human: Domain-specific presence (selection/locks or active_cell/sheet).
    #[serde(default = "default_presence")]
    pub presence: Value,
}

fn default_presence() -> Value {
    Value::Object(serde_json::Map::new())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpEnvelope {
    pub id: String,
    pub seq: u64,
    pub user_id: String,
    pub ts: u64,
    /// Human: Client's latest_seq when the op was authored (for OT transform window).
    pub base_seq: u64,
    pub op_type: String,
    pub payload: Value,
    /// Human: Optional client correlation id for ack / skip-local-apply.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub client_op_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DomainSnapshot {
    /// Human: Highest seq already folded into this snapshot (ops with seq <= this may be dropped).
    pub snapshot_seq: u64,
    pub data: Value,
}

impl DomainSnapshot {
    pub fn empty() -> Self {
        Self {
            snapshot_seq: 0,
            data: Value::Object(serde_json::Map::new()),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CollabSession {
    pub id: String,
    pub room_kind: RoomKind,
    pub file_id: String,
    pub created_at: u64,
    pub last_active_at: u64,
    pub participants: HashMap<String, Participant>,
    pub ops: VecDeque<OpEnvelope>,
    /// Human: Next seq to assign (latest committed seq = next_seq - 1, or 0 if none).
    pub next_seq: u64,
    pub snapshot: DomainSnapshot,
    /// Human: Optimistic concurrency token for Redis CAS.
    pub version: u64,
}

impl CollabSession {
    pub fn latest_seq(&self) -> u64 {
        self.next_seq.saturating_sub(1)
    }

    pub fn ops_after(&self, after_seq: u64) -> Vec<OpEnvelope> {
        self.ops
            .iter()
            .filter(|op| op.seq > after_seq)
            .cloned()
            .collect()
    }
}

#[derive(Debug, Clone, thiserror::Error)]
pub enum CollabError {
    #[error("session not found")]
    NotFound,
    #[error("not a participant")]
    NotParticipant,
    #[error("range locked by another collaborator")]
    Locked,
    #[error("format commit text does not match server text")]
    TextMismatch,
    #[error("invalid op: {0}")]
    InvalidOp(String),
    #[error("base_seq too far behind; sync required")]
    SyncRequired,
    #[error("conflict: {0}")]
    Conflict(String),
    #[error("storage error: {0}")]
    Storage(String),
}

pub fn participant_color(user_id: &str) -> String {
    const COLORS: &[&str] = &[
        "#2563EB", "#DC2626", "#059669", "#D97706", "#7C3AED", "#DB2777", "#0891B2",
    ];
    let hash = user_id
        .bytes()
        .fold(0usize, |acc, b| acc.wrapping_add(b as usize).wrapping_mul(31));
    COLORS[hash % COLORS.len()].to_string()
}
