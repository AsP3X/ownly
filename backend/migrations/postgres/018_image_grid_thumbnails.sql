-- Human: Server-side grid JPEGs for image files — small previews for the drive explorer.
-- Agent: WRITES image_thumbnail_* columns; background worker sets ready after resize+upload.

ALTER TABLE files
    ADD COLUMN IF NOT EXISTS image_thumbnail_ready BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS image_thumbnail_status TEXT,
    ADD COLUMN IF NOT EXISTS image_thumbnail_error TEXT;
