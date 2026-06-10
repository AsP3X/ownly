// Human: Document grid preview sidecars — PDF first-page and spreadsheet mini-grid JPEGs.
// Agent: EXPORTS thumbnail job + mime helpers; ENQUEUED after PDF/spreadsheet upload completes.

pub mod mime;
pub mod spreadsheet_preview;
pub mod thumbnail;
pub mod thumbnail_job;
