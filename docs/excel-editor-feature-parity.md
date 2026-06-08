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
| Fill handle / drag-fill | ✅ | Bottom-right handle; numeric/date/text series |
| Find & Replace | ✅ | Dialog + Ctrl+F; find next / replace / replace all |

## Phase 2 — Formulas & formatting

| Feature | Status | Notes |
|---------|--------|-------|
| Formula evaluation / recalc | 🚧 | SUM, AVERAGE, IF, INDEX, VLOOKUP, COUNTIF, MATCH, date/text helpers; not full Excel set |
| Insert Function / AutoSum | ✅ | Formulas tab + prompt |
| Style persistence on save | ✅ | `cellStyleToXlsx` on serialize |
| Font family / size pickers | ✅ | Home ribbon selects |
| Percent / number / currency formats | ✅ | Home ribbon toggles |
| Vertical align | ✅ | Home ribbon top/middle/bottom |
| Borders / fill color picker | ✅ | Home ribbon border presets + fill color; round-trip on save |
| Wrap text | ✅ | Home ribbon Wrap toggle |
| Merge cells | ✅ | Insert tab → Merge Cells |
| Freeze panes | ✅ | Ribbon freeze/unfreeze; import/export via OOXML; sticky grid |

## Phase 3 — Structure & data

| Feature | Status | Notes |
|---------|--------|-------|
| Add / rename / delete sheet | ✅ | Tab bar +, double-click rename, context-menu delete |
| Reorder sheets | ✅ | Drag-and-drop tab reorder |
| Insert / delete rows | ✅ | Data tab |
| Insert / delete columns | ✅ | Data tab |
| Sort ascending / descending | ✅ | Data tab; header row fixed |
| AutoFilter | 🚧 | Column text filter via prompt; hides rows |
| Remove duplicates | ✅ | Data tab; key column = active cell column |
| Data validation | ⏳ | Not yet implemented |
| Named ranges | ⏳ | Not yet implemented |

## Phase 4 — Ribbon tabs (non-Home)

| Feature | Status | Notes |
|---------|--------|-------|
| File — Save Copy | ✅ | Downloads xlsx |
| File — Export PDF | 🚧 | Uses browser print (same as Print) |
| File — Print | ✅ | `window.print()` |
| Insert — Merge Cells | ✅ | |
| Insert — Bar Chart | ✅ | SVG dialog from selection |
| Insert — Table / PivotTable | ⏳ | Not yet implemented |
| Insert — Pictures / Shapes | ❌ | Requires asset upload pipeline |
| Page Layout — gridlines toggle | ✅ | View flag |
| Page Layout — freeze / unfreeze | ✅ | At active cell |
| Page Layout — margins, orientation | ⏳ | Not yet implemented |
| Formulas — Show Formulas | ✅ | View mode |
| Formulas — Trace Precedents | ⏳ | Not yet implemented |
| Data — Find | ✅ | Opens find/replace dialog |
| Data — From CSV | ✅ | Paste CSV/TSV as new sheet |
| Data — From Web | ⏳ | Not yet implemented |
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
| Conditional formatting export (subset) | ✅ | cellIs, text, expression, scales, data bars, top10, duplicates, iconSet |
| CF export (aboveAverage, uniqueValues edge cases) | 🚧 | Core rules export; exotic Excel CF TBD |
| Cell styles round-trip | 🚧 | Bold/italic/align/fill/font/borders export; full OOXML fidelity TBD |

## Implementation files

| Area | Path |
|------|------|
| Tracker | `docs/excel-editor-feature-parity.md` |
| Editor hook | `frontend/src/hooks/useSpreadsheetEditor.ts` |
| Selection | `frontend/src/lib/spreadsheet/selection.ts` |
| Undo | `frontend/src/lib/spreadsheet/undo.ts` |
| Clipboard | `frontend/src/lib/spreadsheet/clipboard.ts` |
| Formulas | `frontend/src/lib/spreadsheet/formulas.ts` |
| Fill handle | `frontend/src/lib/spreadsheet/fill-handle.ts` |
| CSV import | `frontend/src/lib/spreadsheet/csv-import.ts` |
| Chart data | `frontend/src/lib/spreadsheet/chart-data.ts` |
| Workbook ops | `frontend/src/lib/spreadsheet/workbook-ops.ts` |
| OOXML patch | `frontend/src/lib/spreadsheet/xlsx-ooxml.ts` |
| Find/replace UI | `frontend/src/components/drive/excel/ExcelFindReplaceDialog.tsx` |
| Chart UI | `frontend/src/components/drive/excel/ExcelChartDialog.tsx` |
| Sheet tabs | `frontend/src/components/drive/excel/ExcelSheetTabsBar.tsx` |
| Style export | `frontend/src/lib/spreadsheet/cell-styles.ts` (`cellStyleToXlsx`) |

## Remaining high-value work

1. Full Excel function library (nested arrays, XLOOKUP, date math)
2. Real Copilot LLM integration (backend)
3. Data validation UI
4. AutoFilter dropdown UI (replace prompt)
5. Comments / cell notes
6. Sheet tab reorder persistence smoke on multi-sheet save
