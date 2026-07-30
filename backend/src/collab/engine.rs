// Human: Shared collab engine — join, presence, OT submit, snapshot compact.
// Agent: ORCHESTRATES store + domain plugins + hub; USED by HTTP/WS handlers.

use std::sync::Arc;

use serde_json::{json, Value};
use uuid::Uuid;

use crate::collab::domain::CollabDomain;
use crate::collab::domains::document::{apply_lock_presence, DocumentDomain};
use crate::collab::domains::spreadsheet::SpreadsheetDomain;
use crate::collab::hub::SharedCollabHub;
use crate::collab::store::{CasError, SharedCollabStore};
use crate::collab::types::{
    participant_color, CollabError, CollabSession, OpEnvelope, Participant, RoomKind,
    DEFAULT_MAX_OPS,
};

const CAS_RETRIES: u32 = 8;

pub struct CollabEngine {
    store: SharedCollabStore,
    hub: SharedCollabHub,
    document: DocumentDomain,
    spreadsheet: SpreadsheetDomain,
}

pub type SharedCollabEngine = Arc<CollabEngine>;

impl CollabEngine {
    pub fn new(store: SharedCollabStore, hub: SharedCollabHub) -> SharedCollabEngine {
        Arc::new(Self {
            store,
            hub,
            document: DocumentDomain::new(),
            spreadsheet: SpreadsheetDomain::new(),
        })
    }

    pub fn store(&self) -> &SharedCollabStore {
        &self.store
    }

    pub fn hub(&self) -> &SharedCollabHub {
        &self.hub
    }

    fn domain(&self, kind: RoomKind) -> &dyn CollabDomain {
        match kind {
            RoomKind::Document => &self.document,
            RoomKind::Spreadsheet => &self.spreadsheet,
        }
    }

    // Human: Join or create a live session for (room_kind, file_id).
    pub async fn join(
        &self,
        room_kind: RoomKind,
        file_id: &str,
        user_id: &str,
        display_name: &str,
        seed: Option<Value>,
    ) -> Result<CollabSession, CollabError> {
        let domain = self.domain(room_kind);
        for _ in 0..CAS_RETRIES {
            let existing = self.store.get_by_file(room_kind, file_id).await;
            let mut session = if let Some(s) = existing {
                s
            } else {
                crate::collab::store::CollabStore::new_session(
                    room_kind,
                    file_id,
                    domain.seed_snapshot(seed.clone()),
                )
            };

            // Seed empty document text/html only when still empty.
            if session.snapshot.data.get("text").and_then(|v| v.as_str()) == Some("") {
                if let Some(ref seed) = seed {
                    if room_kind == RoomKind::Document {
                        session.snapshot = domain.seed_snapshot(Some(seed.clone()));
                    }
                }
            }

            let now = crate::collab::store::CollabStore::now();
            let defaults = domain.presence_defaults();
            session.participants.insert(
                user_id.to_string(),
                Participant {
                    user_id: user_id.to_string(),
                    display_name: display_name.to_string(),
                    color: participant_color(user_id),
                    last_seen: now,
                    presence: defaults,
                },
            );
            session.last_active_at = now;
            let expected = session.version;
            match self.store.save_cas(session, expected).await {
                Ok(saved) => return Ok(saved),
                Err(CasError::VersionMismatch) => continue,
                Err(CasError::Storage(e)) => return Err(CollabError::Storage(e)),
            }
        }
        Err(CollabError::Conflict("join CAS contention".into()))
    }

    pub async fn get(&self, session_id: &str) -> Result<CollabSession, CollabError> {
        self.store
            .get(session_id)
            .await
            .ok_or(CollabError::NotFound)
    }

