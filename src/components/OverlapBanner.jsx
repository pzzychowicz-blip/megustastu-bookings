// src/components/OverlapBanner.jsx
// v17.0.0 round 7: the Overlap-warnings banner — Patryk: "all banners must
// follow the Running late banner and be adjustable the same way in Settings".
// v17.0.0 review fix #6: the collapsible/Reveal scaffolding now lives in the
// shared BannerRows shell; this file supplies only the row content.
//   • one Reveal-eased row per overstay warning (BannerRows / useRevealRows);
//   • per-row Reassign + ✕ dismiss → onDismiss(id) (session-only Set in
//     BookingApp, like lateDismissed — the map is pre-filtered by the parent);
//   • the master enable switch lives in Settings → General → Alert banners
//     (settings/bookingDefaults.overlapWarnEnabled — gated in App, not here).
//
// Props:
//   warnings    — App's DISMISS-FILTERED overlapWarnings map
//                 ({seatedId: {next, nextId, nextTime, gap, overdue}})
//   bookings    — full list (name lookup for the seated booking)
//   onReassign  — reassignBooking(nextId)
//   onDismiss   — dismiss one row (seatedId)
//   collapseMax — rows above this start collapsed (default 2)

import { BannerRows } from "./BannerRows";
import { mkBtn } from "./atoms";
import { BTN, T, FW, IC, H } from "../lib/constants";
import { CloseIcon } from "./Icons";

export function OverlapBanner({ warnings, bookings, onReassign, onDismiss, }) {
  const byId = new Map(bookings.map(function (b) { return [b.id, b]; }));

  function renderRow(id) {
    const w = warnings[id];
    const sb = byId.get(id);
    if (!sb || !w) return null;
    const rowTxt = w.overdue ? "var(--danger-text)" : "var(--warn-text)";
    const msg = sb.name + " (overstaying) → " + w.next + " at " + w.nextTime + (w.overdue ? " — overdue" : " — in " + w.gap + " min");
    // v17.15.6: the ✕ names its booking (see LateBanner for the rule and why a
    // banner row, unlike a List card, has no ancestor to inherit from). The
    // Reassign button below needs nothing — `w.next` is the incoming party's
    // name, so its VISIBLE text already differs per row.
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap", padding: "8px 0" }}>
        <span style={{ fontSize: T.body, color: rowTxt, fontWeight: FW.semi, flex: "1 1 auto", minWidth: 0 }}>{msg}</span>
        <button
          onClick={function () { onReassign(w.nextId); }}
          className="mgt-hover-scale"
          style={mkBtn({ fontSize: T.body, minHeight: H.chrome, padding: "4px 12px", background: BTN.orange })}>{"Reassign " + w.next}</button>
        <button
          onClick={function () { onDismiss(id); }}
          aria-label={"Dismiss the overstay warning for " + (sb.name || "(no name)")}
          className="mgt-hover-scale mgt-press"
          style={mkBtn({ fontSize: T.body, width: H.chrome, height: H.chrome, minHeight: H.chrome, padding: 0, display: "inline-flex", alignItems: "center", justifyContent: "center", background: BTN.dismiss })}><CloseIcon size={IC.control} /></button>
      </div>
    );
  }

  return (
    <BannerRows ids={Object.keys(warnings)} renderRow={renderRow} />
  );
}
