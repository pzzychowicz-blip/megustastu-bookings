# MGT Refactor Log

## Phase 0 — May 2026

- ✅ Manual Firebase backup taken (pre-refactor)
- ✅ Git tag v14.1-deployed created on production commit
- ✅ Branch v15-refactor created
- ✅ Skipping in-app JSON export (manual console export sufficient)
- ✅ Skipping dev Firebase project (refactor risk is low)

## Phase A — Pure logic extraction ✅
Date: [May 2026]
- Created src/lib/constants.js (data tokens)
- Created src/lib/booking-logic.js (optimizer + helpers)
- Created src/lib/reminders.js (reminder helpers)
- Modified src/App.jsx — 376 lines extracted, replaced by 3 import blocks
- Tested on localhost: ✅
- Tested on Vercel preview: ✅

## Phase B1 — Atoms extraction + JSX proof-of-concept ✅
Date: May 2026
Status: Merged to main, deployed to production

Files created:
- src/components/atoms.jsx (11 components in JSX syntax — first JSX file in codebase)

Files updated:
- src/lib/constants.js — added BTN button colour tokens
- src/App.jsx — atoms removed, atoms imported, -45 lines

Components moved & converted to JSX: Overlay, Fld, Section, SBadge, TBadge,
SmallTag, Toggle, Kbd, AvailBanner. Plus mkInp / mkBtn style helpers.

Strategic outcome:
- Confirmed Vite + @vitejs/plugin-react handles JSX cleanly in this repo
- Established the modern style template (JSX, const, destructured props,
  spread for style merging) for B2–B5 to follow
- App.jsx still uses RC()/var — full conversion happens incrementally as
  components extract in B2–B5

Verified: localhost ✅, Vercel preview ✅, production smoke test ✅

---

## Phase B2 — Secondary modals + table grid extraction

**Date**: 2026-05-06
**Branch**: `v15-refactor` → merged to `main`
**Status**: ✅ shipped

### Files created
- `src/components/TableGrid.jsx` (92 lines) — JSX, the 13-table picker shared by ManualModal and the walk-in form
- `src/components/ManualModal.jsx` (293 lines) — JSX, manual table assignment + swap-busy mode + keyboard shortcuts
- `src/components/BlockModal.jsx` (154 lines) — JSX, table-level block editor (view + add modes)

### Files modified
- `src/App.jsx` — 2,149 → 1,987 lines (−162). Imports added for the three new components; inline definitions and `TABLE_GROUPS` constant deleted; `TABLE_GROUPS` added to the existing `./lib/constants` import line.
- `src/lib/constants.js` — 44 → 61 lines (+17). Added `TABLE_GROUPS` export with a Phase B2 marker comment.

### Style: continued JSX template from atoms.jsx
JSX, `const`, destructured props, spread for style merging, inline `&&` and `?:` for conditional renders. App.jsx itself stays mixed (RC/`var`) — coexistence works.

### Key decisions
1. **Three separate component files**, not one bundled `modals.jsx`. Reasons: zero coupling between modals; TableGrid is independently shared with the walk-in form; consistent with B3–B5 pattern.
2. **No Phase D bonuses bundled** — kept B2 focused on structural extraction. ErrorBoundary / useMemo / viewport / logout-confirm deferred.
3. **`getCapOf` left inline in ManualModal** — pure logic but moving it now would mix structural extraction with logic relocation. Flagged for Phase C.
4. **`TABLE_GROUPS` moved to `constants.js`** (Option A), not embedded in TableGrid.jsx. Discovered mid-extraction that the new-booking form's "Preferred tables" picker is a second consumer of `TABLE_GROUPS`. Three options were considered (constants.js / export-from-TableGrid / extract-prefs-picker-too); chose constants.js as the smallest correct fix and future-proof for B5 when the prefs picker may itself become a component.

### Pre-merge validation
- Anchor checks before deleting lines 318–489 from App.jsx
- All `TABLE_GROUPS`, `TableGrid`, `ManualModal`, `BlockModal` reference sites preserved
- Brace / paren / bracket balance verified across all five files
- JSX-aware parse via `@babel/parser` + JSX plugin: all six files (the five outputs + atoms.jsx unchanged) parsed cleanly
- All imports in new component files resolve to actual exports in atoms.jsx / constants.js / booking-logic.js

### Verified on
- localhost:5173 — manual modal, swap-busy toggle (S key), clear (C key), Enter submit, block modal view+add, walk-in table picker, **new-booking "Preferred tables" picker** (the second TABLE_GROUPS consumer)
- Vercel preview build — read-only smoke test
- Production after merge — same smoke test on live URL

