// src/components/LateBanner.jsx
// v16.1.1: the "Running late" banner — one row per TODAY'S confirmed booking that
// is past its start time (driven by App's lateMap: {id: "warn"|"noshow"}).
//
// Each ROW eases in AND out via Reveal — the mount/unmount lifecycle lives in
// the shared useRevealRows hook (v16.3.0; was inlined here since v16.1.1). See
// that hook for the renderIds/openIds/sig mechanism.
//
// The No-show button (offerNoShow = lateMap[id]==="noshow", read live from the
// prop) slides in via Presence, matching the Today button. onNoShow(id) →
// doCancelBooking(id, true).
//
// v16.3.0: (1) the banner is COLLAPSIBLE (open by default) — the header row is a
// click-toggle (Summary's ▲/▼ pattern) and the rows wrap in an outer <Reveal>
// (nested Reveals are fine — each clips only while animating). (2) each row gains
// an ✕ dismiss button (right of No-show, both warn+noshow stages) → onDismiss(id).
// Dismissed ids live in BookingApp (`lateDismissed`, session-only) because the
// whole banner must collapse when the last row is dismissed — the lateMap prop
// here is already the DISMISS-FILTERED map (the list/timeline amber highlights
// read the unfiltered one).

import { useState } from "react";
import { Reveal, Presence, mkBtn } from "./atoms";
import { lateMins } from "../lib/booking-logic";
import { BTN } from "../lib/constants";
import { useRevealRows } from "../hooks/useRevealRows";

export function LateBanner({ lateMap, bookings, nowMins, onNoShow, onDismiss }) {
  // v16.4.0 (Patryk): collapsed BY DEFAULT when more than 2 bookings are late —
  // a long list shouldn't shove the grid down. ≤2 stays expanded. Initial-only
  // (session state): it won't auto-re-collapse if the count later crosses 2.
  const [open, setOpen] = useState(function () { return Object.keys(lateMap).length <= 2; });
  // v16.3.0: per-row ease-in/out lifecycle extracted to useRevealRows (shared
  // with WaitAvailBanner). Was inlined here since v16.1.1.
  const { renderIds, openIds } = useRevealRows(Object.keys(lateMap));

  if (renderIds.length === 0) return null;
  const byId = new Map(bookings.map(function (b) { return [b.id, b]; }));
  const liveCount = Object.keys(lateMap).length; // currently-late rows (renderIds may hold departing ones)

  return (
    <div style={{ background: "var(--app-overlap-bg)", border: "2px solid var(--app-overlap-border)", borderRadius: 14, padding: "10px 14px", marginBottom: 10, boxShadow: "0 1px 4px rgba(0,0,0,0.04)" }}>
      <button
        onClick={function () { setOpen(!open); }}
        aria-expanded={open}
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, width: "100%", background: "transparent", border: "none", cursor: "pointer", padding: 0, textAlign: "left" }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: "var(--warn-text)", marginBottom: 2 }}>{"Running late · " + liveCount}</span>
        <span style={{ fontSize: 11, color: "var(--warn-text)", fontWeight: 700, flexShrink: 0 }}>{open ? "▲" : "▼"}</span>
      </button>
      <Reveal show={open}>
        <div>
          {renderIds.map(function (id) {
            const b = byId.get(id);
            const offerNoShow = lateMap[id] === "noshow";
            return (
              <Reveal key={id} show={openIds.has(id)}>
                {b ? (
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap", padding: "8px 12px", borderRadius: 12, background: "var(--warn-bg)", border: "1px solid var(--warn-border)", marginTop: 6 }}>
                    <span style={{ fontSize: 13, color: "var(--warn-text)", fontWeight: 600, flex: "1 1 auto", minWidth: 0 }}>{b.name + " (" + b.time + ") — " + lateMins(b, nowMins) + " min late"}</span>
                    <Presence show={offerNoShow} inClass="mgt-slide-in" outClass="mgt-slide-out" outMs={190} tag="span">
                      <button
                        onClick={function () { onNoShow(id); }}
                        className="mgt-hover-scale"
                        style={mkBtn({ fontSize: 12, minHeight: 32, padding: "4px 12px", background: BTN.orange })}>No show</button>
                    </Presence>
                    <button
                      onClick={function () { onDismiss(id); }}
                      aria-label="Dismiss this alert"
                      className="mgt-hover-scale mgt-press"
                      style={mkBtn({ fontSize: 12, minHeight: 32, padding: "4px 10px", background: BTN.dismiss })}>✕</button>
                  </div>
                ) : null}
              </Reveal>
            );
          })}
        </div>
      </Reveal>
    </div>
  );
}
