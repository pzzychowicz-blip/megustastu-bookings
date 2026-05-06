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