    pub async fn heartbeat(
        &self,
        session_id: &str,
        user_id: &str,
        presence: Option<Value>,
    ) -> Result<CollabSession, CollabError> {
        for _ in 0..CAS_RETRIES {
            let mut session = self
                .store
                .get(session_id)
                .await
                .ok_or(CollabError::NotFound)?;
            let participant = session
                .participants
                .get_mut(user_id)
                .ok_or(CollabError::NotParticipant)?;
            participant.last_seen = crate::collab::store::CollabStore::now();
            if let Some(p) = presence.clone() {
                if let Some(obj) = p.as_object() {
                    let target = participant
                        .presence
                        .as_object_mut()
                        .expect("presence object");
                    for (k, v) in obj {
                        if v.is_null() {
                            target.insert(k.clone(), Value::Null);
                        } else {
                            target.insert(k.clone(), v.clone());
                        }
                    }
                }
            }
            session.last_active_at = crate::collab::store::CollabStore::now();
            let expected = session.version;
            match self.store.save_cas(session, expected).await {
                Ok(saved) => {
                    self.publish_presence(&saved).await;
                    return Ok(saved);
                }
                Err(CasError::VersionMismatch) => continue,
                Err(CasError::Storage(e)) => return Err(CollabError::Storage(e)),
            }
        }
        Err(CollabError::Conflict("heartbeat CAS contention".into()))
    }

    // Human: Submit an op with base_seq; server OT-transforms then appends.
    pub async fn submit_op(
        &self,
        session_id: &str,
        user_id: &str,
        base_seq: u64,
        op_type: &str,
        payload: Value,
        client_op_id: Option<String>,
    ) -> Result<(OpEnvelope, CollabSession), CollabError> {
        for _ in 0..CAS_RETRIES {
            let mut session = self
                .store
                .get(session_id)
                .await
                .ok_or(CollabError::NotFound)?;
            if !session.participants.contains_key(user_id) {
                return Err(CollabError::NotParticipant);
            }

            let domain = self.domain(session.room_kind);
            let latest = session.latest_seq();
            if base_seq > latest {
                return Err(CollabError::InvalidOp(format!(
                    "base_seq {base_seq} ahead of latest {latest}"
                )));
            }

            // Intervening ops that the client has not seen.
            let intervening: Vec<OpEnvelope> = session.ops_after(base_seq);

            // Rebuild snapshot view for transform: snapshot already includes all applied ops
            // (we apply incrementally). Intervening is only for OT of concurrent client ops.
            let mut op = OpEnvelope {
                id: Uuid::new_v4().to_string(),
                seq: 0,
                user_id: user_id.to_string(),
                ts: crate::collab::store::CollabStore::now(),
                base_seq,
                op_type: op_type.to_string(),
                payload: payload.clone(),
                client_op_id: client_op_id.clone(),
            };

            domain.validate_and_transform(
                &session.snapshot,
                &intervening,
                &mut op,
                user_id,
                &session.participants,
            )?;

            domain.apply(&mut session.snapshot, &op)?;

            // Lock side-effects + presence OT for all participants.
            if session.room_kind == RoomKind::Document {
                if let Some(p) = session.participants.get_mut(user_id) {
                    apply_lock_presence(&mut p.presence, &op);
                }
            }
            for p in session.participants.values_mut() {
                domain.transform_presence(&mut p.presence, &op);
            }

            let seq = session.next_seq;
            session.next_seq += 1;
            op.seq = seq;
            session.ops.push_back(op.clone());

            // Compact op ring when oversized; snapshot already holds full state.
            while session.ops.len() > DEFAULT_MAX_OPS {
                if let Some(dropped) = session.ops.pop_front() {
                    session.snapshot.snapshot_seq = session.snapshot.snapshot_seq.max(dropped.seq);
                }
            }
            // Keep snapshot_seq trailing the retained log start for catch-up clarity.
            if let Some(first) = session.ops.front() {
                if session.snapshot.snapshot_seq + 1 < first.seq {
                    session.snapshot.snapshot_seq = first.seq.saturating_sub(1);
                }
            }

            session.last_active_at = crate::collab::store::CollabStore::now();
            if let Some(p) = session.participants.get_mut(user_id) {
                p.last_seen = session.last_active_at;
            }

            let expected = session.version;
            let op_out = op.clone();
            match self.store.save_cas(session, expected).await {
                Ok(saved) => {
                    self.publish_op(&saved, &op_out).await;
                    return Ok((op_out, saved));
                }
                Err(CasError::VersionMismatch) => {
                    // Retry whole submit with fresh session.
                    continue;
                }
                Err(CasError::Storage(e)) => return Err(CollabError::Storage(e)),
            }
        }
        Err(CollabError::Conflict("submit_op CAS contention".into()))
    }

