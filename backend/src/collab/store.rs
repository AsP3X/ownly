// Human: Collab session store — memory primary, optional Redis with version CAS.
// Agent: USED by CollabEngine; keys ownly:collab:session:{id} + ownly:collab:file:{kind}:{file_id}.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use redis::AsyncCommands;
use tracing::{info, warn};
use uuid::Uuid;

use crate::collab::types::{
    CollabSession, DomainSnapshot, PARTICIPANT_TTL_SECS, RoomKind, SESSION_IDLE_TTL_SECS,
};

fn now_unix() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

struct MemoryState {
    sessions: HashMap<String, CollabSession>,
    /// (room_kind, file_id) → session_id
    by_file: HashMap<(RoomKind, String), String>,
}

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

    pub fn redis_manager(&self) -> Option<redis::aio::ConnectionManager> {
        self.redis.clone()
    }

    pub async fn from_redis_url(redis_url: &str) -> std::sync::Arc<Self> {
        let trimmed = redis_url.trim();
        if trimmed.is_empty() {
            info!("Collab store: in-memory (set REDIS_URL for Redis)");
            return std::sync::Arc::new(Self::new());
        }
        match redis::Client::open(trimmed) {
            Ok(client) => match redis::aio::ConnectionManager::new(client).await {
                Ok(manager) => {
                    info!("Collab store: Redis + memory");
                    std::sync::Arc::new(Self {
                        memory: Mutex::new(MemoryState {
                            sessions: HashMap::new(),
                            by_file: HashMap::new(),
                        }),
                        redis: Some(manager),
                    })
                }
                Err(err) => {
                    warn!(error = %err, "Redis collab connect failed — using in-memory");
                    std::sync::Arc::new(Self::new())
                }
            },
            Err(err) => {
                warn!(error = %err, "Invalid REDIS_URL — using in-memory collab");
                std::sync::Arc::new(Self::new())
            }
        }
    }

    fn session_key(session_id: &str) -> String {
        format!("ownly:collab:session:{session_id}")
    }

    fn file_key(kind: RoomKind, file_id: &str) -> String {
        format!("ownly:collab:file:{}:{file_id}", kind.as_str())
    }

    fn prune_memory(state: &mut MemoryState) {
        let now = now_unix();
        let stale: Vec<String> = state
            .sessions
            .iter()
            .filter(|(_, s)| now.saturating_sub(s.last_active_at) > SESSION_IDLE_TTL_SECS)
            .map(|(id, _)| id.clone())
            .collect();
        for id in stale {
            if let Some(session) = state.sessions.remove(&id) {
                state
                    .by_file
                    .remove(&(session.room_kind, session.file_id));
            }
        }
        for session in state.sessions.values_mut() {
            Self::prune_participants(session, now);
        }
    }

    fn prune_participants(session: &mut CollabSession, now: u64) {
        session
            .participants
            .retain(|_, p| now.saturating_sub(p.last_seen) <= PARTICIPANT_TTL_SECS);
    }

    pub fn now() -> u64 {
        now_unix()
    }

    pub async fn get(&self, session_id: &str) -> Option<CollabSession> {
        if self.redis.is_some() {
            if let Some(session) = self.redis_get(session_id).await {
                return Some(session);
            }
        }
        let mut state = self.memory.lock().expect("collab store lock");
        Self::prune_memory(&mut state);
        state.sessions.get(session_id).cloned()
    }

    pub async fn get_by_file(&self, kind: RoomKind, file_id: &str) -> Option<CollabSession> {
        if self.redis.is_some() {
            if let Some(id) = self.redis_file_session_id(kind, file_id).await {
                if let Some(session) = self.redis_get(&id).await {
                    return Some(session);
                }
            }
        }
        let mut state = self.memory.lock().expect("collab store lock");
        Self::prune_memory(&mut state);
        let id = state.by_file.get(&(kind, file_id.to_string()))?.clone();
        state.sessions.get(&id).cloned()
    }

    /// Human: Insert or replace session; bumps version; dual-writes Redis when configured.
    pub async fn save(&self, mut session: CollabSession) -> Result<CollabSession, String> {
        session.version = session.version.saturating_add(1);
        session.last_active_at = now_unix();
        if self.redis.is_some() {
            self.redis_save(&session).await.map_err(|e| e.to_string())?;
        }
        let mut state = self.memory.lock().expect("collab store lock");
        Self::prune_memory(&mut state);
        state.by_file.insert(
            (session.room_kind, session.file_id.clone()),
            session.id.clone(),
        );
        state.sessions.insert(session.id.clone(), session.clone());
        Ok(session)
    }

    /// Human: CAS save — succeeds only when expected_version still matches (Redis + memory).
    pub async fn save_cas(
        &self,
        mut session: CollabSession,
        expected_version: u64,
    ) -> Result<CollabSession, CasError> {
        if session.version != expected_version {
            return Err(CasError::VersionMismatch);
        }
        session.version = expected_version.saturating_add(1);
        session.last_active_at = now_unix();

        if self.redis.is_some() {
            match self.redis_save_cas(&session, expected_version).await {
                Ok(()) => {}
                Err(CasError::VersionMismatch) => return Err(CasError::VersionMismatch),
                Err(CasError::Storage(e)) => return Err(CasError::Storage(e)),
            }
        }

        let mut state = self.memory.lock().expect("collab store lock");
        Self::prune_memory(&mut state);
        if let Some(existing) = state.sessions.get(&session.id) {
            if existing.version != expected_version {
                return Err(CasError::VersionMismatch);
            }
        }
        state.by_file.insert(
            (session.room_kind, session.file_id.clone()),
            session.id.clone(),
        );
        state.sessions.insert(session.id.clone(), session.clone());
        Ok(session)
    }

    pub fn new_session_id() -> String {
        Uuid::new_v4().to_string()
    }

    pub fn new_session(
        room_kind: RoomKind,
        file_id: &str,
        snapshot: DomainSnapshot,
    ) -> CollabSession {
        let now = now_unix();
        CollabSession {
            id: Self::new_session_id(),
            room_kind,
            file_id: file_id.to_string(),
            created_at: now,
            last_active_at: now,
            participants: HashMap::new(),
            ops: std::collections::VecDeque::new(),
            next_seq: 1,
            snapshot,
            version: 0,
        }
    }

    async fn redis_get(&self, session_id: &str) -> Option<CollabSession> {
        let mut conn = self.redis.as_ref()?.clone();
        let raw: Option<String> = conn.get(Self::session_key(session_id)).await.ok()?;
        let mut session: CollabSession = serde_json::from_str(&raw?).ok()?;
        let now = now_unix();
        if now.saturating_sub(session.last_active_at) > SESSION_IDLE_TTL_SECS {
            return None;
        }
        Self::prune_participants(&mut session, now);
        Some(session)
    }

    async fn redis_file_session_id(&self, kind: RoomKind, file_id: &str) -> Option<String> {
        let mut conn = self.redis.as_ref()?.clone();
        conn.get(Self::file_key(kind, file_id)).await.ok()?
    }

    async fn redis_save(&self, session: &CollabSession) -> redis::RedisResult<()> {
        let Some(mut conn) = self.redis.clone() else {
            return Ok(());
        };
        let raw = serde_json::to_string(session).map_err(|e| {
            redis::RedisError::from((
                redis::ErrorKind::TypeError,
                "serialize collab session",
                e.to_string(),
            ))
        })?;
        let _: () = conn
            .set_ex(
                Self::session_key(&session.id),
                raw,
                SESSION_IDLE_TTL_SECS,
            )
            .await?;
        let _: () = conn
            .set_ex(
                Self::file_key(session.room_kind, &session.file_id),
                session.id.as_str(),
                SESSION_IDLE_TTL_SECS,
            )
            .await?;
        Ok(())
    }

    /// Human: Redis CAS using GET version check + SET (retry at engine level).
    async fn redis_save_cas(
        &self,
        session: &CollabSession,
        expected_version: u64,
    ) -> Result<(), CasError> {
        let Some(mut conn) = self.redis.clone() else {
            return Ok(());
        };
        let key = Self::session_key(&session.id);
        let existing: Option<String> = conn
            .get(&key)
            .await
            .map_err(|e| CasError::Storage(e.to_string()))?;
        if let Some(raw) = existing {
            let prev: CollabSession =
                serde_json::from_str(&raw).map_err(|e| CasError::Storage(e.to_string()))?;
            if prev.version != expected_version {
                return Err(CasError::VersionMismatch);
            }
        } else if expected_version != 0 {
            // Creating with non-zero expected is wrong; version 0 means new-or-missing ok.
            return Err(CasError::VersionMismatch);
        }
        self.redis_save(session)
            .await
            .map_err(|e| CasError::Storage(e.to_string()))
    }
}

#[derive(Debug)]
pub enum CasError {
    VersionMismatch,
    Storage(String),
}

pub type SharedCollabStore = std::sync::Arc<CollabStore>;
