// src/hooks/useSharesLine.js
// `useSharesLine` — does flex item `b` sit on the SAME flex line as item `a`,
// in a row that wraps? (v18.2.0)
//
// Written for the date-nav row, whose date controls are nudged down by
// DATE_CTRL_DROP to sit centred against the collapsed Summary card BESIDE them.
// That nudge assumed the Summary never wraps below the controls at 600px and
// up, and it does — from 600 to ~680px it always did, and wider still with the
// Today or waitlist pill showing — so the controls were pushed 9px down into
// the gap and 1px INTO the Summary card below them (measured at 668px: the
// controls' bottom 165, the card's top 164), with 21px above them against 8
// below. Where the Summary sits is a fact of layout, decided by the widths of
// three siblings, the viewed date and the day's numbers — no breakpoint can
// state it, so it is MEASURED, not assumed.
//
// Returns `{ same, settled }`:
//   same    — true / false once measured; null before the first measurement.
//   settled — false for the FIRST measurement only. A caller that transitions
//             on `same` switches its transition on with `settled`, so the
//             value it paints first never animates in from the unmeasured
//             guess: a style that changes in the same recalc as its
//             `transition` takes the NEW transition, so "none" on that first
//             change is what keeps the date controls from sliding 9px on load.
//
// ONE ResizeObserver, on the ROW: a line break always changes the row's height
// (one line against two), and a width change is the other way a break
// happens, so the row's box is the one thing whose size moves whenever the
// answer can. Every other notification — the Summary opening, a resize that
// breaks nothing — measures and hands back the same object, which React drops.
//
// `useLayoutEffect`, so the first answer lands before the first paint.

import { useLayoutEffect, useState } from "react";

// Pure, so the rule is testable without a DOM. offsetTop / offsetHeight rather
// than getBoundingClientRect, because the thing being decided is a TRANSFORM on
// `a`, and offset* ignores transforms — a measurement that included the nudge
// would feed back into whether to apply it. Both items share an offsetParent
// (they are siblings), so their offsetTops are comparable.
export function sharesLine(a, b) {
  return b.offsetTop < a.offsetTop + a.offsetHeight;
}

export function useSharesLine(rowRef, aRef, bRef) {
  const [state, setState] = useState({ same: null, settled: false });
  useLayoutEffect(function () {
    const row = rowRef.current, a = aRef.current, b = bRef.current;
    if (!row || !a || !b) return undefined;
    let first = true;
    function measure() {
      const same = sharesLine(a, b);
      const settled = !first;
      first = false;
      setState(function (prev) {
        return prev.same === same && prev.settled === settled ? prev : { same: same, settled: settled };
      });
    }
    measure();
    if (typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(row);
    return function () { ro.disconnect(); };
  }, [rowRef, aRef, bRef]);
  return state;
}
