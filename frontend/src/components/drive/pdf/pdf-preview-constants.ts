// Human: Shared PDF viewer tuning — desktop matches Pencil Ownly Explorer PDF Viewer scale.
// Agent: READ by usePdfPreviewController; desktop vs mobile padding/gap differ for fit-to-viewport.

export const PDF_MIN_ZOOM = 0.5;
export const PDF_MAX_ZOOM = 5;
export const PDF_ZOOM_STEP = 0.05;
export const PDF_DEFAULT_ZOOM = 1;
export const PDF_THUMBNAIL_WIDTH_DESKTOP = 126;
export const PDF_THUMBNAIL_WIDTH_MOBILE = 198;
export const PDF_PAGE_AREA_PADDING_DESKTOP_PX = 72;
export const PDF_PAGE_AREA_PADDING_X_MOBILE_PX = 24;
// Human: Vertical inset so a fitted page clears floating top badge and bottom metadata bar.
export const PDF_PAGE_AREA_PADDING_Y_MOBILE_PX = 88;
// Human: Gap below each mobile page slot so the next page peeks in while the current page stays centered.
// Agent: APPLIED as margin-bottom on page wrappers — not subtracted from slot height.
export const PDF_MOBILE_NEXT_PAGE_PEEK_PX = 56;
export const PDF_PAGE_STACK_GAP_DESKTOP_PX = 36;
export const PDF_PAGE_STACK_GAP_MOBILE_PX = 8;
export const PDF_SEARCH_DEBOUNCE_MS = 300;
