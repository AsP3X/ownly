# Excel 365 Full Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans.

**Goal:** Close all gaps identified in the Excel 365 parity audit — formulas, ribbon commands, save fidelity, charts, collaboration hooks, and platform support.

**Architecture:** Extend `SheetData` / `SpreadsheetWorkbook` types; add focused `lib/spreadsheet/*` modules per concern (refs, dynamic arrays, merge OOXML, charts OOXML, page setup); wire ribbon → `workbook-ops` → `useSpreadsheetEditor`; patch serialize chain in `parse.ts`; add `/api/v1/spreadsheet/copilot` for LLM/heuristic replies.

**Tech Stack:** React 19, SheetJS, custom OOXML zip patches, Axum backend.

---

## Wave 1 — Model & save fidelity
- [ ] Extended `types.ts` (merges, charts, protection, page setup, zoom, hidden rows/cols)
- [ ] `number-formats.ts` + `cell-styles.ts` numFmt round-trip
- [ ] `xlsx-merge-ooxml.ts` import/export
- [ ] `merge-regions.ts` grid helpers
- [ ] `formula-sheet-refs.ts` cross-sheet `Sheet!A1` parsing

## Wave 2 — Formula engine
- [ ] `formula-dynamic-arrays.ts` (FILTER, SORT, UNIQUE, SEQUENCE, SORTBY)
- [ ] `formula-extended.ts` (financial/statistical batch)
- [ ] `formula-catalog.ts` for Insert Function dialog
- [ ] Structured table refs `Table[Col]`
- [ ] Spill expansion in `recalculateSheet`

## Wave 3 — Workbook operations
- [ ] Format painter, hide row/col, multi-sort, text-to-columns, protect sheet
- [ ] Page setup (orientation, scale, print titles, headers/footers)
- [ ] Chart model + `xlsx-charts-ooxml.ts`
- [ ] Track changes log, sheet tab color, group rows

## Wave 4 — UI
- [ ] Dialogs: Insert Function, Paste Special, Page Setup, Protect, Text to Columns
- [ ] Draw tab canvas, Help tab search, Automate scripts stub
- [ ] Ribbon wiring + zoom status bar + merge grid render
- [ ] Mobile read-only preview mode

## Wave 5 — Backend
- [ ] `POST /api/v1/spreadsheet/copilot` with audit log
- [ ] Co-editing session token endpoint (foundation)

## Wave 6 — Verification
- [ ] `npm run build` + `npm run lint`
- [ ] `cargo test` + clippy if backend touched
