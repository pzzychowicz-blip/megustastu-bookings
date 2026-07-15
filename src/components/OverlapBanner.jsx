// src/components/OverlapBanner.jsx
// v17.0.0 round 7: the Overlap-warnings banner converted to the Running-late
// (LateBanner) pattern — Patryk: "all banners must follow the Running late
// banner and be adjustable the same way in Settings".
//   • collapsible header with a live count (▲/▼, Summary pattern);
//   • default-COLLAPSED when more rows than `collapseMax` (the shared
//     settings/general lateCollapseMax — initial-only, no auto-recollapse);
//   • one Reveal-eased row per overstay warning (useRevealRows lifecycle);
//   • per-row ✕ dismiss → onDismiss(id) (session-only Set in BookingApp,
//     like lateDismissed — the banner map is pre-filtered by the parent);
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

import { useState } from "react";
import { Reveal, mkBtn } from "./atoms";
import { BTN } from "../lib/constants";
import { useRevealRows } from "../hooks/useRevealRows";

export function OverlapBanner({ warnings, bookings, onReassign, onDismiss, collapseMax = 2 }) {
  const [open, setOpen] = useState(function () { return Object.keys(warnings).length <= collapseMax; });
  const { renderIds, openIds } = useRevealRows(Object.keys(warnings));

  if (renderIds.length === 0) return null;
  const byId = new Map(bookings.map(function (b) { return [b.id, b]; }));
  const liveCount = Object.keys(warnings).length;

  return (
    <div style={{ background: "var(--app-overlap-bg)", border: "2px solid var(--app-overlap-border)", borderRadius: 14, padding: "10px 14px", marginBottom: 10, boxShadow: "0 1px 4px rgba(0,0,0,0.04)" }}>
      <button
        onClick={function () { setOpen(!open); }}
        aria-expanded={open}
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, width: "100%", background: "transparent", border: "none", cursor: "pointer", padding: 0, textAlign: "left" }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: "var(--warn-text)", marginBottom: 2 }}>{"Overlap warnings · " + liveCount}</span>
        <span style={{ fontSize: 11, color: "var(--warn-text)", fontWeight: 700, flexShrink: 0 }}>{open ? "▲" : "▼"}</span>
      </button>
      <Reveal show={open}>
        <div>
          {renderIds.map(function (id) {
            const w = warnings[id];
            const sb = byId.get(id);
            return (
              <Reveal key={id} show={openIds.has(id)}>
                {sb && w ? (function () {
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
                })() : null}
              </Reveal>
            );
          })}
        </div>
      </Reveal>
    </div>
  );
}
