// Human: Document (RTF) collab domain — text OT replace, format_commit, exclusive range locks.
// Agent: IMPLEMENTS CollabDomain; snapshot { text, html }.

use serde_json::{json, Value};

use crate::collab::domain::CollabDomain;
use crate::collab::ot::text::{
    apply_replace, transform_offset, transform_range, transform_replace_through, TextReplace,
};
use crate::collab::types::{
    CollabError, DomainSnapshot, OpEnvelope, Participant, RoomKind,
};

pub struct DocumentDomain;

impl DocumentDomain {
    pub fn new() -> Self {
        Self
    }

    fn text_of(snapshot: &DomainSnapshot) -> String {
        snapshot
            .data
            .get("text")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string()
    }

    fn parse_replace(payload: &Value) -> Result<TextReplace, CollabError> {
        let index = payload
            .get("index")
            .and_then(|v| v.as_u64())
            .ok_or_else(|| CollabError::InvalidOp("replace.index required".into()))?
            as usize;
        let delete = payload
            .get("delete")
            .and_then(|v| v.as_u64())
            .unwrap_or(0) as usize;
        let insert = payload
            .get("insert")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        if delete == 0 && insert.is_empty() {
            return Err(CollabError::InvalidOp("replace is a no-op".into()));
        }
        Ok(TextReplace {
            index,
            delete,
            insert,
        })
    }

    fn replace_from_op(op: &OpEnvelope) -> Option<TextReplace> {
        if op.op_type != "replace" {
            return None;
        }
        Self::parse_replace(&op.payload).ok()
    }

    fn range_blocked_by_others(
        participants: &std::collections::HashMap<String, Participant>,
        actor: &str,
        start: u32,
        end: u32,
    ) -> bool {
        if end <= start {
            return false;
        }
        for (id, p) in participants {
            if id == actor {
                continue;
            }
            let Some(ls) = p.presence.get("lock_start").and_then(|v| v.as_u64()) else {
                continue;
            };
            let Some(le) = p.presence.get("lock_end").and_then(|v| v.as_u64()) else {
                continue;
            };
            if le <= ls {
                continue;
            }
            if (start as u64) < le && (end as u64) > ls {
                return true;
            }
        }
        false
    }

}

impl Default for DocumentDomain {
    fn default() -> Self {
        Self::new()
    }
}

impl CollabDomain for DocumentDomain {
    fn room_kind(&self) -> RoomKind {
        RoomKind::Document
    }

    fn empty_snapshot(&self) -> DomainSnapshot {
        DomainSnapshot {
            snapshot_seq: 0,
            data: json!({ "text": "", "html": "" }),
        }
    }

    fn seed_snapshot(&self, seed: Option<Value>) -> DomainSnapshot {
        let mut snap = self.empty_snapshot();
        if let Some(seed) = seed {
            if let Some(text) = seed.get("text").and_then(|v| v.as_str()) {
                snap.data["text"] = json!(text);
            }
            if let Some(html) = seed.get("html").and_then(|v| v.as_str()) {
                snap.data["html"] = json!(html);
            }
        }
        snap
    }

