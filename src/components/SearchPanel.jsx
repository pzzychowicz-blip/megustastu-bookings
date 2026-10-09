// src/components/SearchPanel.jsx
//
// v16.3.0 — global booking search. An Overlay with an auto-focused input that
// matches any booking by name or phone ACROSS ALL DATES (searchBookings in
// customers.js — upcoming-first, then past). Tapping a result jumps to that
// booking's day and focuses it in the List (onPick). A quick "when is Maria's
// booking?" lookup the Customers tab doesn't cover.
//
// Props:
//   bookings   — full bookings list
//   todayStr   — today's ISO date (upcoming/past split; all-UTC)
//   guestTags  — `guestTagMap(bookings)`, and
//   tagList    — the tag list (v18.5.1): 3+ letters of a tag's name match too
//   isMobile   — App's `winW < 600`: the phone's two-line rows (v18.2.0 phase 76)
//   onPick(b)  — jump to the booking (App: setViewDate + select + close)
//   onClose()  — close the panel

import { useState, useRef, useEffect } from "react";
import { S, R, T, FW } from "../lib/constants";
import { searchBookings, matchedTagLabels, formatPhone } from "../lib/customers";
import { formatDay, showsYear } from "../lib/day";
import { guestsLabel } from "../lib/booking-logic";
import { Overlay, ModalTitle, mkInp, mkBtn, AutoHeight, SBadge, SBADGE_W, textWidth } from "./atoms";

// ── Fixed columns (v18.2.0 phase 76, round 2's X7) ───────────────────────────
// A result's guests, phone and status followed its name's width: measured at
// 1280×800 the guests began anywhere from 259 to 265px, 363 on a row with no
// phone, because the name took whatever the cells after it left. And on the
// 580px card there was no room to fix them: one result from another year widens
// every date to 104px, which cut the names to ~68px ("Hugo M…") already, and
// fixed guests, phone and status would have left 48. Patryk's pick of three:
// the card is FIND_CARD_W wide on a tablet, and each cell is a column.
//   · the name column is the widest name in the results, as the List card's is
//     (phase 18), so a short list leaves no gap — capped at NAME_CAP;
//   · guests and phone are the widest of each in the results, measured in the
//     fonts they are drawn in (NAME_FONT / CELL_FONT, spread into the spans);
//   · the status sits in an SBADGE_W cell, so every row's total is the same and
//     the name, the one cell that may shrink, shrinks the same in each.
// NAME_CAP is the room the card leaves: 720 − 2 × 24 (the card's padding) −
// 2 × 12 − 2 (the row's padding and border) = 646, less a year's date (104),
// the time (44), "88 guests" (57), a 15-digit phone (103), the badge (98) and
// five 10px gaps. On a phone the row wraps as it did (the name on a 64px basis
// fills line one, guests at its end; phone and status on line two), with the
// same widths, so each still lines up.
const FIND_CARD_W = 720;
const NAME_CAP = 190;
const TIME_COL = 44;
const DATE_FONT = { fontWeight: FW.bold, fontSize: T.body };
const NAME_FONT = { fontWeight: FW.bold, fontSize: T.lead };
const CELL_FONT = { fontWeight: FW.regular, fontSize: T.body };
// v18.5.1: the tag a result matched by, under its name.
const TAG_FONT = { fontWeight: FW.regular, fontSize: T.small };

// The widest of `labels` in `font`, or undefined (the cells' natural widths)
// with no canvas — a test importing this file.
function widest(labels, font) {
  if (typeof document === "undefined") return undefined;
  const family = getComputedStyle(document.body).fontFamily;
  let w = 0;
  labels.forEach(function (l) { w = Math.max(w, textWidth(l, font.fontWeight, font.fontSize + "px", family)); });
  return w || undefined;
}

