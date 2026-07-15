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
import { BTN } from "../lib/constants";

export function OverlapBanner({ warnings, bookings, onReassign, onDismiss, collapseMax = 2 }) {
  const byId = new Map(bookings.map(function (b) { return [b.id, b]; }));

  function renderRow(id) {
    const w = warnings[id];
    const sb = byId.get(id);
    if (!sb || !w) return null;
    const rowBg = w.overdue ? "var(--danger-bg)" : "var(--warn-bg)";
    const rowBrd = w.overdue ? "var(--danger-border)" : "var(--warn-border)";
    const rowTxt = w.overdue ? "var(--danger-text)" : "var(--warn-text)";
    const msg = sb.name + " (overstaying) → " + w.next + " at " + w.nextTime + (w.overdue ? " — overdue" : " — in " + w.gap + " min");
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap", padding: "8px 12px", borderRadius: 12, background: rowBg, border: "1px solid " + rowBrd, marginTop: 6 }}>
        <span style={{ fontSize: 13, color: rowTxt, fontWeight: 600, flex: "1 1 auto", minWidth: 0 }}>{msg}</span>
        <button
          onClick={function () { onReassign(w.nextId); }}
          className="mgt-hover-scale"
          style={mkBtn({ fontSize: 12, minHeight: 32, padding: "4px 12px", background: BTN.orange })}>{"Reassign " + w.next}</button>
        <button
          onClick={function () { onDismiss(id); }}
          aria-label="Dismiss this warning"
          className="mgt-hover-scale mgt-press"
          style={mkBtn({ fontSize: 12, minHeight: 32, padding: "4px 10px", background: BTN.dismiss })}>✕</button>
      </div>
    );
  }

  return (
    <BannerRows title="Overlap warnings" ids={Object.keys(warnings)} collapseMax={collapseMax} renderRow={renderRow} />
  );
}
