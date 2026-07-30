// Human: Domain plugin trait — document, spreadsheet, and future editors implement this.
// Agent: Engine calls validate_and_transform + apply; domains own snapshot schema.

use serde_json::Value;

use crate::collab::types::{
    CollabError, DomainSnapshot, OpEnvelope, Participant, RoomKind,
};

pub trait CollabDomain: Send + Sync {
    fn room_kind(&self) -> RoomKind;

    fn empty_snapshot(&self) -> DomainSnapshot;

    fn seed_snapshot(&self, seed: Option<Value>) -> DomainSnapshot;

    /// Human: Validate actor permissions within domain (locks etc.) and OT-transform payload.
    /// Agent: MUTATES op.payload (and maybe op_type) in place; intervening ops already applied to snapshot.
    fn validate_and_transform(
        &self,
        snapshot: &DomainSnapshot,
        intervening: &[OpEnvelope],
        op: &mut OpEnvelope,
        actor: &str,
        participants: &std::collections::HashMap<String, Participant>,
    ) -> Result<(), CollabError>;

    fn apply(&self, snapshot: &mut DomainSnapshot, op: &OpEnvelope) -> Result<(), CollabError>;

    /// Human: Shift domain presence fields after a content op.
    fn transform_presence(&self, presence: &mut Value, op: &OpEnvelope);

    fn presence_defaults(&self) -> Value;
}
