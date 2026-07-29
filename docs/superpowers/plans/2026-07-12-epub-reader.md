# EPUB Reader Implementation Plan

← [Back to main README](../../../README.md) · [Documentation index](../../README.md)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans.

**Goal:** Ship an in-browser EPUB reader matching `docs/design/epub-reader.pen` — desktop overlay reader with optional TOC panel, mobile fullscreen reader with settings sheet, integrated into drive and public share flows.

**Architecture:** Mirror PDF/video preview patterns — `useEpubPreviewController` + desktop/mobile surfaces + `DynamicImportPreview` code-split loader. Parse EPUB client-side with `epub.js` from `fetchFileBlobForPreview` / share blob helpers. No backend API changes.

**Tech Stack:** React 19, epub.js, Tailwind tokens aligned to Pencil variables, Vitest unit tests.

**Design reference:** `docs/design/epub-reader.pen` (screens: desktop reader, desktop TOC open, mobile fullscreen, mobile settings sheet).

---

## Task 1: MIME detection, tokens, and preferences

**Files:**
- `frontend/src/lib/utils-app.ts` — add `isEpubMime(mime, filename?)`
- `frontend/src/lib/utils-app.test.ts` — unit tests
- `frontend/src/components/drive/epub/epub-reader-tokens.ts` — design tokens from pen file
- `frontend/src/lib/epub-reader-preference.ts` — localStorage for font size, theme, line spacing
- `frontend/src/lib/epub-reader-preference.test.ts` — unit tests

**Requirements:**
- `isEpubMime` returns true for `application/epub+zip`, `application/epub`, and `.epub` extension fallback
- Tokens: reader paper bg `#FAF8F5`, reader text `#2C2C2C`, accent `#2563EB`, overlay styles matching video player
- Preferences persist per-browser with sane defaults (medium font, light theme, comfortable spacing)

**Verification:** `npm run test` for new tests pass

---

## Task 2: EPUB controller and document loading

**Files:**
- `frontend/package.json` — add `epubjs` dependency
- `frontend/src/lib/epub-document-source.ts` — blob → Book helpers, cleanup
- `frontend/src/components/drive/epub/useEpubPreviewController.ts` — fetch, spine/TOC, chapter nav, progress, settings
- `frontend/src/components/drive/epub/epub-preview-types.ts`
- `frontend/src/components/drive/epub/epub-preview-constants.ts`
- `frontend/src/components/drive/epub/useEpubPreviewController.test.ts` — preference + helper tests

**Requirements:**
- Controller accepts same props shape as PDF preview (`file`, `open`, `shareToken`, `sharePassword`)
- Loads EPUB via existing preview blob fetchers
- Exposes: loading/error, current chapter label, page fraction, go prev/next chapter, TOC entries, toggle TOC, reading settings from preferences
- Revoke/cleanup on close

**Verification:** `npm run test` green for controller tests

---

## Task 3: Desktop and mobile UI surfaces

**Files:**
- `frontend/src/components/drive/epub/EpubPreviewDialog.tsx` — shell, `useIsDesktopPlayer` split
- `frontend/src/components/drive/epub/EpubPreviewSurfaceDesktop.tsx` — overlay card, meta pill, TOC panel, controls
- `frontend/src/components/drive/epub/EpubPreviewSurfaceMobile.tsx` — fullscreen reader, bottom bar
- `frontend/src/components/drive/epub/EpubReaderSettingsSheet.tsx` — mobile settings bottom sheet

**Requirements:**
- Desktop matches pen: dim context feel, reader card with serif content area, top meta pill + close, bottom control bar (TOC, bookmark icon, font +/- , theme icons, progress)
- Desktop TOC panel slides open (toggle via list icon) with chapter list + active highlight
- Mobile matches pen: header with back/close, reading area, progress bar, icon row, settings sheet for font/theme/spacing
- Loading and error states visible
- Inline comments per project rules

**Verification:** `npm run build` passes

---

## Task 4: Drive and share integration

**Files:**
- `frontend/src/lib/dynamic-import-preview.tsx` — `loadEpubPreviewDialog`
- `frontend/src/pages/DrivePage.tsx` — state, handler, dialog mount
- `frontend/src/pages/PublicSharePage.tsx` — same for share context
- `frontend/src/components/drive/FileListView.tsx` — open EPUB action
- `frontend/src/components/drive/ExplorerGrid.tsx` or grid open handler — if separate from list
- `frontend/src/components/drive/MobileFileActionsSheet.tsx` — open EPUB
- `frontend/src/components/public-share/PublicShareExplorer.tsx` — preview handler
- `frontend/src/lib/file-processing.ts` — only if needed for icons/thumbnails

**Requirements:**
- Double-click / open action on `.epub` files launches reader
- Code-split chunk like other previews
- Public share single-file EPUB preview works with share token props
- Do not wire bookmark persistence backend (icon present, no-op or local-only placeholder OK)

**Verification:** `npm run build`, `npm run lint`, `npm run test`

---

## Task 5: Final verification

- Run `npm run build`, `npm run lint`, `npm run test` in `frontend/`
- Note: if `package.json` changed, regenerate lockfile via `node:22-alpine npm install` in `frontend/` (document in report; run if Docker available)
- Confirm no backend changes required
