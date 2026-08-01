# Audit Log Rework — Design Spec

← [Back to main README](../../../README.md) · [Documentation index](../../README.md)

**Date:** 2026-08-01
**Status:** Draft — awaiting approval

## Summary

Rebuild the admin console's System Audit Logs panel and its backing API into a genuinely usable
investigation tool. Today the panel offers four hardcoded tabs derived from string-prefix guesswork,
no search, no date range, no pagination, and no way to see the `context` JSONB and `user_agent` that
every audit row has been storing since day one.

This rework replaces the guessed taxonomy with a declarative catalog, moves filtering into indexed
server-side SQL, adds free-text search plus multi-dimensional faceted filters with live counts,
surfaces full per-event detail in a drawer, and makes every filtered view shareable via URL. CSV
export covers the full filtered set, bounded by an admin-configurable row limit that defaults to
100,000 and can be raised or removed entirely.

---

## Requirements (confirmed)

| Decision | Choice |
|----------|--------|
| Scope | Full-stack — backend query layer, DB migration, frontend rebuild |
| Filters | Free-text search, time range, category + action, actor, severity, IP, resource |
| Event detail | Row detail drawer with `context` JSON and `user_agent` |
| Metrics | Measured values only; the fabricated "Verified 100%" card is removed |
| Export | Server-side CSV over the **full filtered set**, not the loaded page |
| Export cap | Configurable in admin settings; default 100,000; raisable, with `0` = unlimited |

---

## Current State

### Backend — [`backend/src/admin/console.rs`](../../../backend/src/admin/console.rs)

`list_audit_logs` (line 487) and its three helpers have accumulated concrete defects:

1. **Overlapping, incomplete taxonomy.** `audit_category` (line 75) maps `admin.*`→`keys`,
   `setup.*`/`files.*`→`nodes`, `auth.*`/`*delete*`/`*revoke*`→`alerts`, everything else→`all`.
   Of the 65 audit actions actually written, the `shares.*`, `groups.*`, `folders.*`, `uploads.*`,
   `permissions.*`, `recycle_bin.*`, `spreadsheet.*`, and `storage_nodes.*` namespaces — the
   majority — have no category at all.

2. **Counts contradict contents.** `counts_by_category` seeds `"all"` with the table total and then
   increments `"all"` again for every uncategorized action, so the "All Events" tab count exceeds the
   real total. Separately, `admin.users.delete` is counted under `keys` by `audit_category` but is
   also returned by the `alerts` SQL query — tab counts and tab rows disagree.

3. **Full-table scan per request.** `SELECT action FROM audit_logs` (line 580) pulls every row in the
   ledger into application memory on every page load, purely to compute four counters.
   `build_workload_diagnostics` (line 135) repeats the pattern.

4. **Stored data never surfaced.** `context` (JSONB) and `user_agent` are written by every
   `write_audit` call but appear in no response type. The richest forensic data in the system is
   invisible.

5. **Timestamps flattened server-side.** `created_at.format("%Y-%m-%d %H:%M:%S")` (line 597) emits a
   naive string with no zone, so the client cannot localize, sort, or compute relative times.

6. **One index.** Only `idx_audit_logs_created_at` exists. Every filter beyond time is a seq scan.

### Frontend — [`AdminAuditLogsPanel.tsx`](../../../frontend/src/components/admin/console/AdminAuditLogsPanel.tsx)

1. **No search input exists.** The `Search` icon is used as the *Refresh* button's glyph, and again
   as the icon on all three metric cards.
2. **Fabricated metric.** "LOG INTEGRITY STATUS — Verified 100%" is a hardcoded string. Nothing
   measures or verifies integrity. This is a compliance-flavored claim with no backing.
3. **Export is a subset.** `exportAuditCsv` serializes only the ≤100 rows currently in memory while
   presenting itself as an audit export.
4. **Static rows.** No detail view, no sorting, no pagination, no click-to-filter, no relative time.