    fn validate_and_transform(
        &self,
        snapshot: &DomainSnapshot,
        intervening: &[OpEnvelope],
        op: &mut OpEnvelope,
        actor: &str,
        participants: &std::collections::HashMap<String, Participant>,
    ) -> Result<(), CollabError> {
        match op.op_type.as_str() {
            "replace" => {
                let mut replace = Self::parse_replace(&op.payload)?;
                let prior: Vec<TextReplace> = intervening
                    .iter()
                    .filter_map(Self::replace_from_op)
                    .collect();
                replace = transform_replace_through(&replace, &prior);

                // Clamp to current text length after intervening applies (snapshot already includes them).
                let text = Self::text_of(snapshot);
                let len = text.chars().count();
                if replace.index > len {
                    replace.index = len;
                }
                if replace.index + replace.delete > len {
                    replace.delete = len.saturating_sub(replace.index);
                }

                let end = if replace.delete > 0 {
                    (replace.index + replace.delete) as u32
                } else {
                    (replace.index as u32).saturating_add(1)
                };
                if Self::range_blocked_by_others(participants, actor, replace.index as u32, end) {
                    return Err(CollabError::Locked);
                }

                op.payload = json!({
                    "index": replace.index,
                    "delete": replace.delete,
                    "insert": replace.insert,
                });
                Ok(())
            }
            "format_commit" => {
                let html = op
                    .payload
                    .get("html")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| CollabError::InvalidOp("format_commit.html required".into()))?;
                let text = op
                    .payload
                    .get("text")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| CollabError::InvalidOp("format_commit.text required".into()))?;
                let server_text = Self::text_of(snapshot);
                if text != server_text {
                    return Err(CollabError::TextMismatch);
                }
                // Any foreign lock blocks full-doc format (would clobber locked regions' structure).
                for (id, p) in participants {
                    if id == actor {
                        continue;
                    }
                    let ls = p.presence.get("lock_start").and_then(|v| v.as_u64());
                    let le = p.presence.get("lock_end").and_then(|v| v.as_u64());
                    if let (Some(a), Some(b)) = (ls, le) {
                        if b > a {
                            return Err(CollabError::Locked);
                        }
                    }
                }
                op.payload = json!({ "html": html, "text": text });
                Ok(())
            }
            "lock" => {
                let start = op
                    .payload
                    .get("start")
                    .and_then(|v| v.as_u64())
                    .ok_or_else(|| CollabError::InvalidOp("lock.start required".into()))?
                    as u32;
                let end = op
                    .payload
                    .get("end")
                    .and_then(|v| v.as_u64())
                    .ok_or_else(|| CollabError::InvalidOp("lock.end required".into()))?
                    as u32;
                // Human: Empty range (empty doc / collapsed caret) → treat as unlock, not error.
                // Agent: REWRITES op to unlock so apply_lock_presence clears the actor lock.
                if end <= start {
                    op.op_type = "unlock".into();
                    op.payload = json!({});
                    return Ok(());
                }
                if Self::range_blocked_by_others(participants, actor, start, end) {
                    return Err(CollabError::Locked);
                }
                Ok(())
            }
            "unlock" => Ok(()),
            other => Err(CollabError::InvalidOp(format!(
                "unknown document op_type: {other}"
            ))),
        }
    }

    fn apply(&self, snapshot: &mut DomainSnapshot, op: &OpEnvelope) -> Result<(), CollabError> {
        match op.op_type.as_str() {
            "replace" => {
                let replace = Self::parse_replace(&op.payload)?;
                let text = Self::text_of(snapshot);
                let next = apply_replace(&text, &replace);
                snapshot.data["text"] = json!(next);
                // HTML becomes stale until format_commit — keep previous html structure as best-effort.
                Ok(())
            }
            "format_commit" => {
                let html = op
                    .payload
                    .get("html")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                let text = op
                    .payload
                    .get("text")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                snapshot.data["html"] = json!(html);
                snapshot.data["text"] = json!(text);
                Ok(())
            }
            "lock" | "unlock" => Ok(()),
            other => Err(CollabError::InvalidOp(format!(
                "unknown document op_type: {other}"
            ))),
        }
    }

    fn transform_presence(&self, presence: &mut Value, op: &OpEnvelope) {
        if op.op_type != "replace" {
            return;
        }
        let Ok(replace) = Self::parse_replace(&op.payload) else {
            return;
        };
        let mut shift = |key: &str| {
            if let Some(v) = presence.get(key).and_then(|x| x.as_u64()) {
                let next = transform_offset(v as usize, &replace);
                presence[key] = json!(next);
            }
        };
        shift("selection_start");
        shift("selection_end");
        let ls = presence
            .get("lock_start")
            .and_then(|v| v.as_u64())
            .map(|v| v as usize);
        let le = presence
            .get("lock_end")
            .and_then(|v| v.as_u64())
            .map(|v| v as usize);
        if let (Some(s), Some(e)) = (ls, le) {
            match transform_range(s, e, &replace) {
                Some((ns, ne)) => {
                    presence["lock_start"] = json!(ns);
                    presence["lock_end"] = json!(ne);
                }
                None => {
                    presence.as_object_mut().map(|m| {
                        m.remove("lock_start");
                        m.remove("lock_end");
                    });
                }
            }
        }
    }

    fn presence_defaults(&self) -> Value {
        json!({
            "selection_start": null,
            "selection_end": null,
            "lock_start": null,
            "lock_end": null,
        })
    }
}

