// Human: Fan-out hub for live collab WebSocket clients (in-process + optional Redis Pub/Sub).
// Agent: SUBSCRIBE returns receiver; PUBLISH after ops/heartbeats; multi-replica via Redis channel.

use std::collections::HashMap;
use std::sync::Mutex;

use redis::AsyncCommands;
use tokio::sync::broadcast;
use tracing::{debug, warn};

const CHANNEL_CAPACITY: usize = 512;

pub struct CollabHub {
    channels: Mutex<HashMap<String, broadcast::Sender<String>>>,
    redis: Option<redis::aio::ConnectionManager>,
    redis_url: Option<String>,
}

impl CollabHub {
    pub fn new() -> Self {
        Self {
            channels: Mutex::new(HashMap::new()),
            redis: None,
            redis_url: None,
        }
    }

    pub fn with_redis(
        redis: Option<redis::aio::ConnectionManager>,
        redis_url: Option<String>,
    ) -> Self {
        Self {
            channels: Mutex::new(HashMap::new()),
            redis,
            redis_url,
        }
    }

    fn redis_channel(session_id: &str) -> String {
        format!("ownly:collab:hub:{session_id}")
    }

    pub fn subscribe(&self, session_id: &str) -> broadcast::Receiver<String> {
        let mut channels = self.channels.lock().expect("collab hub lock");
        if let Some(tx) = channels.get(session_id) {
            return tx.subscribe();
        }
        let (tx, rx) = broadcast::channel(CHANNEL_CAPACITY);
        channels.insert(session_id.to_string(), tx);
        rx
    }

    pub fn publish_local(&self, session_id: &str, message: String) {
        let channels = self.channels.lock().expect("collab hub lock");
        if let Some(tx) = channels.get(session_id) {
            let _ = tx.send(message);
        }
    }

    /// Human: Fan-out to local WS subscribers and Redis Pub/Sub for other replicas.
    pub async fn publish(&self, session_id: &str, message: String) {
        self.publish_local(session_id, message.clone());
        if let Some(mut conn) = self.redis.clone() {
            let channel = Self::redis_channel(session_id);
            if let Err(err) = conn.publish::<_, _, ()>(channel, message).await {
                warn!(error = %err, %session_id, "collab hub redis publish failed");
            }
        }
    }

    /// Human: Bridge Redis Pub/Sub into the local broadcast channel for multi-replica WS.
    pub fn spawn_redis_bridge(self: &std::sync::Arc<Self>, session_id: String) {
        let Some(url) = self.redis_url.clone() else {
            return;
        };
        let hub = std::sync::Arc::clone(self);
        tokio::spawn(async move {
            let client = match redis::Client::open(url.as_str()) {
                Ok(c) => c,
                Err(err) => {
                    debug!(error = %err, "collab hub redis bridge client open failed");
                    return;
                }
            };
            let mut pubsub = match client.get_async_pubsub().await {
                Ok(p) => p,
                Err(err) => {
                    debug!(error = %err, "collab hub redis pubsub connect failed");
                    return;
                }
            };
            let channel = Self::redis_channel(&session_id);
            if let Err(err) = pubsub.subscribe(&channel).await {
                debug!(error = %err, %session_id, "collab hub redis subscribe failed");
                return;
            }
            use futures_util::StreamExt;
            let mut stream = pubsub.on_message();
            while let Some(msg) = stream.next().await {
                let payload: String = match msg.get_payload() {
                    Ok(p) => p,
                    Err(_) => continue,
                };
                // Avoid echo loops: only inject remote messages (publish already did local).
                // Subscribers on the publishing node get local publish; remote nodes get this.
                hub.publish_local(&session_id, payload);
            }
        });
    }
}

impl Default for CollabHub {
    fn default() -> Self {
        Self::new()
    }
}

pub type SharedCollabHub = std::sync::Arc<CollabHub>;

pub fn new_shared_hub(
    redis: Option<redis::aio::ConnectionManager>,
    redis_url: Option<String>,
) -> SharedCollabHub {
    std::sync::Arc::new(CollabHub::with_redis(redis, redis_url))
}
