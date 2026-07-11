// src/components/WaitAvailBanner.jsx
//
// v16.3.0 — the waitlist "table free" actionable banner. One in-flow row per
// TODAY'S waiting party for whom a table CURRENTLY fits (App's waitAvail), with
// a Book button (pre-fills the booking form) and an ✕ dismiss. Supersedes the
// old 6-second green toast — a persistent, actionable cue instead of a glance.
//
// Same collapsible + per-row ease-in/out shape as LateBanner (shared
// useRevealRows). Suggest/green token family (--suggest-* / --success-text) —
// this is an OPPORTUNITY, not a warning. Future-date fits stay in the waitlist
// panel + the ⏳ badge (not operationally urgent), so only today's entries
// reach here.
//
// Props:
//   entries      — today's available, non-dismissed waiting entries (parent-built)
//   availability — { [entryId]: {tables:[…], time:"HH:MM"} }
//   onBook(entry)  — open the pre-filled booking form (App's bookFromWaitlist)
//   onDismiss(id)  — hide this row for the session (App-owned Set)

import { useState } from "react";
import { Reveal, mkBtn } from "./atoms";
import { BTN } from "../lib/constants";
import { useRevealRows } from "../hooks/useRevealRows";

export function WaitAvailBanner({ entries, availability, onBook, onDismiss }) {
  const [open, setOpen] = useState(true); // collapsible, revealed by default
  const { renderIds, openIds } = useRevealRows(entries.map(function (e) { return e.id; }));

  if (renderIds.length === 0) return null;
  const byId = new Map(entries.map(function (e) { return [e.id, e]; }));
  const liveCount = entries.length;

  return (
    <div style={{ background: "var(--suggest-bg)", border: "2px solid var(--suggest-border)", borderRadius: 14, padding: "10px 14px", marginBottom: 10, boxShadow: "0 1px 4px rgba(0,0,0,0.04)" }}>
      <button
        onClick={function () { setOpen(!open); }}
        aria-expanded={open}
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, width: "100%", background: "transparent", border: "none", cursor: "pointer", padding: 0, textAlign: "left" }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: "var(--success-text)", marginBottom: 2 }}>{"Waitlist — table free · " + liveCount}</span>
        <span style={{ fontSize: 11, color: "var(--success-text)", fontWeight: 700, flexShrink: 0 }}>{open ? "▲" : "▼"}</span>
      </button>
      <Reveal show={open}>
        <div>
          {renderIds.map(function (id) {
            const w = byId.get(id);
            const avail = availability[id] || null;
            return (
              <Reveal key={id} show={openIds.has(id)}>
                {w ? (
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
                ) : null}
              </Reveal>
            );
          })}
        </div>
      </Reveal>
    </div>
  );
}
