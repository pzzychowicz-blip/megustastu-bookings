// src/lib/edge-scroll.js — v18.3.1 (ROADMAP A5, the motion & touch audit)
//
// Scrolling while a timeline block is dragged near the top or bottom edge. An
// armed drag stops the page scrolling (the block's non-passive touchmove
// blocker), so before this a block could only reach the rows already on
// screen: on the tablet i3 and i4 sit below an 800px screen, and on a phone
// everything from table 6 down.
//
// Pure except `scrollParentY` / `scrollBounds`, which read the DOM. The loop
// that drives them lives in TimelineView's TimelineBlock, because it has to
// move the drag's own translateY by exactly what it scrolled.

// How deep the band is, from each edge of the visible scrollport. The ROADMAP
// entry's "about 48px": a fingertip's width, so a finger resting on a row near
// the edge does not scroll by accident.
export const EDGE_BAND = 48;

// px per millisecond at (or past) the edge, ramping linearly from 0 at the
// band's inner line. 0.6 = 600px a second: one 44px row in ~70ms at full
// depth, and a finger just inside the band crawls, so it can stop on a row.
export const EDGE_MAX_SPEED = 0.6;

// Signed velocity for a pointer at `y`, with the scrollport visible from `top`
// to `bottom` (viewport coordinates). Negative scrolls up. A pointer past the
// edge (over a fixed bottom bar, say) runs at full speed rather than stopping.
export function edgeVelocity(y, top, bottom) {
  if (!(bottom - top > 2 * EDGE_BAND)) return 0;
  if (y < top + EDGE_BAND) return -EDGE_MAX_SPEED * Math.min(1, (top + EDGE_BAND - y) / EDGE_BAND);
  if (y > bottom - EDGE_BAND) return EDGE_MAX_SPEED * Math.min(1, (y - (bottom - EDGE_BAND)) / EDGE_BAND);
  return 0;
}

// Whole pixels to scroll this frame, carrying the fraction to the next one:
// at slow speeds a frame moves well under a pixel, and a scrollTop that is
// rounded each time would never move at all.
export function edgeStep(carry, velocity, dt) {
  const total = carry + velocity * dt;
  const step = Math.trunc(total);
  return { step, carry: total - step };
}

// The nearest ancestor that actually scrolls vertically: the body in the
// default layout, the inner region under the fixed shell (nav lock, Split
// View), a pane in Split View. `overflow-x: auto` computes `overflow-y` to
// auto too, so the timeline's own horizontal scroller matches on style and is
// skipped by the size test.
export function scrollParentY(el) {
  for (let n = el && el.parentElement; n; n = n.parentElement) {
    const oy = getComputedStyle(n).overflowY;
    if ((oy === "auto" || oy === "scroll") && n.scrollHeight > n.clientHeight + 1) return n;
  }
  const root = document.scrollingElement;
  return root && root.scrollHeight > root.clientHeight + 1 ? root : null;
}

// Where the scrollport is visible, in viewport coordinates. The body and the
// root scroll the viewport itself; anything else is clipped to its own box and
// to the window. Either way the bottom stops at a fixed bar marked
// `data-fixed-bottom` (the phone's Walk-in / + New bar): rows under it are
// hidden, so the lowest row a finger can SEE must already be in the band.
export function scrollBounds(sc) {
  let top = 0, bottom = window.innerHeight;
  if (!(sc === document.body || sc === document.documentElement || sc === document.scrollingElement)) {
    const r = sc.getBoundingClientRect();
    top = Math.max(top, r.top);
    bottom = Math.min(bottom, r.bottom);
  }
  const bar = document.querySelector("[data-fixed-bottom]");
  if (bar) {
    const br = bar.getBoundingClientRect();
    if (br.height > 0) bottom = Math.min(bottom, br.top);
  }
  return { top, bottom };
}