---

## Approach Comparison

### A. Rich single endpoint (rejected)

One `/audit-logs` call accepts all filters and returns rows, facets, and summary together.

| Pros | Cons |
|------|------|
| Fewest moving parts | Every search keystroke recomputes facet aggregates over the whole table |
| One round trip | Cannot cache or debounce the expensive half independently |

### B. Split reads by cost + Rust taxonomy catalog (recommended)

Three endpoints separated by query cost; action taxonomy declared once in Rust.

| Pros | Cons |
|------|------|
| Cheap paginated row query runs on every filter change | Three endpoints instead of one |
| Expensive facet/summary query debounced separately | Catalog needs upkeep as actions are added (mitigated by fallback) |
| Export streams independently of the UI page size | |
| Taxonomy testable in isolation, shared by SQL and UI | |

### C. Denormalized `audit_events` projection table (rejected)

Category and severity as stored columns maintained by an insert trigger.

| Pros | Cons |
|------|------|
| Fastest possible filtering | Adds a trigger to the write path of an append-only security ledger |
| | Requires a backfill migration over existing rows |
| | More operational risk than current scale justifies |

**Decision: B**, adopting one element of C — a Postgres *generated* column for the action namespace,
which is deterministic, needs no trigger, and makes category filtering index-backed.

---

## Design

### 1. Taxonomy

**Category is the action namespace.** Rather than a hand-maintained mapping that drifts, category is
derived mechanically from the text before the first `.`:

```
admin · auth · files · folders · groups · permissions
recycle_bin · setup · shares · spreadsheet · storage_nodes · uploads
```

Twelve categories, disjoint by construction, automatically correct for any action added later. This
is materialized as a generated column so it is also indexable (§2).

**Severity and label come from a catalog.** New file
`backend/src/admin/audit_catalog.rs` holds one static entry per known action:

```rust
pub struct AuditActionMeta {
    pub severity: AuditSeverity,  // Critical | Warning | Notice | Info
    pub label: &'static str,      // "Administrator removed a user account"
}
```

Severity assignment:

| Severity | Criterion | Examples |
|----------|-----------|----------|
| `Critical` | Irreversible data loss or privilege change | `files.delete.permanent`, `folders.delete.permanent`, `recycle_bin.empty`, `permissions.revoke`, `admin.users.delete`, `admin.storage_blobs.migrate` |
| `Warning` | Reversible destructive or access-reducing action | `files.trash`, `folders.trash`, `shares.revoke`, `shares.user_revoke`, `groups.delete`, `admin.sessions.revoke`, `auth.sessions.revoke`, `files.content_replace` |
| `Notice` | State-changing mutation | `auth.login`, `auth.register`, `auth.password_change`, `admin.users.create`, `admin.settings.update`, `files.upload`, `folders.create`, `groups.create`, `shares.create`, `storage_nodes.update` |
| `Info` | Read, export, or routine lifecycle | `files.download.bulk.start`, `files.export.start`, `files.thumbnail.regenerate`, `admin.storage_blobs.preview`, `uploads.session.create`, `setup.complete` |

**Unknown actions never disappear.** An action absent from the catalog resolves to `Info` severity
and a label derived from the action string plus resource metadata. Filtering by any dimension still
returns it, so a newly added action is visible in the UI before anyone updates the catalog.

This replaces and deletes `audit_category`, `audit_severity`, and `audit_description` from
`console.rs:75-131`. Both `list_audit_logs` and the security panel's key-rotation history
(`console.rs:1030`) switch to the catalog.

**Tests:** no duplicate entries; every catalog severity is reachable; fallback produces a sane label
and category for arbitrary input including malformed actions with no `.`.

### 2. Migration — `backend/migrations/postgres/037_audit_log_filters.sql`

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;

ALTER TABLE audit_logs ADD COLUMN action_namespace TEXT
  GENERATED ALWAYS AS (split_part(action, '.', 1)) STORED;

