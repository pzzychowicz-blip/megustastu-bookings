// src/components/TableGrid.jsx
// Visual grid of all 13 tables grouped by physical cluster, showing live
// availability state. Tap to select / deselect.
//
// Used by ManualModal (assigning tables to an existing booking) and the
// walk-in form inside BookingApp (assigning tables to a new walk-in). Pure
// presentational — all state lives in the parent.
//
// Per-table colour states:
//   • selected  → orange       (currently in `selected`)
//   • blocked   → red          (busy and not swappable in this mode)
//   • busy/swap → yellow       (busy but swappable — only when swapBusy=true
//                               and the slot's booking is not seated)
//   • free      → outlined     (white with indoor/outdoor accent border)
//
// Phase B2 (v15-refactor): extracted from App.jsx and converted RC() → JSX.
// Behaviour, output markup, and all inline styles are byte-identical to the
// original.

import { S, TBL, TABLE_GROUPS } from "../lib/constants";
import { isIn } from "../lib/booking-logic";

// TABLE_GROUPS lives in ../lib/constants because it's also consumed by the
// inline "Preferred tables" picker in App.jsx (new-booking form). Two
// independent UI components reading the same layout descriptor → shared.

export function TableGrid({ selected, toggle, busy, seatedBusy, swapBusy }) {
  const seatedBusySet = seatedBusy || new Set();
  const swapBusyFlag = !!swapBusy;

  // A table is "blocked" (red, not selectable) when it's in `busy` AND either
  // we're not in swap mode OR the slot occupying it is seated. In swap mode,
  // tables held by non-seated bookings show as "swap" (yellow, selectable).
  function isBlocked(id) {
    if (!busy.has(id)) return false;
    if (swapBusyFlag && !seatedBusySet.has(id)) return false;
    return true;
  }

  return (
    <div>
      {TABLE_GROUPS.map((grp) => (
        <div key={grp.name} style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: grp.color, marginBottom: 2, textAlign: "center" }}>
            {grp.name}
          </div>
          {grp.note ? (
            <div style={{ fontSize: 12, color: S.text, marginBottom: 6, fontStyle: "italic", textAlign: "center" }}>
              {grp.note}
            </div>
          ) : null}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
            {grp.tables.map((t) => {
              const blocked = isBlocked(t.id);
              const isSel = selected.includes(t.id);
              const isBusyT = busy.has(t.id) && !blocked;
              const indoor = isIn(t.id);
              const tc = indoor ? TBL.ind : TBL.out;
              let bg, clr, brd;
              if (isSel)        { bg = "rgba(249,115,22,0.8)"; clr = "#fff";  brd = "2px solid rgba(249,115,22,0.9)"; }
              else if (blocked) { bg = "rgba(220,60,60,0.75)"; clr = "#fff";  brd = "2px solid rgba(220,60,60,0.8)"; }
              else if (isBusyT) { bg = "rgba(250,204,21,0.7)"; clr = "#fff";  brd = "2px solid rgba(250,204,21,0.8)"; }
              else              { bg = "rgba(255,255,255,0.4)"; clr = S.text; brd = "2px solid " + tc.bg; }
              const label = blocked ? "busy" : isBusyT ? "swap" : isSel ? "selected" : "cap " + t.cap;
              const subClr = isSel || blocked || isBusyT ? "rgba(255,255,255,0.8)" : S.text;
              return (
                <button
                  key={t.id}
                  onClick={() => toggle(t.id)}
                  className={blocked ? undefined : "mgt-hover-scale"}
                  style={{
                    width: 64, height: 52, padding: 0, borderRadius: 12,
                    border: brd, background: bg, color: clr,
                    fontWeight: 600, fontSize: 14,
                    cursor: blocked ? "not-allowed" : "pointer",
                    opacity: blocked ? 0.5 : 1,
                    display: "flex", flexDirection: "column",
                    alignItems: "center", justifyContent: "center",
                    gap: 2, boxSizing: "border-box",
                    boxShadow: "0 1px 4px rgba(0,0,0,0.08), inset 0 1px 1px rgba(255,255,255,0.3)"
                  }}
                >
                  <span>{t.id}</span>
                  <span style={{ fontSize: 10, fontWeight: 500, color: subClr }}>{label}</span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
