# Excel 365 Full Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans.

**Goal:** Close **remaining** gaps in the Excel 365 parity audit — LLM Copilot, collaboration, track changes, mobile edit, and OOXML fidelity edge cases.

**Architecture:** Extend `SheetData` / `SpreadsheetWorkbook` types; add focused `lib/spreadsheet/*` modules per concern; wire ribbon → `workbook-ops` → `useSpreadsheetEditor`; patch serialize chain in `parse.ts`; add `/api/v1/spreadsheet/copilot` for LLM/heuristic replies.

**Tech Stack:** React 19, SheetJS, custom OOXML zip patches, Axum backend.

**Last pruned:** 2026-06-18 — shipped waves removed from checklist (see [`docs/excel-editor-feature-parity.md`](../../excel-editor-feature-parity.md)).

---

## Remaining — Wave 1–2 (save fidelity + formulas)

- [ ] Full `cell-styles.ts` / numFmt round-trip for edge cases (complex formats, locale)
- [ ] Fuller `formula-extended.ts` statistical/financial batch beyond current subset
- [ ] LAMBDA and advanced dynamic-array functions not yet in `formula-dynamic-arrays.ts`
- [ ] Spill collision / `#SPILL!` semantics parity with Excel for overlapping ranges

## Remaining — Wave 3 (workbook operations)

- [ ] Track changes log (`workbook-ops.ts` — partial types exist; UI not wired)
- [ ] Format painter (if not yet exposed on ribbon)
- [ ] Sheet tab color, group rows (verify against parity tracker)

## Remaining — Wave 4 (UI)

- [ ] Mobile read-only preview polish on small viewports (edit stays gated by `useIsDesktopExcelViewport`)
- [ ] Draw tab canvas (if still stub)
- [ ] Automate scripts stub beyond current placeholder

## Remaining — Wave 5 (backend)

- [ ] `POST /api/v1/spreadsheet/copilot` with audit log (today: local heuristics in `ExcelCopilotSidebar.tsx` only)
- [ ] Co-editing session token endpoint (foundation — explicitly deferred for real-time sync)

## Wave 6 — Verification (ongoing)

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
