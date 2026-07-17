// src/components/WaitAvailBanner.jsx
//
// v16.3.0 — the waitlist "table free" actionable banner. One in-flow row per
// TODAY'S waiting party for whom a table CURRENTLY fits (App's waitAvail), with
// a Book button (pre-fills the booking form) and an ✕ dismiss. Supersedes the
// old 6-second green toast — a persistent, actionable cue instead of a glance.
//
// v17.1.0: migrated onto the shared BannerRows shell (LateBanner/OverlapBanner
// pattern) — the duplicated collapsible/Reveal scaffolding is gone, and the
// banner now honors the Settings "Collapse banners above" stepper via
// `collapseMax` (it used to be hard-coded open). Suggest/green token family
// (--suggest-* / --success-text) — this is an OPPORTUNITY, not a warning.
// Future-date fits stay in the waitlist panel + the ⏳ badge (not operationally
// urgent), so only today's entries reach here.
//
// Props:
//   entries      — today's available, non-dismissed waiting entries (parent-built)
//   availability — { [entryId]: {tables:[…], time:"HH:MM"} }
//   onBook(entry)  — open the pre-filled booking form (App's bookFromWaitlist)
//   onDismiss(id)  — hide this row for the session (App-owned Set)
//   collapseMax  — rows above this start collapsed (Settings → General)

import { BannerRows } from "./BannerRows";
import { mkBtn } from "./atoms";
import { BTN } from "../lib/constants";

export function WaitAvailBanner({ entries, availability, onBook, onDismiss, collapseMax = 2 }) {
  const byId = new Map(entries.map(function (e) { return [e.id, e]; }));

  function renderRow(id) {
    const w = byId.get(id);
    if (!w) return null;
    const avail = availability[id] || null;
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap", padding: "8px 12px", borderRadius: 12, background: "var(--bg-soft)", border: "1px solid var(--suggest-border)", marginTop: 6 }}>
        <span style={{ fontSize: 13, color: "var(--success-text)", fontWeight: 600, flex: "1 1 auto", minWidth: 0 }}>{(w.name || "(no name)") + " · " + w.size + " pax — table free" + (avail && avail.time ? " · " + avail.time : "")}</span>
        <button
          onClick={function () { onBook(w); }}
          className="mgt-hover-scale"
          style={mkBtn({ fontSize: 12, minHeight: 32, padding: "4px 12px", background: "var(--app-walkin)" })}>Book</button>
        <button
          onClick={function () { onDismiss(id); }}
          aria-label="Dismiss this alert"
          className="mgt-hover-scale mgt-press"
          style={mkBtn({ fontSize: 12, minHeight: 32, padding: "4px 10px", background: BTN.dismiss })}>✕</button>
      </div>
    );
  }

  return (
    <BannerRows
      title="Waitlist — table free"
      ids={entries.map(function (e) { return e.id; })}
      collapseMax={collapseMax}
      renderRow={renderRow}
      bg="var(--suggest-bg)"
      border="var(--suggest-border)"
      textColor="var(--success-text)" />
  );
}
