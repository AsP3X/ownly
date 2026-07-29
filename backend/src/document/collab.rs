// Human: Live rich-text co-editing store — sequential ops, presence, exclusive range locks.
// Agent: USED by document collab handlers/WS; memory default; Redis when REDIS_URL is set.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use redis::AsyncCommands;
use serde::{Deserialize, Serialize};
use tracing::{info, warn};
use uuid::Uuid;

const SESSION_TTL_SECS: u64 = 3600;
const PARTICIPANT_TTL_SECS: u64 = 90;
const MAX_OPS_PER_SESSION: usize = 800;

fn now_unix() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DocCollabParticipant {
    pub user_id: String,
    pub display_name: String,
    pub color: String,
    pub last_seen: u64,
    #[serde(default)]
    pub selection_start: Option<u32>,
    #[serde(default)]
    pub selection_end: Option<u32>,
    #[serde(default)]
    pub lock_start: Option<u32>,
    #[serde(default)]
    pub lock_end: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DocCollabOp {
    pub id: String,
    pub seq: u64,
    pub user_id: String,
    pub ts: u64,
    pub op_type: String,
    pub payload: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DocCollabSession {
    pub id: String,
    pub file_id: String,
    pub created_at: u64,
    pub participants: HashMap<String, DocCollabParticipant>,
    pub ops: Vec<DocCollabOp>,
    pub next_seq: u64,
    /// Human: Last committed HTML snapshot for late joiners / reconnect catch-up.
    #[serde(default)]
    pub document_html: String,
    /// Human: Plain-text projection used for lock ranges and insert/delete offsets.
    #[serde(default)]
    pub document_text: String,
}

struct MemoryState {
    sessions: HashMap<String, DocCollabSession>,
    by_file: HashMap<String, String>,
}

pub struct DocCollabStore {
    memory: Mutex<MemoryState>,
    redis: Option<redis::aio::ConnectionManager>,
}

impl Default for DocCollabStore {
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

pub type SharedDocCollabStore = Arc<DocCollabStore>;

impl DocCollabStore {
    pub fn new() -> Self {
        Self::default()
    }

    pub async fn from_redis_url(redis_url: &str) -> SharedDocCollabStore {
        let trimmed = redis_url.trim();
        if trimmed.is_empty() {
            info!("Document collab store: in-memory (set REDIS_URL for Redis)");
            return Arc::new(Self::new());
        }
        match redis::Client::open(trimmed) {
            Ok(client) => match redis::aio::ConnectionManager::new(client).await {
                Ok(manager) => {
                    info!("Document collab store: Redis");
                    Arc::new(Self {
                        memory: Mutex::new(MemoryState {
                            sessions: HashMap::new(),
                            by_file: HashMap::new(),
                        }),
                        redis: Some(manager),
                    })
                }
                Err(err) => {
                    warn!(error = %err, "Redis document collab connect failed — using in-memory");
                    Arc::new(Self::new())
                }
            },
            Err(err) => {
                warn!(error = %err, "Invalid REDIS_URL — using in-memory document collab");
                Arc::new(Self::new())
            }
        }
    }

    fn session_key(session_id: &str) -> String {
        format!("ownly:doc:session:{session_id}")
    }

    fn file_key(file_id: &str) -> String {
        format!("ownly:doc:file:{file_id}")
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

    fn prune_session(session: &mut DocCollabSession) {
        let now = now_unix();
        session
            .participants
            .retain(|_, p| now.saturating_sub(p.last_seen) <= PARTICIPANT_TTL_SECS);
    }

    async fn redis_get_session(&self, session_id: &str) -> Option<DocCollabSession> {
        let mut conn = self.redis.as_ref()?.clone();
        let raw: Option<String> = conn.get(Self::session_key(session_id)).await.ok()?;
        let mut session: DocCollabSession = serde_json::from_str(&raw?).ok()?;
        Self::prune_session(&mut session);
        Some(session)
    }

    async fn redis_save_session(&self, session: &DocCollabSession) -> redis::RedisResult<()> {
        let Some(mut conn) = self.redis.clone() else {
            return Ok(());
        };
        let raw = serde_json::to_string(session).map_err(|e| {
            redis::RedisError::from((
                redis::ErrorKind::TypeError,
                "serialize doc session",
                e.to_string(),
            ))
        })?;
        let _: () = conn
            .set_ex(Self::session_key(&session.id), raw, SESSION_TTL_SECS)
            .await?;
        let _: () = conn
            .set_ex(
                Self::file_key(&session.file_id),
                session.id.as_str(),
                SESSION_TTL_SECS,
            )
            .await?;
        Ok(())
    }

    pub async fn join_or_create(
        &self,
        file_id: &str,
        user_id: &str,
        display_name: &str,
        initial_html: Option<String>,
        initial_text: Option<String>,
    ) -> DocCollabSession {
        if self.redis.is_some() {
            if let Some(session) = self
                .join_or_create_redis(file_id, user_id, display_name, initial_html.clone(), initial_text.clone())
                .await
            {
                return session;
            }
        }
        self.join_or_create_memory(file_id, user_id, display_name, initial_html, initial_text)
    }

    fn join_or_create_memory(
        &self,
        file_id: &str,
        user_id: &str,
        display_name: &str,
        initial_html: Option<String>,
        initial_text: Option<String>,
    ) -> DocCollabSession {
        let mut state = self.memory.lock().expect("doc collab lock");
        Self::prune_memory(&mut state);

        let session_id = state.by_file.get(file_id).cloned().unwrap_or_else(|| {
            let id = Uuid::new_v4().to_string();
            state.by_file.insert(file_id.to_string(), id.clone());
            state.sessions.insert(
                id.clone(),
                DocCollabSession {
                    id: id.clone(),
                    file_id: file_id.to_string(),
                    created_at: now_unix(),
                    participants: HashMap::new(),
                    ops: Vec::new(),
                    next_seq: 1,
                    document_html: initial_html.clone().unwrap_or_default(),
                    document_text: initial_text.clone().unwrap_or_default(),
                },
            );
            id
        });

        let session = state
            .sessions
            .get_mut(&session_id)
            .expect("session just ensured");
        if session.document_html.is_empty() {
            if let Some(html) = initial_html {
                session.document_html = html;
            }
        }
        if session.document_text.is_empty() {
            if let Some(text) = initial_text {
                session.document_text = text;
            }
        }
        session.participants.insert(
            user_id.to_string(),
            DocCollabParticipant {
                user_id: user_id.to_string(),
                display_name: display_name.to_string(),
                color: participant_color(user_id),
                last_seen: now_unix(),
                selection_start: None,
                selection_end: None,
                lock_start: None,
                lock_end: None,
            },
        );
        session.clone()
    }

    async fn join_or_create_redis(
        &self,
        file_id: &str,
        user_id: &str,
        display_name: &str,
        initial_html: Option<String>,
        initial_text: Option<String>,
    ) -> Option<DocCollabSession> {
        let mut conn = self.redis.as_ref()?.clone();
        let existing_id: Option<String> = conn.get(Self::file_key(file_id)).await.ok()?;
        let mut session = if let Some(id) = existing_id {
            self.redis_get_session(&id).await.unwrap_or_else(|| DocCollabSession {
                id,
                file_id: file_id.to_string(),
                created_at: now_unix(),
                participants: HashMap::new(),
                ops: Vec::new(),
                next_seq: 1,
                document_html: initial_html.clone().unwrap_or_default(),
                document_text: initial_text.clone().unwrap_or_default(),
            })
        } else {
            DocCollabSession {
                id: Uuid::new_v4().to_string(),
                file_id: file_id.to_string(),
                created_at: now_unix(),
                participants: HashMap::new(),
                ops: Vec::new(),
                next_seq: 1,
                document_html: initial_html.clone().unwrap_or_default(),
                document_text: initial_text.clone().unwrap_or_default(),
            }
        };
        Self::prune_session(&mut session);
        if session.document_html.is_empty() {
            if let Some(html) = initial_html {
                session.document_html = html;
            }
        }
        if session.document_text.is_empty() {
            if let Some(text) = initial_text {
                session.document_text = text;
            }
        }
        session.participants.insert(
            user_id.to_string(),
            DocCollabParticipant {
                user_id: user_id.to_string(),
                display_name: display_name.to_string(),
                color: participant_color(user_id),
                last_seen: now_unix(),
                selection_start: None,
                selection_end: None,
                lock_start: None,
                lock_end: None,
            },
        );
        self.redis_save_session(&session).await.ok()?;
        Some(session)
    }

    pub async fn get(&self, session_id: &str) -> Option<DocCollabSession> {
        if self.redis.is_some() {
            if let Some(session) = self.redis_get_session(session_id).await {
                return Some(session);
            }
        }
        let mut state = self.memory.lock().expect("doc collab lock");
        Self::prune_memory(&mut state);
        state.sessions.get(session_id).cloned()
    }

    pub async fn heartbeat(
        &self,
        session_id: &str,
        user_id: &str,
        selection_start: Option<u32>,
        selection_end: Option<u32>,
        lock_start: Option<u32>,
        lock_end: Option<u32>,
    ) -> Option<DocCollabSession> {
        if self.redis.is_some() {
            if let Some(session) = self
                .heartbeat_redis(
                    session_id,
                    user_id,
                    selection_start,
                    selection_end,
                    lock_start,
                    lock_end,
                )
                .await
            {
                return Some(session);
            }
        }
        self.heartbeat_memory(
            session_id,
            user_id,
            selection_start,
            selection_end,
            lock_start,
            lock_end,
        )
    }

    fn heartbeat_memory(
        &self,
        session_id: &str,
        user_id: &str,
        selection_start: Option<u32>,
        selection_end: Option<u32>,
        lock_start: Option<u32>,
        lock_end: Option<u32>,
    ) -> Option<DocCollabSession> {
        let mut state = self.memory.lock().expect("doc collab lock");
        Self::prune_memory(&mut state);
        let session = state.sessions.get_mut(session_id)?;
        let participant = session.participants.get_mut(user_id)?;
        participant.last_seen = now_unix();
        if let Some(v) = selection_start {
            participant.selection_start = Some(v);
        }
        if let Some(v) = selection_end {
            participant.selection_end = Some(v);
        }
        // Human: Explicit Option::Some including clearing locks via sentinel max — client sends fields only when set.
        // Human: lock_start/end Some(0)+Some(0) means clear lock; other Some values set exclusive range.
        match (lock_start, lock_end) {
            (Some(0), Some(0)) => {
                participant.lock_start = None;
                participant.lock_end = None;
            }
            (Some(s), Some(e)) => {
                participant.lock_start = Some(s);
                participant.lock_end = Some(e);
            }
            _ => {}
        }
        Some(session.clone())
    }

    async fn heartbeat_redis(
        &self,
        session_id: &str,
        user_id: &str,
        selection_start: Option<u32>,
        selection_end: Option<u32>,
        lock_start: Option<u32>,
        lock_end: Option<u32>,
    ) -> Option<DocCollabSession> {
        let mut session = self.redis_get_session(session_id).await?;
        let participant = session.participants.get_mut(user_id)?;
        participant.last_seen = now_unix();
        if let Some(v) = selection_start {
            participant.selection_start = Some(v);
        }
        if let Some(v) = selection_end {
            participant.selection_end = Some(v);
        }
        match (lock_start, lock_end) {
            (Some(0), Some(0)) => {
                participant.lock_start = None;
                participant.lock_end = None;
            }
            (Some(s), Some(e)) => {
                participant.lock_start = Some(s);
                participant.lock_end = Some(e);
            }
            _ => {}
        }
        self.redis_save_session(&session).await.ok()?;
        Some(session)
    }

    // Human: True when [start,end) overlaps any other user's exclusive lock.
    // Agent: READS participants except user_id; RETURNS true on conflict.
    fn range_blocked_by_others(session: &DocCollabSession, user_id: &str, start: u32, end: u32) -> bool {
        if end <= start {
            return false;
        }
        for (id, p) in &session.participants {
            if id == user_id {
                continue;
            }
            let Some(ls) = p.lock_start else { continue };
            let Some(le) = p.lock_end else { continue };
            if le <= ls {
                continue;
            }
            // Overlap if start < le && end > ls
            if start < le && end > ls {
                return true;
            }
        }
        false
    }

    pub async fn append_op(
        &self,
        session_id: &str,
        user_id: &str,
        op_type: &str,
        payload: serde_json::Value,
    ) -> Result<DocCollabOp, AppendOpError> {
        if self.redis.is_some() {
            match self
                .append_op_redis(session_id, user_id, op_type, payload.clone())
                .await
            {
                Ok(op) => return Ok(op),
                Err(AppendOpError::Locked) => return Err(AppendOpError::Locked),
                Err(AppendOpError::NotFound) => {
                    // fall through to memory if redis session missing
                }
            }
        }
        self.append_op_memory(session_id, user_id, op_type, payload)
    }

    fn apply_op_to_document(session: &mut DocCollabSession, op_type: &str, payload: &serde_json::Value) {
        match op_type {
            "doc_html" => {
                if let Some(html) = payload.get("html").and_then(|v| v.as_str()) {
                    session.document_html = html.to_string();
                }
                if let Some(text) = payload.get("text").and_then(|v| v.as_str()) {
                    session.document_text = text.to_string();
                }
            }
            "text_insert" => {
                let index = payload.get("index").and_then(|v| v.as_u64()).unwrap_or(0) as usize;
                let text = payload
                    .get("text")
                    .and_then(|v| v.as_str())
                    .unwrap_or_default();
                let mut chars: Vec<char> = session.document_text.chars().collect();
                let idx = index.min(chars.len());
                for (offset, ch) in text.chars().enumerate() {
                    chars.insert(idx + offset, ch);
                }
                session.document_text = chars.into_iter().collect();
            }
            "text_delete" => {
                let index = payload.get("index").and_then(|v| v.as_u64()).unwrap_or(0) as usize;
                let length = payload.get("length").and_then(|v| v.as_u64()).unwrap_or(0) as usize;
                let mut chars: Vec<char> = session.document_text.chars().collect();
                if index < chars.len() && length > 0 {
                    let end = (index + length).min(chars.len());
                    chars.drain(index..end);
                    session.document_text = chars.into_iter().collect();
                }
            }
            _ => {}
        }
    }

    fn validate_edit_range(
        session: &DocCollabSession,
        user_id: &str,
        op_type: &str,
        payload: &serde_json::Value,
    ) -> Result<(), AppendOpError> {
        match op_type {
            // Human: Text ops + full HTML are advisory on the server — UI blocks foreign locks.
            // Agent: NEVER reject text_*/doc_html for locks (silent drop froze concurrent sync).
            "text_insert" | "text_delete" | "doc_html" | "unlock" => Ok(()),
            "lock" => {
                let start = payload.get("start").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
                let end = payload.get("end").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
                if end > start && Self::range_blocked_by_others(session, user_id, start, end) {
                    return Err(AppendOpError::Locked);
                }
                Ok(())
            }
            _ => Ok(()),
        }
    }

    // Human: Keep peer lock/caret offsets valid after plain-text insert/delete.
    // Agent: SHIFTS every participant selection + lock through the op (basic OT).
    fn transform_presence_through_text_op(
        session: &mut DocCollabSession,
        op_type: &str,
        payload: &serde_json::Value,
    ) {
        let (index, delete_count, insert_len) = match op_type {
            "text_insert" => {
                let index = payload.get("index").and_then(|v| v.as_u64()).unwrap_or(0) as i64;
                let text = payload.get("text").and_then(|v| v.as_str()).unwrap_or_default();
                (index, 0_i64, text.chars().count() as i64)
            }
            "text_delete" => {
                let index = payload.get("index").and_then(|v| v.as_u64()).unwrap_or(0) as i64;
                let length = payload.get("length").and_then(|v| v.as_u64()).unwrap_or(0) as i64;
                (index, length, 0_i64)
            }
            _ => return,
        };

        let shift = |offset: Option<u32>| -> Option<u32> {
            let Some(raw) = offset else { return None };
            let mut o = raw as i64;
            if o <= index {
                return Some(raw);
            }
            if o >= index + delete_count {
                o = o - delete_count + insert_len;
            } else {
                // Inside deleted span → land at index (+ insert for insert ops)
                o = index + insert_len;
            }
            Some(o.max(0) as u32)
        };

        for participant in session.participants.values_mut() {
            participant.selection_start = shift(participant.selection_start);
            participant.selection_end = shift(participant.selection_end);
            let ls = shift(participant.lock_start);
            let le = shift(participant.lock_end);
            match (ls, le) {
                (Some(a), Some(b)) if b > a => {
                    participant.lock_start = Some(a);
                    participant.lock_end = Some(b);
                }
                (Some(a), Some(b)) if b <= a => {
                    participant.lock_start = None;
                    participant.lock_end = None;
                }
                _ => {
                    participant.lock_start = ls;
                    participant.lock_end = le;
                }
            }
        }
    }

    fn append_op_memory(
        &self,
        session_id: &str,
        user_id: &str,
        op_type: &str,
        payload: serde_json::Value,
    ) -> Result<DocCollabOp, AppendOpError> {
        let mut state = self.memory.lock().expect("doc collab lock");
        Self::prune_memory(&mut state);
        let session = state
            .sessions
            .get_mut(session_id)
            .ok_or(AppendOpError::NotFound)?;
        if !session.participants.contains_key(user_id) {
            return Err(AppendOpError::NotFound);
        }
        Self::validate_edit_range(session, user_id, op_type, &payload)?;

        if op_type == "lock" {
            let start = payload.get("start").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
            let end = payload.get("end").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
            if end > start && Self::range_blocked_by_others(session, user_id, start, end) {
                return Err(AppendOpError::Locked);
            }
            if let Some(p) = session.participants.get_mut(user_id) {
                p.lock_start = Some(start);
                p.lock_end = Some(end);
            }
        }
        if op_type == "unlock" {
            if let Some(p) = session.participants.get_mut(user_id) {
                p.lock_start = None;
                p.lock_end = None;
            }
        }

        Self::apply_op_to_document(session, op_type, &payload);
        Self::transform_presence_through_text_op(session, op_type, &payload);

        let seq = session.next_seq;
        session.next_seq += 1;
        let op = DocCollabOp {
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
        Ok(op)
    }

    async fn append_op_redis(
        &self,
        session_id: &str,
        user_id: &str,
        op_type: &str,
        payload: serde_json::Value,
    ) -> Result<DocCollabOp, AppendOpError> {
        let mut session = self
            .redis_get_session(session_id)
            .await
            .ok_or(AppendOpError::NotFound)?;
        if !session.participants.contains_key(user_id) {
            return Err(AppendOpError::NotFound);
        }
        Self::validate_edit_range(&session, user_id, op_type, &payload)?;

        if op_type == "lock" {
            let start = payload.get("start").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
            let end = payload.get("end").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
            if end > start && Self::range_blocked_by_others(&session, user_id, start, end) {
                return Err(AppendOpError::Locked);
            }
            if let Some(p) = session.participants.get_mut(user_id) {
                p.lock_start = Some(start);
                p.lock_end = Some(end);
            }
        }
        if op_type == "unlock" {
            if let Some(p) = session.participants.get_mut(user_id) {
                p.lock_start = None;
                p.lock_end = None;
            }
        }

        Self::apply_op_to_document(&mut session, op_type, &payload);
        Self::transform_presence_through_text_op(&mut session, op_type, &payload);

        let seq = session.next_seq;
        session.next_seq += 1;
        let op = DocCollabOp {
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
        self.redis_save_session(&session)
            .await
            .map_err(|_| AppendOpError::NotFound)?;
        Ok(op)
    }

    pub async fn ops_since(&self, session_id: &str, after_seq: u64) -> Option<Vec<DocCollabOp>> {
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

#[derive(Debug)]
pub enum AppendOpError {
    NotFound,
    Locked,
}

fn participant_color(user_id: &str) -> String {
    const COLORS: &[&str] = &[
        "#2563EB", "#DC2626", "#059669", "#D97706", "#7C3AED", "#DB2777", "#0891B2",
    ];
    let hash = user_id.bytes().fold(0usize, |acc, b| acc.wrapping_add(b as usize));
    COLORS[hash % COLORS.len()].to_string()
}