    pub async fn ops_since(
        &self,
        session_id: &str,
        after_seq: u64,
    ) -> Result<Vec<OpEnvelope>, CollabError> {
        let session = self.get(session_id).await?;
        Ok(session.ops_after(after_seq))
    }

    async fn publish_presence(&self, session: &CollabSession) {
        let view = session_view(session);
        let msg = json!({
            "type": "presence",
            "participants": view.participants,
            "session": view,
        })
        .to_string();
        self.hub.publish(&session.id, msg).await;
    }

    async fn publish_op(&self, session: &CollabSession, op: &OpEnvelope) {
        let view = session_view(session);
        let msg = json!({
            "type": "op",
            "op": op,
            "session": view,
            "snapshot": session.snapshot,
        })
        .to_string();
        self.hub.publish(&session.id, msg).await;
    }
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct ParticipantView {
    pub user_id: String,
    pub display_name: String,
    pub color: String,
    pub last_seen: u64,
    pub presence: Value,
    // Document convenience fields flattened for UI compatibility.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub selection_start: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub selection_end: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lock_start: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lock_end: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active_cell: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sheet_name: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct SessionView {
    pub id: String,
    pub room_kind: RoomKind,
    pub file_id: String,
    pub participants: Vec<ParticipantView>,
    pub latest_seq: u64,
    pub snapshot: crate::collab::types::DomainSnapshot,
    /// Human: Convenience projections for document UI.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub document_html: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub document_text: Option<String>,
}

pub fn participant_view(p: &Participant) -> ParticipantView {
    let u32_field = |key: &str| -> Option<u32> {
        p.presence
            .get(key)
            .and_then(|v| v.as_u64())
            .map(|n| n as u32)
    };
    let str_field = |key: &str| -> Option<String> {
        p.presence
            .get(key)
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
    };
    ParticipantView {
        user_id: p.user_id.clone(),
        display_name: p.display_name.clone(),
        color: p.color.clone(),
        last_seen: p.last_seen,
        presence: p.presence.clone(),
        selection_start: u32_field("selection_start"),
        selection_end: u32_field("selection_end"),
        lock_start: u32_field("lock_start"),
        lock_end: u32_field("lock_end"),
        active_cell: str_field("active_cell"),
        sheet_name: str_field("sheet_name"),
    }
}

pub fn session_view(session: &CollabSession) -> SessionView {
    let mut participants: Vec<_> = session
        .participants
        .values()
        .map(participant_view)
        .collect();
    participants.sort_by(|a, b| a.display_name.cmp(&b.display_name));
    let (document_html, document_text) = if session.room_kind == RoomKind::Document {
        (
            session
                .snapshot
                .data
                .get("html")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string()),
            session
                .snapshot
                .data
                .get("text")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string()),
        )
    } else {
        (None, None)
    };
    SessionView {
        id: session.id.clone(),
        room_kind: session.room_kind,
        file_id: session.file_id.clone(),
        participants,
        latest_seq: session.latest_seq(),
        snapshot: session.snapshot.clone(),
        document_html,
        document_text,
    }
}

