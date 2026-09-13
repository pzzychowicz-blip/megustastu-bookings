// src/components/VouchersSettings.jsx
//
// v18.0.0 phase 1 — Settings → Vouchers tab body. The 7th tab, after Customers:
// General and Layout are what the restaurant IS, Customers and Reminders are
// what it HOLDS, and vouchers are what it holds.
//
// The tab carries BOTH the records and their configuration — issue · search ·
// filter · void, plus the default expiry period. That is the whole point of
// `settings/voucherDefaults` existing: a voucher setting is edited where
// vouchers are.
//
// ── THERE IS NO DELETE HERE, AND THAT IS DELIBERATE ─────────────────────────
// Do not add one. A voucher's number must never be released: `generateCode`
// excludes every code that has ever existed, and it can only do that because
// every code that has ever existed is still a child of `/vouchers`. Deleting one
// frees its number for re-issue to a second customer. **Voiding** is the action
// — it keeps the child, and therefore the key, and therefore the number, taken
// forever. `useVouchers` has no delete function, and the security rules refuse
// one server-side (`.write` requires `newData.exists()`), so this is three
// layers agreeing rather than a convention someone has to remember.
//
// Props (threaded App → SettingsContent → here, the LayoutSettings pattern):
//   vouchers          — the sanitised list from useVouchers
//   bookings          — to show which booking each redemption belongs to
//   currency          — settings/general.currency; vouchers add no second source
//   voucherDefaults   — settings/voucherDefaults (the expiry period)
//   onIssue(fields)   — returns { ok, code, error }
//   onVoid(code, on)
//   onSaveDefaults(partial)

import { useState, useMemo, useRef, useEffect } from "react";
import { S, BTN, R, T, FW, IC, H, SP } from "../lib/constants";
import {
  formatCode, normalizeCode, voucherState, remainingOf, valueOf, redeemedTotal,
  MANUAL_CODE_MIN, MANUAL_CODE_MAX, expiryFrom, money,
} from "../lib/vouchers";
import { EXPIRY_MIN, EXPIRY_MAX } from "../hooks/useVoucherDefaults";
import { Section, OutlineChip, Reveal, InlineAlert, Fld, mkInp, mkBtn } from "./atoms";
import { ChevronDownIcon, ChevronRightIcon, CopyIcon, CheckIcon } from "./Icons";

// The four states, and the chip tone each reads as. `open` is the only one that
// can still be spent, so it is the only one in success green.
const STATE_TONE = { open: "success", spent: "neutral", expired: "warn", void: "danger" };
const STATE_LABEL = { open: "open", spent: "spent", expired: "expired", void: "void" };

// v18.0.0 session 9: the Copy controls form a COLUMN, and the only stable anchor
// for one is the row's LEFT edge. Measured in the running app at Commit 100, six
// rows: the text block sizes to its own content (189–195px, driven by the
// amount's digit count) and the Copy button sits 8px after it, so the six landed
// at x = 477.3 · 475.3 · 472.1 · 477.6 · 472.6 · 472.9 — a ragged 5.5px spread.
//
// Anchoring from the RIGHT instead is worse, not better, and that was measured
// too: the disclosure control's width varies with its chip count and its money
// figure (142–200px), so the `flex: 1` wrapper is 266–324px wide and pinning the
// button to its right edge would have spread the six over 58px.
//
// So the text block takes a fixed BASIS. 204px clears the widest line the screen
// can currently produce — a four-figure amount with a full expiry date measures
// ~201px rendered — and it is `0 1 <basis>`, never `0 0`: the block may still
// shrink on a phone, where the row wraps anyway, and content wider than the
// basis WRAPS rather than being clipped, because a voucher number nobody can
// read is the one thing this panel must not ship.
const CODE_COL = 204;

