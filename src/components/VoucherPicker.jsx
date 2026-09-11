// src/components/VoucherPicker.jsx
//
// v18.0.0 phase 1 — the booking form's voucher field: attach a gift voucher to
// this booking, or detach the one that is on it.
//
// ── IT IS A FORM FIELD, NOT A PANEL ─────────────────────────────────────────
// v18.0.0 correction. The first version rendered its own `<Section>` with a
// hand-written bold heading, so "Gift voucher" was a different KIND of thing on
// screen from "Notes" and "Deposit (€)" six pixels above it — the same label
// treatment invented twice, which is the defect this repo records for the
// `OutlineChip` that was typed out by hand. It is a `Fld` now, inside the same
// Section as those two, so the three read as one group and it inherits the
// atom's label association for free.
//
// **Both of `Fld`'s shapes are used, and each is the right one.** With nothing
// attached the field is an input (plus its Attach affordance and its dropdown,
// exactly like the name and phone fields), so it takes the FUNCTION shape and
// puts the generated id on the input. With a voucher attached there is no
// single control to point at — it is a row of chips and a Remove button — so it
// takes the ELEMENTS shape and `Fld` makes it a named `role="group"`.
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
//   vouchers        — the sanitised list, for the suggestion dropdown
//   vouchersByCode  — the code→voucher index from useVouchers
//   bookings        — for the "already on another live booking" check
//   bookingId       — editId, or null for a new booking
//   currency        — settings/general.currency

import { useState } from "react";
import { S, BTN, R, T, FW } from "../lib/constants";
import {
  normalizeCode, formatCode, voucherState, remainingOf,
  isRedeemedBy, attachRefusal, searchVouchers,
} from "../lib/vouchers";
import { useAcRow, AC_MENU, AC_ROW } from "../hooks/useAcRow";
import { Fld, OutlineChip, Reveal, InlineAlert, mkInp, mkBtn } from "./atoms";

const STATE_TONE = { open: "success", spent: "neutral", expired: "warn", void: "danger" };

