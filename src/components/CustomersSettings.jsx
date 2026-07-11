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
import { customerIndex, searchCustomers, normalizePhone, formatPhone, hasRealPhone, isNoShow } from "../lib/customers";
import { Section, Reveal, mkInp, mkBtn } from "./atoms";

export function CustomersTabContent({ bookings, waitlist, onDeleteCustomer }) {
  const [query, setQuery] = useState("");
  const [openKey, setOpenKey] = useState(null);   // expanded customer
  const [armedKey, setArmedKey] = useState(null); // delete armed for this key
  const [filter, setFilter] = useState("all");    // v16.3.0: all | regulars | noshows
  // v16.3.0 follow-up (Patryk): "Regular" threshold — minimum completed visits
  // for the Regulars filter, adjustable via a stepper (session-only view
  // preference, like `filter` itself). Default 2.
  const [regularMin, setRegularMin] = useState(2);

  const idx = customerIndex(bookings);
  const all = Object.keys(idx).map(function (k) { return idx[k]; });
  // v16.3.0: insight totals (pure derivation over the whole index).
  const totalCustomers = all.length;
  const totalVisits = all.reduce(function (a, c) { return a + c.visits; }, 0);
  const noShowCustomers = all.filter(function (c) { return c.noShowCount > 0; }).length;
  // v16.4.0: phone-less no-shows aren't in the phone-keyed index at all — count
  // them (count only, never aggregated into an identity: two same-name phone-less
  // people are different people) so they're not fully invisible.
  const phonelessNoShowCount = (bookings || []).filter(function (b) { return b && !hasRealPhone(b.phone) && isNoShow(b); }).length;
  // v16.3.0: quick filters (applied only when NOT searching — a query overrides).
  const base = filter === "regulars"
    ? all.filter(function (c) { return c.visits >= regularMin; }).sort(function (a, b) { return b.visits - a.visits || (b.latestDate || "").localeCompare(a.latestDate || ""); })
    : filter === "noshows"
      ? all.filter(function (c) { return c.noShowCount > 0; }).sort(function (a, b) { return b.noShowCount - a.noShowCount || (b.latestDate || "").localeCompare(a.latestDate || ""); })
      : all.sort(function (a, b) {
          if (b.visits !== a.visits) return b.visits - a.visits;
          return (b.latestDate || "").localeCompare(a.latestDate || "");
        });
  const shown = query.trim()
    ? searchCustomers(idx, query, 50)
    : base.slice(0, 50);

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
          style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "10px 12px", cursor: "pointer" }}><div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 14, fontWeight: 700, color: S.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.name || "(no name)"}</div><div style={{ fontSize: 12, color: S.muted }}>{formatPhone(c.phone) + "  ·  last " + (c.latestDate || "—")}</div></div><div style={{ display: "flex", gap: 4, flexShrink: 0, alignItems: "center" }}>{c.visits > 0 ? chip(c.visits + " visit" + (c.visits !== 1 ? "s" : ""), { bg: "var(--suggest-bg)", border: "var(--suggest-border)", text: "var(--success-text)" }) : null}{c.noShowCount > 0 ? chip(c.noShowCount + " no-show" + (c.noShowCount !== 1 ? "s" : "") + " (" + Math.round((c.noShowCount / c.bookings.length) * 100) + "%)", { bg: "var(--warn-bg)", border: "var(--warn-border)", text: "var(--warn-text)" }) : null}{wlCount > 0 ? chip("⏳ " + wlCount, { bg: "var(--bg-input)", border: "var(--border-soft)", text: "var(--text-secondary)" }) : null}<span style={{ fontSize: 12, color: S.muted }}>{open ? "▾" : "▸"}</span></div></div>
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

  // v16.3.0: All / Regulars / No-shows segmented filter (disabled visual while a
  // search query overrides it).
  const searching = !!query.trim();
  const filterChip = function (key, label) {
    const active = filter === key && !searching;
    return (
      <button
        key={key}
        onClick={function () { setFilter(key); setOpenKey(null); setArmedKey(null); }}
        className="mgt-hover-scale"
        style={mkBtn({ fontSize: 12, minHeight: 32, padding: "4px 12px", background: active ? "var(--accent)" : BTN.nav, opacity: searching ? 0.5 : 1 })}>{label}</button>
    );
  };

  return (
    <div>
      <Section>
        {/* v16.3.0: insight totals */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
          <div style={{ flex: "1 1 90px", padding: "8px 12px", background: "var(--bg-input)", border: "1px solid var(--border-input)", borderRadius: 10 }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: "var(--text-primary)" }}>{totalCustomers}</div>
            <div style={{ fontSize: 11, fontWeight: 500, color: "var(--text-muted)" }}>customers</div>
          </div>
          <div style={{ flex: "1 1 90px", padding: "8px 12px", background: "var(--bg-input)", border: "1px solid var(--border-input)", borderRadius: 10 }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: "var(--success-text)" }}>{totalVisits}</div>
            <div style={{ fontSize: 11, fontWeight: 500, color: "var(--text-muted)" }}>completed visits</div>
          </div>
          <div style={{ flex: "1 1 90px", padding: "8px 12px", background: "var(--bg-input)", border: "1px solid var(--border-input)", borderRadius: 10 }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: "var(--warn-text)" }}>{noShowCustomers}</div>
            <div style={{ fontSize: 11, fontWeight: 500, color: "var(--text-muted)" }}>with a no-show</div>
          </div>
          {phonelessNoShowCount > 0 ? (
            <div style={{ flex: "1 1 90px", padding: "8px 12px", background: "var(--bg-input)", border: "1px solid var(--border-input)", borderRadius: 10 }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: "var(--warn-text)" }}>{phonelessNoShowCount}</div>
              <div style={{ fontSize: 11, fontWeight: 500, color: "var(--text-muted)" }}>no-show, no phone</div>
            </div>
          ) : null}
        </div>
        <input
          value={query}
          onChange={function (e) { setQuery(e.target.value); setOpenKey(null); setArmedKey(null); }}
          placeholder="Search by name or phone…"
          className="mgt-hover-scale"
          style={mkInp()} />
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8, alignItems: "center" }}>
          {filterChip("all", "All")}
          {filterChip("regulars", "Regulars")}
          {filterChip("noshows", "No-shows")}
          {/* v16.3.0 follow-up: Regulars visit-threshold stepper — visible while
              the Regulars filter is active (and not overridden by a search). */}
          {filter === "regulars" && !searching ? (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4, marginLeft: 4 }}>
              <button
                onClick={function () { setRegularMin(function (m) { return Math.max(1, m - 1); }); }}
                disabled={regularMin <= 1}
                className={regularMin <= 1 ? undefined : "mgt-hover-scale"}
                style={mkBtn({ fontSize: 14, minHeight: 28, padding: "2px 10px", background: BTN.nav, opacity: regularMin <= 1 ? 0.4 : 1, cursor: regularMin <= 1 ? "not-allowed" : "pointer" })}>−</button>
              <span style={{ fontSize: 12, fontWeight: 700, color: S.text, minWidth: 62, textAlign: "center" }}>{regularMin + "+ visit" + (regularMin !== 1 ? "s" : "")}</span>
              <button
                onClick={function () { setRegularMin(function (m) { return Math.min(50, m + 1); }); }}
                disabled={regularMin >= 50}
                className={regularMin >= 50 ? undefined : "mgt-hover-scale"}
                style={mkBtn({ fontSize: 14, minHeight: 28, padding: "2px 10px", background: BTN.nav, opacity: regularMin >= 50 ? 0.4 : 1, cursor: regularMin >= 50 ? "not-allowed" : "pointer" })}>+</button>
            </span>
          ) : null}
        </div>
        <div style={{ fontSize: 11, color: S.muted, marginTop: 8 }}>Customers are recognised by phone number across all bookings. Deleting a customer permanently removes every booking and waitlist entry with their number.</div>
      </Section>
      {rows.length ? rows : <div style={{ textAlign: "center", padding: "20px 0", color: S.muted, fontSize: 13 }}>{query.trim() ? "No customers match." : "No customers yet — bookings with a phone number appear here."}</div>}
    </div>
  );
}
