-- Human: Queue EPUB grid cover thumbnails for existing library rows.
-- Agent: WRITES document_thumbnail_status=queued; worker extracts cover JPEG sidecars.

UPDATE files
SET document_thumbnail_ready = false,
    document_thumbnail_status = 'queued',
    document_thumbnail_error = NULL
WHERE deleted_at IS NULL
  AND (
      mime_type ILIKE 'application/epub%'
      OR name ILIKE '%.epub'
  );
