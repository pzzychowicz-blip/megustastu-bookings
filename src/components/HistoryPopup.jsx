// src/components/HistoryPopup.jsx
// Modal popup that lists every history entry on a single booking — the audit
// trail of who-did-what-when. Entries are stored on the booking as
// `{at: ISO timestamp, by: email, action: free-text label}` and pushed by
// every save / status change / manual assignment / etc.
//
// Renders in reverse-chronological order (most recent first). Empty state
// shows "No history yet." Each entry's stamp is its LOCAL day and time, in the
// house date shape (v18.2.0, C1: `formatDay` in lib/day.js).
//
// Parent wires up:
//   • Conditional render: only mount when both `editId` and `showHistory`
//     are truthy.
//   • Lookup of the booking object before passing — keeps this component
//     decoupled from the bookings array.
//
// Phase B5 (v15-refactor): extracted from App.jsx (the inline `historyPopup`
// IIFE) and converted RC() → JSX. Behaviour, output markup, and all inline
// styles are byte-identical to the original.

import { S, R, T, FW } from "../lib/constants";
import { Overlay, mkBtn } from "./atoms";
import { formatDay, formatDaysIn, localDay } from "../lib/day";

export function HistoryPopup({ booking, onClose }) {
  // Defensive check — the parent should already guarantee this, but the
  // original IIFE returned null in this case, so we preserve the same
  // behaviour for safety.
  if (!booking) return null;

  const hist = (booking.history && booking.history.length > 0) ? booking.history : [];
  // Reverse: history is appended chronologically (oldest first), but the most
  // operationally useful entry to see is "what just happened" — the latest one.
  const reversed = hist.slice().reverse();

  return (
    <Overlay /* @static-height the entry list is built once per open — the booking cannot change under it */ onClose={onClose}>
      <h2 style={{ fontSize: T.title, fontWeight: FW.bold, margin: 0, marginBottom: 12, color: S.text }}>
        Booking history
      </h2>
      <div style={{ fontSize: T.body, color: S.muted, marginBottom: 12 }}>
        {booking.name + " — " + formatDay(booking.date) + " " + booking.time}
      </div>
      <div style={{
        maxHeight: 300, overflowY: "auto",
        borderRadius: R.card,
        border: "1px solid var(--border-soft)",
        background: "var(--bg-soft)",
        padding: "10px 12px",
        boxShadow: "var(--shadow-well)"
      }}>
        {reversed.length ? reversed.map((h, i) => {
          const d = new Date(h.at);
          // v18.2.0 (C1): the day in the house shape, "Thu 24.09", where this
          // was the one place in the app writing "24 Sept 2026". The time stays
          // en-GB, which gives "21:30" rather than the US-style "9:30 PM".
          const dateStr = formatDay(localDay(h.at));
          const timeStr = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
          return (
            <div
              key={i}
              style={{
                fontSize: T.body, color: S.muted,
                padding: "6px 0",
                borderBottom: i < reversed.length - 1 ? "1px solid var(--border-soft)" : "none"
              }}
            >
              <span style={{ fontWeight: FW.semi, color: S.text }}>{dateStr + " " + timeStr}</span>
              {" — "}
              <span style={{ color: "var(--accent)", fontWeight: FW.semi }}>{h.by || "staff"}</span>
              <div style={{ marginTop: 2, color: S.text }}>{formatDaysIn(h.action)}</div>
            </div>
          );
        }) : (
          <div style={{ fontSize: T.body, color: S.muted }}>No history yet.</div>
        )}
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}>
        <button
          className="mgt-hover-scale"
          style={mkBtn({ minHeight: 40, padding: "8px 18px", background: "var(--app-btn-slate)" })}
          onClick={onClose}
        >
          Close
        </button>
      </div>
    </Overlay>
  );
}
