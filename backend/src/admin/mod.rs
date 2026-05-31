// Human: Admin-only API surface for instance user directory management.
// Agent: EXPORTS handlers; ENFORCES role=admin via require_admin before mutations.

pub mod handlers;

pub use handlers::require_admin;
