// ── toast-box — where a toast on the top layer is drawn (v18.4.5) ────────────
// The refusal toast is drawn in a `position: fixed` layer above every modal
// (components/RefusalToast.jsx), because inside the main view's own layer it sat
// under the dialog it was raised from. A fixed layer has no anchor of its own, so
// it borrows one: the box of the wrapper StatusToasts floats over, read at the
// moment the refusal is raised. With no modal open the pill therefore lands
// exactly where it always did, in the gap of the timeline toolbar.
//
// Pure: a rect in, a box out, so the three ways the anchor can be unusable are
// decided here and reachable by a test rather than in an event handler.
//  • no rect (the wrapper is not mounted) → the whole viewport's width, top 0
//  • a top above the viewport (the page is scrolled, the non-fixed shell) → 0,
//    so the toast is on screen; in the old layer it was scrolled away with the
//    wrapper
//  • a rect with no width (a hidden pane mid-layout) → the viewport's width
export function toastBox(rect, viewportWidth) {
  const vw = viewportWidth > 0 ? viewportWidth : 0;
  if (!rect || !(rect.width > 0)) return { top: 0, left: 0, width: vw };
  return {
    top: Math.max(0, Math.round(rect.top)),
    left: Math.round(rect.left),
    width: Math.round(rect.width),
  };
}
