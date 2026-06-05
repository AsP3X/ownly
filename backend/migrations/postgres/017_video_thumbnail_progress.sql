-- Human: Percent complete for in-flight video thumbnail background jobs (drive picker UI).
-- Agent: WRITES video_thumbnail_progress on files; background worker updates 0–100 during extraction.

ALTER TABLE files
    ADD COLUMN IF NOT EXISTS video_thumbnail_progress INTEGER NOT NULL DEFAULT 0;
