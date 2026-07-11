// src/components/ConnectionStatus.jsx
// v16.2.0 — Firebase connection-status dot for the header, sat to the right of
// the Log-out button. Ported from the MGT Scheduling sibling app (same repo
// conventions) — kept structurally identical so the two stay in sync; only the
// design tokens are remapped to Bookings' names.
//
// A round indicator that illuminates GREEN when the Realtime Database socket is
// connected and RED when it's disrupted (driven by usePersistence's isOnline,
// itself from `.info/connected`). Clicking it opens a small popover with the
// connection status AND the currently signed-in user's email.
//
// Anchored via a relative wrapper + absolute popover. Closes on outside-click
// + Esc.
//
// Props:
//   connected  (bool)    — isOnline from usePersistence()
//   userEmail  (string)  — currently signed-in user's email
//
// v16.2.0 review fix: the anchor side is MEASURED at open time, not guessed
// from isMobile. The dot's x position depends on header flex-wrap, not on
// viewport width — a left:0 popover from a right-edge dot ran 50px off-screen
// at 599px (isMobile true, header unwrapped). Prefer right-anchoring (grows
// leftward, the desktop look); flip to left-anchoring only when there's no
// room on the left. NB Scheduling's copy has the same latent bug — port this
// fix on its next touch (shared-pattern rule).

import { useEffect, useRef, useState } from "react";
import { S } from "../lib/constants";

// Rendered popover width: minWidth 220 + 2×12 padding + 2×1 border.
const POPOVER_W = 246;

export function ConnectionStatus({ connected, userEmail }) {
  const [open, setOpen] = useState(false);
  const [alignRight, setAlignRight] = useState(true);
  const wrapRef = useRef(null);

  function toggleOpen() {
    const node = wrapRef.current;
    if (node) {
      const r = node.getBoundingClientRect();
      // right-anchored popover spans [r.right − POPOVER_W, r.right] — keep it
      // unless that runs past the left viewport edge (8px margin).
      setAlignRight(r.right - POPOVER_W >= 8);
    }
    setOpen(function (v) { return !v; });
  }

  // Close on outside-click + Esc.
  useEffect(function () {
    if (!open) return undefined;
    function onDocMouseDown(e) {
      const node = wrapRef.current;
      if (node && !node.contains(e.target)) setOpen(false);
    }
    function onKey(e) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocMouseDown);
    document.addEventListener("keydown", onKey);
    return function () {
      document.removeEventListener("mousedown", onDocMouseDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const dotColor = connected ? "var(--status-online)" : "var(--status-offline)";
  const dotGlow = connected ? "var(--status-online-glow)" : "var(--status-offline-glow)";
  const statusText = connected ? "Connected" : "Connection lost";

  return (
    <div ref={wrapRef} style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
      <button
        type="button"
        className="mgt-hover-scale"
        onClick={toggleOpen}
        title={connected ? "Connected to Firebase" : "Firebase connection lost"}
        aria-label={connected ? "Connected to Firebase" : "Firebase connection lost"}
        style={{
          appearance: "none",
          border: "none",
          background: "transparent",
          padding: 6,
          cursor: "pointer",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          lineHeight: 0,
          minHeight: 40,
        }}
      >
        <span
          style={{
            display: "inline-block",
            width: 12,
            height: 12,
            borderRadius: "50%",
            background: dotColor,
            // Soft glow in the matching colour so it reads as "illuminated".
            boxShadow: "0 0 0 3px " + dotGlow,
          }}
        />
      </button>

      {open ? (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 8px)",
            right: alignRight ? 0 : "auto",
            left: alignRight ? "auto" : 0,
            zIndex: 30,
            minWidth: 220,
            padding: 12,
            background: "var(--bg-sheet)",
            border: "1px solid var(--border-card)",
            borderRadius: 12,
            boxShadow: "var(--shadow-sheet)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <span
              style={{
                display: "inline-block",
                width: 10,
                height: 10,
                borderRadius: "50%",
                background: dotColor,
                flexShrink: 0,
              }}
            />
            <span style={{ fontSize: 13, fontWeight: 600, color: S.text }}>
              {statusText}
            </span>
          </div>
          <div style={{ fontSize: 11, marginBottom: 8, color: S.muted }}>
            {connected
              ? "Realtime Database is connected."
              : "Lost connection to the Realtime Database. Changes will sync when it reconnects."}
          </div>
          <div style={{ borderTop: "1px solid var(--border-soft)", paddingTop: 8 }}>
            <div style={{ fontSize: 11, marginBottom: 2, color: S.muted }}>Signed in as</div>
            <div style={{ fontSize: 13, color: S.text, wordBreak: "break-all" }}>
              {userEmail || "—"}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
