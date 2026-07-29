# Filebrowser UI rework — design

**Date:** 2026-07-29
**Status:** Approved for implementation
**Branch:** `feature/filebrowser-ui-rework` (from `dev`)

## Goal

Substantially raise the visual and interaction quality of the Ownly drive filebrowser without
losing a single existing feature or status element, and without the result reading as
machine-generated boilerplate.

## Problem statement

The drive UI works but presents as a template. This is measurable, not subjective:

| Signal | Evidence |
| --- | --- |
| No design system in practice | 167 files carry raw hex literals; `#E5E7EB` ×427, `#1A1A1A` ×422, `#666666` ×420, `#2563EB` ×407, while `index.css` defines a complete but unused CSS-variable token set |
| Accent used as decoration | Every mime icon and folder icon renders `#2563EB`. Blue signals nothing because it signals everything |
| One surface treatment everywhere | `rounded-xl border bg-white hover:shadow-sm` is applied identically to tiles, popovers, panels and cards |
| Centered tile text | `ExplorerGridTiles` centers filenames and metadata; real file managers left-align |
| Low information density | Grid is the only view mode; no columns, no comparison, ~4 facts per file |
| Status hidden on mobile | `DrivePage.tsx:2460` renders the counts line as `hidden … lg:block` pinned by `mt-auto` |
| Dead code | `FileListView.tsx` (442 lines) is imported nowhere |

## Non-goals

- No backend changes. Sorting continues to use the existing four `ExplorerFileSort` options and
  the existing `GET /files?sort=` contract.
- No change to the API client, auth, upload/download pipelines, or collab logic.
- Document canvases (Excel grid, PDF page surface, video surface) are **not** inverted in dark
  mode. A document is paper; it stays light on purpose.

## Design direction

**Precise pro-tool.** Neutral greys carry the interface. Accent colour is reserved for exactly
three meanings: selection, active navigation, and focus. Hairline dividers replace
borders-on-everything. Density increases; decoration decreases.

## Architecture

### 1. Token layer (`frontend/src/index.css`)

A semantic token set defined on `:root`, overridden under `.dark`, and exposed to Tailwind via
`@theme inline`:

- **Surfaces** — `--surface-base`, `--surface-panel`, `--surface-raised`, `--surface-sunken`
- **Text** — `--text-primary`, `--text-secondary`, `--text-tertiary`
- **Lines** — `--line-hairline`, `--line-border`, `--line-strong`
- **Accent** — `--accent`, `--accent-hover`, `--accent-weak`, `--accent-on`
- **State** — `--state-success`, `--state-danger`, `--state-warn`, `--state-processing`, each with
  a `-weak` tint variant
- **Focus** — `--focus-ring`

Migration mapping from today's literals:

| Literal | Token |
| --- | --- |
| `#F7F8FA`, `#f3f2f1` | `--surface-base` |
| `#FFFFFF` | `--surface-panel` |
| `#1A1A1A` | `--text-primary` |
| `#666666` | `--text-secondary` |
| `#888888` | `--text-tertiary` |
| `#E5E7EB`, `#D1D5DB` | `--line-border` |
| `#2563EB` | `--accent` |
| `#1D4ED8` | `--accent-hover` |
| `#EFF6FF`, `#DBEAFE` | `--accent-weak` |
| `#10B981` | `--state-success` |
| `#EF4444` | `--state-danger` |

### 2. Theme system

New `ThemeContext` + `useTheme` hook following the existing `InstanceNameContext` /
`AuthContext` split (context object in a `-context.ts` file, provider in a `.tsx` file).

- Persisted under `localStorage` key `ownly_theme` with values `light | dark | system`
- `system` subscribes to `prefers-color-scheme` via `matchMedia`
- Applied by toggling the `dark` class on `document.documentElement`
- Toggle control added to the existing `DriveProfileMenu` alongside Profile / Settings / Logout

### 3. Explorer toolbar

`DriveCloudExplorer`'s two-row header becomes one sticky toolbar:

`breadcrumb · search · view switcher · Filter · Sort · New Folder · Upload`

- Breadcrumb keeps all drag-drop targets and gains the `…` overflow collapse on desktop
  (currently mobile-only)
- Filter and Sort popovers are extracted into one reusable `ExplorerMenu` primitive preserving
  `role="listbox"`, `aria-selected`, `aria-expanded`, `aria-controls`, and click-outside dismissal
- New segmented **Grid / List** view switcher

### 4. `ExplorerStatusBar` (new)

Persistent footer strip inside the explorer showing folder count, files loaded-of-total,
selection count, storage used, and a live loading/refresh indicator.

