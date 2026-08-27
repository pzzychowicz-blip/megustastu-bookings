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
import { BTN, T, FW, IC, H } from "../lib/constants";
import { CloseIcon } from "./Icons";

export function WaitAvailBanner({ entries, availability, onBook, onDismiss, }) {
  const byId = new Map(entries.map(function (e) { return [e.id, e]; }));

  function renderRow(id) {
    const w = byId.get(id);
    if (!w) return null;
    const avail = availability[id] || null;
    // v17.15.6: both controls carry the waiting PARTY — see LateBanner for the
    // rule and for why a banner row has no ancestor to inherit a name from.
    // `who` is the row's own existing expression rather than a second copy of
    // it, so the button and the sentence can never disagree about the name; the
    // size goes in too, because two parties of a name this vague ("(no name)")
    // is exactly the case a waitlist produces.
    const who = w.name || "(no name)";
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap", padding: "8px 0" }}>
        <span style={{ fontSize: T.body, color: "var(--success-text)", fontWeight: FW.semi, flex: "1 1 auto", minWidth: 0 }}>{who + " · " + w.size + " pax — table free" + (avail && avail.time ? " · " + avail.time : "")}</span>
        <button
          onClick={function () { onBook(w); }}
          aria-label={"Book (" + who + ", " + w.size + " pax)"}
          className="mgt-hover-scale"
          style={mkBtn({ fontSize: T.body, minHeight: H.chrome, padding: "4px 12px", background: "var(--app-walkin)" })}>Book</button>
        <button
          onClick={function () { onDismiss(id); }}
          aria-label={"Dismiss the table-free alert for " + who}
          className="mgt-hover-scale mgt-press"
          style={mkBtn({ fontSize: T.body, width: H.chrome, height: H.chrome, minHeight: H.chrome, padding: 0, display: "inline-flex", alignItems: "center", justifyContent: "center", background: BTN.dismiss })}><CloseIcon size={IC.control} /></button>
      </div>
    );
  }

  return (
    <BannerRows ids={entries.map(function (e) { return e.id; })} renderRow={renderRow} />
  );
}
