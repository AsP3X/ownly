-- Human: Store intrinsic video dimensions probed during HLS ingest for player layout hints.
-- Agent: NULL until ffprobe runs in the encode worker; READ by drive/public-share video players.

ALTER TABLE files
    ADD COLUMN IF NOT EXISTS video_width INTEGER,
    ADD COLUMN IF NOT EXISTS video_height INTEGER;
