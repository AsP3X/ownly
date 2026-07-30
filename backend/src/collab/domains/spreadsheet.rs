// Human: Spreadsheet collab domain — total-order LWW ops + optional state_commit snapshot.
// Agent: IMPLEMENTS CollabDomain; does not OT cell payloads (server order is authority).

use serde_json::{json, Value};

use crate::collab::domain::CollabDomain;
use crate::collab::types::{
    CollabError, DomainSnapshot, OpEnvelope, Participant, RoomKind,
};

/// Human: Max gap between client base_seq and head before forcing sync (catch-up).
const MAX_BASE_LAG: u64 = 256;

pub struct SpreadsheetDomain;

impl SpreadsheetDomain {
    pub fn new() -> Self {
        Self
    }

    fn known_op(op_type: &str) -> bool {
        matches!(
            op_type,
            "cell_edit"
                | "style_patch"
                | "clear_contents"
                | "comment"
                | "hyperlink"
                | "merge"
                | "unmerge"
                | "insert_row"
                | "delete_row"
                | "insert_column"
                | "delete_column"
                | "sheet_add"
                | "sheet_remove"
                | "sheet_rename"
                | "sheet_move"
                | "state_commit"
        )
    }
}

impl Default for SpreadsheetDomain {
    fn default() -> Self {
        Self::new()
    }
}

impl CollabDomain for SpreadsheetDomain {
    fn room_kind(&self) -> RoomKind {
        RoomKind::Spreadsheet
    }

    fn empty_snapshot(&self) -> DomainSnapshot {
        DomainSnapshot {
            snapshot_seq: 0,
            data: json!({ "workbook": null }),
        }
    }

    fn seed_snapshot(&self, seed: Option<Value>) -> DomainSnapshot {
        let mut snap = self.empty_snapshot();
        if let Some(seed) = seed {
            if let Some(wb) = seed.get("workbook") {
                snap.data["workbook"] = wb.clone();
            }
        }
        snap
    }

    fn validate_and_transform(
        &self,
        _snapshot: &DomainSnapshot,
        intervening: &[OpEnvelope],
        op: &mut OpEnvelope,
        _actor: &str,
        _participants: &std::collections::HashMap<String, Participant>,
    ) -> Result<(), CollabError> {
        if !Self::known_op(&op.op_type) {
            return Err(CollabError::InvalidOp(format!(
                "unknown spreadsheet op_type: {}",
                op.op_type
            )));
        }
        if intervening.len() as u64 > MAX_BASE_LAG {
            return Err(CollabError::SyncRequired);
        }
        // Total-order LWW: no payload transform. state_commit replaces snapshot workbook on apply.
        Ok(())
    }

    fn apply(&self, snapshot: &mut DomainSnapshot, op: &OpEnvelope) -> Result<(), CollabError> {
        if op.op_type == "state_commit" {
            if let Some(wb) = op.payload.get("workbook") {
                snapshot.data["workbook"] = wb.clone();
            }
        }
        // Incremental sheet ops are applied client-side; server stores log + optional commit.
        Ok(())
    }

    fn transform_presence(&self, _presence: &mut Value, _op: &OpEnvelope) {
        // Cursor positions are free-form labels; clients refresh via heartbeat.
    }

    fn presence_defaults(&self) -> Value {
        json!({
            "active_cell": null,
            "sheet_name": null,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    #[test]
    fn rejects_unknown_op() {
        let d = SpreadsheetDomain::new();
        let snap = d.empty_snapshot();
        let mut op = OpEnvelope {
            id: "1".into(),
            seq: 0,
            user_id: "u".into(),
            ts: 0,
            base_seq: 0,
            op_type: "nope".into(),
            payload: json!({}),
            client_op_id: None,
        };
        assert!(matches!(
            d.validate_and_transform(&snap, &[], &mut op, "u", &HashMap::new()),
            Err(CollabError::InvalidOp(_))
        ));
    }

    #[test]
    fn state_commit_stores_workbook() {
        let d = SpreadsheetDomain::new();
        let mut snap = d.empty_snapshot();
        let op = OpEnvelope {
            id: "1".into(),
            seq: 1,
            user_id: "u".into(),
            ts: 0,
            base_seq: 0,
            op_type: "state_commit".into(),
            payload: json!({ "workbook": { "sheets": [] } }),
            client_op_id: None,
        };
        d.apply(&mut snap, &op).unwrap();
        assert!(snap.data.get("workbook").unwrap().is_object());
    }
}
