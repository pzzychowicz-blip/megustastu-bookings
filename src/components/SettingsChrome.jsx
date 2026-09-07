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
// v18.0.0: `vouchers` is the 7th tab, after Customers. Same rationale as the
// ordering below — General and Layout are what the restaurant IS, Customers and
// Reminders are what it HOLDS, and vouchers are what it holds. Added HERE and
// nowhere else: the ←/→ keyboard cycle derives from this list, which is exactly
// what a hand-copied second list broke when the Customers tab shipped.
// v17.11.0: `app` is the 6th tab — the eight controls that make the app
// comfortable on YOUR screen, split out of a General tab that had reached 47
// controls. Ordered after the restaurant's own configuration and its data, and
// before Shortcuts: General and Layout are what the restaurant is, Customers and
// Reminders are what it holds, App is how you look at it, and Shortcuts is
// reference rather than settings at all.
// v18.0.0 phase 3: three tabs are `settingsWrite`, and gating them HERE is what
// makes that capability enforced on the client at all — every control on those
// three writes a `settings/*` node, so the tab is the natural boundary and the
// alternative was a guard on each of ~10 save functions. `customers` and
// `vouchers` stay ungated because READING them is not a capability; the
// destructive actions inside them carry their own (customerDelete,
// voucherIssue, voucherVoid). `app` is per-user preferences and `shortcuts` is
// reference, so neither is a restaurant setting at all.
export const SETTINGS_TABS = [
  { id: "general",   label: "General",   cap: "settingsWrite" },
  { id: "layout",    label: "Layout",    cap: "settingsWrite" },
  { id: "customers", label: "Customers" },
  { id: "vouchers",  label: "Vouchers" },
  { id: "reminders", label: "Reminders", cap: "settingsWrite" },
  { id: "app",       label: "App" },
  { id: "shortcuts", label: "Shortcuts" },
  // v18.0.0 phase 3: the 8th tab, and the FIRST one that is not always there.
  // `cap` is what `visibleTabs` filters on — declared beside the tab rather
  // than as a list of admin-only ids somewhere else, because a second list is
  // exactly what this comment block has been about since v16.0.0.
  { id: "admin", label: "Admin", cap: "settingsAdmin" },
];

// ── visibleTabs — the ONE filter, for the same reason as the ONE list ────────
// v18.0.0 phase 3. `SETTINGS_TABS` being single-sourced is not enough on its
// own: the ←/→ keyboard cycle derives from it, so filtering the list at the
// RENDER site alone would leave arrows landing on a tab that renders nothing —
// the fifth version of the hand-copied-tab-list bug, arriving through the one
// door the original fix left open.
//
// So the filter lives here, next to the list, and both consumers call it:
// SettingsContent for the TabBar and the body, useKeyboardShortcuts for the
// cycle. `tests/settings-tabs.test.js` fails the build if either reads
// SETTINGS_TABS directly.
//
// `can` is optional so a caller with no roles context (and any future one)
// degrades to "show everything that is not capability-gated" rather than to an
// empty tab bar.
export function visibleTabs(can) {
  if (typeof can !== "function") return SETTINGS_TABS.filter(function (t) { return !t.cap; });
  return SETTINGS_TABS.filter(function (t) { return !t.cap || can(t.cap); });
}

// ── Cog (gear) icon ─────────────────────────────────────────────────────────
// v17.9.0: moved into the shared icon set (Icons.jsx) so it takes the same Svg
// wrapper, optical stroke compensation and `size` prop as every other icon. It
// was the one icon already drawn properly (v17.1.0) and the house style was
// copied FROM it — but staying outside the set meant it could not be sized, and
// in ViewTools' pair that showed as a 17px search beside a 20px cog.
// Re-exported here so importers and the lazy-Settings boundary are unchanged;
// Icons.jsx has no imports of its own, so this pulls nothing extra in.
export { CogIcon } from "./Icons";
