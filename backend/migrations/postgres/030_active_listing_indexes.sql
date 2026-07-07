-- Human: Partial index for active files in folder listings (performance).
-- Agent: SPEEDS list_owned_files / list_accessible_files WHERE deleted_at IS NULL.

CREATE INDEX IF NOT EXISTS idx_files_user_folder_active
    ON files (user_id, folder_id)
    WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_folders_user_parent_active
    ON folders (user_id, parent_id)
    WHERE deleted_at IS NULL;