function dateLabel(ms) {
  if (!ms) return "—";
  const d = new Date(ms);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

// ── Copy the number ─────────────────────────────────────────────────────────
// v18.0.0 session 8 (item 2a). Patryk: the voucher number must be selectable,
// to copy and paste out of Settings → Vouchers. Measured live 2026-09-11: it
// computed `user-select: none`, because it sat inside the row's `role="button"`
// and `src/index.css` gives every control that rule — so the number could not
// be selected by any means, on any device.
//
// It was a TEXT button until v18.0.0 session 8, on the grounds that the natural
// copy glyph is two overlapping sheets — `ClashIcon`'s silhouette — and that
// icon is an IDENTITY in the notification strip's collapsed tally rather than a
// decoration. That reasoning was right about the hazard and wrong about the
// conclusion, and Patryk's call settled it: the mark he supplied encloses the
// two sheets in a RING, which is what separates it from ClashIcon at a glance.
// `CopyIcon` carries the argument in full; the thing not to do is drop the
// circle, which lands straight back on the collision.
//
// Self-contained on purpose: the live region is INSIDE the button rather than
// one shared region in the panel, because the same control is used in a second
// place (the issue confirmation) and a shared region would make that call site
// depend on which parent it happens to sit in. It is always mounted and starts
// empty — a live region created already holding its message announces nothing.
//
// With no visible text there is nothing for Label-in-Name (WCAG 2.5.3) to
// match, so the name is free — but it still changes with the state ("Copy
// voucher X" → "Copied voucher X"), because the MARK changes too and a name
// that stayed put would describe the wrong icon. Both literals are pinned by
// `tests/a11y.test.js`, which is why they are spelled exactly as they were.
//
// The confirmation is the mark swapping to a CHECK, not a colour change: this
// button is 32px of surface with no room for a word, and colour alone is not a
// state. It reverts after 2s, with the live region doing the announcing.
function CopyBtn({ code }) {
  const [done, setDone] = useState(false);
  const timer = useRef(null);
  useEffect(function () { return function () { clearTimeout(timer.current); }; }, []);
  const text = formatCode(code);
  function doCopy(e) {
    // The row around it is no longer a button, but the issue confirmation sits
    // inside other handlers — stopping here costs nothing and cannot surprise.
    e.stopPropagation();
    if (!navigator.clipboard || !navigator.clipboard.writeText) return;
    navigator.clipboard.writeText(text).then(function () {
      setDone(true);
      clearTimeout(timer.current);
      // Cleared so a SECOND copy re-announces: a live region speaks when its
      // text CHANGES, and re-setting the same string is not a change.
      timer.current = setTimeout(function () { setDone(false); }, 2000);
    }, function () {});
  }
  return (
    <>
      <button
        type="button"
        onClick={doCopy}
        aria-label={(done ? "Copied voucher " : "Copy voucher ") + text}
        title={done ? "Copied" : "Copy the number"}
        className="mgt-hover-scale"
        style={mkBtn({
          padding: SP.none, minHeight: H.compact, width: H.compact,
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          background: BTN.nav,
        })}>
        {done ? <CheckIcon size={IC.chrome} /> : <CopyIcon size={IC.chrome} />}
      </button>
      <span className="mgt-sr-only" role="status" aria-live="polite">{done ? "Copied " + text : ""}</span>
    </>
  );
}

// ── One voucher row ──────────────────────────────────────────────────────────
function VoucherRow({ v, bookings, currency, now, open, onToggle, onVoid }) {
  const state = voucherState(v, now);
  const spent = redeemedTotal(v);
  const led = Object.keys(v.redemptions || {});
  // v18.0.0 session 8 (item 5a): reversals, newest first — a restored balance
  // used to leave no mark on the money record at all.
  const revs = Object.keys(v.reversals || {}).sort(function (a, b) {
    return (v.reversals[b].reversedAt || 0) - (v.reversals[a].reversedAt || 0);
  });
  return (
    <div style={{ border: "1px solid var(--border-soft)", borderRadius: R.card, marginBottom: 6, background: "var(--bg-card)" }}>
      {/* v18.0.0 session 8 (item 2a): the number is OUT of the disclosure
          control. It used to sit inside a `role="button"`, which makes its
          children presentational AND subscribes it to `src/index.css`'s
          `user-select: none` control rule — so the one thing on this screen
          somebody needs to copy was the one thing that could not be selected.
          Moving the number out and making the REST a real <button> also
          settles the other half: a `role="button"` holding a Copy button is
          the container-of-controls defect `tests/a11y.test.js` exists for. */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "10px 12px", borderRadius: R.card }}>
        {/* v18.0.0 session 8: the copy control sits WITH the number it copies —
            after the number and the expiry line — rather than floated to the far
            edge of the row. The `flex: 1` moved OUT to a wrapper holding the
            pair, and the disclosure control still owns the right edge: nothing
            else in the row moved. Session 9 then took the slack back OFF the
            number and gave it a fixed `CODE_COL` basis, which is what makes the
            Copy controls line up as a column — see that constant. */}
        <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ minWidth: 0, flex: "0 1 " + CODE_COL + "px" }}>
            <div style={{ fontSize: T.lead, fontWeight: FW.bold, color: S.text, fontVariantNumeric: "tabular-nums", userSelect: "text", cursor: "text" }}>{formatCode(v.code)}</div>
            <div style={{ fontSize: T.body, color: S.muted }}>
              {money(valueOf(v), currency) + " issued  ·  " + (v.expiresAt ? "expires " + dateLabel(v.expiresAt) : "no expiry")}
            </div>
          </div>
          <CopyBtn code={v.code} />
        </div>
        <button
          type="button"
          aria-expanded={open}
          // The control's name has to carry the voucher, or every row in the
          // list announces identically — v17.15.6's dynamic-label rule. The
          // chips inside are presentational, which is correct here and was
          // correct before: their meaning is in this name.
          aria-label={"Voucher " + formatCode(v.code) + ", " + STATE_LABEL[state] + ", " + money(remainingOf(v), currency) + " left"}
          onClick={onToggle}
          // Making an element focusable makes the browser scroll it into view
          // on MOUSEDOWN, so it moves out from under the finger between press
          // and release and the click is lost (measured up to 297px on a List
          // card, v17.12.0). preventDefault here suppresses only focus — not
          // the click, not pointer events.
          onMouseDown={function (e) { e.preventDefault(); }}
          className="mgt-hover-scale"
          // borderRadius is REQUIRED on any .mgt-hover-scale element: since
          // v17.7.0 the hover rule no longer supplies one but still paints an
          // opaque --bg-hover-card, so a radius-less element renders that fill
          // as a hard-edged rectangle inside its own rounded card.
          //
          // v18.0.0 session 8: the surface is `--bg-soft`, and it may NOT go
          // back to `BTN.nav`. That token is declared once in src/index.css and
          // is therefore theme-INVARIANT dark slate, while everything this
          // control contains — two or three OutlineChips and the chevron — is
          // painted in inks that FLIP. In dark they are pale on dark and read
          // fine; in light they are dark on dark. Measured in the running app,
          // light theme, against the browser's own resolved tokens: the fill
          // composites to rgb(147,149,152) and carries --success-text at
          // 2.37:1, --text-secondary at 2.51:1 and --text-muted at 1.99:1,
          // where the same three on --bg-soft are 6.83, 7.21 and 5.74. The one
          // ink the registry ever paired with --btn-nav is --text-on-accent, at
          // exactly the 3:1 button bar — i.e. that fill is tuned for white and
          // nothing else, which is what `CopyBtn` beside this correctly uses.
          //
          // This is CLAUDE.md's rule ("a colour token may only sit on a surface
          // that flips with it") and the shape is the Customers row two files
          // over: an identical header whose chips and chevron sit on the panel
          // surface with no solid fill at all. The border comes with the fill —
          // --border-glass is a white rim FOR a saturated fill and is invisible
          // on this one, so the control takes the row's own --border-soft and
          // reads as an outlined secondary rather than as nothing.
          style={mkBtn({ display: "flex", gap: 4, flexShrink: 0, alignItems: "center", padding: "6px 8px", minHeight: H.compact, background: "var(--bg-soft)", border: "1px solid var(--border-soft)", borderRadius: R.card })}>
          <OutlineChip tone={STATE_TONE[state]}>{STATE_LABEL[state]}</OutlineChip>
          <OutlineChip tone="neutral">{money(remainingOf(v), currency) + " left"}</OutlineChip>
          {v.origin === "manual" ? <OutlineChip tone="neutral">manual</OutlineChip> : null}
          <span style={{ display: "flex", color: S.muted }}>
            {open ? <ChevronDownIcon size={IC.control} /> : <ChevronRightIcon size={IC.control} />}
          </span>
        </button>
      </div>

      <Reveal show={open}>
        <div style={{ padding: "0 12px 12px" }}>
          <div style={{ fontSize: T.body, color: S.muted, marginBottom: 6 }}>
            {"Issued " + dateLabel(v.issuedAt) + (v.issuedBy ? " by " + v.issuedBy : "") + "  ·  " + money(spent, currency) + " redeemed"}
          </div>
          {v.notes ? <div style={{ fontSize: T.body, color: S.text, marginBottom: 6 }}>{v.notes}</div> : null}

          {led.length ? (
            <div style={{ marginBottom: 8 }}>
              {led.map(function (bid) {
                const e = v.redemptions[bid];
                const b = (bookings || []).find(function (x) { return x.id === bid; });
                return (
                  <div key={bid} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", borderRadius: R.inset, background: "var(--bg-soft)", border: "1px solid var(--border-soft)", marginBottom: 4 }}>
                    <span style={{ fontSize: T.body, fontWeight: FW.semi, color: S.text, minWidth: 84 }}>{money(e.amount, currency)}</span>
                    <span style={{ fontSize: T.body, color: S.muted }}>
                      {b ? (b.date + " · " + (b.scheduledTime || b.time) + " · " + (b.name || "(no name)")) : "booking " + bid}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div style={{ fontSize: T.body, color: S.muted, marginBottom: 8 }}>Not redeemed yet.</div>
          )}

          {/* The reversals, under the redemptions and visibly quieter: this is
              what DID NOT end up being spent, and it exists so that a restored
              balance is explicable months later. */}
          {revs.length ? (
            <div style={{ marginBottom: 8 }}>
              {revs.map(function (rid) {
                const e = v.reversals[rid];
                const b = (bookings || []).find(function (x) { return x.id === e.bookingId; });
                return (
                  <div key={rid} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", borderRadius: R.inset, border: "1px dashed var(--border-soft)", marginBottom: 4 }}>
                    <span style={{ fontSize: T.body, fontWeight: FW.semi, color: S.muted, minWidth: 84 }}>{"Reversed " + money(e.amount, currency)}</span>
                    <span style={{ fontSize: T.body, color: S.muted }}>
                      {(b ? (b.date + " · " + (b.scheduledTime || b.time) + " · " + (b.name || "(no name)")) : "booking " + e.bookingId)
                        + (e.reversedBy ? "  ·  by " + e.reversedBy : "")
                        + (e.reversedAt ? "  ·  " + dateLabel(e.reversedAt) : "")}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : null}

          {/* Void / un-void. The only destructive-looking action there is, and
              it is not destructive: the record and its number both stay. */}
          <button
            type="button"
            onClick={function (e) { e.stopPropagation(); onVoid(v.code, state !== "void"); }}
            aria-label={(state === "void" ? "Reinstate" : "Void") + " voucher " + formatCode(v.code)}
            className="mgt-hover-scale"
            style={mkBtn({ fontSize: T.body, minHeight: 36, background: state === "void" ? BTN.nav : BTN.del })}>
            {state === "void" ? "Reinstate voucher" : "Void voucher"}
          </button>
          <div style={{ fontSize: T.micro, color: S.muted, marginTop: 6 }}>
            Voiding stops a voucher being used. The number stays recorded and is never re-issued.
          </div>
        </div>
      </Reveal>
    </div>
  );
}

// Hoisted to module scope on purpose. A component defined inside another
// component's body is a NEW type on every render, so React unmounts and
// remounts its whole DOM subtree — the v15.8.0 TimelineBlock lesson.
function FilterBtn({ id, label, active, onPick }) {
  return (
    <button type="button" onClick={function () { onPick(id); }}
      // A control that paints itself selected with a fill must say so, or its
      // state is colour alone (v17.15.6).
      aria-pressed={active}
      className="mgt-hover-scale"
      style={mkBtn({ fontSize: T.body, minHeight: 32, padding: "4px 12px", background: active ? "var(--accent)" : BTN.nav })}>
      {label}
    </button>
  );
}

// ── The tab ──────────────────────────────────────────────────────────────────
export function VouchersTabContent({
  vouchers, bookings, currency = "€", voucherDefaults,
  onIssue, onVoid, onSaveDefaults,
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");     // all | open | spent | void
  const [openCode, setOpenCode] = useState(null);

  // Issue form
  const [amount, setAmount] = useState("");
  const [manualCode, setManualCode] = useState("");
  const [notes, setNotes] = useState("");
  const [issueErr, setIssueErr] = useState("");
  // v18.0.0 session 9: WHICH field the refusal is about, taken from
  // `validateIssue` rather than re-derived by matching its message text here.
  const [issueErrField, setIssueErrField] = useState("");
  // The refusal was a plain styled div with no role, inside a `Reveal` that
  // mounts only when it has something to say — so it announced NOTHING (a live
  // region must already be in the tree when its content changes), and neither
  // input carried `aria-invalid` or `aria-describedby`. Measured live: the
  // message was a bare <span>, no role, no aria-live, no live-region ancestor,
  // and the Amount input reported neither attribute. Visible-only feedback on a
  // primary action that reports `disabled:false` and full opacity, so nothing
  // predicts the refusal either.
  const ISSUE_ERROR_ID = "mgt-voucher-issue-error";
  const [issued, setIssued] = useState("");

  // Read ONCE per mount, not per render. Two reasons and both matter: a
  // `Date.now()` in the render body makes the render non-idempotent, and it
  // would land in the `useMemo` dep arrays below — where a value that changes
  // every render defeats the memo completely, which is worse than not having
  // one. Expiry is a day-granularity concept and this panel is open for
  // seconds; a boundary crossing while it sits open is not worth a live clock,
  // and reopening Settings re-reads it.
  const [now] = useState(function () { return Date.now(); });
  const rows = useMemo(function () {
    const q = query.trim().toUpperCase();
    return (vouchers || [])
      .filter(function (v) {
        const st = voucherState(v, now);
        if (filter === "open" && st !== "open") return false;
        if (filter === "spent" && st !== "spent") return false;
        if (filter === "void" && st !== "void" && st !== "expired") return false;
        if (!q) return true;
        // Searched on the NORMALISED code, so typing it with or without the
        // hyphen finds the same voucher — the one normaliser again.
        return v.code.includes(normalizeCode(q)) || (v.notes || "").toUpperCase().includes(q);
      })
      .sort(function (a, b) { return (b.issuedAt || 0) - (a.issuedAt || 0); });
  }, [vouchers, query, filter, now]);

  const totals = useMemo(function () {
    const live = (vouchers || []).filter(function (v) { return voucherState(v, now) === "open"; });
    return {
      count: (vouchers || []).length,
      outstanding: live.reduce(function (a, v) { return a + remainingOf(v); }, 0),
      liveCount: live.length,
    };
  }, [vouchers, now]);

  // A disabled control takes NO hover lift, and pairs the state with opacity +
  // cursor — the shape CustomersSettings' own steppers use.
  const atMin = !voucherDefaults || voucherDefaults.expiryMonths <= EXPIRY_MIN;
  const atMax = !voucherDefaults || voucherDefaults.expiryMonths >= EXPIRY_MAX;

  function doIssue() {
    setIssueErr("");
    setIssueErrField("");
    setIssued("");
    const months = voucherDefaults ? voucherDefaults.expiryMonths : 12;
    const r = onIssue({
      code: manualCode,
      value: amount,
      notes: notes,
      expiresAt: expiryFrom(Date.now(), months),
    });
    if (!r || !r.ok) { setIssueErr((r && r.error) || "Couldn't issue the voucher."); setIssueErrField((r && r.field) || ""); return; }
    setIssued(r.code);
    setAmount("");
    setManualCode("");
    setNotes("");
  }

  return (
    <div>
      {/* ── Issue ─────────────────────────────────────────────────────────── */}
      <Section>
        <div style={{ fontSize: T.lead, fontWeight: FW.bold, color: S.text, marginBottom: 8 }}>Issue a voucher</div>

        {/* `Fld`, not hand-written labels — /code-review v18.0.0, the same
            defect reported against VoucherPicker. This tab had three of them,
            each reproducing the atom's look by eye. The FUNCTION shape gives
            every input a real `useId` association. */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 120px", minWidth: 0 }}>
            <Fld label={"Amount (" + currency + ")"} invalid={issueErrField === "value"} describedBy={ISSUE_ERROR_ID}>{function (fid, attrs) {
              return <input id={fid} {...attrs} type="number" min={0} step={5} inputMode="decimal" value={amount}
                onChange={function (e) { setAmount(e.target.value); }}
                placeholder="50" className="mgt-hover-scale" style={mkInp()} />;
            }}</Fld>
          </div>
          <div style={{ flex: "2 1 200px", minWidth: 0 }}>
            <Fld label="Number (leave blank to generate)" invalid={issueErrField === "code"} describedBy={ISSUE_ERROR_ID}>{function (fid, attrs) {
              return <input id={fid} {...attrs} type="text" value={manualCode}
                onChange={function (e) { setManualCode(e.target.value); }}
                placeholder="from a printed book" autoCapitalize="characters" className="mgt-hover-scale" style={mkInp()} />;
            }}</Fld>
          </div>
        </div>

        <Fld label="Notes (optional)">{function (fid) {
          return <input id={fid} type="text" value={notes} onChange={function (e) { setNotes(e.target.value); }}
            placeholder="Birthday gift for Ana" className="mgt-hover-scale" style={mkInp()} />;
        }}</Fld>

        <div style={{ fontSize: T.micro, color: S.muted, marginBottom: 8 }}>
          {"A typed number is used exactly as entered (" + MANUAL_CODE_MIN + "–" + MANUAL_CODE_MAX +
           " letters or digits; spaces and dashes are ignored). Generated numbers avoid 0/O and 1/I/L so they survive being read out over the phone."}
        </div>

        <button type="button" onClick={doIssue}
          className="mgt-hover-scale"
          style={mkBtn({ fontSize: T.body, minHeight: 40, background: "var(--accent)" })}>Issue voucher</button>

        {/* The `role="alert"` wrapper is permanently mounted and only its CHILD
            is conditional — the booking form's shape, for the booking form's
            reason: an alert is announced when its CONTENT changes, so a region
            that arrives already holding its message says nothing. `Reveal`
            stays INSIDE it so the animation is unchanged. */}
        <div role="alert"><Reveal show={!!issueErr}>
          {issueErr ? <InlineAlert id={ISSUE_ERROR_ID} style={{ marginTop: 8 }}>{issueErr}</InlineAlert> : null}
        </Reveal></div>
        {/* v18.0.0 session 8 (item 2a): the number you have just issued is the
            one most likely to be copied — it is about to be typed into a card
            or a message. CopyBtn sits BESIDE the announcement rather than
            inside it: this div is already a `role="status"`, and a live region
            nested in a live region announces twice. */}
        <Reveal show={!!issued}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
            <div role="status" style={{ fontSize: T.body, color: S.text }}>
              {"Issued "}<strong style={{ fontVariantNumeric: "tabular-nums" }}>{formatCode(issued)}</strong>
            </div>
            {issued ? <CopyBtn code={issued} /> : null}
          </div>
        </Reveal>
      </Section>

      {/* ── Default expiry ────────────────────────────────────────────────── */}
      <Section>
        <div style={{ fontSize: T.lead, fontWeight: FW.bold, color: S.text, marginBottom: 4 }}>Default validity</div>
        <div style={{ fontSize: T.body, color: S.muted, marginBottom: 8 }}>
          How long a newly issued voucher stays usable. Vouchers already issued keep the date they were given.
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button type="button"
            aria-label="Fewer months"
            disabled={atMin}
            className={atMin ? undefined : "mgt-hover-scale"}
            onClick={function () { onSaveDefaults({ expiryMonths: voucherDefaults.expiryMonths - 1 }); }}
            style={mkBtn({ fontSize: T.lead, minHeight: 28, padding: "2px 10px", background: BTN.nav, opacity: atMin ? 0.4 : 1, cursor: atMin ? "not-allowed" : "pointer" })}>−</button>
          <span style={{ fontSize: T.body, color: S.text, minWidth: 96, textAlign: "center" }}>
            {voucherDefaults && voucherDefaults.expiryMonths > 0
              ? voucherDefaults.expiryMonths + " month" + (voucherDefaults.expiryMonths !== 1 ? "s" : "")
              : "Never expires"}
          </span>
          <button type="button"
            aria-label="More months"
            disabled={atMax}
            className={atMax ? undefined : "mgt-hover-scale"}
            onClick={function () { onSaveDefaults({ expiryMonths: voucherDefaults.expiryMonths + 1 }); }}
            style={mkBtn({ fontSize: T.lead, minHeight: 28, padding: "2px 10px", background: BTN.nav, opacity: atMax ? 0.4 : 1, cursor: atMax ? "not-allowed" : "pointer" })}>+</button>
        </div>
      </Section>

      {/* ── The list ──────────────────────────────────────────────────────── */}
      <Section>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 8 }}>
          <div style={{ fontSize: T.lead, fontWeight: FW.bold, color: S.text, flex: 1 }}>Vouchers</div>
          <OutlineChip tone="neutral">{totals.count + " total"}</OutlineChip>
          <OutlineChip tone="success">{money(totals.outstanding, currency) + " outstanding"}</OutlineChip>
        </div>

        <input type="search" value={query} onChange={function (e) { setQuery(e.target.value); }}
          aria-label="Search vouchers by number or note"
          placeholder="Search by number or note…" className="mgt-hover-scale" style={{ ...mkInp(), marginBottom: 8 }} />

        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
          <FilterBtn id="all" label="All" active={filter === "all"} onPick={setFilter} />
          <FilterBtn id="open" label="Open" active={filter === "open"} onPick={setFilter} />
          <FilterBtn id="spent" label="Spent" active={filter === "spent"} onPick={setFilter} />
          <FilterBtn id="void" label="Void & expired" active={filter === "void"} onPick={setFilter} />
        </div>

        {rows.length === 0 ? (
          <div style={{ fontSize: T.body, color: S.muted, padding: "12px 0" }}>
            {totals.count === 0 ? "No vouchers yet. Issue one above." : "No vouchers match that."}
          </div>
        ) : rows.map(function (v) {
          return (
            <VoucherRow key={v.code} v={v} bookings={bookings} currency={currency} now={now}
              open={openCode === v.code}
              onToggle={function () { setOpenCode(openCode === v.code ? null : v.code); }}
              onVoid={onVoid} />
          );
        })}
      </Section>
    </div>
  );
}
