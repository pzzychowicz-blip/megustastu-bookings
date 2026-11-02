// src/lib/compact-shell.js
// ── The compact layout (v18.14.0, H7) ────────────────────────────────────────
// Lock navigation pins the header and the date row, so on a short screen they
// and the toolbar took 253px of 507 before the first grid row, and the tablet
// on the pass showed 2 of 13 tables on opening. Patryk: compact on short screens
// only.
//
// A HEIGHT test, and the only thing that separates that tablet from a taller
// screen of the same width. 998 × 507 with Chrome's bars, 998 × 570 without;
// a 1366 × 768 laptop's browser window is about 650, so 640 leaves laptops and
// iPads alone. A phone keeps its own layout, which already folds differently.
// It is not `useShortViewport` (480), which means "the keyboard is up".
//
// What it does is App's (see `compact` and `toolbarFolded` there) and is not
// animated, like `isMobile`: a screen does not change height in service, and on
// Android the keyboard can only flip it behind a modal. A modal that asks this
// itself reads the height once (InboxPanel's `shortScreen`), or the keyboard flips
// it under the field that raised the keyboard.
export const COMPACT_HEIGHT = 640;

export function isCompact(winH, isMobile) {
  return !isMobile && winH < COMPACT_HEIGHT;
}
