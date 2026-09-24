// src/hooks/useAlignLeft.js
// `useAlignLeft` — keep an element's LEFT edge over another element's left
// edge, as far as its own line allows. (v18.2.0)
//
// Written for the header's view switcher (Timeline / List / Plan), which
// Patryk asked to line up with the Summary card's left edge in the date row
// below it, and to FOLLOW that edge, gently, whenever the Summary's width
// changes. The edge moves more often than it looks: the Today pill and the
// waitlist pill appear to its left, and the date field is as wide as the date
// in it. Where the edge sits is a fact of layout, so it is MEASURED.
//
// Four decisions, each of which was the other way round in a first draft:
//
// 1. A TRANSFORM, not a margin. A margin is part of the flex item's outer
//    size, so a measured margin would feed back into where the header wraps:
//    it can push the switcher onto the next line, where the measurement then
//    says something else. A transform moves the paint and nothing else.
//
// 2. Written in the OBSERVER, not through React state. A ResizeObserver
//    callback runs after layout and before paint, so a style written there is
//    painted in the frame it measured. A setState from there renders in a
//    later task, after the paint, so the switcher would be drawn one frame at
//    its old position every time the header resized — a tremor while a window
//    is dragged. It also never re-renders the app. React never touches these
//    two properties, because the element's `style` prop does not name them.
//
// 3. The glide plays only when the TARGET moved and the switcher's own slot
//    did not. That is what it is for: the Summary's edge moving. When the
//    slot moves (the window resizes and the right-aligned header group moves
//    with it, or the split tools appear beside the switcher), the switcher
//    must stay where it is, over the Summary, so the new transform lands in
//    the same frame with no transition; with one, it would drift in behind
//    the window for 385ms. And when BOTH move — a resize that wraps the
//    header — the transition would start from the old transform in the NEW
//    slot, which is somewhere the switcher never was: measured at 900 → 700px,
//    it slid in from 36px off the left edge of the screen. A jump is honest
//    there, because everything around it jumps too.
//
// 4. A running glide is never cancelled by an unrelated observation.
//    `transition: none` cancels a running transition, jumping it to its end,
//    and unrelated notifications do arrive mid-glide (the title's hours line
//    changes with the viewed day), so nothing is written unless the
//    destination changed.
//
// The slot is read as the element's box minus the transform it has at that
// instant. Mid-glide both numbers are the interpolated ones, so the
// difference is exact. `offsetLeft` also ignores the transform, but it rounds
// to whole pixels, and the edges this lines up are fractional.
//
// `useLayoutEffect`, so the first position lands before the first paint, with
// no transition — the switcher does not slide into place on load.

import { useLayoutEffect } from "react";
import { M } from "../lib/constants";

// Pure, so the rule is testable without a DOM. All three are x positions in
// px: `target` the edge to line up with, `natural` where layout put the
// element, `floor` the leftmost it may go (the end of whatever precedes it on
// its line, plus that line's gap). Returns the translateX to apply.
//
// It moves LEFT only: whatever follows the element on its line sits right
// after it, so a shift right would run into it. When the target is out of
// reach it goes as close as it can.
export function alignShift(target, natural, floor) {
  return Math.min(natural, Math.max(floor, target)) - natural;
}

// The translateX applied right now. Mid-transition this is the interpolated
// value, which is also what getBoundingClientRect includes.
function shiftOf(el) {
  const t = getComputedStyle(el).transform;
  return !t || t === "none" ? 0 : new DOMMatrixReadOnly(t).m41;
}

// `subjectRef` is moved; `targetRef` is lined up with; `floorRef` is what
// precedes the subject on its line, if it shares one — on a line of its own
// the subject is already at the start of it, and stays there.
export function useAlignLeft(subjectRef, targetRef, floorRef) {
  useLayoutEffect(function () {
    const el = subjectRef.current, target = targetRef.current, before = floorRef.current;
    if (!el || !target) return undefined;
    let lastTo = null, lastNatural = null, lastDx = null;
    function measure() {
      const r = el.getBoundingClientRect();
      const natural = r.left - shiftOf(el);
      const to = target.getBoundingClientRect().left;
      let floor = natural;
      if (before) {
        const f = before.getBoundingClientRect();
        if (r.top < f.bottom) {
          const box = before.parentElement;
          floor = f.right + (box ? parseFloat(getComputedStyle(box).columnGap) || 0 : 0);
        }
      }
      const dx = alignShift(to, natural, floor);
      const glide = lastTo !== null && Math.abs(to - lastTo) > 0.5 && Math.abs(natural - lastNatural) < 0.5;
      lastTo = to;
      lastNatural = natural;
      if (lastDx !== null && Math.abs(dx - lastDx) < 0.5) return;
      lastDx = dx;
      el.style.transition = glide ? "transform " + M.shift : "none";
      el.style.transform = dx ? "translateX(" + dx + "px)" : "";
    }
    measure();
    if (typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(measure);
    [target, el, el.parentElement, before, before && before.parentElement].forEach(function (n) {
      if (n) ro.observe(n);
    });
    return function () { ro.disconnect(); };
  }, [subjectRef, targetRef, floorRef]);
}
