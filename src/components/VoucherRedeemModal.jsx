// src/components/VoucherRedeemModal.jsx
//
// v18.0.0 phase 1 — "how much of this voucher did the bill use?", raised in the
// middle of completing a booking that has one attached.
//
// It is raised exactly the way `confirmKitchen` is raised from a save: the
// action stops, the modal asks its question, and its buttons re-enter the
// action carrying the answer. That is an established pattern here, not a new
// one.
//
// ── THE THREE EXITS, AND WHY THERE ARE THREE ────────────────────────────────
// A modal that stands between a party leaving and their table being freed must
// not be answerable only with money.
//
//   * **Redeem and complete** — the ordinary case. The amount defaults to the
//     whole remaining balance, so "fully" needs no second button; typing a
//     smaller number is "partially", and the remainder stays on the voucher for
//     a later visit.
//   * **Complete without using it** — completes the booking and leaves the
//     voucher untouched. This lands in the UNSETTLED state (a completed booking
//     carrying a `voucherCode` with no ledger entry), which is a state the app
//     already defines and already surfaces in the notification strip, because
//     the close-time auto-complete produces it too. So it is a state staff can
//     be left in safely and will be reminded about — not a hole.
//   * **Escape / Cancel** — nothing happens at all. The booking is NOT
//     completed. Escape must mean "I did not mean to start this", which is the
//     one thing it cannot mean if dismissing quietly completed the booking.
//
// Props:
//   voucher   — the sanitised voucher record
//   booking   — the booking being completed (for the name in the title)
//   currency  — settings/general.currency
//   onRedeem(amount) — redeem this much, then complete
//   onSkip()         — complete, redeem nothing (the unsettled path)
//   onClose()        — cancel the whole action

import { useState } from "react";
import { S, R, T, FW } from "../lib/constants";
import { formatCode, remainingOf, redeemableAmount, clampMoney } from "../lib/vouchers";
import { Overlay, ModalTitle, InlineAlert, Reveal, Fld, mkInp, mkBtn, mkSolidBtn } from "./atoms";

export function VoucherRedeemModal({ voucher, booking, currency = "€", onRedeem, onSkip, onClose }) {
  const max = remainingOf(voucher);
  // The field starts at the whole balance, which is what makes "fully" the
  // default action rather than a separate button.
  const [amount, setAmount] = useState(String(max));
  const [err, setErr] = useState("");

  function commit() {
    const n = clampMoney(amount);
    if (n <= 0) { setErr("Enter an amount above zero, or complete without using the voucher."); return; }
    if (n > max) { setErr("That is more than the voucher has left (" + max + " " + currency + ")."); return; }
    onRedeem(redeemableAmount(voucher, n));
  }

  const left = max - clampMoney(amount);

  return (
    <Overlay
      onClose={onClose}
      footer={
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
          <button type="button" onClick={onSkip} className="mgt-hover-scale" style={mkBtn({ background: "var(--app-btn-slate)" })}>
            Complete without using it
          </button>
          <button type="button" onClick={commit} className="mgt-hover-scale" style={mkSolidBtn("var(--accent)")}>
            Redeem &amp; complete
          </button>
        </div>
      }>
      {/* A create/act surface wears its action's own colour. */}
      <ModalTitle background="var(--accent)">Voucher</ModalTitle>

      <h2 style={{ fontSize: T.title, fontWeight: FW.bold, margin: 0, marginBottom: 8, color: S.text }}>
        {formatCode(voucher.code)}
      </h2>
      <div style={{ fontSize: T.lead, color: S.text, marginBottom: 14 }}>
        {(booking && booking.name ? booking.name + "'s booking has this voucher attached. " : "")
          + max + " " + currency + " left on it."}
      </div>

      {/* `Fld`, not a hand-written label — /code-review v18.0.0, the same
          defect reported against VoucherPicker. Every other form surface in the
          app (BlockModal, ReminderEditor, WalkinForm) uses this atom and
          contains no raw labels at all; a second implementation reproduces its
          look by eye and inherits none of its behaviour. The FUNCTION shape
          gives the input a real `useId` association instead of relying on
          implicit label wrapping. */}
      <Fld label={"How much of it did this bill use? (" + currency + ")"}>{function (fid) {
        return (
          <input
            id={fid}
            type="number" min={0} max={max} step={1} inputMode="decimal"
            value={amount}
            onChange={function (e) { setAmount(e.target.value); setErr(""); }}
            className="mgt-hover-scale"
            style={mkInp()} />
        );
      }}</Fld>

      <div style={{ fontSize: T.body, color: S.muted, marginBottom: 10 }}>
        {left > 0
          ? left + " " + currency + " stays on the voucher for a later visit."
          : "This uses the whole voucher."}
      </div>

      {/* The live region is always mounted and only its CHILD is conditional —
          a region created already holding its message announces nothing. */}
      <div role="alert">
        <Reveal show={!!err}><InlineAlert>{err}</InlineAlert></Reveal>
      </div>

      <div style={{ fontSize: T.micro, color: S.muted, marginTop: 10, borderTop: "1px solid var(--border-soft)", paddingTop: 8, borderRadius: R.inset }}>
        Completing without using it leaves the voucher open — the booking will show as unsettled until someone records it.
      </div>
    </Overlay>
  );
}
