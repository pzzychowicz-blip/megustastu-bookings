// src/components/CustomersSettings.jsx
//
// v16.0.0 — Settings → Customers tab body. Customer management over the
// phone-derived customer index (src/lib/customers.js — customers ARE the
// bookings, no separate collection): search by name or phone, per-customer
// booking history, and GDPR-style "delete customer & all data". v17.0.0: the
// delete ANONYMIZES instead of removing — every booking carrying that phone
// stays for statistics as name "Data removed" (phone/notes/history wiped,
// noShow kept, `anonymized` flag set); waitlist entries are still deleted.
// The parent owns the actual write — see onDeleteCustomer.
//
// Deletion is armed-confirm (two taps) with an explicit "permanent, no
// backups" warning — Firebase free plan has no rollback of the wiped fields.
//
// Props (threaded App → SettingsContent → here, the LayoutSettings pattern):
//   bookings              — full bookings list
//   waitlist              — waitlist entries (to show/delete alongside)
//   onDeleteCustomer(key) — normalized-phone key; parent deletes bookings +
//                           waitlist entries and reports the outcome

import { useState, useEffect, useMemo } from "react";
import { S, BTN, BLOCK_BG, BLOCK_INK, R, T, FW, IC } from "../lib/constants";
import { customerIndex, searchCustomers, normalizePhone, formatPhone, identityKey, isNoShow } from "../lib/customers";
import { Section, Reveal, mkInp, mkBtn } from "./atoms";
import { ChevronDownIcon, ChevronRightIcon, WaitIcon } from "./Icons";

