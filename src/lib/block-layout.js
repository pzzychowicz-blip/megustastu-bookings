// src/lib/block-layout.js
// v17.9.1 — what a timeline block can afford to show at its current width.
//
// ── Why this is a module and not four lines inside TimelineBlock ──────────────
// Everything on a block except the guest name is `flexShrink: 0`, so on a narrow
// block they do not compete for space — they overflow it, and the block's
// `overflow: hidden` clips them ON TOP OF ONE ANOTHER. The worst case is neither
// rare nor theoretical: a SEATED block is drawn at its LIVE duration, so every
// party that sits down starts a few pixels wide and grows, and the markers pile
// up for the first stretch of every visit.
//
// The fix is a priority ladder, and a priority ladder is exactly the kind of
// thing that regresses silently — someone adds a sixth flag, or reorders the
// rail for visual reasons, and the marker that disappears first on a crowded
// evening becomes the one that says a party is sitting in a table the next
// booking needs. The house rule is that logic worth a REFACTOR_LOG paragraph is
// worth being reachable by a test, so the DECISION lives here and TimelineView
// keeps the JSX. (Same reasoning as `waitlist-match.js` and `presence-state.js`,
// applied one level down: this decides pixels, not tables, but it decides them
// with a rule nobody can see by reading the render.)
//
// The widths themselves stay in `TimelineView.jsx` — they are measurements of
// that component's own DOM, and this module never needs to know them.

// ── The ladder ───────────────────────────────────────────────────────────────
// never dropped  the guest name (it truncates — that is what an ellipsis is
//                for) and the Assign handle (a control; losing a control because
//                a party sat down early is a different class of defect from
//                losing a marker)
// dropped 2nd    the party-size ring
// dropped 1st    the flags, one at a time, INFORMATIONAL FIRST
//
// `keep` is the drop priority: lowest survives longest. Deposit and preferred
// tables are facts about a booking; locked, repeat-no-show and overstaying are
// the exception states — which is v17.9.0's own argument for moving those flags
// out of the truncating label string, applied to width instead of to text.

/**
 * Decide what fits on a block of `blockPx`, given the fixed cost of the parts
 * that are never dropped.
 *
 * `fixedPx` is stated BY THE CALLER rather than assumed here, because the two
 * callers genuinely differ: a block reserves its Assign handle, while a waitlist
 * ghost has no handle but does carry an unconditional ⏳. Baking the block's
 * figure in and reusing it for the ghost would over-reserve on the ghost — reuse
 * dressed up as correctness.
 *
 * @param {number} blockPx  the block's rendered width in px
 * @param {number} fixedPx  width of the parts that never drop (name floor incl.)
 * @param {number} ringPx   width of the party-size ring + its margin
 * @param {number} flagPx   width of one flag icon + its margin
 * @param {Array<{k:string, keep:number}>} flags  active flags, in RAIL order
 * @returns {{showRing:boolean, flags:Array}} the same flag objects, rail order
 *          preserved, with the ones that do not fit removed
 */
export function visibleRail(blockPx, fixedPx, ringPx, flagPx, flags) {
  const list = flags || [];
  const room = blockPx - fixedPx;
  const showRing = room >= ringPx;
  const flagRoom = room - (showRing ? ringPx : 0);
  const n = Math.max(0, Math.min(list.length, Math.floor(flagRoom / flagPx)));
  if (n >= list.length) return { showRing, flags: list };
  // Choose by `keep`, then RESTORE rail order by filtering the original array
  // rather than returning the sorted slice. If this returned the sort's output,
  // the rendered sequence would quietly become priority order the first time a
  // block dropped a flag — so a wide block and a narrow one would disagree about
  // where the star lives.
  const kept = new Set(
    list.slice().sort((x, y) => x.keep - y.keep).slice(0, n).map((f) => f.k)
  );
  return { showRing, flags: list.filter((f) => kept.has(f.k)) };
}
