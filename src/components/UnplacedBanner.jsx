// src/components/UnplacedBanner.jsx
// v18.2.0 — the notification strip's "Not on the grid" section: one row per
// booking the timeline's Unplaced row holds (lib/unplaced.js decides which),
// each saying WHY and offering Assign.
//
// The design critique found 8 of a day's 12 bookings drawn nowhere, because
// their tables were not in the layout, and nothing on any screen said so. The
// timeline now shows them in its Unplaced row; this is the same fact for the
// views that have no such row — List shows the booking but not that its table
// is gone, and Plan cannot draw a table that does not exist — and for a
// screen reader, through `notifAnnounce`.
//
// Scoped to the VIEWED date, like ClashBanner and UnsettledBanner: its rows
// correspond 1:1 to blocks in the Unplaced row of the day on screen, so it
// takes the strip's `swapKey` and is replaced, not edited, on a date change.
//
// **No ✕ dismissal**, UnsettledBanner's reasoning: the row CLEARS ITSELF the
// moment the booking is placed (Assign, a drag onto a table, a reshuffle), and
// a dismissal would hide the exact thing this section exists to stop being
// invisible.
//
// The Assign button is ClashBanner's: `onAssign(id)` is App's `setManualTarget`,
// the manual table picker, which lists only tables the layout HAS — so it is a
// way out for all three reasons, where a drag needs the timeline on screen.

import { BannerRows } from "./BannerRows";
import { mkBtn } from "./atoms";
import { unplacedPhrase } from "../lib/unplaced";
import { guestsLabel } from "../lib/booking-logic";
import { BTN, T, FW, H } from "../lib/constants";

/**
 * @param {{b: object, reason: string, missing: string[]}[]} items  lib/unplaced `unplacedOf`
 * @param {Function} onAssign  (bookingId) → open the manual table picker
 * @param {string} swapKey     the viewed date
 */
export function UnplacedBanner({ items, onAssign, swapKey }) {
  const byId = new Map(items.map(function (u) { return [u.b.id, u]; }));

  function renderRow(id) {
    const u = byId.get(id);
    if (!u) return null;
    const b = u.b;
    // `(no name)`: sanitize writes `name: b.name || ""` and the form does not
    // require one — every banner carries this fallback (ClashBanner's note).
    const who = b.name || "(no name)";
    const size = Number(b.size) || 2;
    const msg = who + " (" + b.time + ", " + guestsLabel(size) + ") — " + unplacedPhrase(u) + ".";
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap", padding: "8px 0" }}>
        <span style={{ fontSize: T.body, color: "var(--danger-text)", fontWeight: FW.semi, flex: "1 1 auto", minWidth: 0 }}>{msg}</span>
        <button
          onClick={function () { onAssign(b.id); }}
          className="mgt-hover-scale"
          style={mkBtn({ fontSize: T.body, minHeight: H.chrome, padding: "4px 12px", background: BTN.orange })}>{"Assign " + who}</button>
      </div>
    );
  }

  return (
    <BannerRows ids={items.map(function (u) { return u.b.id; })} renderRow={renderRow} swapKey={swapKey} />
  );
}
