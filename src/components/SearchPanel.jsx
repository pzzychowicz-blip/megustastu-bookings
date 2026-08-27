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
//   onPick(b)  — jump to the booking (App: setViewDate + select + close)
//   onClose()  — close the panel

import { useState, useRef, useEffect } from "react";
import { S, R, T, FW } from "../lib/constants";
import { searchBookings, formatPhone } from "../lib/customers";
import { Overlay, ModalTitle, mkInp, mkBtn, AutoHeight, SBadge } from "./atoms";

export function SearchPanel({ bookings, todayStr, onPick, onClose }) {
  const [query, setQuery] = useState("");
  const inputRef = useRef(null);
  useEffect(function () { if (inputRef.current) inputRef.current.focus(); }, []);

  const results = query.trim() ? searchBookings(bookings, query, todayStr, 30) : [];

  const rows = results.map(function (b) {
    return (
      <button
        key={b.id}
        onClick={function () { onPick(b); }}
        className="mgt-hover-scale"
        style={{
          display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", width: "100%",
          padding: "10px 12px", marginBottom: 6, borderRadius: R.inset, cursor: "pointer",
          background: "var(--bg-soft)", border: "1px solid var(--border-soft)", textAlign: "left",
          boxShadow: "var(--shadow-input)"
        }}>
        <span style={{ fontSize: T.body, fontWeight: FW.bold, color: S.text, minWidth: 84 }}>{b.date}</span>
        <span style={{ fontSize: T.body, color: S.text, minWidth: 44 }}>{b.scheduledTime || b.time}</span>
        <span style={{ flex: 1, minWidth: 0, fontSize: T.lead, fontWeight: FW.bold, color: S.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{b.name || "(no name)"}</span>
        <span style={{ fontSize: T.body, color: S.muted }}>{b.size + " pax"}</span>
        {b.phone ? <span style={{ fontSize: T.body, color: S.muted }}>{formatPhone(b.phone)}</span> : null}
        {/* v17.15.6: it IS `SBadge`. v17.7.0 gave this copy "the same fill, text
            and metrics as SBadge" and the sentence stopped being true the moment
            the atom moved: the icon arrived in v17.15.5 and the rim and metrics
            in v17.15.6, and none of it could reach a span typed out by hand.
            **A comment claiming parity with an atom is not parity with it.** */}
        <SBadge status={b.status} />
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
    <Overlay onClose={onClose} footer={footerEl}>
      <ModalTitle background="var(--app-btn-grey-strong)">Find a booking</ModalTitle>
      <input
        ref={inputRef}
        aria-label="Search bookings by name or phone number"
        value={query}
        onChange={function (e) { setQuery(e.target.value); }}
        placeholder="Search by name or phone, any date…"
        className="mgt-hover-scale"
        style={mkInp()} />
      <AutoHeight>
        <div style={{ marginTop: 12 }}>
          {query.trim()
            ? (rows.length ? rows : <div style={{ textAlign: "center", padding: "18px 0", color: S.muted, fontSize: T.body }}>No bookings match.</div>)
            : <div style={{ textAlign: "center", padding: "16px 0", color: S.muted, fontSize: T.body }}>Type a name or phone number to search every date.</div>}
        </div>
      </AutoHeight>
    </Overlay>
  );
}
