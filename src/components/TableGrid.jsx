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

import { S, TBL, TABLE_GROUPS, R, T, FW } from "../lib/constants";
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
          <div style={{ fontSize: T.body, fontWeight: FW.bold, color: grp.color, marginBottom: 2, textAlign: "center" }}>
            {grp.name}
          </div>
          {grp.note ? (
            <div style={{ fontSize: T.body, color: S.text, marginBottom: 6, fontStyle: "italic", textAlign: "center" }}>
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
              // v17.8.0: these three were hard-coded fills with white text and
              // NO token, so the contrast pass could not see them at all —
              // measured 2.31 (selected), 3.13 (blocked) and ~1.4 (swap, white
              // on a bright yellow). The blocked red was also a stale copy of
              // --btn-del's value from BEFORE that pass retuned it.
              // Consolidated onto tokens the app already has rather than three
              // new near-duplicate hues, and the rim is now neutral
              // --border-glass per the solid-label convention (the fill carries
              // the colour; a matching border is a second copy of one signal).
              // `selected` takes the ACCENT because accent means primary action
              // or CURRENT SELECTION — which is literally this state, and it is
              // free now that table badges are teal and purple.
              if (isSel)        { bg = S.accent;                 clr = "var(--text-on-accent)"; brd = "2px solid var(--border-glass)"; }
              else if (blocked) { bg = "var(--btn-del)";         clr = "var(--text-on-accent)"; brd = "2px solid var(--border-glass)"; }
              else if (isBusyT) { bg = "var(--app-warn-solid)";  clr = "var(--text-on-accent)"; brd = "2px solid var(--border-glass)"; }
              else              { bg = "var(--bg-input)";       clr = S.text; brd = "2px solid " + tc.bg; }
              // v17.1.1: isSel first — a Plan-view pre-selected table can be
              // selected AND busy; it paints orange (isSel wins above), so the
              // label must agree.
              const label = isSel ? "selected" : blocked ? "busy" : isBusyT ? "swap" : "cap " + t.cap;
              const subClr = isSel || blocked || isBusyT ? "rgba(255,255,255,0.8)" : S.text;  /* @fixed-fill */
              return (
                <button
                  key={t.id}
                  onClick={() => toggle(t.id)}
                  // v17.8.0: a blocked cell is inert but NOT `disabled`, so the
                  // universal button press-scale would animate a tap that does
                  // nothing. .mgt-nopress opts it out, for the same reason the
                  // hover lift is withheld here.
                  className={blocked && !isSel ? "mgt-nopress" : "mgt-hover-scale"}
                  style={{
                    width: 64, height: 52,   /* @canvas */ padding: 0, borderRadius: R.pill,
                    border: brd, background: bg, color: clr,
                    fontWeight: FW.semi, fontSize: T.lead,
                    cursor: blocked && !isSel ? "not-allowed" : "pointer",
                    opacity: blocked && !isSel ? 0.5 : 1,
                    display: "flex", flexDirection: "column",
                    alignItems: "center", justifyContent: "center",
                    gap: 2, boxSizing: "border-box",
                    boxShadow: "var(--shadow-btn)"
                  }}
                >
                  <span>{t.id}</span>
                  <span style={{ fontSize: T.micro, fontWeight: FW.medium, color: subClr }}>{label}</span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
