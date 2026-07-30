// Human: Editor-specific collab domain plugins.
// Agent: Document + spreadsheet today; future editors add modules here.

pub mod document;
pub mod spreadsheet;

pub use document::DocumentDomain;
pub use spreadsheet::SpreadsheetDomain;
