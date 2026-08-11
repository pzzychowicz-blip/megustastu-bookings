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
  // v17.8.0: 34 → 36. These are the two controls that sit in the same place on
  // all three views, on a device operated one-handed while carrying plates.
  // It went to 44 (the HIG floor) first and that was too big — a 44px circle in
  // the date-nav row out-weighed the date field beside it and the header stopped
  // reading as chrome. 36 is the compromise Patryk picked: a real increase on
  // the old 34, still visibly secondary. Equal width/height keeps --r-pill a
  // true circle (it clamps to half the SHORTER side).
  borderRadius: R.pill, width: 36, height: 36,
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
        <SearchIcon size={18} />
      </button>
      <button
        onClick={onOpenSettings}
        title="Settings & keyboard shortcuts"
        aria-label="Settings & keyboard shortcuts"
        className="mgt-hover-scale"
        style={BTN_STYLE}
      >
        <CogIcon size={18} />
      </button>
    </div>
  );
}
