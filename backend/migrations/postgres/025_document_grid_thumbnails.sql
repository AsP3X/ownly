-- Human: Server-side grid JPEGs for PDF and spreadsheet explorer tiles.
-- Agent: WRITES document_thumbnail_* columns; background worker sets ready after render+upload.

ALTER TABLE files
    ADD COLUMN IF NOT EXISTS document_thumbnail_ready BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS document_thumbnail_status TEXT,
    ADD COLUMN IF NOT EXISTS document_thumbnail_error TEXT;
