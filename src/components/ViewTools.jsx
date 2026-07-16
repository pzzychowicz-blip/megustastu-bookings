// src/components/ViewTools.jsx
// v17.0.0 round 8 (Patryk): the 🔍 Find-a-booking + ⚙ Settings pair, lifted OUT
// of the per-view chrome and into App's date-nav row (right of the Summary
// panel) so the two buttons sit in ONE place for ALL THREE views (Timeline,
// List, Plan) — previously the Timeline legend and the List card-header each
// carried their own copy and Plan had neither.
//
// The chrome is the original 34×34 cog styling, unchanged (--cog-bg/-border).
//
// Props:
//   onOpenSearch()   — App's setShowSearch(true)
//   onOpenSettings() — App's setShowSettings(true)
//   onOpenSim()      — WhatsApp sandbox only: opens the simulator panel. A 🧪
//                      button renders between 🔍 and ⚙ ONLY when WA_SANDBOX
//                      (dev server / deployed sandbox build) AND the prop is
//                      passed — real prod builds never show it. (Moved here
//                      from the Timeline legend at the 17.0.0 sandbox sync.)

import { CogIcon } from "./Settings";
import { S } from "../lib/constants";
import { WA_SANDBOX } from "../lib/waSandbox";

const BTN_STYLE = {
  background: "var(--cog-bg)",
  border: "1px solid var(--cog-border)",
  borderRadius: 10, width: 34, height: 34,
  cursor: "pointer",
  display: "flex", alignItems: "center", justifyContent: "center",
  flexShrink: 0, padding: 0,
  color: S.text,
  boxShadow: "0 1px 3px rgba(0,0,0,0.08), inset 0 1px 1px rgba(255,255,255,0.4)"
};

export function ViewTools({ onOpenSearch = () => {}, onOpenSettings = () => {}, onOpenSim = null }) {
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
      <button
        onClick={onOpenSearch}
        title="Find a booking"
        aria-label="Find a booking"
        className="mgt-hover-scale"
        style={{ ...BTN_STYLE, fontSize: 15, lineHeight: 1 }}
      >
        🔍
      </button>
      {WA_SANDBOX && onOpenSim ? (
        <button
          onClick={onOpenSim}
          title="WhatsApp simulator (sandbox only)"
          className="mgt-hover-scale"
          style={{ ...BTN_STYLE, fontSize: 16, lineHeight: 1 }}
        >
          🧪
        </button>
      ) : null}
      <button
        onClick={onOpenSettings}
        title="Settings & keyboard shortcuts"
        aria-label="Settings & keyboard shortcuts"
        className="mgt-hover-scale"
        style={BTN_STYLE}
      >
        <CogIcon />
      </button>
    </div>
  );
}
