// Human: Admin-only API surface for instance user directory and console dashboards.
// Agent: EXPORTS handlers + console routes; ENFORCES role=admin via require_admin before mutations.

pub mod console;
pub mod handlers;
pub mod storage_nodes;

pub use handlers::require_admin;
