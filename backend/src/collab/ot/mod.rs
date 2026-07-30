// Human: Operational transform primitives for the shared collab engine.
// Agent: EXPORTED text OT used by document domain.

pub mod text;

pub use text::{
    apply_replace, transform_offset, transform_range, transform_replace, transform_replace_through,
    TextReplace,
};
