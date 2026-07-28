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
//   focused        — "a" | "b"; drives the ring and which pane the keyboard acts on
//   onFocus(pane)  — fired from a CAPTURE-phase pointerdown
//   paneA / paneB  — the view elements

import { useRef, useState } from "react";

const MIN_RATIO = 0.2;
const MAX_RATIO = 0.8;

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
    if (e.pointerType === "mouse" && e.buttons === 0) { endDrag(e); return; }
    const next = ratioFromEvent(e);
    if (next != null) setDragRatio(next);
  }
  function endDrag(e) {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    if (dragRatio != null && onRatio) onRatio(dragRatio);
    setDragRatio(null);
  }

  function pane(node, key) {
    const isFocused = focused === key;
    return (
      <div
        // Capture phase: a child that stops propagation must not be able to
        // swallow the focus change.
        onPointerDownCapture={() => { if (onFocus) onFocus(key); }}
        style={{
          flexBasis: (key === "a" ? r : 1 - r) * 100 + "%",
          flexGrow: 0, flexShrink: 1,
          minWidth: 0, minHeight: 0,
          overflow: "auto", WebkitOverflowScrolling: "touch",
          borderRadius: 14,
          outline: isFocused ? "2px solid var(--accent)" : "2px solid transparent",
          outlineOffset: -2,
          transition: "outline-color 160ms ease",
        }}
      >{node}</div>
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
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
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
