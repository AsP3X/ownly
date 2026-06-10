-- Human: Re-queue document preview jobs after switching to LibreOffice + high-DPI rasterization.
-- Agent: WRITES document_thumbnail_status=queued; background worker replaces stale grid-thumbnail.jpg sidecars.

UPDATE files
SET document_thumbnail_ready = false,
    document_thumbnail_status = 'queued',
    document_thumbnail_error = NULL
WHERE deleted_at IS NULL
  AND (
      mime_type ILIKE '%pdf%'
      OR mime_type ILIKE '%spreadsheet%'
      OR mime_type ILIKE '%excel%'
      OR (mime_type ILIKE '%sheet%' AND mime_type NOT ILIKE '%word%')
      OR name ILIKE '%.xlsx'
      OR name ILIKE '%.xls'
      OR name ILIKE '%.xlsm'
      OR name ILIKE '%.xlsb'
      OR name ILIKE '%.ods'
  );
