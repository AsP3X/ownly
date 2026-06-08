# Excel Editor Feature Parity Tracker

Status legend: ✅ Done · 🚧 Partial · ⏳ Planned · ❌ Out of scope (Ownly)

Last updated: 2026-06-08

## Phase 1 — Core editing

| Feature | Status | Notes |
|---------|--------|-------|
| In-cell editing | ✅ | Double-click, type-to-edit, inline input |
| Formula bar editing | ✅ | Pre-existing; recalculates on commit |
| Keyboard navigation (arrows, Tab, Enter) | ✅ | Shift+arrow extends range |
| Multi-cell / range selection | ✅ | Shift+click; range highlight |
| Copy / Cut / Paste (Ctrl+C/X/V) | ✅ | Internal + system clipboard TSV |
| Undo / Redo (Ctrl+Z / Ctrl+Y) | ✅ | 50-level workbook snapshots |
| Fill handle / drag-fill | ⏳ | Not yet implemented |
| Find & Replace | ✅ | Dialog + Ctrl+F; find next / replace / replace all |

## Phase 2 — Formulas & formatting

| Feature | Status | Notes |
|---------|--------|-------|
| Formula evaluation / recalc | 🚧 | SUM, AVERAGE, IF, AND, OR, cell refs, ranges; not full Excel function set |
| Insert Function / AutoSum | ✅ | Formulas tab + prompt |
| Style persistence on save | ✅ | `cellStyleToXlsx` on serialize |
| Font family / size pickers | ✅ | Home ribbon selects |
| Percent / number / currency formats | ✅ | Home ribbon toggles |
| Vertical align | ⏳ | Imported only; no ribbon toggle |
| Borders / fill color picker | ⏳ | Imported only |
| Wrap text | ⏳ | Type supported; no ribbon toggle |
| Merge cells | ✅ | Insert tab → Merge Cells |
| Freeze panes | ⏳ | Not yet implemented |

## Phase 3 — Structure & data

| Feature | Status | Notes |
|---------|--------|-------|
| Add / rename / delete sheet | ✅ | Tab bar +, double-click rename, context-menu delete |
| Reorder sheets | ⏳ | Not yet implemented |
| Insert / delete rows | ✅ | Data tab |
| Insert / delete columns | ✅ | Data tab |
| Sort ascending / descending | ✅ | Data tab; header row fixed |
| AutoFilter | 🚧 | Column text filter via prompt; hides rows |
| Remove duplicates | ⏳ | Not yet implemented |
| Data validation | ⏳ | Not yet implemented |
| Named ranges | ⏳ | Not yet implemented |

## Phase 4 — Ribbon tabs (non-Home)

| Feature | Status | Notes |
|---------|--------|-------|
| File — Save Copy | ✅ | Downloads xlsx |
| File — Export PDF | 🚧 | Uses browser print (same as Print) |
| File — Print | ✅ | `window.print()` |
| Insert — Merge Cells | ✅ | |
| Insert — Table / Chart / PivotTable | ⏳ | Not yet implemented |
| Insert — Pictures / Shapes | ❌ | Requires asset upload pipeline |
| Page Layout — gridlines toggle | ✅ | View flag |
| Page Layout — margins, orientation | ⏳ | Not yet implemented |
| Formulas — Show Formulas | ✅ | View mode |
| Formulas — Trace Precedents | ⏳ | Not yet implemented |
| Data — Find | ✅ | Opens find/replace dialog |
| Data — From CSV / Web | ⏳ | Not yet implemented |
| Automate — Macros / Scripts | ❌ | VBA not supported in browser |

## Phase 5 — Copilot & collaboration

| Feature | Status | Notes |
|---------|--------|-------|
| Copilot cell analysis | ✅ | Heuristic budget compare |
| Copilot prompt / Send | 🚧 | Local heuristic replies (not LLM) |
| Copilot action buttons | ✅ | Navigate to related cells |
| Real-time co-editing | ❌ | Requires backend sync |
| Comments / notes | ⏳ | Not yet implemented |
| Track changes | ❌ | |

## Phase 6 — Save fidelity

| Feature | Status | Notes |
|---------|--------|-------|
| Values + formulas export | ✅ | |
| Column / row dimensions export | ✅ | |
| Conditional formatting export (subset) | ✅ | cellIs, text, expression, scales, data bars |
| CF export (top10, duplicates, iconSet) | ⏳ | Import works; export incomplete |
| Cell styles round-trip | 🚧 | Bold/italic/align/fill/font export added; full OOXML fidelity TBD |

## Implementation files

| Area | Path |
|------|------|
| Tracker | `docs/excel-editor-feature-parity.md` |
| Editor hook | `frontend/src/hooks/useSpreadsheetEditor.ts` |
| Selection | `frontend/src/lib/spreadsheet/selection.ts` |
| Undo | `frontend/src/lib/spreadsheet/undo.ts` |
| Clipboard | `frontend/src/lib/spreadsheet/clipboard.ts` |
| Formulas | `frontend/src/lib/spreadsheet/formulas.ts` |
| Workbook ops | `frontend/src/lib/spreadsheet/workbook-ops.ts` |
| Find/replace UI | `frontend/src/components/drive/excel/ExcelFindReplaceDialog.tsx` |
| Style export | `frontend/src/lib/spreadsheet/cell-styles.ts` (`cellStyleToXlsx`) |

## Remaining high-value work

1. Fill handle / drag-fill
2. Freeze panes
3. Charts from selection
4. Remove duplicates
5. Full Excel function library (VLOOKUP, INDEX/MATCH, date functions)
6. CF export parity for top10 / duplicates / iconSet
7. Real Copilot LLM integration (backend)
8. CSV import as new sheet
