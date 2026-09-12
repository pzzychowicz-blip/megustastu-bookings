// src/components/ActivityLogModal.jsx — v18.0.0 session 8 (item 1)
//
// Patryk's first item: a general history, visible to the admin, covering
// changes, deletions and who did them.
//
// ── IT RESOLVES NAMES, IT DOES NOT STORE THEM ───────────────────────────────
// An entry's `text` holds `{b:<id>}` tokens, never a guest's name — see
// `lib/activity.js` for why that makes erasure a property of the shape. This
// component is the other half: `renderText` resolves each token against the
// LIVE bookings list, so an anonymised booking reads "Data removed" here with
// no pass over the log ever having been made, and a renamed guest reads by
// their current name. Only a DELETED booking has no row to resolve against, and
// those entries carry their own `subject.name` as the fallback.
//
// ── ONE DAY AT A TIME ───────────────────────────────────────────────────────
// The feed is a range query and the range is a day, because "what happened on
// Saturday" is the question this screen exists to answer. The listener is
// mounted only while this modal is open (`useActivityFeed`'s `enabled`), which
// is why the day lives in state up in App rather than here: closing the modal
// must detach the listener, and a day held here would go with it.
import { useMemo, useState } from "react";
import { S, T, FW, SP, R } from "../lib/constants";
import { Overlay, ModalTitle, OutlineChip, DateField, mkInp, mkSel, mkBtn, AutoHeight } from "./atoms";
import { renderText } from "../lib/activity";

// The kinds a person would filter by, in the order they matter during service.
// `session` and `data` are deliberately last: signing in and exporting a backup
// are real entries and nobody opens this screen looking for them.
const KIND_LABEL = {
  booking: "Bookings", voucher: "Vouchers", table: "Tables",
  waitlist: "Waitlist", reminder: "Reminders", standing: "Standing",
  settings: "Settings", people: "People", session: "Sign-in", data: "Data",
};
const KIND_ORDER = [
  "booking", "voucher", "table", "waitlist", "reminder",
  "standing", "settings", "people", "session", "data",
];

function timeOf(ms) {
  if (!ms) return "";
  const d = new Date(ms);
  return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
}

// The author, as a person would say it: the local part of the email, which is
// what staff call each other. The full address is the `title`, because two
// people can share a first name and the log has to be able to settle that.
function personOf(email) {
  const at = String(email || "").indexOf("@");
  return at > 0 ? String(email).slice(0, at) : (email || "—");
}

