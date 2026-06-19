# app_settings secrets migration (SEC-032)

Ownly no longer stores sensitive `app_settings` values in plaintext.

## What changed

| Key | Before | After |
| --- | --- | --- |
| `database_url` | Full connection string with password | Redacted URL only (`postgres://user:***@host/db`). Live credentials remain in `DATABASE_URL`. |
| `smtp_password` | Plaintext | AES-256-GCM blob prefixed with `enc:v1:` (key derived from `SIGNING_SECRET`) |

Admin GET `/api/v1/admin/settings` continues to expose `smtp.password_set: bool` only — never the secret.

## Automatic migration

On backend startup, after migrations:

1. **`smtp_password`** — if present and not already `enc:v1:…`, re-encrypted in place using the current `SIGNING_SECRET`.
2. **`database_url`** — if a password segment is present and not the redacted `***` placeholder, replaced with the redacted form.

A log line is emitted when either key is migrated:

```text
Migrated legacy plaintext app_settings secrets (SEC-032)
```

No operator action is required for typical deployments.

## Operator notes

- **Do not rotate `SIGNING_SECRET` casually** after SMTP passwords are encrypted — existing ciphertext becomes undecryptable. Plan rotation with a fresh SMTP password save from the admin console.
- **Database credentials** are authoritative in `DATABASE_URL` (Compose env / `.env`). The `app_settings.database_url` row is informational (host/db/user) and must not contain passwords.
- **Backups** taken before upgrade may still contain plaintext in historical rows until the upgraded backend starts once against that database.

## Verify

```sql
SELECT key,
       CASE
         WHEN key = 'smtp_password' AND value LIKE 'enc:v1:%' THEN 'encrypted'
         WHEN key = 'database_url' AND value LIKE '%:***@%' THEN 'redacted'
         ELSE 'review'
       END AS status
FROM app_settings
WHERE key IN ('smtp_password', 'database_url');
```

Expected: `smtp_password` → `encrypted` (when set); `database_url` → `redacted` (when set).
