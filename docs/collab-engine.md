# Shared collab engine

← [Architecture](./architecture.md) · [Documentation index](./README.md)

Live co-editing for documents (RTF) and spreadsheets uses **one server-authoritative OT engine** under `/api/v1/collab/*`. Future editors plug in as domain adapters without forking session/transport code.

## Concepts

| Term | Meaning |
|------|---------|
| **Room kind** | `document` or `spreadsheet` (one live session per kind + `file_id`) |
| **base_seq** | Client’s last applied seq when authoring an op; server transforms against intervening ops |
| **replace** | Document text primitive: `{ index, delete, insert }` (unicode scalar indices) |
| **format_commit** | Document HTML snapshot; accepted only when `text` matches server plain text |
| **state_commit** | Spreadsheet optional workbook snapshot for late joiners |
| **lock / unlock** | Document exclusive plain-text ranges; content mutations into foreign locks return **409** |

## Authenticated HTTP

| Method | Path | Notes |
|--------|------|--------|
| `POST` | `/api/v1/collab/sessions` | Body: `{ room_kind, file_id, display_name?, seed? \| initial_html/text? }` |
| `GET` | `/api/v1/collab/sessions/{id}` | Snapshot + participants + `latest_seq` |
| `POST` | `/api/v1/collab/sessions/{id}/heartbeat` | Presence (selection/locks or active_cell) |
| `GET` | `/api/v1/collab/sessions/{id}/ops?after_seq=` | Catch-up |
| `POST` | `/api/v1/collab/sessions/{id}/ops` | `{ base_seq, op_type, payload, client_op_id? }` |
| `GET` | `/api/v1/collab/sessions/{id}/ws` | Bidirectional WebSocket |

Join requires `content.read`. Mutating ops require `content.write`.

## Public share (document, `allow_edit`)

Mirror under `/api/v1/public/shares/{token}/collab/sessions…` with `guest_id` (body or query). WS accepts `?guest_id=` and optional `?password=`.

## WebSocket (protocol v1)

**Server → client:** `hello`, `presence`, `op` (includes `client_op_id` for local ack), `ops` (sync batch), `snapshot`, `error`.

**Client → server:** `heartbeat` / `presence`, `op` (`base_seq`, `op_type`, `payload`, `client_op_id?`), `sync` (`after_seq`), `ping`.

Healthy clients use **WS only** for live traffic; HTTP poll is reconnect/degraded fallback.

## Storage

- In-memory by default; set `REDIS_URL` for multi-replica session JSON + Pub/Sub fan-out.
- Sessions are ephemeral (idle TTL ~1h). Durable document bytes still go through normal file save APIs.

## Extending for a new editor

1. Add `RoomKind` + `CollabDomain` impl under `backend/src/collab/domains/`.
2. Register in `CollabEngine`.
3. Use frontend `CollabClient` with the new `roomKind` and a domain-specific apply path.

## Tests

- Unit: `cargo test --lib collab` (includes shared `ot/fixtures.json` parity)
- HTTP + WebSocket integration: `cargo test --test collab_http` (requires `DATABASE_URL`)
- Frontend OT/client: `npm test -- --run src/lib/collab`

OT transform cases are shared between Rust and TypeScript via:

- `backend/src/collab/ot/fixtures.json`
- `frontend/src/lib/collab/ot/fixtures.json`
