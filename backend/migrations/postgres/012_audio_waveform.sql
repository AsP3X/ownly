-- Human: Audio waveform sidecar metadata — 32-bar peak envelope stored in Nebular OS.
-- Agent: WRITES audio_* columns; background worker sets audio_waveform_key + audio_waveform_ready.

ALTER TABLE files
    ADD COLUMN IF NOT EXISTS audio_waveform_ready BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS audio_encode_status TEXT,
    ADD COLUMN IF NOT EXISTS audio_encode_error TEXT,
    ADD COLUMN IF NOT EXISTS audio_waveform_key TEXT;

-- Human: Pre-existing audio rows stay playable without blocking on a backfill job.
-- Agent: SETS ready status for legacy audio/* uploads so drive actions stay unblocked.
UPDATE files
SET audio_waveform_ready = true,
    audio_encode_status = 'ready'
WHERE mime_type ILIKE 'audio/%'
  AND audio_encode_status IS NULL;
