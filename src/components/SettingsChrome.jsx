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

// ── Cog (gear) icon ─────────────────────────────────────────────────────────
// v17.9.0: moved into the shared icon set (Icons.jsx) so it takes the same Svg
// wrapper, optical stroke compensation and `size` prop as every other icon. It
// was the one icon already drawn properly (v17.1.0) and the house style was
// copied FROM it — but staying outside the set meant it could not be sized, and
// in ViewTools' pair that showed as a 17px search beside a 20px cog.
// Re-exported here so importers and the lazy-Settings boundary are unchanged;
// Icons.jsx has no imports of its own, so this pulls nothing extra in.
export { CogIcon } from "./Icons";