CREATE INDEX idx_audit_logs_ns_created     ON audit_logs(action_namespace, created_at DESC);
CREATE INDEX idx_audit_logs_action_created ON audit_logs(action, created_at DESC);
CREATE INDEX idx_audit_logs_user_created   ON audit_logs(user_id, created_at DESC);
CREATE INDEX idx_audit_logs_ip_created     ON audit_logs(ip, created_at DESC);
CREATE INDEX idx_audit_logs_resource       ON audit_logs(resource_type, resource_id);
CREATE INDEX idx_audit_logs_action_trgm    ON audit_logs USING gin (action gin_trgm_ops);
CREATE INDEX idx_audit_logs_resid_trgm     ON audit_logs USING gin (resource_id gin_trgm_ops);
```

Purely additive: one generated column and seven indexes. No existing column is altered or dropped,
no row semantics change, and the ledger remains append-only. The existing
`idx_audit_logs_created_at` is retained for the unfiltered default view.

### 3. Query layer — `backend/src/admin/audit_query.rs`

```rust
pub struct AuditFilter {
    pub q: Option<String>,              // free text
    pub from: Option<DateTime<Utc>>,
    pub to: Option<DateTime<Utc>>,
    pub categories: Vec<String>,        // action_namespace values
    pub actions: Vec<String>,           // exact action strings
    pub severities: Vec<AuditSeverity>,
    pub actor_ids: Vec<String>,
    pub ip: Option<String>,
    pub resource_type: Option<String>,
    pub resource_id: Option<String>,
}
```

A builder composes one parameterized `WHERE` clause from whichever fields are set. Every value is
bound via `sqlx` placeholders — no string interpolation of user input anywhere.

- **Free text** matches `action`, `resource_id`, `ip`, and joined `users.email` via `ILIKE '%q%'`,
  served by the trigram indexes.
- **Severity** expands through the catalog into `action = ANY($n)`, keeping it index-backed rather
  than forcing a computed predicate.
- **Multi-value dimensions** use `= ANY($n)` so an empty vector means "no constraint".

### 4. Endpoints

All three require the existing `Permission::InstanceAuditRead` and remain audit-exempt, matching
current behavior.

| Endpoint | Returns | Called |
|----------|---------|--------|
| `GET /api/v1/admin/audit-logs` | `{ rows, total_matching, has_more }` | Every filter change |
| `GET /api/v1/admin/audit-logs/facets` | Facet counts + summary metrics | Debounced, separately |
| `GET /api/v1/admin/audit-logs/export.csv` | Streaming CSV of the full filtered set | On demand |

**Row payload** gains the fields the panel needs and the table already stores:

```ts
type AdminAuditLogRow = {
  id: string;
  timestamp: string;          // RFC 3339 UTC — client formats and localizes
  actor_id: string | null;
  actor_email: string | null;
  action: string;
  category: string;
  label: string;
  severity: "Critical" | "Warning" | "Notice" | "Info";
  resource_type: string | null;
  resource_id: string | null;
  ip: string | null;
  user_agent: string | null;
  context: unknown | null;    // JSONB, verbatim
};
```

`context` ships with the row rather than behind a per-event endpoint: a page is 50 rows by default
(`limit` clamped to 1–200), the payload stays modest, and the detail drawer opens instantly with no
second round trip.

**Facets** are computed *within the active filter*, with each facet excluding its own dimension — so
the count beside "files" shows what you would get by adding that filter, not what you already have.
Returns counts per category, counts per severity, top 10 actors, and top 10 actions, as grouped
aggregates. This is what replaces the `SELECT action FROM audit_logs` full scan.

**Summary metrics**, all scoped to the active filter: events in range, critical + warning count,
distinct actors, busiest action. The facets payload also carries `export_max_rows`, the effective
export cap (see §5), so the panel can warn about truncation without needing settings-read permission.

**Export** cursor-pages internally in 1,000-row batches and streams, so it is bounded in memory
regardless of result size. It applies the same filter as the on-screen view and honors the
configurable row cap described in §5. If the filtered set exceeds the cap, the response ends with a
final CSV comment line stating the truncation and the true match count — an export must never
silently misrepresent its own completeness.

**Pagination** is cursor-based on `(created_at, id)` — stable under concurrent inserts, unlike
`OFFSET`, which shifts rows when new events land mid-browse.

### 5. Export row limit — admin setting

The maximum number of rows a single audit export may produce is instance policy, not a constant.
Compliance exports and incident investigations legitimately need the entire ledger; routine exports
should not accidentally generate a multi-gigabyte download.

**Storage.** A new `app_settings` key, following the existing key/value pattern:

| Key | Default | Semantics |
|-----|---------|-----------|
| `audit_export_max_rows` | `100000` | Maximum rows per export. `0` means **unlimited**. |

Read via the existing `read_setting` helper with the same parse-and-fall-back shape as
`default_storage_quota_gb` (`console.rs:746`), so a missing or corrupt value degrades to the 100,000
default rather than failing the export.

**API surface.** `AdminSettingsResponse` gains `audit_export_max_rows: u64`;
`AdminSettingsPatch` gains `audit_export_max_rows: Option<u64>`. Validation rejects nothing but
negatives (excluded by the unsigned type) — any positive value is accepted, and `0` selects
unlimited. There is deliberately **no upper bound**: capping the cap would defeat its purpose.

Changing this value already flows through `patch_settings`, which writes an `admin.settings.update`
audit row. That matters here more than for most settings: this control governs how much of the audit
trail can leave the system, so changes to it must themselves be in the trail.

**Reading the cap in the audit panel.** The effective cap is returned in the **facets** payload as
`export_max_rows`, not read from `/admin/settings`. An auditor may hold `InstanceAuditRead` without
`InstanceSettingsRead`; routing it through the settings endpoint would make the export UI fail for
exactly the role that most needs it.

**UI.** A number field in the System Settings panel's security section, mirroring the
`default_storage_quota_gb` local-draft pattern (`AdminSystemSettingsPanel.tsx:515`) so typing does
not fight `parseInt`. Labeled "Audit export row limit", suffix "rows", with helper text
`0 = unlimited`. When set to `0`, an inline caution notes that unlimited exports of a large ledger
can produce very large files and long-running downloads.

**In the audit panel.** Before starting an export whose `total_matching` exceeds the cap, the Export
button surfaces a confirmation naming both numbers — "Exporting 100,000 of 2,340,112 matching events.
Raise the limit in System Settings to export more." — so truncation is known in advance, never
discovered afterward in the file.

### 6. Frontend

The single 165-line panel splits into five focused modules:

| File | Responsibility |
|------|----------------|
| `AdminAuditLogsPanel.tsx` | Orchestration, fetching, layout |
| `audit-log-filters.ts` | Filter state type, URL query-string sync, API param serialization |
| `AuditFilterBar.tsx` | Search, time range, facet multi-selects, active-filter chips |
| `AuditLogTable.tsx` | Sortable rows, relative + absolute time, click-to-filter cells |
| `AuditEventDrawer.tsx` | Full per-event detail |

**Filter bar.** Debounced free-text search (300 ms). Time range as presets — 1h / 24h / 7d / 30d /
All — plus a custom from–to. Multi-select dropdowns for category, severity, actor, and action, each
showing live facet counts. The twelve categories group in the dropdown for scanability:

- *Security & Access* — auth, admin, permissions
- *Content* — files, folders, recycle_bin, spreadsheet
- *Sharing* — shares, groups
- *Infrastructure* — storage_nodes, uploads, setup

Every active filter renders as a removable chip beneath the bar, with a "Clear all". Filter state is
always visible rather than hidden inside collapsed dropdowns.

**URL sync.** Filter state serializes to the query string. A filtered view is bookmarkable, shareable
with another admin, and survives a reload — the largest usability gain in this rework for the least
code.

**Table.** Clicking an actor, action, IP, or severity cell adds it as a filter, making "this looks
odd" → "show me everything like it" a single click. Timestamps render relative ("4m ago") with the
exact UTC value on hover. Sortable by time, ascending or descending. Cursor pagination via "Load
more", with `total_matching` shown so the result size is never a mystery.

`AdminConsoleTable` currently takes `ReactNode[][]` with no row identity, no sorting, and no row
click. Rather than distort the shared primitive, `AuditLogTable` is purpose-built and styled to match
it — the audit table's needs are specific enough that generalizing the primitive would degrade its
other callers.

**Drawer.** Opens on row click with actor, action and label, severity, resource type/id, IP, user
agent, exact timestamp, and pretty-printed `context` JSON with copy-to-clipboard.

**Metric cards.** Four measured values, all respecting the active filter: events in range, critical +
warning count, distinct actors, busiest action. The fabricated integrity card is removed. Each card
gets its own icon rather than three copies of `Search`.

**Keyboard.** `/` focuses search, `Esc` closes the drawer, arrow keys move row selection.

**Empty states** distinguish "no audit events yet" from "no events match these filters" — the latter
offering a "Clear filters" action.

### 7. Testing

**Rust**
- Catalog: no duplicates, fallback correctness, malformed action handling.
- Filter builder: correct parameterized SQL per filter combination; empty filter produces no `WHERE`.
- Export cap: default applies when the setting is absent; a corrupt value falls back to 100,000; `0`
  streams the full set uncapped; a set cap truncates at exactly that row count and emits the
  truncation footer with the true match count.
- Integration (`backend/tests/http_integration.rs`): each endpoint's permission denial without
  `InstanceAuditRead`; filter correctness per dimension; cursor pagination boundaries including
  concurrent-insert stability; CSV shape and header; `export_max_rows` present in the facets payload
  for a principal holding `InstanceAuditRead` but **not** `InstanceSettingsRead`.

**TypeScript**
- Filter ↔ URL query-string round-trip, including multi-value and empty cases.
- API parameter serialization.
- Export truncation confirmation appears when `total_matching > export_max_rows` and is skipped when
  the cap is `0`.
- Playwright: search → filter → open drawer → export.

---

## Out of Scope — Flagged

**Failed authentication is not audited.** [`auth/handlers.rs:387`](../../../backend/src/auth/handlers.rs)
writes `auth.login` only after credentials verify. Failed logins, permission denials, and rate-limit
trips leave no audit row at all.

No amount of filtering improves this: a security investigation cannot find events that were never
written. Adding them means touching the auth write path and the rate limiter, which carries its own
risk profile and deserves separate review. **Recommended as the immediate follow-up.**

The severity taxonomy above is designed to accommodate it — failure events would slot into `Warning`
and `Critical` without restructuring.

---

## Risks

| Risk | Mitigation |
|------|------------|
| `pg_trgm` extension unavailable on a deployment's Postgres | `CREATE EXTENSION IF NOT EXISTS` inside the migration; ships with standard Postgres including the project's Docker image |
| Generated column requires a full table rewrite on large ledgers | Additive `ALTER` on current data volumes is fast; the migration is documented as requiring a brief lock |
| Catalog drifts as new actions are added | Fallback guarantees unknown actions remain visible and filterable; catalog is a label/severity refinement, never a gate |
| Facet queries slow on very large tables | Split from the row query and debounced independently; all facet dimensions are index-backed |
| Unlimited export (`0`) produces a huge file or a long-running request | Streaming with 1,000-row batches keeps server memory flat regardless of size; the UI cautions when the cap is set to `0`, and the pre-export confirmation names the row count before the download starts |
