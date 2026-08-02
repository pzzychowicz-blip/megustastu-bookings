// src/components/SplitLayout.jsx
//
// v17.5.0 — the two-pane container behind Split View. Purely presentational:
// it receives the two already-built view ELEMENTS and arranges them, so it
// knows nothing about Timeline/List/Plan.
//
// It only works inside the `shellFixed` layout (see CLAUDE.md): both panes are
// `overflow:auto` with `minHeight:0`, which needs an ancestor chain that
// actually has a definite height. That is why entering a split forces the fixed
// shell rather than being an independent setting.
//
// Props:
//   dir            — "v" = side by side (flex row) · "h" = top and bottom
//   ratio          — 0.2…0.8, pane A's share
//   onRatio(r)     — committed on pointer-UP only, so localStorage isn't
//                    written once per animation frame during a drag
//   focused        — "a" | "b"; drives the corner marks and which pane the
//                    keyboard acts on
//   onFocus(pane)  — fired from a CAPTURE-phase pointerdown
//   paneA / paneB  — the view elements

import { useRef, useState } from "react";
import { R } from "../lib/constants";

const MIN_RATIO = 0.2;
const MAX_RATIO = 0.8;

// v17.5.0 correction — the focused pane is marked with four corner brackets
// instead of a full accent outline. A ring all the way round a pane reads as a
// second border on top of every card inside it and competes with the content;
// corners say the same thing at the edges, where there is nothing to compete
// with. Module scope so the array isn't rebuilt on every drag frame.
const MARK = 18;        // arm length
const RING = 2;         // stroke
// Must track the scroller's borderRadius (R.card, below) or the bracket arc
// stops lining up with the corner it traces. v17.7.0: both read the same token.
const MARK_R = "var(--r-card)";
const EDGE = RING + "px solid var(--accent)";
const CORNERS = [
  { k: "tl", style: { top: 0, left: 0, borderTop: EDGE, borderLeft: EDGE, borderTopLeftRadius: MARK_R } },
  { k: "tr", style: { top: 0, right: 0, borderTop: EDGE, borderRight: EDGE, borderTopRightRadius: MARK_R } },
  { k: "bl", style: { bottom: 0, left: 0, borderBottom: EDGE, borderLeft: EDGE, borderBottomLeftRadius: MARK_R } },
  { k: "br", style: { bottom: 0, right: 0, borderBottom: EDGE, borderRight: EDGE, borderBottomRightRadius: MARK_R } },
];

