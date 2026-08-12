// src/components/PrefPickerModal.jsx
// Modal table picker for the "preferred tables" hint on a booking. Soft hint
// — the optimizer prefers these tables when assigning, but falls back if
// they're not usable (e.g. busy, capacity-mismatched, conflicts with another
// booking). This is different from the "manual" assignment in ManualModal,
// which is a hard lock.
//
// Selection rule: stops accepting new tables once the chosen subset has
// enough capacity for the party. The user can clear and start over if they
// want a different cluster. This avoids "you picked 5 tables for 2 people"
// confusion.
//
// Capacity is read from VALID_COMBOS when the chosen subset matches a known
// cluster, and falls back to the sum of standalone capacities otherwise. The
// check uses a simpler version of `getCapOf` than ManualModal — no
// "best matching subset" search — because for preferences we don't need to
// score partial matches.
//
// Parent wires up:
//   • Conditional render: parent decides when to show the modal (typically
//     `showPrefPicker ? <PrefPickerModal ... /> : null`).
//   • selected: the current array of preferred table ids (may be empty).
//   • partySize: the booking's party size, used for the capacity check.
//   • onChange(newSelection): called with the new array on every change.
//   • onClose(): close the modal (does not clear the selection).
//
// Phase B5 (v15-refactor): extracted from App.jsx (the inline `prefPickerModal`
// IIFE) and converted RC() → JSX. Behaviour, output markup, and all inline
// styles are byte-identical to the original.
//
// Phase C1 (v15-refactor): the local `getCapOf` is replaced by the existing
// `comboCap` export from booking-logic.js — same algorithm (exact-match →
// sum-of-standalones, no greedy). ManualModal and WalkinForm use a
// different export (`comboCapBest`) which adds a greedy best-subset branch;
// for soft-hint preferences here, the simpler version is correct.

import { S, BTN, TBL, TABLE_GROUPS, R, T, FW, IC } from "../lib/constants";
import { isIn, comboCap } from "../lib/booking-logic";
import { Overlay, ModalTitle, mkBtn, AutoHeight } from "./atoms";
import { CheckIcon } from "./Icons";

export function PrefPickerModal({ selected, partySize, onChange, onClose }) {
  const prefs = selected || [];
  const needed = Number(partySize) || 2;

  // Capacity computation — see booking-logic.js#comboCap (exact-match in
  // VALID_COMBOS, otherwise sum of standalones; no greedy branch). Local
  // alias keeps existing call sites readable.
  const getCapOf = comboCap;

  function togglePref(id) {
    if (prefs.includes(id)) {
      onChange(prefs.filter((x) => x !== id));
      return;
    }
    // Cap-met short-circuit: if the existing selection already fits the
    // party, refuse to add more. Forces the user to clear before choosing a
    // different cluster — matches the original behaviour exactly.
    if (prefs.length > 0 && getCapOf(prefs) >= needed) return;
    onChange(prefs.concat([id]));
  }

  const cap = getCapOf(prefs);
  const capOk = prefs.length === 0 || cap >= needed;
  // v17.9.0: the tick is a real icon, so capText is JSX rather than a string.
  const capText = prefs.length === 0
    ? "No preference (auto)"
    : (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
        {"Capacity: " + cap + " / " + needed + " pax"}
        {cap >= needed ? <CheckIcon size={IC.control} /> : <span>— need more</span>}
      </span>
    );
  const capColor = prefs.length === 0 ? S.muted : (cap >= needed ? "var(--success-text)" : "var(--warn-text)");

  // v14.4.1: clear/done row pinned via Overlay's `footer` slot.
  const footerEl=(
    <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
      {prefs.length > 0 ? (
        <button
          className="mgt-hover-scale mgt-press"
          style={mkBtn({ minHeight: 44, padding: "10px 18px", background: BTN.clear })}
          onClick={() => onChange([])}
        >
          Clear
        </button>
      ) : null}
      <button
        className="mgt-hover-scale mgt-press"
        style={mkBtn({ minHeight: 44, padding: "10px 18px", background: "var(--app-btn-slate)" })}
        onClick={onClose}
      >
        Done
      </button>
    </div>
  );

  return (
    <Overlay onClose={onClose} footer={footerEl}>
      <AutoHeight>
      <ModalTitle marginBottom={4} background="var(--btn-tables)">Preferred table</ModalTitle>
      <div style={{ fontSize: T.body, color: S.text, marginBottom: 14, textAlign: "center" }}>
        Soft hint — optimizer tries this first, falls back if unavailable.
      </div>
      <div style={{
        marginBottom: 14, padding: "10px 14px", borderRadius: R.card,
        background: "var(--bg-card)",
        border: "1px solid " + (capOk ? "var(--suggest-border)" : "var(--border-sheet)"),
        boxShadow: "0 1px 4px rgba(0,0,0,0.04)"
      }}>
        <div style={{ fontSize: T.lead, fontWeight: FW.bold, color: S.text }}>
          {"Selected: " + (prefs.length ? prefs.join(" + ") : "none")}
        </div>
        <div style={{ fontSize: T.body, color: capColor, fontWeight: FW.medium, marginTop: 2 }}>
          {capText}
        </div>
      </div>
      {TABLE_GROUPS.map((grp) => (
        <div key={grp.name} style={{ marginBottom: 14 }}>
          <div style={{ fontSize: T.body, fontWeight: FW.bold, color: grp.color, marginBottom: 4, textAlign: "center" }}>
            {grp.name}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
            {grp.tables.map((t) => {
              const isPref = prefs.includes(t.id);
              const indoor = isIn(t.id);
              const tc = indoor ? TBL.ind : TBL.out;
              return (
                <button
                  key={t.id}
                  className="mgt-hover-scale"
                  onClick={() => togglePref(t.id)}
                  style={{
                    width: 64, height: 52,   /* @canvas */ padding: 0, borderRadius: R.pill,
                    border: "2px solid " + (isPref ? "var(--accent)" : tc.bg),
                    background: isPref ? "var(--btn-tables)" : "var(--bg-input)",
                    color: isPref ? "#fff" : S.text,
                    fontWeight: FW.semi, fontSize: T.lead,
                    cursor: "pointer",
                    display: "flex", flexDirection: "column",
                    alignItems: "center", justifyContent: "center",
                    gap: 2, boxSizing: "border-box",
                    boxShadow: "var(--shadow-btn)"
                  }}
                >
                  <span>{t.id}</span>
                  <span style={{
                    fontSize: T.micro, fontWeight: FW.medium,
                    color: isPref ? "rgba(255,255,255,0.8)" : S.text
                  }}>
                    {"cap " + t.cap}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
      </AutoHeight>
    </Overlay>
  );
}