### Notes for B3
- Settings tree is the next target: `SettingsContent`, `TabBar`, `GeneralTabContent`, `RemindersTabContent`, `ReminderEditor`, `ReminderListItem`, `ShortcutsContent`, `ShortcutRow`, `CogIcon`.
- Likely 3–4 files (settings shell + reminder editor + shortcuts + general tab). Decide single-file-vs-split at the start of B3.
- App.jsx target after B3: ~1,400–1,500 lines.

### Cumulative progress
| Phase | App.jsx lines | Modules in `src/` |
|---|---|---|
| Pre-refactor (v14.1) | 2,570 | 1 (`App.jsx`) |
| After Phase A | 2,194 | 4 |
| After Phase B1 | 2,149 | 5 |
| **After Phase B2** | **1,987** | **8** |

---

## Phase B3 — Settings modal tree extraction

**Date**: 2026-05-06
**Branch**: `v15-refactor` → merged to `main`
**Status**: ✅ shipped

### Files created
- `src/components/Settings.jsx` — JSX, the Settings shell. Exports `SettingsContent` (tab dispatcher), `TabBar` (pill-shaped tab switcher), `GeneralTabContent` (version + copyright), `CogIcon` (gear SVG used as Settings trigger).
- `src/components/Reminders.jsx` — JSX, the Reminders tab body. Exports `RemindersTabContent` (header + list), `ReminderListItem` (one card). Module-level `DAY_SHORT_LABELS` constant co-located here.
- `src/components/Shortcuts.jsx` — JSX, the Shortcuts cheatsheet. Exports `ShortcutsContent` (sectioned cheatsheet), `ShortcutRow` (one keycap-and-label row). Module-level `SHORTCUT_SECTIONS` constant co-located here.
- `src/components/ReminderEditor.jsx` — JSX, the standalone reminder editor modal at z-index 250 (sits above the Settings Overlay's 200). Pure presentational — `draft` and `setDraft` owned by BookingApp.

### Files modified
- `src/App.jsx` — 1,987 → 1,783 lines (−204). Imports added for `SettingsContent`, `CogIcon`, `ReminderEditor`; nine inline component definitions and the `DAY_SHORT_LABELS` module-level constant deleted.

### Style: continued JSX template
JSX, `const`, destructured props, spread for state updates (`{...draft, text:v}` instead of `Object.assign`), inline `&&` and `?:` for conditional renders. App.jsx itself stays in `RC()`/`var` style — coexistence works.

### Key decisions
1. **Four files (Option C)**, not two (Option A monolith) or three (Option B Reminders+Editor merged). Reasons: each file = one logical concern; well-balanced sizes (largest is ReminderEditor at ~310 lines including comments); ReminderEditor is structurally a top-level modal like ManualModal/BlockModal so it earns its own file by B2 precedent; future tabs can add new files instead of bloating an existing one.
2. **No Phase D bonuses bundled** — same reasoning as B2; kept B3 focused on structural extraction. ErrorBoundary / useMemo / viewport / logout-confirm still deferred.
3. **`DAY_SHORT_LABELS` co-located in Reminders.jsx** — was previously a top-level App.jsx constant only used by ReminderListItem. Moving it inside its only consumer is the obvious cleanup.
4. **Outdated comment fixed silently.** The original ShortcutsContent header claimed it was "shared by Settings modal AND the standalone `?` popup." No `?` popup exists in the codebase — `?` key dispatches `setShowSettings(true)`. The dual-use claim was removed in the new file's header.
5. **Hardcoded "version 14.1" preserved** in GeneralTabContent. Per refactor plan, this string bumps to "15.0" at end of B5.
6. **Custom overlay kept inline in ReminderEditor** — the Overlay component from atoms.jsx uses z-index 200; ReminderEditor needs 250 to sit above the Settings modal. Lifting ReminderEditor's overlay markup to a shared "z-aware Overlay" was out of scope; flagged for Phase C consideration.

### Pre-merge validation
- **Anchor checks** — 8 distinct line-position anchors verified against the post-B2 App.jsx before any mutation (BlockModal import close, RC alias, Settings section comment, ShortcutRow def, DAY_SHORT_LABELS const, ReminderEditor def, CogIcon def + closing brace, Timeline header).
- **Reference sweep** — confirmed every remaining Settings-tree symbol in the modified App.jsx is either an import line, a reference inside the import-block comment, or a legitimate consumer at expected call sites.
- **JSX-aware parse** — all 5 affected files (4 new + modified App.jsx) parsed cleanly with `@babel/parser` + JSX plugin.
- **Import resolution audit** — all 13 imported symbols across the 4 new files resolve to actual exports in their source files (constants.js, booking-logic.js, reminders.js, atoms.jsx, sibling components).
- **Brace / paren / bracket balance** — perfect across all files.

### Verified on
- localhost:5173 — Settings cog opens modal; tab switching (click + ←/→ keys); General tab shows version + copyright; Reminders tab empty state, list state, "+ New reminder" launches editor at z=250 above Settings; Save / toggle / edit / delete flows; Shortcuts tab renders 7 sections; `?` key opens Settings from anywhere; Reminder editor validation (empty text, past date, all-times-past for one-off); Esc key closes editor.
- Vercel preview build — read-only smoke test
- Production after merge — same smoke test on live URL

### Notes for B4
- TimelineView (~125 lines) and ListView (~50 lines) are the next targets. Both live near the top of App.jsx now (post-deletion area).
- TimelineView has heavier dependencies than B2/B3 components: zoom state, follow-now state, busy-window calculations, the cog button, AvailBanner integration. Read carefully before drafting.
- Decide single-file (`Views.jsx` bundling both) vs split (`TimelineView.jsx` + `ListView.jsx`) at the start of B4 based on dependency overlap. My instinct: split, because they share almost no dependencies and List is much smaller.
- App.jsx target after B4: ~1,600 lines.

### Cumulative progress
| Phase | App.jsx lines | Modules in `src/` |
|---|---|---|
| Pre-refactor (v14.1) | 2,570 | 1 (`App.jsx`) |
| After Phase A | 2,194 | 4 |
| After Phase B1 | 2,149 | 5 |
| After Phase B2 | 1,987 | 8 |
| **After Phase B3** | **1,783** | **12** |

We're 31% of the way through reducing App.jsx's pre-refactor size. Two sub-phases remaining (B4, B5).

---

## Phase B4 — Timeline + List view extraction

**Date**: 2026-05-07
**Branch**: `v15-refactor` → merged to `main`
**Status**: ✅ shipped

### Files created
- `src/components/TimelineView.jsx` (651 lines) — JSX, the Gantt-style scrollable grid. Includes zoom controls, follow-now mode (today only), optimizer toggle + reshuffle button, long-press → quick-status popup, and the cog button that opens Settings. Inline sub-components `GridLines`, `Block`, `BlockBar` close over parent state and stay inside.
- `src/components/ListView.jsx` (187 lines) — JSX, sorted booking card list. Status-priority ordering (seated → confirmed → completed → cancelled), live duration tags on seated bookings, conflict and warn banners, action buttons.

### Files modified
- `src/App.jsx` — 1,783 → 1,612 lines (−171). Imports added for `TimelineView` and `ListView`. `CogIcon` dropped from the Settings import line because App.jsx no longer uses it directly — `TimelineView` (which uses it for the legend-row settings trigger) now imports it from `./components/Settings`. Two inline component definitions and their section header comments deleted.

### Style: continued JSX template from atoms.jsx
JSX, `const`, destructured props with default values, spread for style merging, inline `&&` and `?:` for conditional renders. App.jsx itself stays mixed (RC/`var`) — coexistence works.

### Key decisions
1. **Two separate component files**, not one bundled `views.jsx`. Both are consumed only by BookingApp but they share zero dependencies and have very different sizes (651 vs 187 lines). Matches the B2 / B3 one-file-per-logical-unit precedent.
2. **`CogIcon` import migrated to TimelineView**, not kept in App.jsx as a pass-through. TimelineView is its only consumer in code, so the import lives where the use is.
3. **Inline helpers preserved**. `pct(mins)` (TimelineView, time-axis percentage) and `statusOrder(s)` (ListView, sort priority) are pure but stay inline for now — promoting them mid-extraction would mix structural and logic moves. Both flagged for Phase C alongside `getCapOf` from B2.
4. **Inline sub-components stay inline**. `GridLines`, `Block`, and `BlockBar` close over `pct`, `setQuickStatus`, `warnings`, `onEdit`, `onManual`, etc. Lifting them out would force prop-passing for ~10 closure-captured values per call.
5. **Unused `blockEl = useRef(null)` preserved verbatim** inside the `Block` sub-component. It's a runtime allocation (not a comment), so dropping it would have been a behavioural change rather than a structural one. Flagged for Phase C cleanup.
6. **No Phase D bonuses bundled** — kept B4 focused on structural extraction. ErrorBoundary / `useMemo` / cleanup of stale refs deferred.

### Validation performed
- All three files pass `@babel/parser` JSX parse-check.
- Every imported symbol verified to exist as an export in its source module.
- No unused imports in either new file.
- App.jsx call sites for `RC(TimelineView, …)` and `RC(ListView, …)` preserved.
- Live smoke test confirmed: timeline render, scroll, zoom, follow-now, optimizer toggle, reshuffle, long-press status popup, cog → Settings, list-view sort order, live duration tag on seated bookings, status-change buttons.