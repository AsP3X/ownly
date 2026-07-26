// Human: In-process broadcast hub for live collab WebSocket clients per session.
// Agent: SUBSCRIBE returns receiver; PUBLISH fans out JSON events after ops/heartbeats.

use std::collections::HashMap;
use std::sync::Mutex;

use tokio::sync::broadcast;

const CHANNEL_CAPACITY: usize = 256;

#[derive(Default)]
pub struct CollabHub {
    channels: Mutex<HashMap<String, broadcast::Sender<String>>>,
}

impl CollabHub {
    pub fn new() -> Self {
        Self::default()
    }

    // Human: Subscribe to session events (creates channel if missing).
    // Agent: RETURNS broadcast Receiver; lagging clients drop oldest messages.
    pub fn subscribe(&self, session_id: &str) -> broadcast::Receiver<String> {
        let mut channels = self.channels.lock().expect("collab hub lock");
        if let Some(tx) = channels.get(session_id) {
            return tx.subscribe();
        }
        let (tx, rx) = broadcast::channel(CHANNEL_CAPACITY);
        channels.insert(session_id.to_string(), tx);
        rx
    }

    // Human: Fan-out a JSON event string to all session WebSocket subscribers.
    // Agent: NO-OP when no subscribers; IGNORES send errors from closed receivers.
    pub fn publish(&self, session_id: &str, message: String) {
        let channels = self.channels.lock().expect("collab hub lock");
        if let Some(tx) = channels.get(session_id) {
            let _ = tx.send(message);
        }
    }
}

pub type SharedCollabHub = std::sync::Arc<CollabHub>;

pub fn new_shared_hub() -> SharedCollabHub {
    std::sync::Arc::new(CollabHub::new())
}
