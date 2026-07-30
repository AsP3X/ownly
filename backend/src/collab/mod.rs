// Human: Shared real-time collab engine for documents, spreadsheets, and future editors.
// Agent: EXPORTS engine, HTTP/WS handlers, OT; REPLACES document/*collab* + spreadsheet collab store.

pub mod domain;
pub mod domains;
pub mod engine;
pub mod hub;
pub mod http;
pub mod ot;
pub mod store;
pub mod types;
pub mod ws;

pub use engine::{session_view, CollabEngine, SharedCollabEngine};
pub use types::{CollabError, OpEnvelope, RoomKind};