export function ActivityLogModal({
  day, onSetDay, rows, loading, bookings, onOpenBooking, onClose,
}) {
  const [kinds, setKinds] = useState({});     // {} = everything
  const [who, setWho] = useState("");
  const [q, setQ] = useState("");

  // Resolving a token needs a map, and the bookings list is an array. Built
  // once per render of a list that only changes when a booking does.
  const byId = useMemo(function () {
    const m = {};
    (bookings || []).forEach(function (b) { if (b && b.id) m[b.id] = b; });
    return m;
  }, [bookings]);

  const people = useMemo(function () {
    const seen = {};
    (rows || []).forEach(function (r) { if (r.email) seen[r.email] = true; });
    return Object.keys(seen).sort();
  }, [rows]);

  const anyKind = Object.keys(kinds).some(function (k) { return kinds[k]; });

  const shown = useMemo(function () {
    const needle = q.trim().toLowerCase();
    return (rows || []).filter(function (r) {
      if (anyKind && !kinds[r.kind]) return false;
      if (who && r.email !== who) return false;
      if (!needle) return true;
      // Searched against what is ON SCREEN, tokens resolved — otherwise typing
      // a guest's name finds nothing, which is the first thing anybody tries.
      const text = renderText(r.text, byId, r.subject && r.subject.name);
      return (text + " " + personOf(r.email)).toLowerCase().includes(needle);
    });
  }, [rows, kinds, anyKind, who, q, byId]);

  function toggleKind(k) {
    setKinds(function (prev) {
      const next = Object.assign({}, prev);
      if (next[k]) delete next[k]; else next[k] = true;
      return next;
    });
  }

  return (
    <Overlay onClose={onClose} footer={
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button className="mgt-hover-scale" onClick={onClose}
          style={mkBtn({ background: "var(--app-btn-slate)" })}>Done</button>
      </div>
    }>
      {/* A read surface, so the pill takes the neutral — ModalTitle's colour
          rule, and the same one the Settings overlay this opens from wears. */}
      <ModalTitle background="var(--app-btn-grey-strong)">Activity log</ModalTitle>

      <div style={{ display: "flex", gap: SP.base, flexWrap: "wrap", alignItems: "center", marginBottom: SP.base }}>
        <DateField
          value={day}
          onChange={function (e) { onSetDay(e.target.value); }}
          style={{ ...mkInp(), width: "auto", flex: "0 1 190px" }}
          inputProps={{ "aria-label": "Day to show" }}
        />
        {/* `.mgt-hover-scale` on both, like every other control in the app —
            `check:style`'s Rule 10 catches an interactive element without it,
            and it caught these two. `DateField` above needs none because the
            atom carries the class on its own wrapper. `mkSel` rather than
            `mkInp` for the dropdown: a <select> paints its arrow hard against
            padding-right, which on a pill lands it inside the right cap. */}
        <select
          value={who}
          onChange={function (e) { setWho(e.target.value); }}
          aria-label="Filter by person"
          className="mgt-hover-scale"
          style={{ ...mkSel(), width: "auto", flex: "0 1 170px" }}
        >
          <option value="">Everyone</option>
          {people.map(function (p) {
            return <option key={p} value={p}>{personOf(p)}</option>;
          })}
        </select>
        <input
          type="search" value={q} onChange={function (e) { setQ(e.target.value); }}
          aria-label="Search the activity log"
          placeholder="Search…"
          className="mgt-hover-scale"
          style={{ ...mkInp(), flex: "1 1 140px" }}
        />
      </div>

      <div role="group" aria-label="Filter by kind"
        style={{ display: "flex", gap: SP.tight, flexWrap: "wrap", marginBottom: SP.base }}>
        {KIND_ORDER.map(function (k) {
          const on = !!kinds[k];
          return (
            <OutlineChip
              key={k} as="button" tone={on ? "success" : "neutral"}
              aria-pressed={on}
              onClick={function () { toggleKind(k); }}
            >{KIND_LABEL[k]}</OutlineChip>
          );
        })}
      </div>

      <AutoHeight watch={day + "·" + shown.length + "·" + loading}>
        <div>
          {loading ? (
            <div style={{ fontSize: T.body, color: S.muted, padding: SP.wide + "px 0" }}>Loading…</div>
          ) : shown.length === 0 ? (
            <div style={{ fontSize: T.body, color: S.muted, padding: SP.wide + "px 0" }}>
              {rows && rows.length
                ? "Nothing matches those filters."
                : "Nothing was recorded on this day."}
            </div>
          ) : shown.map(function (r) {
            const text = renderText(r.text, byId, r.subject && r.subject.name);
            // A row naming a booking that still exists can open it. One that
            // names a deleted one cannot, and must not look as though it could.
            const first = r.bookings ? Object.keys(r.bookings)[0] : null;
            const live = first && byId[first] ? first : null;
            return (
              <div key={r.id} style={{
                display: "flex", gap: SP.base, alignItems: "baseline",
                padding: "6px 8px", borderRadius: R.inset,
                borderBottom: "1px solid var(--border-soft)",
              }}>
                <span style={{ fontSize: T.micro, color: S.muted, minWidth: 44, fontVariantNumeric: "tabular-nums" }}>
                  {timeOf(r.at)}
                </span>
                <span title={r.email} style={{ fontSize: T.micro, color: S.muted, minWidth: 76, overflow: "hidden", textOverflow: "ellipsis" }}>
                  {personOf(r.email)}
                </span>
                <span style={{ flex: 1, minWidth: 0, fontSize: T.body, color: S.text }}>
                  {live ? (
                    <button
                      type="button"
                      className="mgt-hover-scale"
                      onClick={function () { onOpenBooking(live); }}
                      style={mkBtn({
                        background: "transparent", border: "none", boxShadow: "none",
                        color: "var(--text-primary)", padding: SP.none, minHeight: 0,
                        fontSize: T.body, fontWeight: FW.regular, textAlign: "left",
                      })}
                    >{text}</button>
                  ) : text}
                </span>
                {r.auto ? <OutlineChip tone="neutral" size="micro">Automatic</OutlineChip> : null}
              </div>
            );
          })}
        </div>
      </AutoHeight>

      <div style={{ fontSize: T.micro, color: S.muted, marginTop: SP.base }}>
        {/* Said on screen rather than implied, because the database cannot
            enforce it: `.read` is `auth != null` at the root and cascades, so
            every signed-in account can read this node. Hiding the screen is
            what this app can honestly promise, and it says so. */}
        Kept for 12 months. Any signed-in account can read this log —
        it is hidden from the app, not from the database.
      </div>
    </Overlay>
  );
}
