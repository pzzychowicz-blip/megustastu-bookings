// src/components/EmptyDay.jsx
// v17.11.0 — the empty-day prompt, shared by all three views.
//
// v17.8.0 wrote this for ListView, and it was the good answer: an empty day used
// to be one grey sentence centred in ~500px of nothing, with the only useful
// action (+ New) at the far top of the screen, so a first-shift host learned
// nothing from it. It now says what the day is and offers the two things you can
// do with an empty one, where the user is already looking.
//
// It just never left List. Timeline drew an empty grid and Plan drew an empty
// room — the same condition answered three ways, one of them useful.
//
// ── Where it goes, and why that differs from "replace the view" ──────────────
// One rule for all three: the prompt sits at the TOP of the view's content.
//
// In List that IS the whole body, because a list of nothing has nothing else to
// draw — so List's behaviour is byte-for-byte what v17.8.0 shipped. In Timeline
// and Plan it sits above a canvas that is still worth drawing: the grid and the
// floor plan are pictures of the ROOM, and an empty room is exactly what you
// want to see on an empty day. They also carry their own affordances that have
// nothing to do with bookings — tapping a table label to block it, reading the
// layout — and replacing them would take those away to deliver a sentence.
//
// So the shared thing is the prompt and its position, not the decision to blank
// the view. "Share the empty state" does not mean "make three views identical";
// it means the same condition stops producing three different amounts of help.
//
// ── The closed day is NOT this ───────────────────────────────────────────────
// It renders nothing when the day is closed, which fixes a wart List shipped
// alone: on a closed day it offered "New booking" and "Walk-in", and the app
// refuses both — a prompt whose only outcome is a refusal. The notification
// strip's own `Closed this day` section is the empty state for that case, and it
// already appears in all three views (v17.8.0's strip audit). Copying it here
// would be a second answer to a question that has one.

import { mkBtn } from "./atoms";
import { S, T, FW } from "../lib/constants";

/**
 * @param {boolean} closed   the viewed day is a closed day — render nothing
 * @param {Function} onNew   open the new-booking form (omit to hide the button)
 * @param {Function} onWalkin open the walk-in form (omit to hide the button;
 *                   App already passes null on any day but today, because a
 *                   walk-in is a party standing at the door now).
 *                   v17.14.0: the three VIEWS pass this as `emptyWalkin`, the
 *                   name that tells it apart from PlanView's own per-table
 *                   `onWalkin(tableId)`. Here there is nothing to tell it apart
 *                   from, so it keeps the plain `on*` handler convention.
 */
export function EmptyDay({ closed = false, onNew, onWalkin }) {
  if (closed) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14, padding: "32px 16px" }}>
      <div style={{ fontSize: T.lead, fontWeight: FW.semi, color: S.text }}>Nothing booked for this day yet.</div>
      <div style={{ fontSize: T.body, color: S.muted, textAlign: "center", maxWidth: 340 }}>
        Take a reservation, or seat someone who has just walked in.
      </div>
      {onNew || onWalkin ? (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center", marginTop: 2 }}>
          {onNew ? (
            <button className="mgt-hover-scale" onClick={onNew}
              style={mkBtn({ background: "var(--accent)", padding: "8px 18px" })}>New booking</button>
          ) : null}
          {onWalkin ? (
            <button className="mgt-hover-scale" onClick={function () { onWalkin(null); }}
              style={mkBtn({ background: "var(--app-walkin)", padding: "8px 18px" })}>Walk-in</button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
