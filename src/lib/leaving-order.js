// src/lib/leaving-order.js
//
// v18.3.2 (O3) — `placeLeaving(liveIds, renderIds, prevOrder)`: the order to
// draw a list in while some of its rows are folding away.
//
// `useRevealRows` keeps a departed row mounted until its collapse finishes, but
// its `renderIds` are in ARRIVAL order, and a list sorted by anything else has
// to put the leaving row back where it was, or it jumps before it folds.
// DESIGN.md's rule for that was "rank a departed row half a step above its
// replacement" (`rank - 0.5`, NotificationStrip's `rankOf`). That compares a
// departed row's OLD index with the live rows' NEW ones, which is right for one
// departure and wrong for two: [A, B, C, D, E] losing B and D leaves C at 1 and
// E at 2, so D (3 - 0.5) sorts after E. The List loses several cards in one
// commit whenever the close-time auto-complete runs.
//
// So a leaving row is anchored to its PREDECESSOR instead: it goes straight
// after the nearest row drawn before it last time that is still drawn now, or
// first if there is none. Leaving rows are placed in the order they were last
// drawn, so a run of them keeps its order, and one placed earlier can anchor the
// next. For a single departure this is the same answer as `rank - 0.5`.
//
//   liveIds    the list as it is now, in its own order
//   renderIds  useRevealRows' mounted ids: live rows plus the leaving ones
//   prevOrder  what this returned the last time its inputs changed, i.e. the
//              order on screen (hooks/useLeavingOrder.js remembers it)
//
// A live id that is not mounted yet is left out: useRevealRows adds a newcomer
// one commit later, and drawing it before then would mount its Reveal closed.
// A leaving id missing from `prevOrder` (never drawn) goes last.

export function placeLeaving(liveIds, renderIds, prevOrder) {
  const mounted = new Set(renderIds);
  const live = new Set(liveIds);
  const out = liveIds.filter(function (id) { return mounted.has(id); });
  const leaving = renderIds.filter(function (id) { return !live.has(id); });
  if (!leaving.length) return out;
  const was = new Map();
  prevOrder.forEach(function (id, i) { was.set(id, i); });
  const at = function (id) { return was.has(id) ? was.get(id) : Infinity; };
  leaving.sort(function (a, b) { return at(a) - at(b); });
  leaving.forEach(function (id) {
    let pos = out.length;
    if (was.has(id)) {
      pos = 0;
      for (let j = was.get(id) - 1; j >= 0; j--) {
        const k = out.indexOf(prevOrder[j]);
        if (k >= 0) { pos = k + 1; break; }
      }
    }
    out.splice(pos, 0, id);
  });
  return out;
}
