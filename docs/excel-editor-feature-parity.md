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
| Formula evaluation / recalc | 🚧 | SUMIFS, MAXIFS/MINIFS, ROW/COLUMN/OFFSET, IFNA, text helpers |
| Insert Function / AutoSum | ✅ | Formulas tab + prompt |
| Trace Precedents | ✅ | Highlights formula refs in amber on grid |
| Named ranges | ✅ | Name Manager + formula resolution + OOXML export |
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
| AutoFilter | ✅ | Dialog with search + value checkboxes |
| Remove duplicates | ✅ | Data tab; key column = active cell column |
| Data validation | ✅ | List / number rules; import/export OOXML; commit guard |
| Insert Table | ✅ | Header + banded rows on selection; table metadata on sheet |

## Phase 4 — Ribbon tabs (non-Home)

| Feature | Status | Notes |
|---------|--------|-------|
| File — Save Copy | ✅ | Downloads xlsx |
| File — Export PDF | ✅ | Print preview dialog → Save as PDF in browser |
| File — Print | ✅ | Opens print preview with margin guides |
| Insert — Merge Cells | ✅ | |
| Insert — Table | ✅ | Formats selection with banded rows |
| Insert — Bar Chart | ✅ | SVG dialog from selection |
| Insert — PivotTable | ✅ | Group-by summary dialog; inserts new sheet |
| Insert — Pictures / Shapes | ❌ | Requires asset upload pipeline |
| Page Layout — gridlines toggle | ✅ | View flag |
| Page Layout — freeze / unfreeze | ✅ | At active cell |
| Page Layout — print area | ✅ | Set/clear selection; OOXML round-trip; violet outline in grid |
| Page Layout — margins | ✅ | Margins dialog; pageMargins OOXML export |
| Page Layout — print preview | ✅ | Margin guides + isolated print/PDF export |
| Formulas — Name Manager | ✅ | Create/delete defined names |
| Formulas — Trace Precedents | ✅ | Formulas tab |
| Data — Find | ✅ | Opens find/replace dialog |
| Data — From CSV | ✅ | Paste CSV/TSV as new sheet |
| Data — Validation / Comment | ✅ | Data tab dialogs |
| Automate — Macros / Scripts | ❌ | VBA not supported in browser |

## Phase 5 — Copilot & collaboration

| Feature | Status | Notes |
|---------|--------|-------|
| Copilot cell analysis | ✅ | Heuristic budget compare |
| Copilot prompt / Send | 🚧 | Local heuristic replies (not LLM) |
| Copilot action buttons | ✅ | Navigate to related cells |
| Real-time co-editing | ❌ | Requires backend sync |
| Comments / notes | ✅ | In-app + OOXML import/export |
| Track changes | ❌ | |

## Phase 6 — Save fidelity

| Feature | Status | Notes |
|---------|--------|-------|
| Values + formulas export | ✅ | |
| Column / row dimensions export | ✅ | |
| Conditional formatting export (subset) | ✅ | cellIs, text, expression, scales, data bars, top10, duplicates, iconSet, aboveAverage |
| Comments + validation + defined names OOXML | ✅ | `xlsx-metadata-ooxml.ts` |
| Cell styles round-trip | 🚧 | Bold/italic/align/fill/font/borders export; full OOXML fidelity TBD |

## Implementation files

| Area | Path |
|------|------|
| Tracker | `docs/excel-editor-feature-parity.md` |
| Metadata OOXML | `frontend/src/lib/spreadsheet/xlsx-metadata-ooxml.ts` |
| Page settings OOXML | `frontend/src/lib/spreadsheet/xlsx-page-settings-ooxml.ts` |
| Page margins UI | `frontend/src/components/drive/excel/ExcelPageMarginsDialog.tsx` |
| Named ranges | `frontend/src/lib/spreadsheet/named-ranges.ts` |
| Name Manager UI | `frontend/src/components/drive/excel/ExcelNamedRangeDialog.tsx` |
| Pivot summary | `frontend/src/lib/spreadsheet/pivot-summary.ts` |
| PivotTable UI | `frontend/src/components/drive/excel/ExcelPivotTableDialog.tsx` |
| Print preview | `frontend/src/lib/spreadsheet/print-preview.ts` |
| Print preview UI | `frontend/src/components/drive/excel/ExcelPrintPreviewDialog.tsx` |
| Workbook ops | `frontend/src/lib/spreadsheet/workbook-ops.ts` |

## Remaining high-value work

1. Real Copilot LLM integration (backend)
2. Structured references for table formulas
3. Full Excel function library (LAMBDA, dynamic arrays)
4. Comment VML drawing for Excel-native indicators
