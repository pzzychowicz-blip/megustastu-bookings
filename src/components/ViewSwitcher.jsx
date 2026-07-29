// src/components/ViewSwitcher.jsx
//
// v17.5.0 — the Timeline / List / Plan buttons, extracted from App.jsx's inline
// .map so the Split View gesture and toolbar live with them rather than adding
// a fourth concern to a 2400-line render.
//
// ── Gestures ─────────────────────────────────────────────────────────────────
// Right-click (desktop) or press-and-hold 450ms (touch) on a view button opens
// SplitMenu — the same affordance as the timeline's / plan's quick-status, so
// there's one "hold for more" idea in the app rather than two.
//
// The hard part is CANCELLING the hold. SplitMenu portals a scrim to <body>
// ABOVE the button, so once it opens the button's own pointerup/click may never
// fire (CLAUDE.md: "A portalled scrim swallows the pointerup"). Relying on the
// button's pointerup to clear the timer would therefore leave it armed. So the
// timer is cleared from a WINDOW-level pointerup/pointercancel installed for
// the life of the press, plus the usual >8px move cancel.
//
// `didLongRef` suppresses the click that a touch-end would otherwise deliver
// after a completed hold — same flag, same purpose, as TimelineView's.
//
// Both gestures no-op entirely when split is disabled or on a phone; the plain
// left-click behaviour below is then exactly what App.jsx did before.

import { useRef, useEffect } from "react";
import { S, BTN } from "../lib/constants";
import { mkBtn, Presence } from "./atoms";

const ORD = ["timeline", "list", "plan"];
const HOLD_MS = 450;
const MOVE_CANCEL_PX = 8;

export function ViewSwitcher({
  view, split, focusedPane, splitEnabled, isMobile,
  onPickView,        // (v) — plain left-click / tap
  onOpenSplitMenu,   // (v) — RMB / long-press
  onSwapSides, onToggleDir, onExitSplit,
}) {
  const pressRef = useRef(null);
  const startRef = useRef(null);
  const didLongRef = useRef(false);
  const cleanupRef = useRef(null);

  // Clear any armed press if this unmounts mid-hold.
  useEffect(() => () => { if (cleanupRef.current) cleanupRef.current(); }, []);

  const gesturesOn = splitEnabled && !isMobile;

  function clearPress() {
    if (pressRef.current) { clearTimeout(pressRef.current); pressRef.current = null; }
    if (cleanupRef.current) { cleanupRef.current(); cleanupRef.current = null; }
    startRef.current = null;
  }

  function startPress(v, e) {
    if (!gesturesOn || e.pointerType !== "touch") return;
    clearPress();
    didLongRef.current = false;
    startRef.current = { x: e.clientX, y: e.clientY };
    // Window-level release listeners: see the header note — the popup's scrim
    // can swallow the button's own pointerup.
    const onUp = () => clearPress();
    const onMove = (ev) => {
      const s = startRef.current;
      if (!s) return;
      if (Math.abs(ev.clientX - s.x) > MOVE_CANCEL_PX || Math.abs(ev.clientY - s.y) > MOVE_CANCEL_PX) clearPress();
    };
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    window.addEventListener("pointermove", onMove);
    cleanupRef.current = () => {
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      window.removeEventListener("pointermove", onMove);
    };
    pressRef.current = setTimeout(() => {
      pressRef.current = null;
      didLongRef.current = true;
      clearPress();
      onOpenSplitMenu(v);
    }, HOLD_MS);
  }

  function onCtx(v, e) {
    if (!gesturesOn) return;
    e.preventDefault();
    clearPress();
    onOpenSplitMenu(v);
  }

  function handleClick(v) {
    // A completed hold already acted; the trailing click must not switch views.
    if (didLongRef.current) { didLongRef.current = false; return; }
    onPickView(v);
  }

  // Active = the accent fill. In a split BOTH panes' views are active, and the
  // focused one is the one keyboard shortcuts act on.
  function isActive(v) { return split ? (split.a === v || split.b === v) : view === v; }
  function isFocusedPaneView(v) { return !!split && split[focusedPane] === v; }

  const toolBtn = (extra) => mkBtn(Object.assign({ minHeight: 40, padding: "8px 10px", fontSize: 13, background: BTN.nav }, extra));

  return (
    <>
      {ORD.map((v) => (
        <button
          key={v}
          className="mgt-hover-scale"
          onClick={() => handleClick(v)}
          onContextMenu={(e) => onCtx(v, e)}
          onPointerDown={(e) => startPress(v, e)}
          onPointerUp={clearPress}
          onPointerCancel={clearPress}
          title={gesturesOn ? "Right-click or hold to add to a split view" : undefined}
          style={Object.assign(
            mkBtn({ background: isActive(v) ? S.accent : "var(--app-btn-grey)", textTransform: "capitalize", minHeight: 40 }),
            {
              WebkitTouchCallout: "none", WebkitUserSelect: "none", userSelect: "none",
              touchAction: "manipulation",
            },
            // In a split, an outline marks WHICH of the two active buttons the
            // keyboard is pointed at — the fill alone can't say that.
            isFocusedPaneView(v) ? { outline: "2px solid var(--text-on-accent)", outlineOffset: -4 } : null
          )}
        >{v}</button>
      ))}
      <Presence show={!!split} inClass="mgt-slide-in" outClass="mgt-slide-out" outMs={190} tag="span">
        <span style={{ display: "inline-flex", gap: 6 }}>
          <button className="mgt-hover-scale" onClick={onSwapSides}
            title="Swap the two views" aria-label="Swap the two views"
            style={toolBtn()}>⇄</button>
          <button className="mgt-hover-scale" onClick={onToggleDir}
            title={split && split.dir === "v" ? "Switch to top and bottom" : "Switch to side by side"}
            aria-label="Change split direction"
            style={toolBtn()}>{split && split.dir === "v" ? "⬓" : "◧"}</button>
          <button className="mgt-hover-scale" onClick={onExitSplit}
            title="Leave split view" aria-label="Leave split view"
            style={toolBtn({ background: BTN.dismiss })}>✕</button>
        </span>
      </Presence>
    </>
  );
}
