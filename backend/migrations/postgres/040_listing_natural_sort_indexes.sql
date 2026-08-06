-- Human: Expression indexes backing the default natural-name sort for drive listings.
-- Agent: natural_sort_key() is IMMUTABLE (008_natural_sort.sql) so expression indexes are valid;
--         these let ORDER BY natural_sort_key(name), lower(name) use an index scan instead of
--         a full in-memory sort of every row in the folder on every page view.

-- Human: Files listing default sort: natural_sort_key(f.name) ASC, lower(f.name) ASC.
-- Agent: Composite expression index covers the full ORDER BY + id tie-break for stable pages.
CREATE INDEX IF NOT EXISTS idx_files_user_folder_natural
    ON files (user_id, folder_id, natural_sort_key(name), lower(name), id)
    WHERE deleted_at IS NULL;

-- Human: Folders listing default sort: natural_sort_key(fo.name) ASC, lower(fo.name) ASC.
-- Agent: Mirrors the files index shape for list_owned_folders.
CREATE INDEX IF NOT EXISTS idx_folders_user_parent_natural
    ON folders (user_id, parent_id, natural_sort_key(name), lower(name), id)
    WHERE deleted_at IS NULL;
