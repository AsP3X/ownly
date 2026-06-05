// Human: HTTP handlers for user file library and folder hierarchy operations.
// Agent: MODULE files::handlers + files::folders; ROUTES mounted under /api/v1/files and /api/v1/folders.

pub mod bulk_download;
pub mod delete_config;
pub mod delete_job;
pub mod file_copy;
pub mod file_delete;
pub mod folder_download;
pub mod folders;
pub mod handlers;
pub mod listing;
pub mod processing;
pub mod recycle_bin;
pub mod upload_validation;
pub mod zip_job;
