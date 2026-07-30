# Text / code editor live collab

**Date:** 2026-07-30  
**Status:** Approved for implementation planning  
**Approach:** A — reuse existing `document` collab room + wire Monaco (`TextCodeEditorDialog`)

## Problem

Ownly’s shared coop collab engine already supports live multi-user editing for **RTF** (`document` room) and **spreadsheets**. The Monaco-based text/code editor (`TextCodeEditorDialog`) opens `.md`, `.txt`, and other text/code mimes but is still single-user. Collaborators cannot co-edit the same plain-text file in real time.

## Goals

- Live co-editing for all files already opened by the text/code editor (`isTextCodePreviewMime`), using the **same framework as the RTF editor**.
- Google Docs / Word–style free concurrent editing (OT merge; remote cursors/selections).
- Active tab only: only the focused tab participates in a collab session.
- Explicit Save for durable vault bytes; live OT for ephemeral session state.
- Public share links with `allow_edit` use the same guest collab path as RTF.

## Non-goals (v1)

- New `RoomKind` or backend domain adapter
- Sentence / range exclusive locks (RTF-style)
- Auto-save to the vault
- Collab sessions kept alive for background tabs
- Markdown split-preview co-editing UX
- View-only collab presence (read-only does not join — match RTF)

## Architecture

```
TextCodeEditorDialog (active editable tab)
  → useDocumentCollab (document room; no locks / format_commit)
  → CollabClient → /api/v1/collab/*  (or public share collab)
  → Monaco: local diffs out, remote replaces in, selection presence
```

| Layer | Decision |
|--------|----------|
| Room kind | Existing `document` — shared with RTF |
| OT primitive | `replace` `{ index, delete, insert }` (unicode scalar indices) |
| Transport | Existing `CollabClient` (WebSocket-first, HTTP poll fallback) |
| Seed | `{ text: fileContent, html: "" }` |
| format_commit | Not used for plain text |
| Locks | Not used; free concurrent edit |
| Durable persistence | Explicit Save (`replaceTextFileContent` / public share save) |
| Backend changes | None required for protocol; docs note plain-text consumers |

RTF and text/code never open the same mime path for the same file in both editors, so one `document` session per `file_id` is correct.

## Components

### `TextCodeEditorDialog`

- When **open**, **not read-only**, **active file loaded** (buffer ready, not loading/error), enable `useDocumentCollab` for `file.id`.
- Match RTF enable gate pattern: `open && !readOnly && Boolean(file?.id) && !loading && bufferReady`.
- Public share: `getOrCreatePublicCollabGuestId` + `publicShare` auth object (same as RTF).
- Display name / local user id: same guest vs signed-in rules as RTF.
- On **tab switch**: stop collab for previous file; start for new file after its buffer is ready.
- On **close** or **read-only**: stop client; clear collab UI.
- **Save**: write current buffer to vault/share; keep collab session; clear dirty against post-save content (dirty = buffer ≠ last saved, not ≠ collab snapshot).
- Seed from loaded buffer text; on late join with other participants and divergent server `document_text`, adopt server text into the buffer (mirror RTF session/snapshot takeover).

### `useDocumentCollab`

- Reuse the hook; **small extension required** for plain-text late join:
  - Today, session/snapshot takeover only fires `onRemoteDocument` when `html` is non-empty (RTF path).
  - Plain-text seeds use `html: ""`, so add a text-aware path, e.g. `onRemoteText?: (text, fromUserId) => void`, and/or treat non-empty `document_text` divergence the same way when participants > 1.
  - Keep RTF behavior unchanged when `html` is present.
- Call only: `publishPlainChange` / `publishTextOp`, selection `updatePresence`.
- Do **not** call `acquireSentenceLock`, `releaseLock`, or `publishDocument` (`format_commit`).

### `CodeEditorSurface` + Monaco helpers

Small pure module (e.g. `frontend/src/lib/text-code-editor/collab-monaco.ts`):