It absorbs the status line currently at `DrivePage.tsx:2460`. Content is preserved verbatim; only
placement and responsiveness change, so the line is no longer desktop-only.

### 5. Grid tiles

`ExplorerGridTiles` keeps its component boundaries, memo comparators, and preview-slot footprint
(the `content-visibility` / `contain-intrinsic-size` performance work and grid alignment both
depend on that footprint). Visual changes only:

- Thumbnail fills the slot edge-to-edge
- Metadata moves to a hairline-separated footer
- Filename left-aligns
- Mime icons take neutral tones instead of uniform accent blue
- Size and date use tabular numerals

### 6. List view

`FileListView` is revived as a genuine second view mode:

- **Desktop:** Name / Size / Type / Modified / Shared / ⋯ columns, header row with click-to-sort
  bound to the existing four `ExplorerFileSort` options
- **Mobile:** its current stacked-row layout is retained
- Must reach grid parity: selection, drag source and drop target, touch drag, previews,
  processing states, shared indicators, infinite-scroll sentinel, load-more controls
- View mode persisted via new `readExplorerViewMode` / `writeExplorerViewMode` in
  `drive-preferences.ts` under key `ownly_explorer_view_mode`

### 7. Keyboard navigation

New `useExplorerKeyboardNav` hook:

| Key | Action |
| --- | --- |
| Arrows | Move roving focus across entries |
| Home / End | Jump to first / last entry |
| Enter | Open folder or preview file |
| Backspace | Navigate up one folder level |
| Space | Toggle selection |
| Shift+Arrow | Extend selection |
| Esc | Clear selection |
| Delete | Request delete via the existing confirm dialog |

Guarded by the same input / textarea / contenteditable / dialog check the existing Ctrl+K handler
uses. Ctrl+K (focus search) and Ctrl+A (select all) continue to work unchanged.

## Feature preservation inventory

Every item below exists today and must still work after the rework. This is the acceptance
checklist for the regression rule.

**Explorer:** breadcrumb navigation, breadcrumb drop targets, mobile breadcrumb collapse, search,
Enter-to-search with focus retention, Ctrl+K focus, type filter, file sort, sort persistence,
create folder, upload, folder open, HTML5 drag-drop, touch long-press drag, drag ghost, drop
target highlighting, self-drop rejection, selection checkboxes, card-select mode, mobile
tap-select, select-all, infinite scroll, load-more folders, load-more files, loading skeletons,
empty states (searching vs empty folder).

**Tiles:** image / video / document thumbnails, thumbnail shimmer, processing badge, processing
progress overlay, shared indicator, mobile ⋯ actions button, touch-drag armed state, filename
extension preservation, per-mime preview routing (video, image, pdf, epub, text, rtf,
spreadsheet, audio).

**Bulk bar:** selection count, select-all, download, favourite, rebuild streams, delete, copy to
folder, move to folder, clear selection, mobile floating dock behaviour.

**Sidebar:** Home / My Cloud / Shared Files / Secure Vaults (disabled) / Trash Bin / Settings nav,
upload rate limit widget, storage widget with `role="progressbar"` and aria values.

**Topbar:** encrypted-session status line, profile trigger, profile menu with Profile / Settings /
Admin Console / Logout.

**Panels:** Home overview, Shared Files (with-me and by-me plus metrics), Recycle Bin.

**Mobile:** header, bottom nav, sidebar sheet, file actions sheet, home section.

## Verification

Per `.cursor/rules/regression-testing.mdc`:

```bash
cd frontend && npm run lint && npm run test && npm run build
```

Manual smoke: upload, download, delete, search, share, drag-move, folder create, mobile
selection, theme toggle in both modes, and both view modes.

## Rules compliance

- `.cursor/rules/inline-documentation.mdc` — every new or modified `.ts` / `.tsx` carries
  `// Human:` and, where behaviour is non-trivial, `// Agent:` lines; `{/* … */}` form inside JSX
- `.cursor/rules/git-commits.mdc` — work happens on `feature/filebrowser-ui-rework` off `dev`;
  commits use the `TASK:` prefix; no push, merge, rebase or amend without an explicit request
- `.cursor/rules/regression-testing.mdc` — feature inventory above is the acceptance checklist

## Delivery

One branch, phased commits, lint/test/build at each phase boundary:

1. Token layer + theme system
2. Explorer toolbar + status bar
3. Grid tiles + list view + view toggle
4. Keyboard navigation
5. Shell, panels, mobile surfaces
6. Dialog chrome theming
