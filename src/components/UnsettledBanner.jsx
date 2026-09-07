// src/components/UnsettledBanner.jsx
//
// v18.0.0 — the UNSETTLED voucher section: a booking that completed carrying a
// voucher that was never redeemed against it.
//
// ── WHY THIS STATE EXISTS AT ALL ────────────────────────────────────────────
// It is not an inconsistency, it is the honest answer to a question nobody was
// there to ask. Two paths reach it, and both are deliberate:
//
//   * **The close-time auto-complete** flips every still-seated booking to
//     `completed` at closing with nobody present, and must never redeem —
//     there is no human to say how much of the bill the voucher covered. Same
//     shape as v17.16.12's `seatingClosed` gate: a status path that runs
//     without a person needs its own answer.
//   * **"Complete without using it"** in the redeem modal, which is somebody
//     choosing to settle it later so the table can be freed now.
//
// So this section is the second half of both of those decisions. Without it,
// "settle it later" has no later — and the redeem modal says in as many words
// that the booking "will show as unsettled until someone records it", which is
// a promise this file keeps.
//
// ── SCOPED TO THE VIEWED DATE, NOT TO TODAY ─────────────────────────────────
// Unlike Running late / Waitlist / Overlap, which are today-only. Money left
// unrecorded does not stop mattering because the day rolled over — the whole
// point is that staff settle it NEXT service, which means seeing it on a day
// that is no longer today. `ClashBanner` is scoped the same way, for the
// related reason that its rows correspond to what is drawn on the day in front
// of you.
//
// The row's action opens the booking, because settling is an edit of the
// booking rather than of the voucher: re-completing it raises the redeem
// prompt again, which is the one flow that writes the ledger.

import { BannerRows } from "./BannerRows";
import { mkBtn } from "./atoms";
import { formatCode, normalizeCode, remainingOf } from "../lib/vouchers";
import { BTN, T, FW, H } from "../lib/constants";

export function UnsettledBanner({ bookings, vouchersByCode, currency = "€", onOpen, swapKey }) {
  const byId = new Map(bookings.map(function (b) { return [b.id, b]; }));

  function renderRow(id) {
    const b = byId.get(id);
    if (!b) return null;
    const code = normalizeCode(b.voucherCode);
    const v = vouchersByCode[code];
    // `(no name)` — the fallback every other banner carries, and the one
    // ClashBanner shipped without: `sanitize` writes `name: b.name || ""` and
    // the form does not require a name, so a nameless booking would give the
    // button the accessible name "Settle  " and identify nothing.
    const who = b.name || "(no name)";
    const left = v ? remainingOf(v) : 0;
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap", padding: "8px 0" }}>
        <span style={{ fontSize: T.body, color: "var(--warn-text)", fontWeight: FW.semi, flex: "1 1 auto", minWidth: 0 }}>
          {who + " (" + b.time + ") completed with voucher " + formatCode(code)
            + " still unrecorded — " + left + " " + currency + " on it."}
        </span>
        <button
          onClick={function () { onOpen(b.id); }}
          className="mgt-hover-scale"
          // The visible text LEADS and the disambiguator follows (v17.15.4):
          // "Settle" is what a voice-control user can say, and the name is what
          // tells sixty rows apart.
          aria-label={"Settle " + who + "'s voucher"}
          style={mkBtn({ fontSize: T.body, minHeight: H.chrome, padding: "4px 12px", background: BTN.orange })}>
          {"Settle " + who}
        </button>
      </div>
    );
  }

  // No ✕ dismissal, deliberately, and it is the one banner without one. The
  // other four are notices about a situation you may already know about; this
  // is an unfinished piece of bookkeeping about money, and it CLEARS ITSELF the
  // moment somebody records it. A dismissal here would hide a thing that has
  // not been done, which is the opposite of what the row is for.
  return (
    <BannerRows ids={bookings.map(function (b) { return b.id; })} renderRow={renderRow} swapKey={swapKey} />
  );
}
