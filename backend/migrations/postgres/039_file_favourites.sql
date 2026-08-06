-- Human: Starred files, stored per account instead of per browser.
-- Agent: REPLACES the client's ownly_favourite_files localStorage key; the web client migrates its ids once on load.

-- Human: One row per (user, starred file). Composite PK makes re-starring idempotent.
-- Agent: BOTH sides cascade — deleting a file or a user clears its stars with no orphan sweep.
CREATE TABLE IF NOT EXISTS file_favourites (
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    file_id    TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, file_id)
);

-- Human: The only read pattern — "every file this user starred, newest first".
CREATE INDEX IF NOT EXISTS idx_file_favourites_user_created
    ON file_favourites (user_id, created_at DESC);