export function SearchPanel({ bookings, todayStr, isMobile, guestTags, tagList, onPick, onClose }) {
  const [query, setQuery] = useState("");
  const inputRef = useRef(null);
  useEffect(function () { if (inputRef.current) inputRef.current.focus(); }, []);

  const tagArg = tagList ? { map: guestTags, list: tagList } : null;
  const results = query.trim() ? searchBookings(bookings, query, todayStr, 30, tagArg) : [];
  // v18.5.1 (Patryk): the tags a result matched by, under its name, whether or
  // not the name matched too. "" on a row found by its name or phone alone,
  // which then has no second line.
  const tagOf = {};
  results.forEach(function (b) { tagOf[b.id] = matchedTagLabels(b, query, tagArg).join(", "); });

  // v18.2.0 (the design critique, C1): the date column is as wide as the widest
  // date the results hold — "Wed 24.09" is 66px in this bold and
  // "Wed 24.09.2025" 103 (measured on DEV) — so the times stay a column when a
  // booking from another year is among them. Phase 76 MEASURES it, like the
  // columns after it, so a wider system font (Roboto on the Android tablet)
  // cannot push the times out of line; the two numbers are the fallback with no
  // canvas.
  const dateCol = widest(results.map(function (b) { return formatDay(b.date); }), DATE_FONT)
    || (results.some(function (b) { return showsYear(b.date); }) ? 104 : 68);
  const nameW = widest(results.map(function (b) { return b.name || "(no name)"; }), NAME_FONT);
  // v18.5.1: the tag line is in the name column, so the column fits it too.
  const tagW = widest(results.map(function (b) { return tagOf[b.id]; }), TAG_FONT) || 0;
  const nameCol = nameW ? Math.min(NAME_CAP, Math.max(nameW, tagW)) : NAME_CAP;
  const paxCol = widest(results.map(function (b) { return guestsLabel(b.size); }), CELL_FONT);
  const phones = results.filter(function (b) { return b.phone; }).map(function (b) { return formatPhone(b.phone); });
  // v18.2.0 /code-review: "auto" when the width cannot be measured (no 2D
  // canvas), never undefined. The render tests `phoneCol` for WHETHER there is
  // a phone column, so an unmeasurable width used to hide every number.
  const phoneCol = phones.length ? (widest(phones, CELL_FONT) || "auto") : 0;

  const rows = results.map(function (b) {
    return (
      <button /* @no-lift a result row as wide as the card: .mgt-ac-row tints it through --row-bg */
        key={b.id}
        onClick={function () { onPick(b); }}
        // v18.4.0 (Patryk): a wide row takes the tint and neither the lift nor the press dip (DESIGN.md, Press feedback).
        // At 8% a 690px row grew 28px a side, and at 96% its date slid inward.
        className="mgt-ac-row mgt-nopress"
        style={{
          display: "flex", alignItems: "center", gap: 10, flexWrap: isMobile ? "wrap" : "nowrap", width: "100%",
          padding: "10px 12px", marginBottom: 6, borderRadius: R.inset, cursor: "pointer",
          "--row-bg": "var(--bg-soft)", "--row-bg-hover": "var(--bg-hover-card)", border: "1px solid var(--border-soft)", textAlign: "left",
          boxShadow: "var(--shadow-input)"
        }}>
        <span style={{ ...DATE_FONT, color: S.text, width: dateCol, flexShrink: 0 }}>{formatDay(b.date)}</span>
        <span style={{ fontSize: T.body, color: S.text, width: TIME_COL, flexShrink: 0 }}>{b.scheduledTime || b.time}</span>
        {/* v18.2.0 (C1): a BASIS, where it was `flex: 1` with a zero one. The row
            wraps on a phone, and a line is packed by basis, so a name that
            asked for 0px stayed on line one with whatever the phone and the
            badge left it: measured at 375px, 21.5px ("C…"), and 1.5px once a
            date with a year widened the column. 64px keeps a word and sends
            the phone and badge to line two (the name then fills line one:
            104px beside a year, 140 without). It is no bigger because the
            tablet's 506px line holds a year, a phone and a badge with 88px to
            spare, and 96 measured a wrap there that 64 does not. Phase 76
            keeps that basis on a phone; on the wider card the name is a
            column (the note above the component). */}
        <span style={{ flex: isMobile ? "1 1 64px" : "0 1 " + nameCol + "px", minWidth: 0, display: "flex", flexDirection: "column" }}>
          <span style={{ ...NAME_FONT, color: S.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{b.name || "(no name)"}</span>
          {tagOf[b.id] ? <span style={{ ...TAG_FONT, color: S.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{tagOf[b.id]}</span> : null}
        </span>
        <span style={{ ...CELL_FONT, color: S.muted, width: paxCol, flexShrink: 0, whiteSpace: "nowrap" }}>{guestsLabel(b.size)}</span>
        {phoneCol ? <span style={{ ...CELL_FONT, color: S.muted, width: phoneCol, flexShrink: 0, whiteSpace: "nowrap" }}>{b.phone ? formatPhone(b.phone) : ""}</span> : null}
        {/* v17.15.6: it IS `SBadge`. v17.7.0 gave this copy "the same fill, text
            and metrics as SBadge" and the sentence stopped being true the moment
            the atom moved: the icon arrived in v17.15.5 and the rim and metrics
            in v17.15.6, and none of it could reach a span typed out by hand.
            **A comment claiming parity with an atom is not parity with it.** */}
        <span style={{ width: SBADGE_W, flexShrink: 0, display: "flex" }}><SBadge status={b.status} /></span>
      </button>
    );
  });

  const footerEl = (
    <div style={{ display: "flex", justifyContent: "flex-end" }}><button
      className="mgt-hover-scale mgt-press"
      style={mkBtn({ minHeight: 44, padding: "10px 18px", background: "var(--app-btn-slate)" })}
      onClick={onClose}>Done</button></div>
  );

  return (
    <Overlay onClose={onClose} footer={footerEl} maxWidth={FIND_CARD_W}>
      <ModalTitle background="var(--app-btn-grey-strong)">Find a booking</ModalTitle>
      <input
        ref={inputRef}
        aria-label="Search bookings by name, phone number or tag"
        value={query}
        onChange={function (e) { setQuery(e.target.value); }}
        placeholder="Search by name, phone or tag, any date…"
        className="mgt-hover-scale"
        style={mkInp()} />
      <AutoHeight>
        <div style={{ marginTop: 12 }}>
          {query.trim()
            ? (rows.length ? rows : <div style={{ textAlign: "center", padding: "18px 0", color: S.muted, fontSize: T.body }}>No bookings match.</div>)
            : <div style={{ textAlign: "center", padding: "16px 0", color: S.muted, fontSize: T.body }}>Type a name, a phone number or a tag to search every date.</div>}
        </div>
      </AutoHeight>
    </Overlay>
  );
}
