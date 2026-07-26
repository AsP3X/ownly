# Excel Editor Feature Parity Tracker

Status legend: ✅ Done · 🚧 Partial · ⏳ Planned · ❌ Out of scope (Ownly)

Last updated: 2026-07-26 (batch 3)

## Ribbon UI

| Feature | Status | Notes |
|---------|--------|-------|
| Excel 365 tab strip | ✅ | File (green) + Home/Insert/Draw/Page Layout/Formulas/Data/Review/View/Help/Automate |
| Labeled command groups | ✅ | Clipboard, Font, Alignment, Number, Styles, Cells, Editing (Home) |
| Ribbon collapse | ✅ | Chevron on tab strip |
| Design tokens | ✅ | `excel-ribbon-tokens.ts` from login-screen + Office colors |
| Format Painter | ✅ | Activate + apply on next cell click |
| Strikethrough | ✅ | Style + grid + OOXML strike |
| Group / Ungroup rows | ✅ | Data → Outline; `rowOutlineLevels` |
| Sheet tab color | ✅ | View → Tab Color; tab bar accent |
| Trace Dependents | ✅ | Formulas auditing |
| Track Changes log UI | ✅ | Review → Tracking + Change Log dialog |

## Phase 1 — Core editing

| Feature | Status | Notes |
|---------|--------|-------|
| In-cell editing | ✅ | Double-click, type-to-edit, inline input |
| Formula bar editing | ✅ | Pre-existing; recalculates on commit |
| Keyboard navigation (arrows, Tab, Enter) | ✅ | Shift+arrow extends range |
| Multi-cell / range selection | ✅ | Shift+click; range highlight |
| Copy / Cut / Paste (Ctrl+C/X/V) | ✅ | Internal + system clipboard TSV |
| Paste Special | ✅ | All / values / formats / formulas + transpose |
| Undo / Redo (Ctrl+Z / Ctrl+Y) | ✅ | 50-level workbook snapshots |
| Fill handle / drag-fill | ✅ | Bottom-right handle; numeric/date/text series |
| Find & Replace | ✅ | Dialog + Ctrl+F; find next / replace / replace all |

## Phase 2 — Formulas & formatting

| Feature | Status | Notes |
|---------|--------|-------|
| Formula evaluation / recalc | 🚧 | Large catalog: IFS/SWITCH, trig (SIN/COS/…), FACT/COMBIN/ROMAN, date (DAYS/WEEKNUM/WORKDAY/TIME), stats (GEOMEAN/MODE/QUARTILE/NORMSDIST), info (ISEVEN/ISODD), text helpers, dynamic arrays, LET; still not full Excel library |
| Evaluate Formula dialog | ✅ | Formulas → Evaluate |
| Insert hyperlink | ✅ | Insert → Link |
| Clear contents | ✅ | Home → Clear keeps styles |
| Status bar range stats | ✅ | Multi-cell Average/Count/Sum |
| Dynamic arrays + #SPILL! | ✅ | Clear old spills; collision returns `#SPILL!`; multi-col FILTER/SORT/UNIQUE |
| Insert Function / AutoSum | ✅ | Formulas tab + prompt |
| Trace Precedents / Dependents | ✅ | Amber highlight on grid |
| Named ranges | ✅ | Name Manager + formula resolution + OOXML export |
| Style persistence on save | ✅ | `cellStyleToXlsx` including strikethrough |
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
| Data validation | ✅ | List / number / date / custom; column or per-cell scope |
| Insert Table | ✅ | Header + banded rows on selection; table metadata on sheet |
| Multi-field pivot summary | ✅ | 1–2 row fields + 1–2 value aggregations → new sheet |

## Phase 4 — Ribbon tabs (non-Home)

| Feature | Status | Notes |
|---------|--------|-------|
| File — Save Copy | ✅ | Downloads xlsx |
| File — Export PDF | ✅ | Print preview dialog → Save as PDF in browser |
| File — Print | ✅ | Opens print preview with margin guides |
| Insert — Merge Cells | ✅ | |
| Insert — Table | ✅ | Formats selection with banded rows |
| Insert — Charts | ✅ | Column/bar/line/area/pie/doughnut/**scatter** |
| Insert — PivotTable | ✅ | Multi-field summary dialog; inserts new sheet |
| Insert — Pictures / Shapes | ❌ | Requires asset upload pipeline |
| Page Layout — gridlines toggle | ✅ | View flag |
| Page Layout — freeze / unfreeze | ✅ | At active cell |
| Page Layout — print area | ✅ | Set/clear selection; OOXML round-trip; violet outline in grid |
| Page Layout — margins | ✅ | Margins dialog; pageMargins OOXML export |
| Page Layout — print preview | ✅ | Margin guides + isolated print/PDF export |
| Formulas — Name Manager | ✅ | Create/delete defined names |
| Formulas — Trace Precedents / Dependents | ✅ | Formulas tab |
| Data — Find | ✅ | Opens find/replace dialog |
| Data — From CSV | ✅ | Paste CSV/TSV as new sheet |
| Data — Validation / Comment | ✅ | Data tab dialogs |
| Automate — Macros / Scripts | ❌ | VBA not supported in browser |

## Phase 5 — Copilot & collaboration

| Feature | Status | Notes |
|---------|--------|-------|
| Copilot cell analysis | ✅ | Formula / budget / comment heuristics |
| Copilot prompt / Send | ✅ | `POST /api/v1/spreadsheet/copilot` + local fallback |
| Copilot action buttons | ✅ | Navigate to related cells |
| Real-time co-editing | ❌ | Requires backend sync |
| Comments / notes | ✅ | In-app + OOXML + **VML drawing** for Excel indicators |
| Track changes | ✅ | Toggle + append on edit + Change Log dialog |

## Phase 6 — Save fidelity

| Feature | Status | Notes |
|---------|--------|-------|
| Values + formulas export | ✅ | |
| Column / row dimensions export | ✅ | |
| Conditional formatting export (subset) | ✅ | cellIs, text, expression, scales, data bars, top10, duplicates, iconSet, aboveAverage |
| Comments + validation + defined names OOXML | ✅ | `xlsx-metadata-ooxml.ts` + VML |
| Cell styles round-trip | 🚧 | Bold/italic/strike/align/fill/font/borders (thin–double + per-side colors); theme1.xml palette on import + theme index export when matched |
| Theme colors from theme1.xml | ✅ | `loadThemePaletteFromXlsxBuffer` + tint + indexed palette |
| Chart insert OOXML | ✅ | Common types including scatter |

## Implementation files

| Area | Path |
|------|------|
| Tracker | `docs/excel-editor-feature-parity.md` |
| Ribbon shell | `frontend/src/components/drive/excel/ExcelSpreadsheetRibbon.tsx` |
| Track changes UI | `frontend/src/components/drive/excel/ExcelTrackChangesDialog.tsx` |
| Formulas | `frontend/src/lib/spreadsheet/formulas.ts`, `formula-extended.ts`, `formula-dynamic-arrays.ts` |
| Pivot | `frontend/src/lib/spreadsheet/pivot-summary.ts` |
| Copilot API | `backend/src/spreadsheet/handlers.rs` + `frontend/src/api/client.ts` `postSpreadsheetCopilot` |

## Remaining high-value work

1. Full Excel function library (hundreds of functions beyond current set)
2. Real LLM behind Copilot (endpoint is heuristic-ready + audited)
3. Full OOXML theme color / complex numFmt edge cases
4. Real-time collaboration
5. Mobile edit mode (read-only polish shipped; edit stays desktop-gated)
