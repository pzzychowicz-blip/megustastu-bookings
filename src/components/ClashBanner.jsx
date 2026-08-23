// src/components/ClashBanner.jsx
// v17.11.0 — the double-booking banner. One row per clashing PAIR.
//
// ── Why this section did not exist ───────────────────────────────────────────
// The app had a conflict detector and a conflict-shaped banner, and they were
// about different things. `overlapWarnings` is an OVERSTAY detector: it
// iterates SEATED bookings and warns when one runs into the next booking's
// slot. Two *confirmed* bookings on one table never reach it. `findConflicts`,
// which does see them, was wired only to the silent reconciliation effect — and
// that effect relocates the newest NON-LOCKED booking, then gives up:
// `if(!movable.length) break; // only locked overlaps — leave as-is`.
//
// So an all-locked clash produced no banner, no marker and no log, while being
// reachable by completely ordinary use: every walk-in is `_locked`, and so is
// every drag-drop. Measured live on a seeded day, the two blocks sat on one row
// and overlapped by 288px with the later painting over the earlier — so the
// interface drew a double-booking as two tidy consecutive sittings. That is the
// one place this app actively misleads rather than merely omits.
//
// This is the strip half of the fix; TimelineView draws the marker and the
// border. Both read the same `findClashes` pairs, so the two surfaces cannot
// disagree about what is clashing.
//
// ── Why the action is Assign, not Reassign ───────────────────────────────────
// OverlapBanner's row offers `onReassign`, and copying that here would have
// shipped a button that can only ever fail: `reassignBooking` refuses a locked
// booking outright ("Booking is manually locked. Edit manually to change
// tables."), and a clash that survived the reconciler is locked BY DEFINITION —
// being locked is the exact condition under which the reconciler leaves it. The
// row opens the manual assign modal, which is the surface that can resolve it.
//
// It offers the LATER booking. Both are equally "wrong", but the earlier party
// may already be at the table, and the reconciler's own tie-break (newest
// first) points the same way — so the automatic path and the manual one propose
// the same move instead of fighting over it.
//
// Props:
//   pairs     — findClashes output for the viewed date, DISMISS-FILTERED
//   bookings  — full list (name/time lookup)
//   onAssign  — open the manual assign modal for a booking id
//   onDismiss — dismiss one row (the pair's row id)

import { BannerRows } from "./BannerRows";
import { mkBtn } from "./atoms";
import { toMins, clashRowId } from "../lib/booking-logic";
import { BTN, T, FW, IC, H } from "../lib/constants";
import { CloseIcon } from "./Icons";

export function ClashBanner({ pairs, bookings, onAssign, onDismiss, swapKey }) {
  const byId = new Map(bookings.map(function (b) { return [b.id, b]; }));
  const byRow = new Map(pairs.map(function (c) { return [clashRowId(c), c]; }));

  function renderRow(rowId) {
    const c = byRow.get(rowId);
    if (!c) return null;
    const A = byId.get(c.a);
    const B = byId.get(c.b);
    if (!A || !B) return null;
    // The later booking is the one the button offers, so the sentence names it
    // second and ends on the party the action is about.
    const first = toMins(A.time) <= toMins(B.time) ? A : B;
    const later = first === A ? B : A;
    // `tables` is empty when the pair collides over a shared JOIN rather than a
    // shared table (see findClashes). Naming no table is the honest sentence
    // there; inventing a table id would not be.
    const where = c.tables.length
      ? (c.tables.length === 1 ? "table " + c.tables[0] : "tables " + c.tables.join(" + "))
      : "tables that cannot both be joined";
    const msg = first.name + " (" + first.time + ") and " + later.name + " (" + later.time + ") are both on " + where + ".";
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap", padding: "8px 0" }}>
        <span style={{ fontSize: T.body, color: "var(--danger-text)", fontWeight: FW.semi, flex: "1 1 auto", minWidth: 0 }}>{msg}</span>
        <button
          onClick={function () { onAssign(later.id); }}
          className="mgt-hover-scale"
          style={mkBtn({ fontSize: T.body, minHeight: H.chrome, padding: "4px 12px", background: BTN.orange })}>{"Assign " + later.name}</button>
        <button
          onClick={function () { onDismiss(rowId); }}
          aria-label="Dismiss this double-booking warning"
          className="mgt-hover-scale mgt-press"
          style={mkBtn({ fontSize: T.body, width: H.chrome, height: H.chrome, minHeight: H.chrome, padding: 0, display: "inline-flex", alignItems: "center", justifyContent: "center", background: BTN.dismiss })}><CloseIcon size={IC.control} /></button>
      </div>
    );
  }

  return (
    <BannerRows ids={pairs.map(clashRowId)} renderRow={renderRow} swapKey={swapKey} />
  );
}
