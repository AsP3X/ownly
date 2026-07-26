// Human: Spreadsheet co-editing store — in-memory by default, Redis when REDIS_URL is set.
// Agent: USED by collab HTTP handlers; Redis enables multi-replica presence + op log.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use redis::AsyncCommands;
use serde::{Deserialize, Serialize};
use tracing::{info, warn};
use uuid::Uuid;

const SESSION_TTL_SECS: u64 = 3600;
const PARTICIPANT_TTL_SECS: u64 = 90;
const MAX_OPS_PER_SESSION: usize = 500;

fn now_unix() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CollabParticipant {
    pub user_id: String,
    pub display_name: String,
    pub color: String,
    pub last_seen: u64,
    #[serde(default)]
    pub active_cell: Option<String>,
    #[serde(default)]
    pub sheet_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CollabOp {
    pub id: String,
    pub seq: u64,
    pub user_id: String,
    pub ts: u64,
    pub op_type: String,
    pub payload: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CollabSession {
    pub id: String,
    pub file_id: String,
    pub created_at: u64,
    pub participants: HashMap<String, CollabParticipant>,
    pub ops: Vec<CollabOp>,
    pub next_seq: u64,
}

struct MemoryState {
    sessions: HashMap<String, CollabSession>,
    by_file: HashMap<String, String>,
}

// Human: Dual backend — process memory always available; Redis used when client is Some.
// Agent: ASYNC methods; Redis key ownly:ss:session:{id} + ownly:ss:file:{file_id}.
pub struct CollabStore {
    memory: Mutex<MemoryState>,
    redis: Option<redis::aio::ConnectionManager>,
}

impl Default for CollabStore {
    fn default() -> Self {
        Self {
            memory: Mutex::new(MemoryState {
                sessions: HashMap::new(),
                by_file: HashMap::new(),
            }),
            redis: None,
        }
    }
}

impl CollabStore {
    pub fn new() -> Self {
        Self::default()
    }

    // Human: Build store from optional REDIS_URL (empty/whitespace → memory only).
    // Agent: CALLED at AppState construction; LOGS backend choice.
    pub async fn from_redis_url(redis_url: &str) -> SharedCollabStore {
        let trimmed = redis_url.trim();
        if trimmed.is_empty() {
            info!("Spreadsheet collab store: in-memory (set REDIS_URL for Redis)");
            return Arc::new(Self::new());
        }
        match redis::Client::open(trimmed) {
            Ok(client) => match redis::aio::ConnectionManager::new(client).await {
                Ok(manager) => {
                    info!("Spreadsheet collab store: Redis");
                    Arc::new(Self {
                        memory: Mutex::new(MemoryState {
                            sessions: HashMap::new(),
                            by_file: HashMap::new(),
                        }),
                        redis: Some(manager),
                    })
                }
                Err(err) => {
                    warn!(error = %err, "Redis collab connect failed — using in-memory");
                    Arc::new(Self::new())
                }
            },
            Err(err) => {
                warn!(error = %err, "Invalid REDIS_URL — using in-memory collab");
                Arc::new(Self::new())
            }
        }
    }

    fn session_key(session_id: &str) -> String {
        format!("ownly:ss:session:{session_id}")
    }

    fn file_key(file_id: &str) -> String {
        format!("ownly:ss:file:{file_id}")
    }

    fn prune_memory(state: &mut MemoryState) {
        let now = now_unix();
        let stale: Vec<String> = state
            .sessions
            .iter()
            .filter(|(_, s)| now.saturating_sub(s.created_at) > SESSION_TTL_SECS)
            .map(|(id, _)| id.clone())
            .collect();
        for id in stale {
            if let Some(session) = state.sessions.remove(&id) {
                state.by_file.remove(&session.file_id);
            }
        }
        for session in state.sessions.values_mut() {
            session
                .participants
                .retain(|_, p| now.saturating_sub(p.last_seen) <= PARTICIPANT_TTL_SECS);
        }
    }

    fn prune_session(session: &mut CollabSession) {
        let now = now_unix();
        session
            .participants
            .retain(|_, p| now.saturating_sub(p.last_seen) <= PARTICIPANT_TTL_SECS);
    }

    async fn redis_get_session(
        &self,
        session_id: &str,
    ) -> Option<CollabSession> {
        let mut conn = self.redis.as_ref()?.clone();
        let raw: Option<String> = conn.get(Self::session_key(session_id)).await.ok()?;
        let mut session: CollabSession = serde_json::from_str(&raw?).ok()?;
        Self::prune_session(&mut session);
        Some(session)
    }

    async fn redis_save_session(&self, session: &CollabSession) -> redis::RedisResult<()> {
        let Some(mut conn) = self.redis.clone() else {
            return Ok(());
        };
        let raw = serde_json::to_string(session).map_err(|e| {
            redis::RedisError::from((redis::ErrorKind::TypeError, "serialize session", e.to_string()))
        })?;
        let _: () = conn
            .set_ex(Self::session_key(&session.id), raw, SESSION_TTL_SECS)
            .await?;
        let _: () = conn
            .set_ex(Self::file_key(&session.file_id), session.id.as_str(), SESSION_TTL_SECS)
            .await?;
        Ok(())
    }

    pub async fn join_or_create(
        &self,
        file_id: &str,
        user_id: &str,
        display_name: &str,
    ) -> CollabSession {
        if self.redis.is_some() {
            if let Some(session) = self.join_or_create_redis(file_id, user_id, display_name).await {
                return session;
            }
        }
        self.join_or_create_memory(file_id, user_id, display_name)
    }

    fn join_or_create_memory(
        &self,
        file_id: &str,
        user_id: &str,
        display_name: &str,
    ) -> CollabSession {
        let mut state = self.memory.lock().expect("collab memory lock");
        Self::prune_memory(&mut state);

        let session_id = state.by_file.get(file_id).cloned().unwrap_or_else(|| {
            let id = Uuid::new_v4().to_string();
            state.by_file.insert(file_id.to_string(), id.clone());
            state.sessions.insert(
                id.clone(),
                CollabSession {
                    id: id.clone(),
                    file_id: file_id.to_string(),
                    created_at: now_unix(),
                    participants: HashMap::new(),
                    ops: Vec::new(),
                    next_seq: 1,
                },
            );
            id
        });

        let session = state
            .sessions
            .get_mut(&session_id)
            .expect("session just ensured");
        session.participants.insert(
            user_id.to_string(),
            CollabParticipant {
                user_id: user_id.to_string(),
                display_name: display_name.to_string(),
                color: participant_color(user_id),
                last_seen: now_unix(),
                active_cell: None,
                sheet_name: None,
            },
        );
        session.clone()
    }

    async fn join_or_create_redis(
        &self,
        file_id: &str,
        user_id: &str,
        display_name: &str,
    ) -> Option<CollabSession> {
        let mut conn = self.redis.as_ref()?.clone();
        let existing_id: Option<String> = conn.get(Self::file_key(file_id)).await.ok()?;
        let mut session = if let Some(id) = existing_id {
            self.redis_get_session(&id).await.unwrap_or_else(|| CollabSession {
                id,
                file_id: file_id.to_string(),
                created_at: now_unix(),
                participants: HashMap::new(),
                ops: Vec::new(),
                next_seq: 1,
            })
        } else {
            CollabSession {
                id: Uuid::new_v4().to_string(),
                file_id: file_id.to_string(),
                created_at: now_unix(),
                participants: HashMap::new(),
                ops: Vec::new(),
                next_seq: 1,
            }
        };
        Self::prune_session(&mut session);
        session.participants.insert(
            user_id.to_string(),
            CollabParticipant {
                user_id: user_id.to_string(),
                display_name: display_name.to_string(),
                color: participant_color(user_id),
                last_seen: now_unix(),
                active_cell: None,
                sheet_name: None,
            },
        );
        if let Err(err) = self.redis_save_session(&session).await {
            warn!(error = %err, "Redis save collab session failed");
            return None;
        }
        Some(session)
    }

    pub async fn heartbeat(
        &self,
        session_id: &str,
        user_id: &str,
        active_cell: Option<String>,
        sheet_name: Option<String>,
    ) -> Option<CollabSession> {
        if self.redis.is_some() {
            if let Some(session) = self
                .heartbeat_redis(session_id, user_id, active_cell.clone(), sheet_name.clone())
                .await
            {
                return Some(session);
            }
        }
        self.heartbeat_memory(session_id, user_id, active_cell, sheet_name)
    }

    fn heartbeat_memory(
        &self,
        session_id: &str,
        user_id: &str,
        active_cell: Option<String>,
        sheet_name: Option<String>,
    ) -> Option<CollabSession> {
        let mut state = self.memory.lock().expect("collab memory lock");
        Self::prune_memory(&mut state);
        let session = state.sessions.get_mut(session_id)?;
        let participant = session.participants.get_mut(user_id)?;
        participant.last_seen = now_unix();
        if let Some(cell) = active_cell {
            participant.active_cell = Some(cell);
        }
        if let Some(sheet) = sheet_name {
            participant.sheet_name = Some(sheet);
        }
        Some(session.clone())
    }

    async fn heartbeat_redis(
        &self,
        session_id: &str,
        user_id: &str,
        active_cell: Option<String>,
        sheet_name: Option<String>,
    ) -> Option<CollabSession> {
        let mut session = self.redis_get_session(session_id).await?;
        let participant = session.participants.get_mut(user_id)?;
        participant.last_seen = now_unix();
        if let Some(cell) = active_cell {
            participant.active_cell = Some(cell);
        }
        if let Some(sheet) = sheet_name {
            participant.sheet_name = Some(sheet);
        }
        self.redis_save_session(&session).await.ok()?;
        Some(session)
    }

    pub async fn get(&self, session_id: &str) -> Option<CollabSession> {
        if self.redis.is_some() {
            if let Some(session) = self.redis_get_session(session_id).await {
                return Some(session);
            }
        }
        let mut state = self.memory.lock().expect("collab memory lock");
        Self::prune_memory(&mut state);
        state.sessions.get(session_id).cloned()
    }

    pub async fn append_op(
        &self,
        session_id: &str,
        user_id: &str,
        op_type: &str,
        payload: serde_json::Value,
    ) -> Option<CollabOp> {
        if self.redis.is_some() {
            if let Some(op) = self
                .append_op_redis(session_id, user_id, op_type, payload.clone())
                .await
            {
                return Some(op);
            }
        }
        self.append_op_memory(session_id, user_id, op_type, payload)
    }

    fn append_op_memory(
        &self,
        session_id: &str,
        user_id: &str,
        op_type: &str,
        payload: serde_json::Value,
    ) -> Option<CollabOp> {
        let mut state = self.memory.lock().expect("collab memory lock");
        Self::prune_memory(&mut state);
        let session = state.sessions.get_mut(session_id)?;
        if !session.participants.contains_key(user_id) {
            return None;
        }
        let seq = session.next_seq;
        session.next_seq += 1;
        let op = CollabOp {
            id: Uuid::new_v4().to_string(),
            seq,
            user_id: user_id.to_string(),
            ts: now_unix(),
            op_type: op_type.to_string(),
            payload,
        };
        session.ops.push(op.clone());
        if session.ops.len() > MAX_OPS_PER_SESSION {
            let drop = session.ops.len() - MAX_OPS_PER_SESSION;
            session.ops.drain(0..drop);
        }
        Some(op)
    }

    async fn append_op_redis(
        &self,
        session_id: &str,
        user_id: &str,
        op_type: &str,
        payload: serde_json::Value,
    ) -> Option<CollabOp> {
        let mut session = self.redis_get_session(session_id).await?;
        if !session.participants.contains_key(user_id) {
            return None;
        }
        let seq = session.next_seq;
        session.next_seq += 1;
        let op = CollabOp {
            id: Uuid::new_v4().to_string(),
            seq,
            user_id: user_id.to_string(),
            ts: now_unix(),
            op_type: op_type.to_string(),
            payload,
        };
        session.ops.push(op.clone());
        if session.ops.len() > MAX_OPS_PER_SESSION {
            let drop = session.ops.len() - MAX_OPS_PER_SESSION;
            session.ops.drain(0..drop);
        }
        self.redis_save_session(&session).await.ok()?;
        Some(op)
    }

    pub async fn ops_since(&self, session_id: &str, after_seq: u64) -> Option<Vec<CollabOp>> {
        let session = self.get(session_id).await?;
        Some(
            session
                .ops
                .into_iter()
                .filter(|op| op.seq > after_seq)
                .collect(),
        )
    }
}

fn participant_color(user_id: &str) -> String {
    const COLORS: &[&str] = &[
        "#2563EB", "#DC2626", "#059669", "#D97706", "#7C3AED", "#DB2777", "#0891B2",
    ];
    let hash = user_id
        .bytes()
        .fold(0u32, |acc, b| acc.wrapping_mul(31).wrapping_add(b as u32));
    COLORS[(hash as usize) % COLORS.len()].to_string()
}

pub type SharedCollabStore = Arc<CollabStore>;

pub fn new_shared_store() -> SharedCollabStore {
    Arc::new(CollabStore::new())
}

#[allow(dead_code)]
const _TTL: Duration = Duration::from_secs(PARTICIPANT_TTL_SECS);
