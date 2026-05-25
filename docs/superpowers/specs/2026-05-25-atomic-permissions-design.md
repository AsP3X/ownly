# Atomic Permission System — Design Spec

**Date:** 2026-05-25  
**Status:** Draft — awaiting approval

## Summary

Replace MediaVault's owner-only access model and decorative `users.role` field with a unified **atomic grant** system. Permissions are indivisible capabilities granted to **users or groups** on **instance, folder, or file** resources. Folder grants inherit to descendants; **explicit deny always beats allow**. The `admin` capability is not a special user attribute — it is membership in a seeded system group that holds instance-wide grants.

---

## Requirements (confirmed)

| Decision | Choice |
|----------|--------|
| Subjects | Users **and** groups |
| Instance admin | **Group membership only** — no privileged `users.role` |
| Folder semantics | Inherit down; **deny wins** over allow |
| Atomicity | Each permission is one indivisible capability; grant/revoke is transactional |

---

## Approach Comparison

### A. Bitmask grants (rejected)

Store `allow_mask` / `deny_mask` BIGINT per `(subject, resource)`.

| Pros | Cons |
|------|------|
| Fast bitwise checks | Adding permissions requires schema/code migration |
| Compact storage | Poor audit readability ("what changed?") |
| | Awkward deny-wins debugging |

### B. Atomic grant rows (recommended)

One row per `(subject, resource, permission, effect)`.

| Pros | Cons |
|------|------|
| Truly atomic — each permission is one row | More rows at scale |
| Extensible without bitmask limits | Resolution query is more complex |
| Perfect audit trail | |
| Natural fit for deny-wins inheritance | |

### C. Role bundles only (rejected)

Groups named "Editor", "Viewer" with fixed bundles; no per-permission grants.

| Pros | Cons |
|------|------|
| Simple UX | Not atomic — bundles are coarse |
| | Cannot express "read but not share" cleanly |

**Recommendation:** **B** — atomic grant rows with a typed permission catalog in Rust.

---

## Permission Catalog

Permissions are **strings** validated against a Rust enum/catalog. Each is atomic and independently grantable.

### Instance scope (`resource_type = 'instance'`, `resource_id = NULL`)

| Permission | Meaning |
|------------|---------|
| `instance.admin` | Full instance control (superset shortcut — expands to all instance.* below) |
| `instance.settings.read` | Read app settings |
| `instance.settings.manage` | Update app settings |
| `instance.users.read` | List/view users |
| `instance.users.manage` | Create, enable/disable, manage memberships |
| `instance.groups.read` | List groups and members |
| `instance.groups.manage` | Create/update/delete groups, add/remove members |
| `instance.permissions.manage` | Grant/revoke any permission |
| `instance.audit.read` | Read audit log |

### File / folder scope (`resource_type = 'file' | 'folder'`)

| Permission | Implies | Meaning |
|------------|---------|---------|
| `content.read` | — | List, download, view metadata |
| `content.write` | `content.read` | Upload into folder, rename, move |
| `content.delete` | `content.read` | Delete file/folder |
| `content.share` | `content.read` | Grant/revoke permissions on this resource (subset) |
| `content.manage_acl` | `content.share` | Full ACL control including deny grants |

**Implication rule:** Granting `content.write` does not auto-insert rows — the **authz resolver** treats implied permissions as satisfied when checking. Only explicit grants are stored; implications are computed at check time. This keeps the grant table atomic (one stored permission per intent) while avoiding redundant rows.

**Owner default:** The `user_id` owner of a file/folder implicitly holds all `content.*` permissions. Owner access is not stored in `permission_grants`. Explicit deny can still block an owner (rare admin scenario) — see evaluation order.

---

## Database Schema (migration `002_atomic_permissions.sql`)

### `groups`

```sql
CREATE TABLE groups (
    id          TEXT PRIMARY KEY,
    slug        TEXT NOT NULL UNIQUE,       -- e.g. 'admin', 'editors'
    name        TEXT NOT NULL,
    description TEXT,
    is_system   BOOLEAN NOT NULL DEFAULT false,  -- prevents delete of admin group
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### `group_members`

```sql
CREATE TABLE group_members (
    group_id   TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (group_id, user_id)
);
CREATE INDEX idx_group_members_user ON group_members(user_id);
```

### `permission_grants`

The core atomic grant table. **One row = one atomic permission decision.**

```sql
CREATE TYPE grant_subject_type AS ENUM ('user', 'group');
CREATE TYPE grant_resource_type AS ENUM ('instance', 'folder', 'file');
CREATE TYPE grant_effect AS ENUM ('allow', 'deny');

