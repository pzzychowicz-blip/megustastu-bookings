// src/components/QuickStatusPopup.jsx
//
// v17.0.0 — the quick-status popup, extracted VERBATIM from TimelineView
// (long-press / RMB on a booking) so the new PlanView shares one component
// instead of duplicating the status-gating rules:
//   • a PENDING booking's only forward status is Confirmed (+ Cancel stays
//     reachable — the decline flow, Patryk-confirmed);
//   • the one-tap "No show" appears for a confirmed/pending booking past the
//     no-show threshold (`late[id] === "noshow"`, App's lateMap).
//
// Fixed-position scrim at z=300 — above view content, below modals (the
// timeline z-order contract). Tapping the scrim closes.
//
// Props:
//   booking        — the target booking (name shown as the title)
//   late           — App's lateMap ({id: "warn"|"noshow"})
//   onStatus(id,s) — App's updateStatus
//   onNoShow(id)   — App's doCancelBooking(id, true)
//   onClose()      — clear the parent's popup state

import { S, BLOCK_BG, BTN } from "../lib/constants";

export function QuickStatusPopup({ booking, late = {}, onStatus, onNoShow, onClose }) {
  if (!booking) return null;
  return (
    <div
      onClick={onClose}
      className="mgt-scrim-in"
      style={{
        position: "fixed", inset: 0, zIndex: 300,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "var(--tl-popup-scrim)"
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="mgt-card-in"
        style={{
          background: "var(--tl-popup-bg)", borderRadius: 20,
          border: "1px solid " + S.border,
          boxShadow: "0 8px 32px rgba(0,0,0,0.14)",
          padding: "20px 24px",
          minWidth: 240, maxWidth: 320, zIndex: 301
        }}
      >
        <div style={{ fontSize: 20, fontWeight: 700, color: S.text, marginBottom: 16 }}>
          {booking.name}
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {(booking.status === "pending"
            ? ["confirmed", "cancelled"]
            : ["confirmed", "seated", "completed", "cancelled"])
            .filter((st) => st !== booking.status)
            .map((st) => (
              <button
                key={st}
                className="mgt-hover-scale"
                style={{
                  background: BLOCK_BG[st], border: "none",
                  borderRadius: 12, padding: "10px 18px",
                  fontSize: 14, fontWeight: 700, color: "var(--text-on-accent)",
                  cursor: "pointer", textTransform: "capitalize",
                  minHeight: 44, flex: "1 1 auto"
                }}
                onClick={() => {
                  onStatus(booking.id, st);
                  onClose();
                }}
              >
                {st}
              </button>
            ))}
          {(booking.status === "confirmed" || booking.status === "pending") && late[booking.id] === "noshow" ? (
            <button
              className="mgt-hover-scale"
              style={{
                background: BTN.orange, border: "none",
                borderRadius: 12, padding: "10px 18px",
                fontSize: 14, fontWeight: 700, color: "var(--text-on-accent)",
                cursor: "pointer",
                minHeight: 44, flex: "1 1 auto"
              }}
              onClick={() => {
                onNoShow(booking.id);
                onClose();
              }}
            >
              No show
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
