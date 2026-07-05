// src/components/CustomersSettings.jsx
//
// v16.0.0 — Settings → Customers tab body. Customer management over the
// phone-derived customer index (src/lib/customers.js — customers ARE the
// bookings, no separate collection): search by name or phone, per-customer
// booking history, and GDPR-style "delete customer & all data" (= delete every
// booking carrying that phone + their waitlist entries; the parent owns the
// actual write — see onDeleteCustomer).
//
// Deletion is armed-confirm (two taps) with an explicit "permanent, no
// backups" warning — Firebase free plan has no rollback.
//
// Props (threaded App → SettingsContent → here, the LayoutSettings pattern):
//   bookings              — full bookings list
//   waitlist              — waitlist entries (to show/delete alongside)
//   onDeleteCustomer(key) — normalized-phone key; parent deletes bookings +
//                           waitlist entries and reports the outcome

import { useState } from "react";
import { S, BTN, STATUS_COLORS } from "../lib/constants";
import { customerIndex, searchCustomers, normalizePhone, formatPhone } from "../lib/customers";
import { Section, Reveal, mkInp, mkBtn } from "./atoms";

export function CustomersTabContent({ bookings, waitlist, onDeleteCustomer }) {
  const [query, setQuery] = useState("");
  const [openKey, setOpenKey] = useState(null);   // expanded customer
  const [armedKey, setArmedKey] = useState(null); // delete armed for this key

  const idx = customerIndex(bookings);
  const all = Object.keys(idx).map(function (k) { return idx[k]; });
  const shown = query.trim()
    ? searchCustomers(idx, query, 50)
    : all.sort(function (a, b) {
        if (b.visits !== a.visits) return b.visits - a.visits;
        return (b.latestDate || "").localeCompare(a.latestDate || "");
      }).slice(0, 50);

  function waitCountOf(key) {
    return (waitlist || []).filter(function (w) { return w && normalizePhone(w.phone) === key; }).length;
  }

  const chip = function (label, colors) {
    return <span style={{ fontSize: 10, fontWeight: 700, borderRadius: 8, padding: "2px 6px", background: colors.bg, border: "1px solid " + colors.border, color: colors.text, flexShrink: 0 }}>{label}</span>;
  };

  const rows = shown.map(function (c) {
    const open = openKey === c.phone;
    const armed = armedKey === c.phone;
    const wlCount = waitCountOf(c.phone);
    const historyRows = open ? c.bookings.map(function (b) {
      const sc = STATUS_COLORS[b.status] || STATUS_COLORS.confirmed;
      return (
        <div key={b.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", borderRadius: 10, background: "var(--bg-soft)", border: "1px solid var(--border-soft)", marginBottom: 4 }}><span style={{ fontSize: 12, fontWeight: 600, color: S.text, minWidth: 84 }}>{b.date}</span><span style={{ fontSize: 12, color: S.text, minWidth: 44 }}>{b.scheduledTime || b.time}</span><span style={{ fontSize: 12, color: S.text, minWidth: 40 }}>{b.size + " pax"}</span><span style={{ fontSize: 10, fontWeight: 700, borderRadius: 8, padding: "2px 8px", background: sc.bg, border: "1px solid " + sc.border, color: sc.text, textTransform: "capitalize" }}>{b.status}</span>{b.noShow || (b.history || []).some(function (h) { return h && h.action === "no show"; }) ? chip("no-show", { bg: "var(--warn-bg)", border: "var(--warn-border)", text: "var(--warn-text)" }) : null}</div>
      );
    }) : null;
    return (
      // No overflow:hidden on this card — it clips the header row's
      // .mgt-hover-scale lift (the v15.8.0 "clip only while animating" gotcha
      // applies to ANY container of a hover-lift, not just height animators).
      // No child paints edge-to-edge, so the rounded corners don't need
      // clipping; Reveal does its own clipping while the history animates.
      <div key={c.phone} style={{ borderRadius: 14, border: "1px solid var(--border-soft)", background: "var(--bg-soft)", marginBottom: 8 }}>
        <div
          className="mgt-hover-scale"
          onClick={function () { setOpenKey(open ? null : c.phone); setArmedKey(null); }}
          style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "10px 12px", cursor: "pointer" }}><div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 14, fontWeight: 700, color: S.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.name || "(no name)"}</div><div style={{ fontSize: 12, color: S.muted }}>{formatPhone(c.phone) + "  ·  last " + (c.latestDate || "—")}</div></div><div style={{ display: "flex", gap: 4, flexShrink: 0, alignItems: "center" }}>{c.visits > 0 ? chip(c.visits + " visit" + (c.visits !== 1 ? "s" : ""), { bg: "var(--suggest-bg)", border: "var(--suggest-border)", text: "var(--success-text)" }) : null}{c.noShowCount > 0 ? chip(c.noShowCount + " no-show" + (c.noShowCount !== 1 ? "s" : ""), { bg: "var(--warn-bg)", border: "var(--warn-border)", text: "var(--warn-text)" }) : null}{wlCount > 0 ? chip("⏳ " + wlCount, { bg: "var(--bg-input)", border: "var(--border-soft)", text: "var(--text-secondary)" }) : null}<span style={{ fontSize: 12, color: S.muted }}>{open ? "▾" : "▸"}</span></div></div>
        <Reveal show={open}>
          <div style={{ padding: "0 12px 12px" }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: S.muted, margin: "4px 0 6px" }}>{c.bookings.length + " booking" + (c.bookings.length !== 1 ? "s" : "") + (wlCount ? " · " + wlCount + " waitlist entr" + (wlCount !== 1 ? "ies" : "y") : "")}</div>
            {historyRows}
            <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
              {armed ? <span style={{ fontSize: 12, fontWeight: 700, color: "var(--danger-text)" }}>Permanently deletes everything for this customer — no backups. Tap again to confirm.</span> : null}
              <button
                className="mgt-hover-scale mgt-press"
                style={mkBtn({ fontSize: 12, minHeight: 36, background: BTN.del, opacity: armed ? 1 : 0.85 })}
                onClick={function () {
                  if (armed) { onDeleteCustomer(c.phone); setArmedKey(null); setOpenKey(null); }
                  else setArmedKey(c.phone);
                }}>{armed ? "Confirm delete" : "Delete customer & all data"}</button>
            </div>
          </div>
        </Reveal>
      </div>
    );
  });

  return (
    <div>
      <Section>
        <input
          value={query}
          onChange={function (e) { setQuery(e.target.value); setOpenKey(null); setArmedKey(null); }}
          placeholder="Search by name or phone…"
          className="mgt-hover-scale"
          style={mkInp()} />
        <div style={{ fontSize: 11, color: S.muted, marginTop: 8 }}>Customers are recognised by phone number across all bookings. Deleting a customer permanently removes every booking and waitlist entry with their number.</div>
      </Section>
      {rows.length ? rows : <div style={{ textAlign: "center", padding: "20px 0", color: S.muted, fontSize: 13 }}>{query.trim() ? "No customers match." : "No customers yet — bookings with a phone number appear here."}</div>}
    </div>
  );
}
