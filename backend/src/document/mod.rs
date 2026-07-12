// Human: Document grid preview sidecars — PDF first-page, spreadsheet mini-grid, and EPUB cover JPEGs.
// Agent: EXPORTS thumbnail job + mime helpers; ENQUEUED after qualifying document upload completes.

pub mod epub_cover;
pub mod mime;
pub mod spreadsheet_preview;
pub mod thumbnail;
pub mod thumbnail_job;