CREATE TABLE permission_grants (
    id            TEXT PRIMARY KEY,
    subject_type  grant_subject_type NOT NULL,
    subject_id    TEXT NOT NULL,            -- users.id or groups.id
    resource_type grant_resource_type NOT NULL,
    resource_id   TEXT,                     -- NULL only when resource_type = 'instance'
    permission    TEXT NOT NULL,            -- catalog string, validated in app
    effect        grant_effect NOT NULL DEFAULT 'allow',
    granted_by    TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at    TIMESTAMPTZ,              -- optional TTL

    CONSTRAINT permission_grants_resource_id_check CHECK (
        (resource_type = 'instance' AND resource_id IS NULL)
        OR (resource_type IN ('folder', 'file') AND resource_id IS NOT NULL)
    )
);

-- Atomic uniqueness: one decision per subject + resource + permission
CREATE UNIQUE INDEX idx_permission_grants_unique
    ON permission_grants (subject_type, subject_id, resource_type, resource_id, permission);

CREATE INDEX idx_permission_grants_resource
    ON permission_grants (resource_type, resource_id);

CREATE INDEX idx_permission_grants_subject
    ON permission_grants (subject_type, subject_id);
```

### Seed data (same migration)

1. Insert system group: `slug = 'admin'`, `is_system = true`.
2. Grant `instance.admin` (allow) to group `admin`.
3. Backfill: every existing `users.role = 'admin'` → insert into `group_members` for admin group.

### Deprecate `users.role`

- **Phase 1 (this work):** Stop using `role` for authorization. Keep column + JWT field for backward-compatible UI; sync JWT `role` to `'admin'` when user is in admin group, else `'user'`.
- **Phase 2 (future):** Migration drops `users.role` and removes from JWT claims.

---

## Authorization Engine (`backend/src/authz/`)

### Module layout

```
backend/src/authz/
  mod.rs          -- public API
  catalog.rs      -- Permission enum + implication graph
  resolver.rs     -- effective permission evaluation
  grants.rs       -- CRUD with transactions + audit
  middleware.rs   -- require_permission extractor
```

### Core API

```rust
/// Check one atomic permission (with implication expansion).
pub async fn authorize(
    pool: &PgPool,
    user_id: &str,
    permission: Permission,
    resource: ResourceRef,  // Instance | Folder(id) | File(id)
) -> Result<(), AppError>;

/// Resolve effective effect for one permission on one resource.
pub async fn resolve_effect(
    pool: &PgPool,
    user_id: &str,
    permission: Permission,
    resource: ResourceRef,
) -> Result<Effect, AppError>;  // Allow | Deny | Default

