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
//   devices    (array)   — v17.3.0: live presence list from usePresence()
//                          [{key,email,ua,since}] — all connected tabs/devices
//   myKey      (string)  — v17.3.0: this connection's presence key ("This device")
//
// v16.2.0 review fix: the anchor side is MEASURED at open time, not guessed
// from isMobile. The dot's x position depends on header flex-wrap, not on
// viewport width — a left:0 popover from a right-edge dot ran 50px off-screen
// at 599px (isMobile true, header unwrapped). Prefer right-anchoring (grows
// leftward, the desktop look); flip to left-anchoring only when there's no
// room on the left. NB Scheduling's copy has the same latent bug — port this
// fix on its next touch (shared-pattern rule).

import { useEffect, useRef, useState } from "react";
import { S, R, BTN, M, T, FW } from "../lib/constants";
import { mkBtn, Presence } from "./atoms";

// Rendered popover width: minWidth 260 + 2×12 padding + 2×1 border.
const POPOVER_W = 286;

// v17.3.0: compact "connected since" — a relative string computed at render time
// (the popover only opens on click, so no ticking clock is needed).
// v17.8.0: `offset` is the `.info/serverTimeOffset` correction from usePresence.
// These timestamps are serverTimestamps, so on a device with clock skew a raw
// Date.now() comparison produces nonsense like "connected 3h ago" for a tab
// opened a minute ago — or a negative span rendered as "just now" forever.
function sinceText(ts, offset) {
  if (!ts) return "";
  // Negative spans (a stamp fractionally ahead of the corrected clock) fall
  // into this same branch — deliberately one test, not two.
  const mins = Math.floor((Date.now() + (offset || 0) - ts) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return mins + "m ago";
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + "h ago";
  return Math.floor(hrs / 24) + "d ago";
}

export function ConnectionStatus({ connected, hasConnected, userEmail, devices, myKey, onLogout, offset = 0 }) {
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

  // v17.5.1: three states, not two. `connected` (isOnline) starts optimistically
  // TRUE and only goes false after a handshake has succeeded at least once, so a
  // device that has NEVER connected used to show a confident green dot — the
  // single most misleading signal in the Android-tablet outage. `hasConnected`
  // separates "still connecting" from "connected", so the dot can no longer
  // claim a connection the app has never had.
  const connecting = !hasConnected && connected;
  const dotColor = connecting ? "var(--status-connecting)" : connected ? "var(--status-online)" : "var(--status-offline)";
  const dotGlow = connecting ? "var(--status-connecting-glow)" : connected ? "var(--status-online-glow)" : "var(--status-offline-glow)";
  const statusText = connecting ? "Connecting…" : connected ? "Connected" : "Connection lost";
  // v17.3.0: this device first, then most-recently-connected — so "This device"
  // sits at the top of the list.
  const deviceList = (devices || []).slice().sort(function (a, b) {
    if ((a.key === myKey) !== (b.key === myKey)) return a.key === myKey ? -1 : 1;
    return (b.since || 0) - (a.since || 0);
  });

  return (
    <div ref={wrapRef} style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
      <button
        type="button"
        className="mgt-hover-scale"
        onClick={toggleOpen}
        title={connecting ? "Connecting to Firebase…" : connected ? "Connected to Firebase" : "Firebase connection lost"}
        aria-label={connecting ? "Connecting to Firebase" : connected ? "Connected to Firebase" : "Firebase connection lost"}
        style={{
          appearance: "none",
          border: "none",
          background: "transparent",
          // v17.7.0: this button MUST carry its own radius. It is the app's only
          // .mgt-hover-scale element with no background of its own, so it was the
          // sole consumer of the `border-radius: 12px` the hover rule used to
          // supply — and that declaration is gone now (it squared off every
          // pill). Without a resting radius the hover state paints its opaque
          // --bg-hover-card as a hard-edged RECTANGLE behind the round dot.
          // R.pill rather than "50%". v17.8.0 made the box SQUARE at 44 (it was
          // 24x40 — a 24px-wide target for the control that opens the device
          // list and Log out), so the pill now clamps to half of 44 and this is
          // finally a true circle rather than the vertical egg the old
          // width/height mismatch produced.
          borderRadius: R.pill,
          padding: 0,
          cursor: "pointer",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          lineHeight: 0,
          width: 44,
          height: 44,
        }}
      >
        <span
          style={{
            display: "inline-block",
            width: 12,
            height: 12,
            borderRadius: "50%",
            backgroundColor: dotColor,
            // Soft glow in the matching colour so it reads as "illuminated".
            boxShadow: "0 0 0 3px " + dotGlow,
            // Green -> amber -> red used to be a hard cut, which is the one way
            // to change a always-visible indicator that nobody notices: a static
            // thing that is a different colour than it was reads as having always
            // been that colour. Motion is what makes a glance catch it, and 200ms
            // is not a delay — the state has already changed, this is only how it
            // is drawn.
            transition: "background-color " + M.move + ", box-shadow " + M.move,
          }}
        />
      </button>

      {/* v17.8.0: the popover appears and disappears through Presence rather
          than a bare `open ?` — it never had an entrance, which stopped being
          survivable once every other surface in the app eased. mgt-card-in /
          -out are reused rather than invented: they fade and translateY(8px),
          which on a top-anchored popover reads as it dropping out of the dot,
          exactly the motion this needs. outMs must match --t-move (240ms) or
          the node unmounts mid-animation.
          Presence renders the positioned element ITSELF (its `style` prop) —
          no extra wrapper, so `wrapRef.current.contains()` and the absolute
          anchoring are untouched. */}
      <Presence
        show={open}
        inClass="mgt-card-in"
        outClass="mgt-card-out"
        outMs={240}
        style={{
          position: "absolute",
          top: "calc(100% + 8px)",
          right: alignRight ? 0 : "auto",
          left: alignRight ? "auto" : 0,
          zIndex: 30,
          minWidth: 260,
          padding: 12,
          background: "var(--bg-ac-menu)",
          border: "1px solid var(--border-card)",
          borderRadius: R.card,
          boxShadow: "var(--shadow-sheet)",
        }}
      >
        {open ? (
          <>
          {/* v17.8.0: Log out moved OFF the header row and in here, right-aligned
              on the status line. It belongs with the identity this popover
              already shows ("Signed in as" sits two rows below), and the header
              — ViewSwitcher · Walk-in · + New · the dot — was wrapping to a
              third row on a phone with it there. */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
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
              <span style={{ fontSize: T.body, fontWeight: FW.semi, color: S.text }}>
                {statusText}
              </span>
            </div>
            {onLogout ? (
              <button
                type="button"
                className="mgt-hover-scale"
                onClick={onLogout}
                style={mkBtn({ fontSize: T.body, minHeight: 32, padding: "6px 12px", background: BTN.nav })}
              >
                Log out
              </button>
            ) : null}
          </div>
          <div style={{ fontSize: T.small, marginBottom: 8, color: S.muted }}>
            {connecting
              ? "Establishing the first connection to the Realtime Database…"
              : connected
                ? "Realtime Database is connected."
                : "Lost connection to the Realtime Database. Changes will sync when it reconnects."}
          </div>
          <div style={{ borderTop: "1px solid var(--border-soft)", paddingTop: 8 }}>
            <div style={{ fontSize: T.small, marginBottom: 2, color: S.muted }}>Signed in as</div>
            <div style={{ fontSize: T.body, color: S.text, wordBreak: "break-all" }}>
              {userEmail || "—"}
            </div>
          </div>
          {deviceList.length ? (
            <div style={{ borderTop: "1px solid var(--border-soft)", marginTop: 8, paddingTop: 8 }}>
              <div style={{ fontSize: T.small, marginBottom: 6, color: S.muted }}>
                {"Connected device" + (deviceList.length === 1 ? "" : "s") + " (" + deviceList.length + ")"}
              </div>
              <div style={{ maxHeight: 200, overflowY: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
                {deviceList.map(function (d) {
                  const mine = d.key === myKey;
                  return (
                    <div key={d.key} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span
                        style={{
                          display: "inline-block", width: 7, height: 7, borderRadius: "50%",
                          background: "var(--status-online)", flexShrink: 0,
                        }}
                      />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: T.body, color: S.text, wordBreak: "break-all" }}>{d.email}</div>
                        <div style={{ fontSize: T.small, color: S.muted }}>
                          {d.ua + (sinceText(d.since, offset) ? "  ·  " + sinceText(d.since, offset) : "")}
                        </div>
                      </div>
                      {mine ? (
                        // v17.8.0: text, not a pill. Every other thing in this
                        // popover is plain text on a quiet pane, and "this one
                        // is you" is a marker, not a state — the row's own dot
                        // is the only status the line has to carry.
                        <span
                          style={{
                            fontSize: T.micro, fontWeight: FW.bold, color: "var(--text-secondary)",
                            letterSpacing: "0.03em", flexShrink: 0, whiteSpace: "nowrap",
                          }}
                        >
                          This device
                        </span>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}
          </>
        ) : null}
      </Presence>
    </div>
  );
}
