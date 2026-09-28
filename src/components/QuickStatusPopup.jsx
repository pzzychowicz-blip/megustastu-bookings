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
// v18.3.0 (M3): the scrim and card are `PopupShell` (atoms), shared with the
// split menu and the Plan table popover, and every mount site wraps this in
// `ModalPresence`, so it animates OUT as well as in. While it leaves it is
// inert: the shell lets taps through, and every button here checks `leaving`.
// /review-animations: a PICK (a status, No show, Delete) calls `skipExit()`
// before it closes, so the card is gone as the result starts (the wipe, the
// cancel or delete confirm); only a dismiss plays the exit (PresenceContext).
//
// Props:
//   booking        — the target booking (name shown as the title)
//   late           — App's lateMap ({id: "warn"|"noshow"})
//   onStatus(id,s) — App's updateStatus
//   onNoShow(id)   — App's doCancelBooking(id, true)
//   onClose()      — clear the parent's popup state

import { useEffect, useRef } from "react";
import { S, BLOCK_BG, BLOCK_INK, BTN, R, T, FW, IC } from "../lib/constants";
import { seatingClosed } from "../lib/booking-logic";
import { useArmAfterRelease } from "../hooks/useArmAfterRelease";
import { NoShowIcon, StatusIcon, TrashIcon } from "./Icons";
import { mkDangerBtn, PopupShell, useModalPresence } from "./atoms";

// v18.2.0: two optional props, both for the List card's ⋯ — the first surface
// to open this card with a CLICK rather than a hold.
//   onDelete   — adds Delete as the last button. The List card had it inline;
//                it moved in here with the other rarely-used actions. It goes
//                through the caller's `onDelete`, i.e. App's confirm, as before.
//   startArmed — the opening press has ALREADY been released (it was a click),
//                so there is nothing for useArmAfterRelease to wait for. Without
//                it a keyboard user who opened this with Enter could not press
//                anything for the hook's 10s backstop. It also makes the card
//                behave like the dialog a click-opened surface is expected to
//                be: focus moves to the first button, Escape closes, and focus
//                returns to whatever opened it. The hold-opened path is
//                untouched — its finger is still down, which is the whole
//                reason the arming exists.
// v18.2.0 phase 60: two more, also the List card's — what the opener ALREADY
// offers, so this card does not offer it a second time (Patryk: the ⋯ card
// repeated the next-step button beside it).
//   omitStatus — the status its own button moves the booking to (the card's
//                `nextStatusOf`), left out of the status row.
//   omitNoShow — the opener shows No show itself, so this card does not.
// The timeline and the plan pass neither: their block and table carry no
// status buttons, so this card is the only place those actions live.
export function QuickStatusPopup({ booking, late = {}, today = "", nowMins = 0, onStatus, onNoShow, onClose, onDelete = null, startArmed = false, omitStatus = null, omitNoShow = false }) {
  // v17.16.12: this popup opens at 400ms INTO a hold, centred on the viewport,
  // so the finger that opened it is sitting on the card it just conjured. Until
  // that finger lifts, every control here is inert — see useArmAfterRelease for
  // the measurements. Hooks run before the early return below, which is why
  // this line is above it and not beside the other consts.
  const armedByRelease = useArmAfterRelease();
  const armed = startArmed || armedByRelease;
  // v18.3.0 (M3): true while the wrapping ModalPresence plays the exit.
  const { leaving, skipExit } = useModalPresence();
  const cardRef = useRef(null);
  // Refs, not deps: onClose is usually an inline arrow, and re-running this on
  // every render would restore and re-steal focus each time.
  const onCloseRef = useRef(onClose);
  useEffect(function () { onCloseRef.current = onClose; });
  // v18.3.0 (M3): a LEAVING card counts as closed here, so focus returns to
  // the opener and Escape is released when the exit STARTS, not 260ms later
  // when ModalPresence unmounts the cached card.
  const open = !!booking && !leaving;
  useEffect(function () {
    if (!startArmed || !open) return undefined;
    const opener = document.activeElement;
    const first = cardRef.current && cardRef.current.querySelector("button");
    if (first) first.focus({ preventScroll: true });
    function onKey(e) {
      if (e.key !== "Escape") return;
      // Capture phase on window, and stopped: the global Escape handler
      // (useKeyboardShortcuts) would otherwise ALSO drop the List selection.
      e.stopPropagation();
      e.preventDefault();
      onCloseRef.current();
    }
    window.addEventListener("keydown", onKey, true);
    return function () {
      window.removeEventListener("keydown", onKey, true);
      if (opener && document.contains(opener) && typeof opener.focus === "function") opener.focus({ preventScroll: true });
    };
  }, [startArmed, open]);
  if (!booking) return null;
  // v17.0.0 correction: portalled to <body> (SlideView's transform) — the
  // portal and the scrim's no-select trio (v17.16.12) now live in PopupShell.
  return (
    <PopupShell
      onScrimClick={() => { if (armed && !leaving) onClose(); }}
      cardRef={cardRef}
      cardStyle={{
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
          // v18.2.0 phase 60: not the one the opener's own button offers.
          .filter((st) => st !== omitStatus)
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
                if (!armed || leaving) return;
                skipExit();
                onStatus(booking.id, st);
                onClose();
              }}
            >
              <StatusIcon status={st} size={IC.control} />{st}
            </button>
          ))}
        {!omitNoShow && (booking.status === "confirmed" || booking.status === "pending") && late[booking.id] === "noshow" ? (
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
              if (!armed || leaving) return;
              skipExit();
              onNoShow(booking.id);
              onClose();
            }}
          >
            <NoShowIcon size={IC.control} />No show
          </button>
        ) : null}
        {onDelete ? (
          <button
            className="mgt-hover-scale"
            // v18.2.0 phase 62: the app's one destructive look, on this
            // card's own pill geometry.
            style={mkDangerBtn({ fontSize: T.lead, fontWeight: FW.bold, padding: "10px 18px", minHeight: 44, flex: "1 1 auto" })}
            onClick={() => {
              if (!armed || leaving) return;
              skipExit();
              onDelete(booking.id);
              onClose();
            }}
          >
            <TrashIcon size={IC.control} />Delete
          </button>
        ) : null}
      </div>
    </PopupShell>
  );
}
