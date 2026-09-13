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
// v18.0.0 phase 3: a tab declares the capabilities that make it worth opening,
// and gating them HERE is what makes those capabilities enforced on the client
// at all — the alternative was a guard on each of ~10 save functions.
// `customers` and `vouchers` stay ungated because READING them is not a
// capability; the destructive actions inside them carry their own
// (customerDelete, voucherIssue, voucherVoid). `app` is per-user preferences and
// `shortcuts` is reference, so neither is a restaurant setting at all.
//
// v18.0.0 phase 5: the WhatsApp tab replaces the sandbox's `WA_SANDBOX` splice
// with the `module` gate phase 4 built. Same effect — a build without the module
// shows exactly the tabs it always did — but through the switch an admin can
// reach, rather than a build-time constant only a developer can. It keeps the
// sandbox's placement: after Reminders, with the other things the restaurant
// HOLDS, and before App/Shortcuts, which are about the device and reference.
//
// **`caps` is a LIST and the test is ANY, because one tab stopped being one
// capability.** The v18.0.0 split gave reminders, standing bookings, the floor
// plan and the opening hours their own rows, and General holds controls
// belonging to four of them at once — so a single `cap` would have hidden a
// person's own hours editor because they lack the unrelated capability that
// governs the optimiser cutoff two sections further down. The tab is the door;
// the sections behind it gate themselves (`GeneralTabContent`, which takes
// `can` for exactly that).
export const SETTINGS_TABS = [
  { id: "general",   label: "General",   caps: ["settingsWrite", "hoursEdit", "recurringManage", "dataExport"] },
  { id: "layout",    label: "Layout",    caps: ["layoutEdit"] },
  { id: "customers", label: "Customers" },
  // v18.0.0 phase 4: `module` beside `caps`, for the same reason `caps` sits
  // here rather than as a list of ids elsewhere — a second list is what this
  // comment block has been about since v16.0.0. The two gates are different
  // questions and both go through `visibleTabs`: `module` asks whether this
  // restaurant HAS the feature, `caps` who may use it.
  { id: "vouchers",  label: "Vouchers", module: "vouchers" },
  { id: "reminders", label: "Reminders", caps: ["reminderManage"] },
  // Both gates at once, and the FIRST tab to carry both — which is the pair
  // `visibleTabs` was written for. `module` asks whether this restaurant has
  // WhatsApp at all; `settingsWrite` asks who may change the one restaurant-wide
  // setting behind this tab (auto-archive on completion). The INBOX is not gated
  // on a capability: reading and replying to a guest is service work, the same
  // judgement that leaves Customers and Vouchers open (Patryk's call, phase 5).
  { id: "whatsapp",  label: "WhatsApp", module: "whatsapp", caps: ["settingsWrite"] },
  { id: "app",       label: "App" },
  { id: "shortcuts", label: "Shortcuts" },
  // v18.0.0 phase 3: the 8th tab, and the FIRST one that is not always there.
  // `caps` is what `visibleTabs` filters on — declared beside the tab rather
  // than as a list of admin-only ids somewhere else, because a second list is
  // exactly what this comment block has been about since v16.0.0.
  { id: "admin", label: "Admin", caps: ["settingsAdmin"] },
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
// v18.0.0 phase 4 adds the SECOND gate, `hasModule`, and the order is
// load-bearing: a module that is off hides the tab from everybody INCLUDING an
// admin, so it is tested first and `can` never runs for that tab. The other
// order would let a capability grant re-open a feature the restaurant switched
// off. Both are optional so a caller with no context degrades to "show what is
// not gated" rather than to an empty tab bar.
export function visibleTabs(can, hasModule) {
  const canFn = typeof can === "function" ? can : null;
  const modFn = typeof hasModule === "function" ? hasModule : null;
  return SETTINGS_TABS.filter(function (t) {
    // /code-review: BOTH gates degrade the same way, and the first version of
    // this did not. `t.module && modFn && !modFn(...)` short-circuits to false
    // when `modFn` is absent, which SHOWS a module-gated tab — the opposite of
    // what the `can` half four lines down does, and the opposite of the
    // conservative direction the comment above claims for both. A future third
    // caller, or either existing one losing the prop in a refactor, would have
    // silently re-opened the Vouchers tab for a restaurant that switched the
    // module off, with nothing erroring. Absent context now HIDES a gated tab
    // whichever gate it is: the app always passes both, so the only reachable
    // case is a mistake, and hiding is the direction you notice.
    if (t.module && (!modFn || !modFn(t.module))) return false;
    if (!t.caps) return true;
    if (!canFn) return false;
    return t.caps.some(function (c) { return canFn(c); });
  });
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
