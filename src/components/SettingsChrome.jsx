// src/components/SettingsChrome.jsx
//
// v17.1.0 (Tier 3 code-splitting) — the two LIGHT Settings exports that other
// always-loaded code needs eagerly: SETTINGS_TABS (App.jsx's ←/→ keyboard nav)
// and CogIcon (ViewTools' ⚙ trigger). They moved here so App/ViewTools no
// longer statically import Settings.jsx — which lets the whole Settings modal
// (all five tab bodies + the floor-plan editor) load as a LAZY chunk on first
// open instead of in the startup bundle. Settings.jsx re-exports both, so the
// old import path still works.

// ── SETTINGS_TABS — the ONE tab list (v16.0.0 follow-up) ────────────────────
// Single source of truth for the Settings tabs. SettingsContent renders it AND
// App.jsx's ←/→ keyboard nav derives its cycle order from it (imported there).
// Add or reorder tabs HERE ONLY — a hand-copied id list elsewhere is exactly
// how the "arrow keys skip the new Customers tab" bug happened when the 5th
// tab shipped. Never duplicate this list.
export const SETTINGS_TABS = [
  { id: "general",   label: "General" },
  { id: "layout",    label: "Layout" },
  { id: "customers", label: "Customers" },
  { id: "reminders", label: "Reminders" },
  { id: "shortcuts", label: "Shortcuts" },
];

// ── Cog (gear) icon — 20×20 SVG, used as Settings trigger ───────────────────
// Stroke inherits from the parent button's `color` via currentColor, so the
// trigger button controls its own colour.
export function CogIcon() {
  return (
    <svg
      width={20} height={20}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx={12} cy={12} r={3} />
      <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
    </svg>
  );
}