/// List visible resources for a folder listing (used by drive UI).
pub async fn list_accessible_folder_contents(
    pool: &PgPool,
    user_id: &str,
    folder_id: Option<&str>,
    required: Permission,
) -> Result<Vec<...>, AppError>;
```

### Evaluation algorithm (deny wins + inheritance)

For `(user, permission P, resource R)`:

1. **Collect applicable grants** for all subjects `{user} ∪ {groups user belongs to}`:
   - Direct grants on `R`
   - Inherited grants from ancestor folders (walk `parent_id` chain to root)
   - Instance-level grants (`resource_type = 'instance'`)

2. **Expand** checked permission to include implications (e.g. checking `content.read` also considers grants of `content.write`, `content.delete`, etc. as satisfying read).

3. **Owner check:** If user is `user_id` owner of file/folder → implicit allow for all `content.*` unless step 4 finds a deny.

4. **Decision (deny wins):**
   ```
   IF any applicable grant has effect = deny for P (or super-permission that implies P)
      → DENY
   ELSE IF any applicable grant has effect = allow for P (or implied)
      → ALLOW
   ELSE IF owner
      → ALLOW
   ELSE
      → DENY
   ```

5. **Inheritance scope:** A grant on folder `F` applies to `F` itself and all descendant files/subfolders. It does not apply to sibling folders.

**Conflict example:** Parent folder allow `content.read` + child file deny `content.read` → user denied read on that file (deny wins).

**Conflict example:** Parent folder deny `content.read` + child file allow `content.read` → user denied (deny anywhere in applicable chain wins — secure default).

### Performance

- Single check: one query for user's group IDs + one query for grants on resource chain and instance.
- Cache group membership in request extensions after first load (optional optimization).
- Index-backed; no recursive SQL required (bounded folder depth, walk in Rust).

---

## Grant Mutations (atomic transactions)

Every grant create/update/delete runs in a **DB transaction**:

1. Validate permission string against catalog.
2. Validate subject exists (user or group).
3. Validate resource exists (folder/file) when scoped.
4. Verify caller holds `content.manage_acl` on resource OR `instance.permissions.manage` on instance.
5. Upsert or delete grant row (unique index prevents duplicates).
6. Write `audit_logs` row in same transaction.
7. Commit.

Audit actions:
- `permissions.grant`, `permissions.revoke`, `permissions.deny`
- `groups.create`, `groups.update`, `groups.delete`
- `groups.member.add`, `groups.member.remove`

---

## API Surface

### Admin / management (`/api/v1/admin/*`)

All routes require `instance.*` permissions (admin group satisfies via `instance.admin`).

| Method | Path | Permission |
|--------|------|------------|
| GET | `/admin/users` | `instance.users.read` |
| PATCH | `/admin/users/{id}` | `instance.users.manage` |
| GET | `/admin/groups` | `instance.groups.read` |
| POST | `/admin/groups` | `instance.groups.manage` |
| PATCH | `/admin/groups/{id}` | `instance.groups.manage` |
| DELETE | `/admin/groups/{id}` | `instance.groups.manage` (blocked if `is_system`) |
| POST | `/admin/groups/{id}/members` | `instance.groups.manage` |
| DELETE | `/admin/groups/{id}/members/{user_id}` | `instance.groups.manage` |
| GET | `/admin/permissions` | `instance.permissions.manage` |
| PUT | `/admin/permissions` | `instance.permissions.manage` |
| DELETE | `/admin/permissions/{id}` | `instance.permissions.manage` |
| GET | `/admin/audit-logs` | `instance.audit.read` |
| GET/PATCH | `/admin/settings` | `instance.settings.read/manage` |

### Resource ACL (`/api/v1/permissions/*`)

| Method | Path | Permission |
|--------|------|------------|
| GET | `/permissions?resource_type=&resource_id=` | `content.read` on resource OR manage_acl |
| PUT | `/permissions` | `content.manage_acl` on resource OR `instance.permissions.manage` |
| DELETE | `/permissions/{id}` | same as PUT |

### Existing file/folder routes

Replace `user_id = claims.sub` checks with `authz::authorize(...)`:

| Route | Permission |
|-------|------------|
| GET files/folders | `content.read` |
| POST upload / POST folders | `content.write` on target folder |
| PATCH move | `content.write` on file + target folder |
| DELETE | `content.delete` |
| Download | `content.read` |

**List queries:** Return files/folders the user can `content.read` — union of owned resources, granted resources, and inherited access. Admin group does **not** bypass file ACLs unless explicitly granted (principle of least privilege).

---

## Setup Flow Changes

1. Create first user (no `role = 'admin'` — use `role = 'user'` or omit special role).
2. Create system `admin` group + seed grant.
3. Add first user to `admin` group.
4. JWT `role` field derived: `'admin'` if member of admin group, else `'user'`.

---

## Frontend (phase aligned with backend)

1. **Auth context:** Optionally fetch `/api/v1/me/permissions` for instance-level capabilities.
2. **Admin section:** Routes gated on `instance.admin` or specific permissions; pages for users, groups, audit, settings.
3. **Drive sharing UI:** Share dialog on file/folder → PUT `/permissions` with user/group picker and permission checkboxes (atomic toggles).
4. **Remove** reliance on `user.role === 'admin'` alone — check permission set from API.

---

## Testing Strategy

| Layer | Tests |
|-------|-------|
| `authz::resolver` | Unit tests: inheritance, deny-wins, owner default, group expansion, implications |
| Grant CRUD | Integration: transaction rollback on audit failure |
| HTTP | Integration: non-owner with read grant can download; deny blocks despite parent allow |
| Setup | First user in admin group can access `/admin/users` |
| Regression | Existing owner-only flows still work without explicit grants |

---

## Migration / Rollout

1. Ship `002_atomic_permissions.sql` — additive only, no data loss.
2. Backfill admin group membership from `users.role = 'admin'`.
3. Deploy authz module; switch handlers one by one.
4. Existing files remain owned by creator — owner implicit full access unchanged.

---

## Out of Scope (this phase)

- Public link / anonymous sharing
- Permission TTL enforcement job (column exists; cron later)
- Dropping `users.role` column
- Quota enforcement tied to permissions
- Nebular OS per-user storage ACLs (API-layer authz remains)

---

## Open Questions

None blocking — all core decisions confirmed.
