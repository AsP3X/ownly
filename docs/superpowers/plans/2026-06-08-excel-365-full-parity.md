# Excel 365 Full Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans.

**Goal:** Close **remaining** gaps in the Excel 365 parity audit — LLM Copilot, collaboration, track changes, mobile edit, and OOXML fidelity edge cases.

**Architecture:** Extend `SheetData` / `SpreadsheetWorkbook` types; add focused `lib/spreadsheet/*` modules per concern; wire ribbon → `workbook-ops` → `useSpreadsheetEditor`; patch serialize chain in `parse.ts`; add `/api/v1/spreadsheet/copilot` for LLM/heuristic replies.

**Tech Stack:** React 19, SheetJS, custom OOXML zip patches, Axum backend.

**Last pruned:** 2026-06-18 — shipped waves removed from checklist (see [`docs/excel-editor-feature-parity.md`](../../excel-editor-feature-parity.md)).

---

## Remaining — Wave 1–2 (save fidelity + formulas)

- [x] Spill collision / `#SPILL!` + multi-col dynamic arrays (2026-07-26)
- [x] TEXTJOIN / INDIRECT / SUMPRODUCT / XMATCH / TRANSPOSE / LET (+ limited LAMBDA) (2026-07-26)
- [x] Extended financial/stat/text batch in `formula-extended.ts` (2026-07-26)
- [ ] Full `cell-styles.ts` / numFmt round-trip for remaining theme/locale edge cases
- [ ] Full Excel function library (hundreds still missing)

## Remaining — Wave 3 (workbook operations)

- [x] Track changes log + UI (append on edit, Change Log dialog) (2026-07-26)
- [x] Format painter on ribbon
- [x] Sheet tab color + group/ungroup rows (2026-07-26)
- [x] Strikethrough style + OOXML (2026-07-26)
- [x] Scatter chart insert (2026-07-26)
- [x] Multi-field pivot + paste special formats/formulas + per-cell validation (2026-07-26)

## Remaining — Wave 4 (UI)

- [x] Mobile read-only preview polish (sheet chips + cell readout) (2026-07-26)
- [x] Draw tab ink tools (pen/eraser)
- [x] Automate scripts stub (disabled — out of scope)

## Remaining — Wave 5 (backend)

- [x] `POST /api/v1/spreadsheet/copilot` with audit log + frontend fallback (2026-07-26; heuristic; LLM optional)
- [x] Co-editing session foundation (2026-07-26): join/heartbeat/ops + presence strip (not full CRDT)
- [x] Apply remote multi-type ops (cell/style/structure/sheets) under server seq order (2026-07-26)
- [x] Optional Redis-backed collab (`REDIS_URL`, memory fallback) (2026-07-26)
- [x] WebSocket live push for ops/presence + poll gap-fill (2026-07-26)
- [ ] Wire real LLM provider behind copilot when productized
- [ ] True CRDT for offline multi-master (centralized sequential OT is the current model)

## Wave 6 — Verification (ongoing)

- [x] Spreadsheet unit tests (`formula-parity`, `pivot-summary`, existing suite)
- [ ] `npm run build` + `npm run lint`
- [ ] `cargo test` + clippy if backend touched
- [ ] Round-trip: edit in Ownly → download → Excel Desktop → save → re-upload

---

## Shipped (removed from active plan)

The following were completed before 2026-06-18; detail lives in [`excel-editor-feature-parity.md`](../../excel-editor-feature-parity.md):

- Extended `types.ts` (merges, charts, protection, page setup, zoom, hidden rows/cols)
- `number-formats.ts`, `cell-styles.ts` (baseline), `xlsx-merge-ooxml.ts`, `merge-regions.ts`
- `formula-sheet-refs.ts`, `formula-dynamic-arrays.ts` (FILTER, SORT, UNIQUE, SEQUENCE, SORTBY)
- `formula-catalog.ts`, `formula-table-refs.ts` (Table[Column])
- Spill expansion in `recalculateSheet` / `formulas.ts`
- Ribbon shell, most Home/Insert/Data/Page Layout tabs, print preview, pivot summary
- `xlsx-charts-ooxml.ts` (bar chart insert), `xlsx-metadata-ooxml.ts`, comments/validation OOXML
