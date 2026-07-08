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
import { S, STATUS_COLORS } from "../lib/constants";
import { searchBookings, formatPhone } from "../lib/customers";
import { Overlay, mkInp, mkBtn, AutoHeight } from "./atoms";

export function SearchPanel({ bookings, todayStr, onPick, onClose }) {
  const [query, setQuery] = useState("");
  const inputRef = useRef(null);
  useEffect(function () { if (inputRef.current) inputRef.current.focus(); }, []);

  const results = query.trim() ? searchBookings(bookings, query, todayStr, 30) : [];

  const rows = results.map(function (b) {
    const sc = STATUS_COLORS[b.status] || STATUS_COLORS.confirmed;
    return (
      <button
        key={b.id}
        onClick={function () { onPick(b); }}
        className="mgt-hover-scale"
        style={{
          display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", width: "100%",
          padding: "10px 12px", marginBottom: 6, borderRadius: 12, cursor: "pointer",
          background: "var(--bg-soft)", border: "1px solid var(--border-soft)", textAlign: "left",
          boxShadow: "var(--shadow-input)"
        }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: S.text, minWidth: 84 }}>{b.date}</span>
        <span style={{ fontSize: 12, color: S.text, minWidth: 44 }}>{b.scheduledTime || b.time}</span>
        <span style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 700, color: S.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{b.name || "(no name)"}</span>
        <span style={{ fontSize: 12, color: S.muted }}>{b.size + " pax"}</span>
        {b.phone ? <span style={{ fontSize: 12, color: S.muted }}>{formatPhone(b.phone)}</span> : null}
        <span style={{ fontSize: 10, fontWeight: 700, borderRadius: 8, padding: "2px 8px", background: sc.bg, border: "1px solid " + sc.border, color: sc.text, textTransform: "capitalize" }}>{b.status}</span>
      </button>
    );
  });

  const footerEl = (
    <div style={{ display: "flex", justifyContent: "flex-end" }}><button
      className="mgt-hover-scale mgt-press"
      style={mkBtn({ minHeight: 44, padding: "10px 18px", background: "#64748b" })}
      onClick={onClose}>Done</button></div>
  );

  return (
    <Overlay onClose={onClose} footer={footerEl}>
      <div style={{ textAlign: "center", marginBottom: 14 }}><div
        style={{ fontSize: 16, fontWeight: 700, color: "var(--text-on-accent)", display: "inline-block", padding: "8px 16px", borderRadius: 12, background: "rgba(0,122,255,0.75)", border: "1px solid rgba(255,255,255,0.2)", boxShadow: "0 1px 4px rgba(0,0,0,0.1), inset 0 1px 1px rgba(255,255,255,0.15)" }}>Find a booking</div></div>
      <input
        ref={inputRef}
        value={query}
        onChange={function (e) { setQuery(e.target.value); }}
        placeholder="Search by name or phone, any date…"
        className="mgt-hover-scale"
        style={mkInp()} />
      <AutoHeight>
        <div style={{ marginTop: 12 }}>
          {query.trim()
            ? (rows.length ? rows : <div style={{ textAlign: "center", padding: "20px 0", color: S.muted, fontSize: 13 }}>No bookings match.</div>)
            : <div style={{ textAlign: "center", padding: "16px 0", color: S.muted, fontSize: 13 }}>Type a name or phone number to search every date.</div>}
        </div>
      </AutoHeight>
    </Overlay>
  );
}
