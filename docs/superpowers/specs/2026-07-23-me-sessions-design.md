# Self-service sessions + hygiene design

**Date:** 2026-07-23  
**Status:** Approved  
**Scope:** Honest Profile “Authorized Sessions” UX and light repo hygiene.

## Problem

Settings → Authorized Sessions shows **demo devices** from localStorage (`profile-sessions-storage.ts`) with a fake current IP. Admins already list/revoke sessions via audit-derived rows (`GET/POST /admin/users/{id}/sessions*`); end users cannot.

## Approach

Reuse the existing audit + `user_sessions` revoke store (approach A). Do not introduce a first-class `user_sessions` table.

## Hygiene

- Ignore `tmp-login.json` / `tmp-*.json`; remove local credential scratch files from the working tree when present.
- Remove unused `backend/Cargo.toml.tmp`.
- Do not commit local `mcps/` dumps.

## API

| Method | Path | Behavior |
|--------|------|----------|
| `GET` | `/api/v1/me/sessions` | List non-revoked `auth.login` / `auth.register` audit rows for the caller (limit 25). |
| `POST` | `/api/v1/me/sessions/{session_id}/revoke` | Revoke that session if it belongs to the caller; **reject** revoking the current JWT `sid` (400). |
| `POST` | `/api/v1/me/sessions/revoke-others` | Revoke all listed sessions except the caller’s current `sid` (or newest if no `sid`). |

Response row shape (shared with admin list):

```json
{
  "id": "audit-uuid",
  "device_label": "Windows 11 PC • Chrome Web Browser",
  "location_label": "Location: unknown • IP: 203.0.113.10",
  "created_line": "Token Created: Jul 23, 2026",
  "activity_line": "Last active now",
  "is_current": true
}
```

- `is_current`: JWT `sid` matches row `id`. If no match (legacy token without `sid`), mark the newest non-revoked row only.
- Audit actions: `auth.sessions.revoke`, `auth.sessions.revoke_others`.
- Shared list/build helpers live in `user_sessions` so admin and `/me` stay aligned.

## Frontend

- `fetchMySessions`, `revokeMySession`, `revokeOtherMySessions` on the API client.
- Settings loads sessions from the API; **no demo seed**.
- `ProfileSessionsCard` renders server rows; current session has no Revoke control.
- Drop reliance on localStorage remote session list for production display.

## Out of scope

FTS search, backup tooling, 2FA, geo-IP, new session DB table, OpenAPI full rewrite.

## Verification

- Integration: list after login-shaped audit row; self-revoke invalidates that JWT; cannot revoke another user’s session id via `/me`; cannot revoke current `sid`.
- UI: empty server list shows no fake devices; revoke refreshes list.
