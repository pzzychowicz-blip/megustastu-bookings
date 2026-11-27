// src/hooks/useDragReorder.js — v18.19.1 (Patryk, 2026-11-27)
//
// Drag to reorder, for the lists in Settings → Layout whose order the optimiser
// reads (size, combo and swap rules, the tables in a zone, Prefer, Anchors and a
// join group's chips). One instance serves every list in a component, because
// only one drag runs at a time; each list has a name, and its items are siblings
// marked with `itemProps(list, idx, key)`.
//
// The gesture (Patryk's choice): a GRIP that drags the moment it is touched
// (`gripProps`), with `touch-action: none` on the grip only, so the rest of a
// row still scrolls the page and its steppers still tap. A press that does not
// travel DRAG_SLOP is nothing at all, so a tap on a grip only focuses it. With
// a keyboard, the arrow keys on a focused grip move the item one place.
//
// What the eye sees, in order:
//   · the item lifts (a shadow over its own ground, `liftStyle`) and follows the
//     finger, by an inline `transform`, along a column or across a chip row;
//   · the others slide to the slot it is over, a FLIP on `M.dur.move`, so the
//     list always shows the order a release would save (`slotAt`, lib/reorder.js,
//     from the boxes measured when the drag started);
//   · on release it SETTLES from under the finger into its slot, then the order
//     is saved, once (`onCommit(list, from, to)`); Escape, a lost capture or a
//     cancelled pointer eases it back to where it started and saves nothing.
// The settle comes before the save because a row keyed by index re-renders its
// content on the save, and a moving node that suddenly showed another row would
// be the one thing a person sees. Under reduced motion there is no FLIP and no
// settle (`reduceMotionOn`).
//
// The rules this keeps (src/CLAUDE.md, Gotchas):
//   · setPointerCapture on the GRIP, which has no child click targets;
//     `onLostPointerCapture` guarded on `e.target === e.currentTarget`;
//   · a mouse move with `buttons === 0` ends it (a scrim that ate the release);
//   · teardown first, dispatch last;
//   · `beginHold()` for the length of the drag, so iOS raises no selection UI;
//   · nothing reads a ref during render: the handlers read them at event time.
// The edge scroll is lib/edge-scroll.js's, as the Timeline drag uses it: a size
// rule is tall, and the Settings body scrolls.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { M, R } from "../lib/constants";
import { slotAt } from "../lib/reorder";
import { beginHold } from "../lib/holdSelection";
import { edgeVelocity, edgeStep, scrollParentY, scrollBounds } from "../lib/edge-scroll";
import { reduceMotionOn } from "../components/atoms";

// How far a press must travel before it is a drag: a finger's tremble is not.
const DRAG_SLOP = 4;

const listSel = function (list) { return '[data-reorder-list="' + list + '"]'; };

// The lifted look: the ground the row already sits on, so its text keeps the
// contrast it has at rest, and the popover's shadow. Rounded so the ground does
// not end in square corners over the rows it passes. The ground is the TWO
// layers a row sits on at rest, the Section's `--bg-soft` over the dialog's
// `--bg-sheet`: `--bg-soft` alone is 95% opaque in light and 5% in dark, and
// the row it passed over showed through it (seen on DEV).
export const liftStyle = {
  position: "relative", zIndex: 3,
  backgroundColor: "var(--bg-sheet)",
  backgroundImage: "linear-gradient(var(--bg-soft), var(--bg-soft))",
  boxShadow: "var(--shadow-popover)",
  borderRadius: R.inset
};