pub fn collab_error_to_message(err: &CollabError) -> String {
    err.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::collab::hub::new_shared_hub;
    use crate::collab::store::CollabStore;

    fn engine() -> SharedCollabEngine {
        let store = Arc::new(CollabStore::new());
        let hub = new_shared_hub(None, None);
        CollabEngine::new(store, hub)
    }

    #[tokio::test]
    async fn join_and_concurrent_document_ops() {
        let eng = engine();
        let s1 = eng
            .join(
                RoomKind::Document,
                "file-1",
                "u1",
                "Alice",
                Some(json!({ "text": "hello world", "html": "<p>hello world</p>" })),
            )
            .await
            .unwrap();
        let s2 = eng
            .join(RoomKind::Document, "file-1", "u2", "Bob", None)
            .await
            .unwrap();
        assert_eq!(s1.id, s2.id);

        let (op_a, _) = eng
            .submit_op(
                &s1.id,
                "u1",
                0,
                "replace",
                json!({ "index": 0, "delete": 0, "insert": "X" }),
                Some("a1".into()),
            )
            .await
            .unwrap();
        assert_eq!(op_a.seq, 1);

        let (op_b, session) = eng
            .submit_op(
                &s1.id,
                "u2",
                0, // concurrent with base 0; server transforms through op_a
                "replace",
                json!({ "index": 11, "delete": 0, "insert": "Y" }),
                Some("b1".into()),
            )
            .await
            .unwrap();
        assert_eq!(op_b.seq, 2);
        assert_eq!(
            session.snapshot.data.get("text").and_then(|v| v.as_str()),
            Some("Xhello worldY")
        );
    }

    #[tokio::test]
    async fn lock_enforced_on_replace() {
        let eng = engine();
        let s = eng
            .join(
                RoomKind::Document,
                "file-lock",
                "u1",
                "Alice",
                Some(json!({ "text": "abcdef", "html": "" })),
            )
            .await
            .unwrap();
        eng.join(RoomKind::Document, "file-lock", "u2", "Bob", None)
            .await
            .unwrap();
        eng.submit_op(
            &s.id,
            "u1",
            0,
            "lock",
            json!({ "start": 0, "end": 3 }),
            None,
        )
        .await
        .unwrap();

        let err = eng
            .submit_op(
                &s.id,
                "u2",
                1,
                "replace",
                json!({ "index": 1, "delete": 1, "insert": "Z" }),
                None,
            )
            .await
            .unwrap_err();
        assert!(matches!(err, CollabError::Locked));
    }

    #[tokio::test]
    async fn interleaved_typing_stress_converges() {
        let eng = engine();
        let s = eng
            .join(
                RoomKind::Document,
                "file-stress",
                "u1",
                "Alice",
                Some(json!({ "text": "", "html": "" })),
            )
            .await
            .unwrap();
        eng.join(RoomKind::Document, "file-stress", "u2", "Bob", None)
            .await
            .unwrap();

        // Alternate single-character inserts at end from two users (each tracks own base).
        let mut base_a = 0u64;
        let mut base_b = 0u64;
        for i in 0..40 {
            let (user, base) = if i % 2 == 0 {
                ("u1", base_a)
            } else {
                ("u2", base_b)
            };
            let ch = if i % 2 == 0 { "a" } else { "b" };
            // Always append relative to author base; server transforms.
            let (op, session) = eng
                .submit_op(
                    &s.id,
                    user,
                    base,
                    "replace",
                    json!({ "index": 10_000, "delete": 0, "insert": ch }), // clamp to end
                    Some(format!("c{i}")),
                )
                .await
                .unwrap();
            if user == "u1" {
                base_a = op.seq;
            } else {
                base_b = op.seq;
            }
            // Keep other base behind occasionally to force OT
            if i % 5 == 0 {
                // leave lag
            } else if user == "u1" {
                base_b = session.latest_seq();
            } else {
                base_a = session.latest_seq();
            }
        }

        let final_session = eng.get(&s.id).await.unwrap();
        let text = final_session
            .snapshot
            .data
            .get("text")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        assert_eq!(text.chars().count(), 40);
        assert_eq!(text.chars().filter(|c| *c == 'a').count(), 20);
        assert_eq!(text.chars().filter(|c| *c == 'b').count(), 20);
        assert_eq!(final_session.latest_seq(), 40);
    }
}