export function CustomersTabContent({ bookings, waitlist, onDeleteCustomer, regularMinDefault = 2 }) {
  const [query, setQuery] = useState("");
  const [openKey, setOpenKey] = useState(null);   // expanded customer
  const [armedKey, setArmedKey] = useState(null); // delete armed for this key
  const [filter, setFilter] = useState("all");    // v16.3.0: all | regulars | noshows
  // v16.3.0 follow-up (Patryk): "Regular" threshold — minimum completed visits
  // for the Regulars filter, adjustable via a stepper (session-only view
  // preference, like `filter` itself). Default 2.
  // v17.0.0: the initial threshold comes from settings/general (regularMin);
  // the in-tab stepper still adjusts it per-session, and a remote settings
  // change re-syncs it (clobbering a session tweak is acceptable — the setting
  // IS the intended value).
  const [regularMin, setRegularMin] = useState(regularMinDefault);
  useEffect(function () { setRegularMin(regularMinDefault); }, [regularMinDefault]);

  const idx = useMemo(() => customerIndex(bookings), [bookings]); // v17.1.0 perf: walks every booking
  const all = Object.keys(idx).map(function (k) { return idx[k]; });
  // v16.3.0: insight totals (pure derivation over the whole index).
  const totalCustomers = all.length;
  const totalVisits = all.reduce(function (a, c) { return a + c.visits; }, 0);
  const noShowCustomers = all.filter(function (c) { return c.noShowCount > 0; }).length;
  // v16.4.0: no-shows with no identity aren't in the index at all — count them
  // (count only, never aggregated into an identity: two same-name phone-less
  // people are different people) so they're not fully invisible.
  // v17.10.0: the test is `!identityKey(b)`, not "no phone". A JOINED phone-less
  // guest now HAS an identity and a row of their own above, so counting them
  // here as well would double-count them and leave the tile claiming they are
  // untraceable when they are two lines up.
  const phonelessNoShowCount = (bookings || []).filter(function (b) { return b && !identityKey(b) && isNoShow(b); }).length;
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

  // v17.8.0: OUTLINE chips — no fill, a 2px border, the colour carried by the
  // border and the text. These are standalone counts sitting on their own in a
  // quiet row, not status tags competing inside a dense line (which is what
  // ListView's solid tags are), so the pale-fill-plus-border-plus-bold-text
  // stack was three encodings of one signal on something that needs one. The
  // extra pixel of border is what keeps them legible once the fill is gone.
  const chip = function (label, colors) {
    return <span style={{ fontSize: T.micro, fontWeight: FW.bold, borderRadius: R.pill, padding: "2px 6px", display: "inline-flex", alignItems: "center", gap: 2, background: "transparent", border: "2px solid " + colors.border, color: colors.text, flexShrink: 0 }}>{label}</span>;
  };

  const rows = shown.map(function (c) {
    // v17.10.0: `c.key` — the identity, which is the phone for a phone customer
    // and the guestId for a joined phone-less one. Keying any of this on
    // `c.phone` would collapse every guest row onto the same "" key: one shared
    // React key, one shared open/armed state, one delete hitting all of them.
    const open = openKey === c.key;
    const armed = armedKey === c.key;
    const wlCount = c.phone ? waitCountOf(c.phone) : 0;
    const historyRows = open ? c.bookings.map(function (b) {
      return (
        <div key={b.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", borderRadius: R.inset, background: "var(--bg-soft)", border: "1px solid var(--border-soft)", marginBottom: 4 }}><span style={{ fontSize: T.body, fontWeight: FW.semi, color: S.text, minWidth: 84 }}>{b.date}</span><span style={{ fontSize: T.body, color: S.text, minWidth: 44 }}>{b.scheduledTime || b.time}</span><span style={{ fontSize: T.body, color: S.text, minWidth: 40 }}>{b.size + " pax"}</span>{/* v17.7.0: solid, like every other status label (see SBadge). */}<span style={{ fontSize: T.small, fontWeight: FW.semi, borderRadius: R.pill, padding: "4px 10px", background: BLOCK_BG[b.status] || BLOCK_BG.confirmed, border: "1px solid var(--border-glass)", color: BLOCK_INK[b.status] || BLOCK_INK.confirmed, textTransform: "capitalize" }}>{b.status}</span>{b.noShow || (b.history || []).some(function (h) { return h && h.action === "no show"; }) ? chip("no-show", { border: "var(--warn-border)", text: "var(--warn-text)" }) : null}</div>
      );
    }) : null;
    return (
      // No overflow:hidden on this card — it clips the header row's
      // .mgt-hover-scale lift (the v15.8.0 "clip only while animating" gotcha
      // applies to ANY container of a hover-lift, not just height animators).
      // No child paints edge-to-edge, so the rounded corners don't need
      // clipping; Reveal does its own clipping while the history animates.
      <div key={c.key} style={{ borderRadius: R.card, border: "1px solid var(--border-soft)", background: "var(--bg-soft)", marginBottom: 8 }}>
        <div
          className="mgt-hover-scale"
          onClick={function () { setOpenKey(open ? null : c.key); setArmedKey(null); }}
          // v17.8.0 fix: borderRadius is REQUIRED on any .mgt-hover-scale
          // element. Since v17.7.0 the hover rule no longer supplies one, but it
          // still paints an opaque --bg-hover-card — so a radius-less element
          // renders that fill as a hard-edged rectangle and this row visibly
          // squared off inside its own rounded card on hover. R.card matches the
          // parent exactly. (ConnectionStatus's dot button was the first case in
          // the app; this is the second. Check any new one.)
          style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "10px 12px", cursor: "pointer", borderRadius: R.card }}><div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: T.lead, fontWeight: FW.bold, color: S.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.name || "(no name)"}</div><div style={{ fontSize: T.body, color: S.muted }}>{(c.phone ? formatPhone(c.phone) : "No phone · linked guest") + "  ·  last " + (c.latestDate || "—")}</div></div><div style={{ display: "flex", gap: 4, flexShrink: 0, alignItems: "center" }}>{c.visits > 0 ? chip(c.visits + " visit" + (c.visits !== 1 ? "s" : ""), { border: "var(--suggest-border)", text: "var(--success-text)" }) : null}{c.noShowCount > 0 ? chip(c.noShowCount + " no-show" + (c.noShowCount !== 1 ? "s" : "") + " (" + Math.round((c.noShowCount / c.bookings.length) * 100) + "%)", { border: "var(--warn-border)", text: "var(--warn-text)" }) : null}{wlCount > 0 ? chip(<><WaitIcon size={IC.inline} />{wlCount}</>, { border: "var(--border-soft)", text: "var(--text-secondary)" }) : null}<span style={{ display: "flex", color: S.muted }}>{open ? <ChevronDownIcon size={IC.control} /> : <ChevronRightIcon size={IC.control} />}</span></div></div>
        <Reveal show={open}>
          <div style={{ padding: "0 12px 12px" }}>
            <div style={{ fontSize: T.body, fontWeight: FW.bold, color: S.muted, margin: "4px 0 6px" }}>{c.bookings.length + " booking" + (c.bookings.length !== 1 ? "s" : "") + (wlCount ? " · " + wlCount + " waitlist entr" + (wlCount !== 1 ? "ies" : "y") : "")}</div>
            {historyRows}
            <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
              {armed ? <span style={{ fontSize: T.body, fontWeight: FW.bold, color: "var(--danger-text)" }}>Permanently removes this customer's personal data (name, phone, notes, history) — no backups. Their bookings remain anonymized as “Data removed” for statistics. Tap again to confirm.</span> : null}
              <button
                className="mgt-hover-scale mgt-press"
                style={mkBtn({ fontSize: T.body, minHeight: 36, background: BTN.del, opacity: armed ? 1 : 0.85 })}
                onClick={function () {
                  if (armed) { onDeleteCustomer({ phone: c.phone, guestIds: c.guestIds }); setArmedKey(null); setOpenKey(null); }
                  else setArmedKey(c.key);
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
        style={mkBtn({ fontSize: T.body, minHeight: 32, padding: "4px 12px", background: active ? "var(--accent)" : BTN.nav, opacity: searching ? 0.5 : 1 })}>{label}</button>
    );
  };

  return (
    <div>
      <Section>
        {/* v16.3.0: insight totals */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
          <div style={{ flex: "1 1 90px", padding: "8px 12px", background: "var(--bg-input)", border: "1px solid var(--border-input)", borderRadius: R.inset }}>
            <div style={{ fontSize: T.title, fontWeight: FW.bold, color: "var(--text-primary)" }}>{totalCustomers}</div>
            <div style={{ fontSize: T.small, fontWeight: FW.regular, color: "var(--text-muted)" }}>customers</div>
          </div>
          <div style={{ flex: "1 1 90px", padding: "8px 12px", background: "var(--bg-input)", border: "1px solid var(--border-input)", borderRadius: R.inset }}>
            <div style={{ fontSize: T.title, fontWeight: FW.bold, color: "var(--success-text)" }}>{totalVisits}</div>
            <div style={{ fontSize: T.small, fontWeight: FW.regular, color: "var(--text-muted)" }}>completed visits</div>
          </div>
          <div style={{ flex: "1 1 90px", padding: "8px 12px", background: "var(--bg-input)", border: "1px solid var(--border-input)", borderRadius: R.inset }}>
            <div style={{ fontSize: T.title, fontWeight: FW.bold, color: "var(--warn-text)" }}>{noShowCustomers}</div>
            <div style={{ fontSize: T.small, fontWeight: FW.regular, color: "var(--text-muted)" }}>with a no-show</div>
          </div>
          {phonelessNoShowCount > 0 ? (
            <div style={{ flex: "1 1 90px", padding: "8px 12px", background: "var(--bg-input)", border: "1px solid var(--border-input)", borderRadius: R.inset }}>
              <div style={{ fontSize: T.title, fontWeight: FW.bold, color: "var(--warn-text)" }}>{phonelessNoShowCount}</div>
              <div style={{ fontSize: T.small, fontWeight: FW.regular, color: "var(--text-muted)" }}>no-show, unidentified</div>
            </div>
          ) : null}
        </div>
        <input
          aria-label="Search customers by name or phone number"
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
                style={mkBtn({ fontSize: T.lead, minHeight: 28, padding: "2px 10px", background: BTN.nav, opacity: regularMin <= 1 ? 0.4 : 1, cursor: regularMin <= 1 ? "not-allowed" : "pointer" })}>−</button>
              <span style={{ fontSize: T.body, fontWeight: FW.bold, color: S.text, minWidth: 62, textAlign: "center" }}>{regularMin + "+ visit" + (regularMin !== 1 ? "s" : "")}</span>
              <button
                onClick={function () { setRegularMin(function (m) { return Math.min(50, m + 1); }); }}
                disabled={regularMin >= 50}
                className={regularMin >= 50 ? undefined : "mgt-hover-scale"}
                style={mkBtn({ fontSize: T.lead, minHeight: 28, padding: "2px 10px", background: BTN.nav, opacity: regularMin >= 50 ? 0.4 : 1, cursor: regularMin >= 50 ? "not-allowed" : "pointer" })}>+</button>
            </span>
          ) : null}
        </div>
        <div style={{ fontSize: T.small, color: S.muted, marginTop: 8 }}>Customers are recognised by phone number, or — for guests who never gave one — by having been linked to each other from the name suggestions on a booking. Deleting a customer permanently removes their personal data (and waitlist entries); the bookings themselves stay anonymized as “Data removed” for statistics.</div>
      </Section>
      {rows.length ? rows : <div style={{ textAlign: "center", padding: "18px 0", color: S.muted, fontSize: T.body }}>{query.trim() ? "No customers match." : "No customers yet — they appear here once a booking has a phone number, or once you link a guest from the name suggestions."}</div>}
    </div>
  );
}
