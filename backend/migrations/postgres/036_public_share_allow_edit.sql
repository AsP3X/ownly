-- Human: Optional edit permission for public share links (preview vs co-edit).
-- Agent: allow_edit=false (default) keeps links view-only; true enables public content replace.

ALTER TABLE public_shares
    ADD COLUMN allow_edit BOOLEAN NOT NULL DEFAULT false;
