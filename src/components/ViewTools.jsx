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

import { CogIcon } from "./SettingsChrome"; // v17.1.0: light import — Settings.jsx is lazy-loaded now
import { SearchIcon } from "./Icons";       // v17.8.0: was the 🔍 emoji, beside a hand-drawn SVG cog
import { S, R } from "../lib/constants";

const BTN_STYLE = {
  background: "var(--cog-bg)",
  border: "1px solid var(--cog-border)",
  // v17.8.0: 34 → 44. These are the two controls that sit in the same place on
  // all three views, and they were the smallest square targets in the header on
  // a device operated with one hand while carrying plates. Equal width/height
  // keeps --r-pill a true circle (it clamps to half the SHORTER side).
  borderRadius: R.pill, width: 44, height: 44,
  cursor: "pointer",
  display: "flex", alignItems: "center", justifyContent: "center",
  flexShrink: 0, padding: 0,
  color: S.text,
  boxShadow: "var(--shadow-btn)"
};

export function ViewTools({ onOpenSearch = () => {}, onOpenSettings = () => {} }) {
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
      <button
        onClick={onOpenSearch}
        title="Find a booking"
        aria-label="Find a booking"
        className="mgt-hover-scale"
        style={BTN_STYLE}
      >
        <SearchIcon size={17} />
      </button>
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
