# Text / Code Editor Live Collab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire Monaco `TextCodeEditorDialog` to the existing RTF coop collab framework so `.md`, `.txt`, and other text/code files support Google Docs–style multi-user co-editing.

**Architecture:** Reuse `room_kind: "document"`, OT `replace`, `useDocumentCollab` / `CollabClient`. Frontend-only: unicode offset helpers, Monaco remote apply + decorations, dialog lifecycle (active tab only), presence strip. Small hook extension for text-only late-join takeover. Explicit Save unchanged.

**Tech Stack:** React, Monaco (`@monaco-editor/react`), existing collab OT (`frontend/src/lib/collab`), Playwright e2e.

**Spec:** `docs/superpowers/specs/2026-07-30-text-code-editor-collab-design.md`

---

## File map

| File | Responsibility |
|------|----------------|
| `frontend/src/lib/text-code-editor/collab-monaco.ts` | Scalar ↔ UTF-16 offsets; pure string replace apply |
| `frontend/src/lib/text-code-editor/collab-monaco.test.ts` | Unit tests for offsets + replace |
| `frontend/src/hooks/useDocumentCollab.ts` | `onRemoteText` for plain-text session/snapshot takeover |
| `frontend/src/components/drive/text-code-editor/CodeEditorSurface.tsx` | Remote apply, presence decorations, selection scalar callback |
| `frontend/src/components/drive/rtf/RtfCollabPresence.tsx` | Optional footer hint (plain-text wording) |
| `frontend/src/components/drive/TextCodeEditorDialog.tsx` | Collab wire-up |
| `docs/collab-engine.md` | Document plain-text consumers |
| `frontend/e2e/collab-text-smoke.spec.ts` | Dual-client smoke |

---

### Task 1: Offset helpers + tests

**Files:**
- Create: `frontend/src/lib/text-code-editor/collab-monaco.ts`
- Create: `frontend/src/lib/text-code-editor/collab-monaco.test.ts`

- [ ] Implement `utf16ToScalarIndex`, `scalarToUtf16Index`, re-export `applyReplace` usage for text
- [ ] Unit tests with ASCII + emoji (surrogate pairs)
- [ ] Commit

### Task 2: `useDocumentCollab` text takeover

**Files:**
- Modify: `frontend/src/hooks/useDocumentCollab.ts`

- [ ] Add `onRemoteText?: (text: string, fromUserId: string) => void`
- [ ] Session join + snapshot: if no HTML path, adopt divergent `document_text` when participants > 1
- [ ] Keep RTF `onRemoteDocument` behavior when html present
- [ ] Commit

### Task 3: Monaco surface collab APIs

**Files:**
- Modify: `frontend/src/components/drive/text-code-editor/CodeEditorSurface.tsx`

- [ ] Imperative `applyRemoteReplace`, `setRemotePresence`
- [ ] `onCollabSelectionChange?: (start: number, end: number) => void` (scalar)
- [ ] Re-broadcast: parent owns publish; surface applies remote without spurious full resets
- [ ] Commit

### Task 4: Wire `TextCodeEditorDialog`

**Files:**
- Modify: `frontend/src/components/drive/TextCodeEditorDialog.tsx`
- Modify: `frontend/src/components/drive/rtf/RtfCollabPresence.tsx` (optional hint)

- [ ] Auth + guest + `useDocumentCollab` (active tab, editable, loaded)
- [ ] publishPlainChange on local edit; apply remote; presence; strip
- [ ] Commit

### Task 5: Docs + e2e

**Files:**
- Modify: `docs/collab-engine.md`
- Create: `frontend/e2e/collab-text-smoke.spec.ts`

- [ ] Docs note
- [ ] Playwright dual-client smoke (mirror RTF)
- [ ] Commit

---

## Self-review vs spec

- Free concurrent edit, active tab only, explicit Save, public allow_edit: Tasks 3–4
- Unicode OT indices: Task 1
- Text-only late join: Task 2
- E2E + docs: Task 5
- No new RoomKind: confirmed