export function VoucherPicker({ code, onChange, vouchers, vouchersByCode, bookings, bookingId, currency = "€", carriedFrom, suggestions }) {
  const [typed, setTyped] = useState("");
  const [err, setErr] = useState("");
  const [focus, setFocus] = useState(false);
  const acRowHandlers = useAcRow();
  // Once per mount, for the same reason the Vouchers tab reads it once: expiry
  // is a day-scale concept and a `Date.now()` in the render body is neither
  // pure nor stable enough to sit in a dependency.
  const [now] = useState(function () { return Date.now(); });

  const attached = code ? (vouchersByCode || {})[normalizeCode(code)] : null;
  const settledHere = attached && isRedeemedBy(attached, bookingId);

  function attach(raw) {
    const c = normalizeCode(raw === undefined ? typed : raw);
    if (!c) { setErr("Enter a voucher number."); return; }
    const refusal = attachRefusal((vouchersByCode || {})[c], c, bookings, bookingId, now);
    if (refusal) { setErr(refusal); return; }
    setErr("");
    setTyped("");
    setFocus(false);
    onChange(c);
  }

  // ── Something is attached ──────────────────────────────────────────────────
  // `Fld`'s ELEMENTS shape: there is no single control here to carry the label,
  // so the atom makes this a named group instead of emitting a dangling `for`.
  if (code) {
    const st = attached ? voucherState(attached, now) : null;
    return (
      <Fld label="Gift voucher">
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
              className="mgt-hover-scale"
              style={mkBtn({ fontSize: T.body, minHeight: 32, padding: "4px 12px", background: BTN.nav, borderRadius: R.pill })}>
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
        {/* v18.0.0 session 8 (item 7): where an attached voucher CAME FROM, when
            it was not typed here. Book Again pre-attaches the source visit's
            open voucher, and a code that appears by itself needs to say why —
            otherwise the only way to find out is to remember. Removable like any
            other attachment; this is a note, not a lock. */}
        {carriedFrom ? (
          <div style={{ fontSize: T.micro, color: S.muted, marginTop: 2 }}>{carriedFrom}</div>
        ) : null}
      </Fld>
    );
  }

  // ── Nothing attached ───────────────────────────────────────────────────────
  // The suggestion dropdown is the name/phone fields' own machinery, from the
  // shared `useAcRow` hook — so a tap on a row behaves identically here, and a
  // swipe that scrolls the list does not pick a voucher.
  const matches = focus ? searchVouchers(vouchers, typed, 20, now) : [];
  const menu = matches.length ? (
    <div style={AC_MENU}>
      {matches.map(function (v) {
        return (
          <div
            key={v.code}
            className="mgt-ac-row"
            {...acRowHandlers(function () { attach(v.code); })}
            style={AC_ROW}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: T.body, fontWeight: FW.semi, color: S.text, fontVariantNumeric: "tabular-nums" }}>
                {formatCode(v.code)}
              </div>
              {v.notes ? (
                <div style={{ fontSize: T.small, color: S.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {v.notes}
                </div>
              ) : null}
            </div>
            <OutlineChip tone="success">{remainingOf(v) + " " + currency + " left"}</OutlineChip>
          </div>
        );
      })}
    </div>
  ) : null;

  return (
    <Fld label="Gift voucher">{function (fid) {
      return (
        <div>
          {/* v18.0.0 session 8 (item 2b): a recognised guest's own open
              vouchers, offered before anybody types. The list comes from
              `guestOpenVouchers`, which has already applied the
              one-live-booking rule — so a row here can always be attached, and
              tapping one can never produce the refusal the picker would show a
              moment later. Capped at three: this is a prompt, not a catalogue,
              and the typed field below is still there for the rest. */}
          {suggestions && suggestions.length ? (
            <div style={{ marginBottom: 8 }}>
              {suggestions.slice(0, 3).map(function (s) {
                return (
                  <div key={s.code}
                    style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "6px 8px", borderRadius: R.inset, background: "var(--bg-soft)", border: "1px solid var(--border-soft)", marginBottom: 4 }}>
                    <span style={{ fontSize: T.body, color: S.text }}>
                      {"This guest has voucher "}
                      <strong style={{ fontVariantNumeric: "tabular-nums" }}>{formatCode(s.code)}</strong>
                      {"  ·  " + s.remaining + " " + currency + " left"}
                    </span>
                    {/* Not hidden when the last visit never recorded it: that is
                        money the restaurant has not accounted for, and the
                        person who can settle it is the one looking at this. */}
                    {s.unsettled ? <OutlineChip tone="warn">last visit not recorded</OutlineChip> : null}
                    <span style={{ flex: 1 }} />
                    <button type="button"
                      onClick={function () { attach(s.code); }}
                      aria-label={"Attach voucher " + formatCode(s.code) + " to this booking"}
                      className="mgt-hover-scale"
                      style={mkBtn({ fontSize: T.body, minHeight: 32, padding: "4px 12px", background: BTN.nav, borderRadius: R.pill })}>
                      Attach
                    </button>
                  </div>
                );
              })}
            </div>
          ) : null}
          <div style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
            <div style={{ position: "relative", flex: 1, minWidth: 0 }}>
              <input
                id={fid}
                type="text"
                value={typed}
                onChange={function (e) { setTyped(e.target.value); setErr(""); }}
                onFocus={function () { setFocus(true); }}
                onBlur={function () { setFocus(false); }}
                onKeyDown={function (e) { if (e.key === "Enter") { e.preventDefault(); attach(); } }}
                placeholder="Number, or pick from the list"
                autoCapitalize="characters"
                autoComplete="off"
                className="mgt-hover-scale"
                style={mkInp()} />
              {menu}
            </div>
            <button type="button" onClick={function () { attach(); }}
              className="mgt-hover-scale"
              style={mkBtn({ fontSize: T.body, background: BTN.nav, borderRadius: R.pill })}>
              Attach
            </button>
          </div>
          <div role="alert">
            <Reveal show={!!err}><InlineAlert style={{ marginTop: 8 }}>{err}</InlineAlert></Reveal>
          </div>
        </div>
      );
    }}</Fld>
  );
}
