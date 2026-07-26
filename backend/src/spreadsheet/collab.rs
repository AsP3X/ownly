// Human: In-memory co-editing session store — presence + op log foundation (not full CRDT).
// Agent: USED by spreadsheet collab HTTP handlers; PROCESS-LOCAL; NOT durable across restarts.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
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

#[derive(Debug, Default)]
pub struct CollabStore {
    sessions: Mutex<HashMap<String, CollabSession>>,
    // Human: Latest session id per file for join-by-file.
    // Agent: UPDATED on create; READ by join_or_create.
    by_file: Mutex<HashMap<String, String>>,
}

impl CollabStore {
    pub fn new() -> Self {
        Self::default()
    }

    fn prune_locked(sessions: &mut HashMap<String, CollabSession>, by_file: &mut HashMap<String, String>) {
        let now = now_unix();
        let stale: Vec<String> = sessions
            .iter()
            .filter(|(_, s)| now.saturating_sub(s.created_at) > SESSION_TTL_SECS)
            .map(|(id, _)| id.clone())
            .collect();
        for id in stale {
            if let Some(session) = sessions.remove(&id) {
                by_file.remove(&session.file_id);
            }
        }
        for session in sessions.values_mut() {
            session.participants.retain(|_, p| {
                now.saturating_sub(p.last_seen) <= PARTICIPANT_TTL_SECS
            });
        }
    }

    pub fn join_or_create(
        &self,
        file_id: &str,
        user_id: &str,
        display_name: &str,
    ) -> CollabSession {
        let mut sessions = self.sessions.lock().expect("collab sessions lock");
        let mut by_file = self.by_file.lock().expect("collab by_file lock");
        Self::prune_locked(&mut sessions, &mut by_file);

        let session_id = by_file.get(file_id).cloned().unwrap_or_else(|| {
            let id = Uuid::new_v4().to_string();
            by_file.insert(file_id.to_string(), id.clone());
            sessions.insert(
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

        let session = sessions
            .get_mut(&session_id)
            .expect("session just ensured");
        let color = participant_color(user_id);
        session.participants.insert(
            user_id.to_string(),
            CollabParticipant {
                user_id: user_id.to_string(),
                display_name: display_name.to_string(),
                color,
                last_seen: now_unix(),
                active_cell: None,
                sheet_name: None,
            },
        );
        session.clone()
    }

    pub fn heartbeat(
        &self,
        session_id: &str,
        user_id: &str,
        active_cell: Option<String>,
        sheet_name: Option<String>,
    ) -> Option<CollabSession> {
        let mut sessions = self.sessions.lock().expect("collab sessions lock");
        let mut by_file = self.by_file.lock().expect("collab by_file lock");
        Self::prune_locked(&mut sessions, &mut by_file);
        let session = sessions.get_mut(session_id)?;
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

    pub fn get(&self, session_id: &str) -> Option<CollabSession> {
        let mut sessions = self.sessions.lock().expect("collab sessions lock");
        let mut by_file = self.by_file.lock().expect("collab by_file lock");
        Self::prune_locked(&mut sessions, &mut by_file);
        sessions.get(session_id).cloned()
    }

    pub fn append_op(
        &self,
        session_id: &str,
        user_id: &str,
        op_type: &str,
        payload: serde_json::Value,
    ) -> Option<CollabOp> {
        let mut sessions = self.sessions.lock().expect("collab sessions lock");
        let mut by_file = self.by_file.lock().expect("collab by_file lock");
        Self::prune_locked(&mut sessions, &mut by_file);
        let session = sessions.get_mut(session_id)?;
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

    pub fn ops_since(&self, session_id: &str, after_seq: u64) -> Option<Vec<CollabOp>> {
        let session = self.get(session_id)?;
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
    let hash = user_id.bytes().fold(0u32, |acc, b| acc.wrapping_mul(31).wrapping_add(b as u32));
    COLORS[(hash as usize) % COLORS.len()].to_string()
}

pub type SharedCollabStore = Arc<CollabStore>;

pub fn new_shared_store() -> SharedCollabStore {
    Arc::new(CollabStore::new())
}

// Silence unused import warning if Duration reserved for future TTL tuning.
#[allow(dead_code)]
const _TTL: Duration = Duration::from_secs(PARTICIPANT_TTL_SECS);
