// src/components/VoucherCarryModal.jsx
//
// v18.0.0 session 8 (item 7) — "move the rest of this voucher to their next
// booking?", asked once the visit that was using it has been completed.
//
// It is the answer to the question Patryk opened the session with: what should
// Book Again do about a voucher when the source booking is SEATED? It cannot
// copy the code — a seated visit is still live and still holds it, so the new
// draft would carry an attachment `attachRefusal` refuses on the
// one-live-booking rule. The balance is not even known yet. So the offer waits
// until COMPLETION, which is the first moment both facts are settled: how much
// is left, and that this visit is done with it.
//
// TWO answers, and neither is destructive. **Move** attaches the code to the
// guest's next booking (attaching is not redeeming — it records an intention,
// and the money question is asked again when THAT booking completes). **Not
// now** leaves the voucher exactly where it is: open, with its balance, ready
// to be attached by hand from the picker like any other. Escape and the
// backdrop are Not now.
//
// The card renders a SNAPSHOT taken when the prompt was raised, so its height
// is static and nothing can change underneath it while it is open.

import { S, T, FW } from "../lib/constants";
import { Overlay, mkBtn, mkSolidBtn } from "./atoms";
import { formatCode } from "../lib/vouchers";
import { WEEKDAY_SHORT } from "../lib/day";

// "Fri 18/09" — the weekday is what staff actually navigate by, and the app's
// one weekday list is in lib/day.js.
function whenLabel(date, time) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "")) return (date || "") + (time ? " at " + time : "");
  const wd = WEEKDAY_SHORT[new Date(date).getUTCDay()] || "";
  return (wd ? wd + " " : "") + date.slice(8, 10) + "/" + date.slice(5, 7) + (time ? " at " + time : "");
}

export function VoucherCarryModal({ carry, currency = "€", onMove, onNotNow }) {
  if (!carry) return null;
  const footer = (
    <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
      <button
        type="button"
        onClick={onNotNow}
        className="mgt-hover-scale mgt-press"
        style={mkBtn({ minHeight: 44, padding: "10px 18px", background: "var(--app-btn-slate)" })}
      >Not now</button>
      <button
        type="button"
        onClick={onMove}
        className="mgt-hover-scale mgt-press"
        style={mkSolidBtn(S.accent, { minHeight: 44, padding: "10px 18px" })}
      >Move it</button>
    </div>
  );
  return (
    <Overlay /* @static-height a snapshot taken when the visit was completed — nothing on it changes while it is open */ onClose={onNotNow} footer={footer}>
      <h2 style={{ fontSize: T.title, fontWeight: FW.bold, margin: 0, marginBottom: 8, color: S.text }}>
        Move the rest of this voucher?
      </h2>
      <div style={{ fontSize: T.lead, color: S.text, marginBottom: 12 }}>
        {carry.amount + " " + currency + " is left on voucher "}
        <strong style={{ fontVariantNumeric: "tabular-nums" }}>{formatCode(carry.code)}</strong>
        {". Move it to " + (carry.name || "their next booking") + " on " + whenLabel(carry.date, carry.time) + "?"}
      </div>
      <div style={{ fontSize: T.small, color: S.sub }}>
        Moving it only attaches the number — how much that visit uses is asked when it is completed.
        Not now leaves the voucher open, and it can be attached by hand at any time.
      </div>
    </Overlay>
  );
}
