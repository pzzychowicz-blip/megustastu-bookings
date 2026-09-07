// src/components/VoucherPicker.jsx
//
// v18.0.0 phase 1 — the booking form's voucher field: attach a gift voucher to
// this booking, or detach the one that is on it.
//
// ── ATTACHED IS NOT REDEEMED ────────────────────────────────────────────────
// This field writes `booking.voucherCode` and nothing else. It does not touch
// the voucher, does not move any money, and cannot: the ledger entry is written
// when the booking is COMPLETED, by `VoucherRedeemModal`. The two are different
// facts at different times, and keeping them apart is what makes a booking with
// a `voucherCode` and no ledger entry a meaningful state — "unsettled" — rather
// than an inconsistency.
//
// So detaching here is free and reversible. It removes an intention, not a
// payment. A booking that has ALREADY redeemed against the voucher is a
// different matter and this field says so instead of offering the detach.
//
// ── NOT A DRAFTING SURFACE OF ITS OWN ───────────────────────────────────────
// The typed code is component-local until Attach; `voucherCode` then lands in
// the form draft like `deposit` or `notes`, so the booking form's existing
// unsaved-changes baseline (`openForm` → `formBaseline` → `sameDraft`) already
// covers it. There is deliberately no `onDirty` here — `ManualModal`'s shape is
// for a surface whose picks live outside the draft, and these do not.
//
// Props:
//   code            — form.voucherCode (the draft value)
//   onChange(code)  — writes it back into the form draft
//   vouchersByCode  — the code→voucher index from useVouchers
//   bookings        — for the "already on another live booking" check
//   bookingId       — editId, or null for a new booking
//   currency        — settings/general.currency

import { useState } from "react";
import { S, BTN, R, T, FW } from "../lib/constants";
import {
  normalizeCode, formatCode, voucherState, remainingOf,
  isRedeemedBy, attachRefusal,
} from "../lib/vouchers";
import { Section, OutlineChip, Reveal, InlineAlert, mkInp, mkBtn } from "./atoms";

const STATE_TONE = { open: "success", spent: "neutral", expired: "warn", void: "danger" };

export function VoucherPicker({ code, onChange, vouchersByCode, bookings, bookingId, currency = "€" }) {
  const [typed, setTyped] = useState("");
  const [err, setErr] = useState("");
  // Once per mount, for the same reason the Vouchers tab reads it once: expiry
  // is a day-scale concept and a `Date.now()` in the render body is neither
  // pure nor stable enough to sit in a dependency.
  const [now] = useState(function () { return Date.now(); });

  const attached = code ? (vouchersByCode || {})[normalizeCode(code)] : null;
  const settledHere = attached && isRedeemedBy(attached, bookingId);

  function attach() {
    const c = normalizeCode(typed);
    if (!c) { setErr("Enter a voucher number."); return; }
    const refusal = attachRefusal((vouchersByCode || {})[c], c, bookings, bookingId, now);
    if (refusal) { setErr(refusal); return; }
    setErr("");
    setTyped("");
    onChange(c);
  }

  // ── Something is attached ──────────────────────────────────────────────────
  if (code) {
    const st = attached ? voucherState(attached, now) : null;
    return (
      <Section>
        <div style={{ fontSize: T.lead, fontWeight: FW.semi, color: S.text, marginBottom: 6 }}>Gift voucher</div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: T.lead, fontWeight: FW.bold, color: S.text, fontVariantNumeric: "tabular-nums" }}>
            {formatCode(code)}
          </span>
          {attached ? <OutlineChip tone={STATE_TONE[st]}>{st}</OutlineChip> : null}
          {attached ? <OutlineChip tone="neutral">{remainingOf(attached) + " " + currency + " left"}</OutlineChip> : null}
          {settledHere ? <OutlineChip tone="success">redeemed here</OutlineChip> : null}
          <span style={{ flex: 1 }} />
          {/* A booking that has already redeemed against this voucher keeps its
              link: detaching would orphan a ledger entry that records something
              that really happened. Settle it from Settings → Vouchers instead. */}
          {settledHere ? null : (
            <button type="button"
              onClick={function () { onChange(""); setErr(""); }}
              aria-label={"Remove voucher " + formatCode(code) + " from this booking"}
              style={mkBtn({ fontSize: T.body, minHeight: 32, padding: "4px 12px", background: BTN.nav })}>
              Remove
            </button>
          )}
        </div>
        <div style={{ fontSize: T.micro, color: S.muted, marginTop: 6 }}>
          {settledHere
            ? "This booking has already been settled against this voucher."
            : attached
              ? "You will be asked how much of it the bill used when this booking is completed."
              : "This number is not in the voucher list — it may have been recorded on another device."}
        </div>
      </Section>
    );
  }

  // ── Nothing attached ───────────────────────────────────────────────────────
  return (
    <Section>
      <div style={{ fontSize: T.lead, fontWeight: FW.semi, color: S.text, marginBottom: 6 }}>Gift voucher</div>
      <div style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
        <input
          type="text"
          value={typed}
          onChange={function (e) { setTyped(e.target.value); setErr(""); }}
          onKeyDown={function (e) { if (e.key === "Enter") { e.preventDefault(); attach(); } }}
          placeholder="Voucher number"
          autoCapitalize="characters"
          aria-label="Voucher number to attach to this booking"
          className="mgt-hover-scale"
          style={{ ...mkInp(), flex: 1, minWidth: 0 }} />
        <button type="button" onClick={attach}
          style={mkBtn({ fontSize: T.body, background: BTN.nav, borderRadius: R.pill })}>
          Attach
        </button>
      </div>
      <div role="alert">
        <Reveal show={!!err}><InlineAlert style={{ marginTop: 8 }}>{err}</InlineAlert></Reveal>
      </div>
    </Section>
  );
}
