// src/components/HistoryPopup.jsx
// Modal popup that lists every history entry on a single booking — the audit
// trail of who-did-what-when. Entries are stored on the booking as
// `{at: ISO timestamp, by: email, action: free-text label}` and pushed by
// every save / status change / manual assignment / etc.
//
// Renders in reverse-chronological order (most recent first). Empty state
// shows "No history yet." Dates are formatted with Intl-aware locale strings
// rather than the raw ISO so that staff in the Canary Islands see local dates.
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

import { S } from "../lib/constants";
import { Overlay, mkBtn } from "./atoms";

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
    <Overlay onClose={onClose}>
      <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 12, color: S.text }}>
        Booking history
      </div>
      <div style={{ fontSize: 13, color: S.muted, marginBottom: 12 }}>
        {booking.name + " — " + booking.date + " " + booking.time}
      </div>
      <div style={{
        maxHeight: 300, overflowY: "auto",
        borderRadius: 14,
        border: "2px solid rgba(160,170,190,0.4)",
        background: "rgba(255,255,255,0.35)",
        padding: "10px 12px",
        boxShadow: "inset 0 1px 4px rgba(0,0,0,0.06)"
      }}>
        {reversed.length ? reversed.map((h, i) => {
          const d = new Date(h.at);
          // en-GB chosen deliberately — gives "12 May 2026" / "21:30" rather
          // than the US-style "May 12, 2026" / "9:30 PM". Matches what staff
          // see elsewhere in the app.
          const dateStr = d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
          const timeStr = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
          return (
            <div
              key={i}
              style={{
                fontSize: 12, color: S.muted,
                padding: "6px 0",
                borderBottom: i < reversed.length - 1 ? "1px solid rgba(160,170,190,0.25)" : "none"
              }}
            >
              <span style={{ fontWeight: 600, color: S.text }}>{dateStr + " " + timeStr}</span>
              {" — "}
              <span style={{ color: "var(--accent)", fontWeight: 600 }}>{h.by || "staff"}</span>
              <div style={{ marginTop: 2, color: S.text }}>{h.action}</div>
            </div>
          );
        }) : (
          <div style={{ fontSize: 12, color: S.muted }}>No history yet.</div>
        )}
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}>
        <button
          className="mgt-hover-scale"
          style={mkBtn({ minHeight: 40, padding: "8px 18px", background: "#64748b" })}
          onClick={onClose}
        >
          Close
        </button>
      </div>
    </Overlay>
  );
}
