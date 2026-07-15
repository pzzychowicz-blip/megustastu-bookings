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

import { BannerRows } from "./BannerRows";
import { Presence, mkBtn } from "./atoms";
import { lateMins } from "../lib/booking-logic";
import { BTN } from "../lib/constants";

export function LateBanner({ lateMap, bookings, nowMins, onNoShow, onDismiss, collapseMax = 2 }) {
  // v17.0.0 review fix #6: the collapsible/Reveal scaffolding moved to the
  // shared BannerRows shell (also used by OverlapBanner); this file supplies
  // only the row content. The No-show button (offerNoShow = lateMap[id]===
  // "noshow", read live) slides in via Presence, matching the Today button.
  const byId = new Map(bookings.map(function (b) { return [b.id, b]; }));

  function renderRow(id) {
    const b = byId.get(id);
    if (!b) return null;
    const offerNoShow = lateMap[id] === "noshow";
    return (
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
    );
  }

  return (
    <BannerRows title="Running late" ids={Object.keys(lateMap)} collapseMax={collapseMax} renderRow={renderRow} />
  );
}
