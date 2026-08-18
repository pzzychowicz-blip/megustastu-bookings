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

import { createPortal } from "react-dom";
import { S, BLOCK_BG, BLOCK_INK, BTN, R, T, FW, IC } from "../lib/constants";
import { NoShowIcon, StatusIcon } from "./Icons";

export function QuickStatusPopup({ booking, late = {}, onStatus, onNoShow, onClose }) {
  if (!booking) return null;
  // v17.0.0 correction: portalled to <body>. The popup mounts inside SlideView,
  // whose transform (while a view-slide runs/settles) turns this position:fixed
  // scrim into a CONTAINING-BLOCK-relative box — on a wide timeline it centered
  // on the scroller, not the screen. A body portal always centers on the viewport.
  return createPortal(
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
          background: "var(--tl-popup-bg)", borderRadius: R.sheet,
          border: "1px solid " + S.border,
          boxShadow: "var(--shadow-popover)",
          padding: "18px 24px",
          minWidth: 240, maxWidth: 320, zIndex: 301
        }}
      >
        <div style={{ fontSize: T.display, fontWeight: FW.bold, color: S.text, marginBottom: 16 }}>
          {booking.name}
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {(booking.status === "pending"
            ? ["confirmed", "cancelled"]
            : ["confirmed", "seated", "completed", "cancelled"])
            .filter((st) => st !== booking.status)
            // v17.10.0: this popup is the surface staff use DURING service (a
            // long-press on the timeline or the floor plan), and it was the one
            // place the same five decisions carried no mark at all — so the
            // same choice looked different in three places. Same source, same
            // size as the List card and the edit form.
            .map((st) => (
              <button
                key={st}
                className="mgt-hover-scale"
                style={{
                  background: BLOCK_BG[st], border: "none",
                  borderRadius: R.pill, padding: "10px 18px",
                  fontSize: T.lead, fontWeight: FW.bold, color: BLOCK_INK[st] || "var(--text-on-accent)",
                  cursor: "pointer", textTransform: "capitalize",
                  minHeight: 44, flex: "1 1 auto",
                  display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6
                }}
                onClick={() => {
                  onStatus(booking.id, st);
                  onClose();
                }}
              >
                <StatusIcon status={st} size={IC.control} />{st}
              </button>
            ))}
          {(booking.status === "confirmed" || booking.status === "pending") && late[booking.id] === "noshow" ? (
            <button
              className="mgt-hover-scale"
              style={{
                background: BTN.orange, border: "none",
                borderRadius: R.pill, padding: "10px 18px",
                fontSize: T.lead, fontWeight: FW.bold, color: "var(--text-on-accent)",
                cursor: "pointer",
                minHeight: 44, flex: "1 1 auto",
                display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6
              }}
              onClick={() => {
                onNoShow(booking.id);
                onClose();
              }}
            >
              <NoShowIcon size={IC.control} />No show
            </button>
          ) : null}
        </div>
      </div>
    </div>,
    document.body
  );
}
