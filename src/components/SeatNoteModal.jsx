// src/components/SeatNoteModal.jsx
//
// v18.0.0 session 7 — the note a party brought with them, shown the moment they
// are seated. A booking's notes are where "nut allergy", "birthday cake with
// dessert" and "wheelchair — step-free table" live, and the moment that matters is
// when the party sits down. Until now the note was a line on a List card and a
// dog-ear on a timeline block, and nothing put it in front of the person seating
// them. Patryk, 2026-09-11: a popover with the note and ONE button.
//
// Raised from BOTH doors a booking is seated through — `updateStatus` (the
// quick-status popup, the List card's button, the S key) and `doSaveEdit` (the
// form's Save) — through one predicate, `seatNoteFor` (booking-logic.js), so the
// two cannot disagree about when it opens. Never for a walk-in: the person typing
// its note is the one seating it.
//
// It renders a SNAPSHOT taken at the seat rather than a live lookup. That is what
// makes its height genuinely static — nothing on it can change while it is up —
// and it means a booking deleted on another device in those seconds does not
// blank the note under the reader.
//
// One button, "Done": the house word for dismissing a panel with no decision in
// it (the waitlist, search and roles panels). Escape and the backdrop do the same.

import { S, R, T, FW, SP } from "../lib/constants";
import { Overlay, TBadge, mkBtn } from "./atoms";

export function SeatNoteModal({ note, onClose }) {
  if (!note) return null;
  const guests = note.size + (note.size === 1 ? " guest" : " guests");
  const footer = (
    <div style={{ display: "flex", justifyContent: "flex-end" }}>
      <button
        className="mgt-hover-scale mgt-press"
        style={mkBtn({ minHeight: 44, padding: "10px 18px", background: "var(--app-btn-slate)" })}
        onClick={onClose}
      >Done</button>
    </div>
  );
  return (
    <Overlay /* @static-height a snapshot taken at the seat — nothing on it can change while it is open */ onClose={onClose} footer={footer}>
      <h2 style={{ fontSize: T.title, fontWeight: FW.bold, margin: 0, marginBottom: 6, color: S.text }}>
        {"Note — " + (note.name || "this booking")}
      </h2>
      <div style={{ display: "flex", alignItems: "center", gap: SP.snug, flexWrap: "wrap", fontSize: T.body, color: S.muted, marginBottom: 12 }}>
        <span>{guests + " · " + note.time}</span>
        {note.tables.map((t) => <TBadge key={t} id={t} />)}
      </div>
      <div style={{
        whiteSpace: "pre-wrap", overflowWrap: "anywhere",
        fontSize: T.lead, color: S.text,
        maxHeight: 300, overflowY: "auto",
        borderRadius: R.card,
        border: "1px solid var(--border-soft)",
        background: "var(--bg-soft)",
        padding: "10px 12px",
        boxShadow: "var(--shadow-well)"
      }}>
        {note.notes}
      </div>
    </Overlay>
  );
}
