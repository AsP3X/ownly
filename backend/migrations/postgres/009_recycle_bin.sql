-- Human: Soft-delete support — files and folders move to recycle bin before permanent purge.
-- Agent: deleted_at NULL = active row; partial indexes speed recycle-bin listing and expiry sweeps.

ALTER TABLE files ADD COLUMN deleted_at TIMESTAMPTZ;
ALTER TABLE folders ADD COLUMN deleted_at TIMESTAMPTZ;

CREATE INDEX idx_files_user_recycle ON files (user_id, deleted_at DESC)
    WHERE deleted_at IS NOT NULL;

CREATE INDEX idx_folders_user_recycle ON folders (user_id, deleted_at DESC)
    WHERE deleted_at IS NOT NULL;
