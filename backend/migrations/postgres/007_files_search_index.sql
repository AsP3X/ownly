-- Human: Speed up drive name search (LOWER(name) LIKE) for large libraries.
-- Agent: INDEX on (user_id, lower(name)) for list_files q= filter queries.

CREATE INDEX idx_files_user_name_lower ON files (user_id, (LOWER(name)));
