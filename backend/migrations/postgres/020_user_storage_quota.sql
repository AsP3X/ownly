-- Human: Optional per-user storage cap in GB; NULL inherits instance default_storage_quota_gb.
-- Agent: READ by quota helpers; WRITTEN by PATCH /admin/users/:id storage_quota_gb.
ALTER TABLE users ADD COLUMN storage_quota_gb INTEGER NULL;