export function SplitLayout({ dir = "v", ratio = 0.5, onRatio, focused = "a", onFocus, paneA, paneB }) {
  const wrapRef = useRef(null);
  const draggingRef = useRef(false);
  // Local ratio so the drag is smooth without writing to localStorage per frame;
  // null = "no drag in progress, use the committed prop".
  const [dragRatio, setDragRatio] = useState(null);
  const r = dragRatio == null ? ratio : dragRatio;
  const row = dir === "v";

  function ratioFromEvent(e) {
    const el = wrapRef.current;
    if (!el) return null;
    const b = el.getBoundingClientRect();
    const raw = row ? (e.clientX - b.left) / b.width : (e.clientY - b.top) / b.height;
    return Math.max(MIN_RATIO, Math.min(MAX_RATIO, raw));
  }

  function onDividerDown(e) {
    // Primary button only. A non-primary press that opens a context menu would
    // otherwise arm a drag whose pointerup lands on the portalled menu scrim,
    // leaving the divider armed for the next stray move (the v17.0.0 round-8
    // lesson, CLAUDE.md's portalled-scrim row).
    if (e.pointerType === "mouse" && e.button !== 0) return;
    draggingRef.current = true;
    // Capturing on the DIVIDER is safe — it has no child click targets of its
    // own, which is the condition the setPointerCapture-kills-click gotcha is
    // actually about.
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    const next = ratioFromEvent(e);
    if (next != null) setDragRatio(next);
  }
  function onDividerMove(e) {
    if (!draggingRef.current) return;
    // A mouse move with no button held can't be a drag — belt-and-braces for a
    // pointerup we never saw.
    if (e.pointerType === "mouse" && e.buttons === 0) { endDrag(e, true); return; }
    const next = ratioFromEvent(e);
    if (next != null) setDragRatio(next);
  }
  // `fromEvent` false for pointercancel: that event carries no meaningful
  // release position, so the last position we actually tracked is the honest
  // answer there.
  function endDrag(e, fromEvent) {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    // v17.5.0 review fix: commit the ratio from the RELEASE event rather than
    // from `dragRatio`, which is render state. If a pointermove and the
    // pointerup ever land in one React batch, the closure here still holds the
    // previous move's value and the divider settles a step behind the finger.
    const fromRelease = fromEvent ? ratioFromEvent(e) : null;
    const commit = fromRelease != null ? fromRelease : dragRatio;
    if (commit != null && onRatio) onRatio(commit);
    setDragRatio(null);
  }

  function pane(node, key) {
    const isFocused = focused === key;
    return (
      // v17.5.0 correction — the pane is now a non-scrolling FRAME wrapping the
      // scroller, for two reasons:
      //  1. The focus marks must not scroll away with the content. An absolutely
      //     positioned child of a scroll container moves with the content; a
      //     child of the frame stays pinned to the pane's edges.
      //  2. It makes the hover-lift gutter self-scaling again. A percentage
      //     padding resolves against the CONTAINING BLOCK, which is now this
      //     frame (= exactly the pane), so a flat 4% is correct in both split
      //     directions. It previously resolved against the whole split row and
      //     had to be hand-scaled by the pane's share — which was only right for
      //     side-by-side and left top/bottom panes clipping the List cards.
      <div
        // Capture phase: a child that stops propagation must not be able to
        // swallow the focus change.
        onPointerDownCapture={() => { if (onFocus) onFocus(key); }}
        style={{
          position: "relative",
          flexBasis: (key === "a" ? r : 1 - r) * 100 + "%",
          flexGrow: 0, flexShrink: 1,
          minWidth: 0, minHeight: 0,
          display: "flex",
        }}
      >
        <div style={{
          flex: 1, minWidth: 0, minHeight: 0,
          overflow: "auto", WebkitOverflowScrolling: "touch",
          // Hover-lift gutter: a scrolling pane clips at its padding box, and
          // the List cards inside scale 1.08 on hover (= 4% of card width per
          // side), so without this the lift is cut off at the pane edge.
          paddingInline: "4%", paddingBlock: 12,
          borderRadius: R.card,
        }}>{node}</div>
        {CORNERS.map((c) => (
          <div key={c.k} style={Object.assign({
            position: "absolute", width: MARK, height: MARK,
            pointerEvents: "none",
            opacity: isFocused ? 1 : 0,
            transition: "opacity 160ms ease",
          }, c.style)} />
        ))}
      </div>
    );
  }

  return (
    <div
      ref={wrapRef}
      style={{
        display: "flex", flexDirection: row ? "row" : "column",
        flex: 1, minHeight: 0, gap: 0,
      }}
    >
      {pane(paneA, "a")}
      <div
        onPointerDown={onDividerDown}
        onPointerMove={onDividerMove}
        onPointerUp={(e) => endDrag(e, true)}
        onPointerCancel={(e) => endDrag(e, false)}
        onDoubleClick={() => { if (onRatio) onRatio(0.5); }}
        title="Drag to resize · double-click to reset"
        style={{
          flex: "0 0 auto",
          width: row ? 10 : "auto", height: row ? "auto" : 10,
          cursor: row ? "col-resize" : "row-resize",
          touchAction: "none",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}
      >
        {/* The visible rule is a thin inner bar so the 10px hit area stays
            comfortable on touch without looking like a 10px gutter. */}
        <div style={{
          width: row ? 2 : "70%", height: row ? "70%" : 2,
          borderRadius: 2,
          background: dragRatio != null ? "var(--accent)" : "var(--border-soft)",
          transition: "background 140ms ease",
        }} />
      </div>
      {pane(paneB, "b")}
    </div>
  );
}
