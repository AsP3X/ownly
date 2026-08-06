-- Human: Age stamp for the cached export.mp4 download remux so it can be expired.
-- Agent: WRITTEN when the export is built; READ by temp_cleanup::sweep_expired_download_exports.
--        Nothing expired these before, so a cached export lived until the file was deleted.
ALTER TABLE files
    ADD COLUMN IF NOT EXISTS download_export_created_at TIMESTAMPTZ;

-- Human: Existing exports have no stamp. Backfill from updated_at so the sweeper can reason
-- about them instead of skipping NULLs forever.
UPDATE files
   SET download_export_created_at = COALESCE(updated_at, now())
 WHERE COALESCE(download_export_ready, FALSE)
   AND download_export_created_at IS NULL;

-- Human: The sweeper scans by age over ready exports only.
CREATE INDEX IF NOT EXISTS idx_files_download_export_created_at
    ON files (download_export_created_at)
    WHERE download_export_ready;
