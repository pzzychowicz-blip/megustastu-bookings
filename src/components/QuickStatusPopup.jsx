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
import { seatingClosed } from "../lib/booking-logic";
import { useArmAfterRelease } from "../hooks/useArmAfterRelease";
import { NoShowIcon, StatusIcon } from "./Icons";

export function QuickStatusPopup({ booking, late = {}, today = "", nowMins = 0, onStatus, onNoShow, onClose }) {
  // v17.16.12: this popup opens at 400ms INTO a hold, centred on the viewport,
  // so the finger that opened it is sitting on the card it just conjured. Until
  // that finger lifts, every control here is inert — see useArmAfterRelease for
  // the measurements. Hooks run before the early return below, which is why
  // this line is above it and not beside the other consts.
  const armed = useArmAfterRelease();
  if (!booking) return null;
  // v17.0.0 correction: portalled to <body>. The popup mounts inside SlideView,
  // whose transform (while a view-slide runs/settles) turns this position:fixed
  // scrim into a CONTAINING-BLOCK-relative box — on a wide timeline it centered
  // on the scroller, not the screen. A body portal always centers on the viewport.
  return createPortal(
    <div
      onClick={() => { if (armed) onClose(); }}
      className="mgt-scrim-in"
      style={{
        position: "fixed", inset: 0, zIndex: 300,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "var(--tl-popup-scrim)",
        // v17.16.12: the card below has carried these since v17.10.1; the SCRIM
        // had not, and it is what the finger is on for most of the screen when
        // a centred card appears under a hold. A scrim is never a copy target.
        WebkitUserSelect: "none", userSelect: "none", WebkitTouchCallout: "none"
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
          minWidth: 240, maxWidth: 320, zIndex: 301,
          // v17.10.1: the buttons are covered by index.html's control rule, but
          // the guest name above them is a <div> and this popup is opened by a
          // HOLD — so on Android the finger that opened it is still down on the
          // card, and the OS selects whatever is under it. The title is the one
          // thing here that isn't a control.
          WebkitUserSelect: "none", userSelect: "none", WebkitTouchCallout: "none"
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
            // v17.16.12: never offer a status the app will take straight back.
            // On a day whose close has passed, the close-time auto-complete
            // flips a manual "seated" to "completed" on the next 15s tick — so
            // the tap read as broken rather than as refused. Same gating idiom
            // as the pending branch above.
            .filter((st) => st !== "seated" || !seatingClosed(booking.date, today, nowMins))
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
                  if (!armed) return;
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
                if (!armed) return;
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
