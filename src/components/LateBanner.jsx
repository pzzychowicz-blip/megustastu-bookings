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
import { BTN, T, FW, IC, H } from "../lib/constants";
import { CloseIcon, NoShowIcon } from "./Icons";

export function LateBanner({ lateMap, bookings, nowMins, onNoShow, onDismiss, }) {
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
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap", padding: "8px 0" }}>
        <span style={{ fontSize: T.body, color: "var(--warn-text)", fontWeight: FW.semi, flex: "1 1 auto", minWidth: 0 }}>{b.name + " (" + b.time + ") — " + lateMins(b, nowMins) + " min late"}</span>
        <Presence show={offerNoShow} inClass="mgt-slide-in" outClass="mgt-slide-out" tag="span">
          <button
            onClick={function () { onNoShow(id); }}
            className="mgt-hover-scale"
            style={mkBtn({ fontSize: T.body, minHeight: H.chrome, padding: "4px 12px", background: BTN.orange, display: "inline-flex", alignItems: "center", gap: 6 })}><NoShowIcon size={IC.control} />No show</button>
        </Presence>
        <button
          onClick={function () { onDismiss(id); }}
          aria-label="Dismiss this alert"
          className="mgt-hover-scale mgt-press"
          style={mkBtn({ fontSize: T.body, width: H.chrome, height: H.chrome, minHeight: H.chrome, padding: 0, display: "inline-flex", alignItems: "center", justifyContent: "center", background: BTN.dismiss })}><CloseIcon size={IC.control} /></button>
      </div>
    );
  }

  return (
    <BannerRows ids={Object.keys(lateMap)} renderRow={renderRow} />
  );
}