1. **Unicode scalar offset ↔ Monaco UTF-16 position** — OT uses `[...text]` scalar indices; Monaco uses UTF-16 code units. Conversion is mandatory for emoji/CJK correctness.
2. **Apply remote `TextReplace`** via `executeEdits` (or equivalent), preserving local selection when reasonable.
3. **Remote decorations** — cursors and selection ranges from other participants’ `selection_start` / `selection_end` + color.

Surface responsibilities:

- On local model content change: if not applying remote, notify parent with before/after (or new value) so parent can `publishPlainChange`.
- Report selection offsets (scalar) for presence heartbeats.
- Accept imperative apply-remote and set-remote-decorations (or props driven from dialog).

**Re-broadcast guard:** while applying a remote op, set `applyingRemoteRef` (or equivalent) so `onChange` does not publish.

**Multi-edit coalescing:** prefer full-buffer before/after `diffPlainText` (shared collab OT helper) over per-Monaco-change-event ops, matching RTF’s plain path.

### Presence UI

- Compact strip in text-editor chrome (names, colors, transport/error), patterned after `RtfCollabPresence`.
- Remote cursors/selections inside Monaco (Google Docs–style), not exclusive lock highlights.

### Open paths

- No change to Drive / Public share open routing; collab starts after dialog load + seed.

## Data flow

1. Open file → fetch blob → buffer ready → join `document` session with `{ text, html: "" }`.
2. Local edit → before/after strings → `diffPlainText` → `replace` op (server OT on `base_seq`).
3. Remote `replace` (non-echo) → apply to Monaco model + buffer without re-publish.
4. Caret/selection → presence `{ selection_start, selection_end }` → remote decorations.
5. Tab switch → stop old client → join new file when ready.
6. Save → vault/share API with local buffer → clear dirty; collab continues.

## Error handling

| Condition | Behavior |
|-----------|----------|
| WebSocket drop | Poll fallback via `CollabClient`; UI shows transport mode |
| Soft op errors (`invalid_op`, etc.) | Do not mark editor fully offline (same soft-error filtering as RTF hook) |
| Join/load collab failure | Local edit + Save still work; non-blocking collab error in strip |
| Late join divergent seed | Prefer server snapshot text when other participants present |
| Read-only / no write | Do not join collab |

## Testing

| Layer | Coverage |
|--------|----------|
| Unit | Scalar ↔ UTF-16 mapping; apply remote replace; no re-publish while applying |
| Existing | Keep `src/lib/collab` OT fixtures as protocol source of truth |
| E2E | Playwright dual-client smoke for `.txt` or `.md` (mirror `collab-rtf-smoke.spec.ts`): two clients converge; Save still works |

E2E smoke is in scope for the implementation plan (same bar as RTF collab).

## Documentation

- Update `docs/collab-engine.md`: `document` rooms serve RTF **and** Monaco plain text/code; plain-text path uses `replace` + presence only (no `format_commit` / locks).

## Implementation sketch (for planning)

1. Extend `useDocumentCollab` for text-only session/snapshot takeover (no RTF regression).
2. Add `collab-monaco` helpers + unit tests (offset mapping, apply replace).
3. Extend `CodeEditorSurface` for remote apply, selection-for-collab, decorations, re-broadcast guard.
4. Wire `TextCodeEditorDialog`: auth/guest identity, `useDocumentCollab`, active-tab lifecycle, presence strip, publish on edit, apply remote, presence on selection.
5. Docs update for collab engine.
6. Playwright dual-client smoke for text/code.

## Success criteria

- Two users (or dual browser contexts) open the same `.md`/`.txt` and see each other’s edits converge without refresh.
- Remote cursors/selections visible with participant colors.
- Explicit Save persists to vault; collab does not require auto-save.
- Public `allow_edit` share co-edits via guest APIs.
- Switching tabs only keeps the active file in a live session.
- No backend schema/protocol break for existing RTF collab.
