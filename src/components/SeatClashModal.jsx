// src/components/SeatClashModal.jsx
//
// v18.0.0 session 8 (C3) — "table 3 still has López seated", asked BEFORE the
// seat lands. Seating never checked whether the table still had a party at it,
// and the result is the one clash the app cannot fix by itself: both bookings
// are `isLocked`, `applyOpt` copies a locked booking's tables through, and the
// reconciler deliberately leaves an all-locked overlap alone. So the table is
// double-held until somebody notices.
//
// Raised from BOTH seating doors through one predicate (`seatClashParties`,
// booking-logic.js), the shape the seat note and the voucher prompts already
// use, so the popup, the List card, the S key and the form's Save cannot
// disagree about when it opens.
//
// THREE answers, because the two obvious ones are both wrong on their own:
// refusing outright is wrong (the previous party may simply have left without
// anyone tapping Complete — which is most evenings), and seating silently is
// the bug. "Complete them & seat" is the one that matches what happened in the
// room; "Seat anyway" is for a genuine share or a correction that will follow;
// Back — and Escape, and the backdrop — leave everything as it is.
//
// It renders a SNAPSHOT taken when the seat was refused, not a live lookup:
// static height, and a booking completed on another device in those seconds
// cannot blank the question under the reader.

import { S, T, FW, SP, BTN } from "../lib/constants";
import { Overlay, TBadge, mkBtn, mkSolidBtn } from "./atoms";

export function SeatClashModal({ clash, onComplete, onAnyway, onBack }) {
  if (!clash) return null;
  const others = clash.others || [];
  const footer = (
    <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
      <button
        className="mgt-hover-scale mgt-press"
        style={mkBtn({ minHeight: 44, padding: "10px 18px", background: "var(--app-btn-slate)" })}
        onClick={onBack}
      >Back</button>
      <button
        className="mgt-hover-scale mgt-press"
        style={mkSolidBtn(BTN.orange, { minHeight: 44, padding: "10px 18px" })}
        onClick={onAnyway}
      >Seat anyway</button>
      <button
        className="mgt-hover-scale mgt-press"
        style={mkSolidBtn(S.accent, { minHeight: 44, padding: "10px 18px" })}
        onClick={onComplete}
      >Complete them &amp; seat</button>
    </div>
  );
  return (
    <Overlay /* @static-height a snapshot taken when the seat was refused — nothing on it changes while it is open */ onClose={onBack} footer={footer}>
      <h2 style={{ fontSize: T.title, fontWeight: FW.bold, margin: 0, marginBottom: 8, color: S.text }}>
        {others.length > 1 ? "Those tables are still occupied" : "That table is still occupied"}
      </h2>
      <div style={{ fontSize: T.lead, color: S.text, marginBottom: 12 }}>
        {others.map((o) => (
          <div key={o.id} style={{ display: "flex", alignItems: "center", gap: SP.snug, flexWrap: "wrap", marginBottom: 6 }}>
            {o.tables.map((t) => <TBadge key={t} id={t} />)}
            <span>{"still has " + (o.name || "a party") + " seated" + (o.time ? " (since " + o.time + ")" : "") + "."}</span>
          </div>
        ))}
      </div>
      <div style={{ fontSize: T.small, color: S.sub }}>
        Completing them records how long they stayed and frees the table. Seating anyway leaves both parties on it.
      </div>
    </Overlay>
  );
}