export function useDragReorder(opts) {
  const optsRef = useRef(opts);
  useEffect(function () { optsRef.current = opts; });
  const rootRef = useRef(null);
  // What renders: which list is being dragged, its item, and the slot it is over.
  const [drag, setDrag] = useState(null);
  const st = useRef(null);       // the live drag (read in handlers only)
  const snap = useRef(null);     // {list, rects} for the next FLIP pass
  const focusNext = useRef(null);// {list, key} to focus after a keyboard move

  // ── geometry ───────────────────────────────────────────────────────────────
  function items(list) {
    const root = rootRef.current;
    return root ? Array.prototype.slice.call(root.querySelectorAll(listSel(list))) : [];
  }
  function rel(el) {
    const r = el.getBoundingClientRect(), o = rootRef.current.getBoundingClientRect();
    return { left: r.left - o.left, top: r.top - o.top, width: r.width, height: r.height };
  }
  // The rects of a list's items as they are DRAWN now (a running slide
  // included), keyed by item key: where the next FLIP pass starts each one.
  function snapshot(list) {
    const rects = new Map();
    items(list).forEach(function (el) { rects.set(el.getAttribute("data-reorder-key"), rel(el)); });
    snap.current = { list: list, rects: rects };
    // A snapshot no render consumed (a save that was refused) must not start a
    // slide later, for some other change: it lives one frame.
    const mine = snap.current;
    requestAnimationFrame(function () { if (snap.current === mine) snap.current = null; });
  }

  // Where the dragged item should be drawn, from the pointer: root-relative, so
  // a scroll of the Settings body (which moves the root too) changes nothing.
  function place() {
    const d = st.current;
    if (!d || !d.layout || !rootRef.current) return;
    const o = rootRef.current.getBoundingClientRect();
    const x = d.ptr.x - o.left - d.grab.x, y = d.ptr.y - o.top - d.grab.y;
    const tx = d.axis === "y" ? 0 : x - d.layout.left;
    d.el.style.transform = "translate(" + tx + "px, " + (y - d.layout.top) + "px)";
    if (d.settling) return;
    const to = slotAt(d.others, { x: x + d.size.width / 2, y: y + d.size.height / 2 }, d.axis === "y" ? "y" : "wrap");
    if (to !== d.to) {
      snapshot(d.list);
      d.to = to;
      setDrag({ list: d.list, key: d.key, from: d.from, to: to });
    }
  }

  // ── the edge scroll ────────────────────────────────────────────────────────
  function edgeLoop(t) {
    const d = st.current;
    if (!d || d.settling) return;
    const sc = d.scroller;
    if (sc) {
      const b = scrollBounds(sc);
      const v = edgeVelocity(d.ptr.y, b.top, b.bottom);
      const dt = d.lastT ? Math.min(48, t - d.lastT) : 16;
      if (v) {
        const s = edgeStep(d.carry, v, dt);
        d.carry = s.carry;
        if (s.step) { sc.scrollTop += s.step; place(); }
      } else d.carry = 0;
    }
    d.lastT = t;
    d.raf = requestAnimationFrame(edgeLoop);
  }

  // ── ending ─────────────────────────────────────────────────────────────────
  function onEsc(e) {
    if (e.key !== "Escape" || !st.current) return;
    // Immediate as well: a listener on the same target is not stopped by
    // stopPropagation alone (src/CLAUDE.md, the capture-phase popup row).
    e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
    end(false);
  }
  // Teardown first, dispatch last: a throw in the save must not strand a row lifted.
  function finish() {
    const d = st.current;
    if (!d) return;
    st.current = null;
    if (d.onEsc) window.removeEventListener("keydown", d.onEsc, true);
    if (d.raf) cancelAnimationFrame(d.raf);
    d.el.style.transform = "";
    try { if (d.grip.hasPointerCapture && d.grip.hasPointerCapture(d.pointerId)) d.grip.releasePointerCapture(d.pointerId); } catch { /* already gone */ }
    if (d.commit && d.to !== d.from) optsRef.current.onCommit(d.list, d.from, d.to);
    setDrag(null);
  }
  // A release saves (`commit`); Escape, a lost capture or a cancel does not.
  function end(commit) {
    const d = st.current;
    if (!d) return;
    if (!d.active) { finish(); return; }
    if (d.settling) return;
    d.settling = true;
    d.commit = commit;
    if (!commit && d.to !== d.from) {
      // Back to where it started: the others slide home, and the layout pass
      // below starts the settle once the item's own slot is drawn again.
      snapshot(d.list);
      d.to = d.from;
      d.settleNext = true;
      setDrag({ list: d.list, key: d.key, from: d.from, to: d.from });
      return;
    }
    settle();
  }
  function settle() {
    const d = st.current;
    if (!d) return;
    const el = d.el, from = el.style.transform;
    el.style.transform = "";
    if (reduceMotionOn() || typeof el.animate !== "function" || !from) { finish(); return; }
    const a = el.animate([{ transform: from }, { transform: "translate(0px, 0px)" }], { duration: M.dur.move, easing: M.easeOut });
    a.onfinish = finish;
    a.oncancel = finish;
    // A hidden page runs no frames, so the settle would never finish and the
    // drop would wait to be saved until the page is shown again. `finish` runs
    // once (it clears the drag first), so whichever comes first saves.
    setTimeout(finish, M.dur.move + 120);
  }

  // ── after each render: slide the others, re-measure the lifted item ─────────
  useLayoutEffect(function () {
    const s = snap.current;
    if (s && rootRef.current) {
      snap.current = null;
      const d = st.current;
      const quiet = reduceMotionOn();
      items(s.list).forEach(function (el) {
        if (d && el === d.el) return;
        const was = s.rects.get(el.getAttribute("data-reorder-key"));
        if (!was || typeof el.animate !== "function") return;
        el.getAnimations().forEach(function (a) { a.cancel(); });
        const now = rel(el);
        const dx = was.left - now.left, dy = was.top - now.top;
        if (quiet || (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5)) return;
        el.animate([{ transform: "translate(" + dx + "px, " + dy + "px)" }, { transform: "translate(0px, 0px)" }], { duration: M.dur.move, easing: M.easeOut });
      });
    }
    const d = st.current;
    if (d && d.active) {
      const keep = d.el.style.transform;
      d.el.style.transform = "";
      d.layout = rel(d.el);
      d.el.style.transform = keep;
      place();
      if (d.settleNext) { d.settleNext = false; settle(); }
    }
    const f = focusNext.current;
    if (f && rootRef.current) {
      focusNext.current = null;
      const el = rootRef.current.querySelector(listSel(f.list) + '[data-reorder-key="' + f.key + '"] [data-reorder-grip]');
      if (el && document.activeElement !== el) el.focus({ preventScroll: true });
    }
  });

  // An unmount mid-drag (Settings closed) takes its listeners with it.
  useEffect(function () {
    return function () {
      const d = st.current;
      if (!d) return;
      st.current = null;
      if (d.onEsc) window.removeEventListener("keydown", d.onEsc, true);
      if (d.raf) cancelAnimationFrame(d.raf);
    };
  }, []);

  // ── what a caller spreads ──────────────────────────────────────────────────
  // On the grip: a <button>. `count` is the list's length (for the keys), `key`
  // the item's key (for the focus a keyboard move hands back).
  function gripProps(list, idx, count, key) {
    return {
      "data-reorder-grip": "",
      style: { touchAction: "none", cursor: drag && drag.list === list && drag.key === key ? "grabbing" : "grab" },
      onPointerDown: function (e) {
        if (st.current || (e.pointerType === "mouse" && e.button !== 0)) return;
        const grip = e.currentTarget;
        const el = grip.closest("[data-reorder-list]");
        if (!el || !rootRef.current) return;
        const all = items(list);
        const from = all.indexOf(el);
        if (from < 0) return;
        const boxes = all.map(rel);
        const r = el.getBoundingClientRect();
        st.current = {
          list: list, key: key, el: el, grip: grip, pointerId: e.pointerId,
          axis: (optsRef.current.axisOf && optsRef.current.axisOf(list)) || "y",
          from: from, to: from, active: false, settling: false,
          start: { x: e.clientX, y: e.clientY }, ptr: { x: e.clientX, y: e.clientY },
          grab: { x: e.clientX - r.left, y: e.clientY - r.top },
          size: { width: r.width, height: r.height },
          others: boxes.filter(function (_, i) { return i !== from; }),
          layout: boxes[from], scroller: null, raf: 0, carry: 0, lastT: 0
        };
        try { grip.setPointerCapture(e.pointerId); } catch { /* a pointer the browser already let go of */ }
      },
      onPointerMove: function (e) {
        const d = st.current;
        if (!d || e.pointerId !== d.pointerId) return;
        if (e.pointerType === "mouse" && e.buttons === 0) { end(false); return; }
        d.ptr = { x: e.clientX, y: e.clientY };
        if (!d.active) {
          if (Math.abs(e.clientX - d.start.x) < DRAG_SLOP && Math.abs(e.clientY - d.start.y) < DRAG_SLOP) return;
          d.active = true;
          beginHold();
          // Kept on the drag, so the render that ends it removes the SAME
          // function this render added (each render makes a new `onEsc`).
          d.onEsc = onEsc;
          window.addEventListener("keydown", d.onEsc, true);
          d.scroller = scrollParentY(rootRef.current);
          if (optsRef.current.onStart) optsRef.current.onStart(list);
          setDrag({ list: list, key: d.key, from: d.from, to: d.from });
          d.raf = requestAnimationFrame(edgeLoop);
        }
        place();
      },
      onPointerUp: function (e) { const d = st.current; if (d && e.pointerId === d.pointerId) end(true); },
      onPointerCancel: function (e) { const d = st.current; if (d && e.pointerId === d.pointerId) end(false); },
      onLostPointerCapture: function (e) {
        const d = st.current;
        if (e.target !== e.currentTarget || !d || e.pointerId !== d.pointerId || d.settling) return;
        end(false);
      },
      onKeyDown: function (e) {
        if (st.current || e.altKey || e.ctrlKey || e.metaKey) return;
        const axis = (optsRef.current.axisOf && optsRef.current.axisOf(list)) || "y";
        let dir = 0;
        if (e.key === "ArrowUp" || (axis !== "y" && e.key === "ArrowLeft")) dir = -1;
        else if (e.key === "ArrowDown" || (axis !== "y" && e.key === "ArrowRight")) dir = 1;
        if (!dir) return;
        e.preventDefault();
        e.stopPropagation();
        const to = idx + dir;
        if (to < 0 || to >= count) return;
        snapshot(list);
        focusNext.current = { list: list, key: key };
        optsRef.current.onCommit(list, idx, to);
      }
    };
  }

  // On each item: its list and key. `order` below is what the caller renders.
  function itemProps(list, key) {
    return { "data-reorder-list": list, "data-reorder-key": key };
  }
  // Is this item the one lifted? The caller adds `liftStyle` to it.
  function isLifted(list, key) {
    return !!(drag && drag.list === list && drag.key === key);
  }

  // The indices of a list of `count` in the order to draw them: the stored
  // order, or the preview while that list is dragged.
  function order(list, count) {
    const ids = [];
    for (let i = 0; i < count; i++) ids.push(i);
    if (!drag || drag.list !== list || drag.from === drag.to) return ids;
    const it = ids.splice(drag.from, 1)[0];
    ids.splice(drag.to, 0, it);
    return ids;
  }

  // The root as a CALLBACK ref, not the ref object: the React Compiler reads a
  // returned object holding a ref as a ref itself, and every `order(…)` call in
  // the caller's render then counted as reading a ref during render (ten
  // `react-hooks/refs` advisories, measured).
  function rootEl(el) { rootRef.current = el; }
  return { rootEl: rootEl, drag: drag, gripProps: gripProps, itemProps: itemProps, isLifted: isLifted, order: order, snapshot: snapshot };
}