/// Human: Apply lock/unlock side-effects onto the actor's presence map.
pub fn apply_lock_presence(presence: &mut Value, op: &OpEnvelope) {
    match op.op_type.as_str() {
        "lock" => {
            if let (Some(s), Some(e)) = (
                op.payload.get("start").and_then(|v| v.as_u64()),
                op.payload.get("end").and_then(|v| v.as_u64()),
            ) {
                presence["lock_start"] = json!(s);
                presence["lock_end"] = json!(e);
            }
        }
        "unlock" => {
            if let Some(obj) = presence.as_object_mut() {
                obj.insert("lock_start".into(), Value::Null);
                obj.insert("lock_end".into(), Value::Null);
            }
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn domain() -> DocumentDomain {
        DocumentDomain::new()
    }

    #[test]
    fn concurrent_replace_converges() {
        let d = domain();
        let mut snap = d.seed_snapshot(Some(json!({ "text": "hello world", "html": "<p>hello world</p>" })));

        let mut op_a = OpEnvelope {
            id: "a".into(),
            seq: 0,
            user_id: "u1".into(),
            ts: 1,
            base_seq: 0,
            op_type: "replace".into(),
            payload: json!({ "index": 0, "delete": 0, "insert": "X" }),
            client_op_id: None,
        };
        let mut op_b = OpEnvelope {
            id: "b".into(),
            seq: 0,
            user_id: "u2".into(),
            ts: 1,
            base_seq: 0,
            op_type: "replace".into(),
            payload: json!({ "index": 11, "delete": 0, "insert": "Y" }),
            client_op_id: None,
        };
        let parts = HashMap::new();
        d.validate_and_transform(&snap, &[], &mut op_a, "u1", &parts)
            .unwrap();
        d.apply(&mut snap, &op_a).unwrap();
        d.validate_and_transform(&snap, &[op_a.clone()], &mut op_b, "u2", &parts)
            .unwrap();
        d.apply(&mut snap, &op_b).unwrap();
        assert_eq!(DocumentDomain::text_of(&snap), "Xhello worldY");
    }

    #[test]
    fn lock_blocks_replace() {
        let d = domain();
        let snap = d.seed_snapshot(Some(json!({ "text": "abcdef", "html": "" })));
        let mut parts = HashMap::new();
        parts.insert(
            "u1".into(),
            Participant {
                user_id: "u1".into(),
                display_name: "One".into(),
                color: "#000".into(),
                last_seen: 0,
                presence: json!({ "lock_start": 0, "lock_end": 3 }),
            },
        );
        let mut op = OpEnvelope {
            id: "x".into(),
            seq: 0,
            user_id: "u2".into(),
            ts: 1,
            base_seq: 0,
            op_type: "replace".into(),
            payload: json!({ "index": 1, "delete": 1, "insert": "Z" }),
            client_op_id: None,
        };
        let err = d
            .validate_and_transform(&snap, &[], &mut op, "u2", &parts)
            .unwrap_err();
        assert!(matches!(err, CollabError::Locked));
    }

    #[test]
    fn format_commit_requires_text_match() {
        let d = domain();
        let snap = d.seed_snapshot(Some(json!({ "text": "abc", "html": "<p>abc</p>" })));
        let mut op = OpEnvelope {
            id: "f".into(),
            seq: 0,
            user_id: "u1".into(),
            ts: 1,
            base_seq: 0,
            op_type: "format_commit".into(),
            payload: json!({ "html": "<p><b>abX</b></p>", "text": "abX" }),
            client_op_id: None,
        };
        let err = d
            .validate_and_transform(&snap, &[], &mut op, "u1", &HashMap::new())
            .unwrap_err();
        assert!(matches!(err, CollabError::TextMismatch));
    }

    #[test]
    fn format_commit_ok_when_text_matches() {
        let d = domain();
        let mut snap = d.seed_snapshot(Some(json!({ "text": "abc", "html": "<p>abc</p>" })));
        let mut op = OpEnvelope {
            id: "f".into(),
            seq: 0,
            user_id: "u1".into(),
            ts: 1,
            base_seq: 0,
            op_type: "format_commit".into(),
            payload: json!({ "html": "<p><b>abc</b></p>", "text": "abc" }),
            client_op_id: None,
        };
        d.validate_and_transform(&snap, &[], &mut op, "u1", &HashMap::new())
            .unwrap();
        d.apply(&mut snap, &op).unwrap();
        assert_eq!(
            snap.data.get("html").and_then(|v| v.as_str()),
            Some("<p><b>abc</b></p>")
        );
    }

    #[test]
    fn empty_lock_rewrites_to_unlock() {
        let d = domain();
        let snap = d.empty_snapshot();
        let mut op = OpEnvelope {
            id: "l".into(),
            seq: 0,
            user_id: "u1".into(),
            ts: 1,
            base_seq: 0,
            op_type: "lock".into(),
            payload: json!({ "start": 0, "end": 0 }),
            client_op_id: None,
        };
        d.validate_and_transform(&snap, &[], &mut op, "u1", &HashMap::new())
            .unwrap();
        assert_eq!(op.op_type, "unlock");
    }
}
