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

---

## Phase B5 — Final modal & screen extraction + version bump

**Date**: 2026-05-07
**Branch**: `v15-refactor` → merged to `main`
**Status**: ✅ shipped

### Files created
- `src/components/LoginScreen.jsx` (124 lines) — JSX, the unauthenticated entry screen. Email + password inputs, Firebase auth wiring, error mapping for invalid-credential / wrong-password / user-not-found / too-many-requests. Self-contained, 0 props.
- `src/components/WalkinForm.jsx` (484 lines) — JSX, the walk-in seating modal. Time / party size / duration steppers, table picker (via `TableGrid`), kitchen-load section with alternative-time chips, capacity check, AvailBanner integration. 11 props.
- `src/components/PrefPickerModal.jsx` (160 lines) — JSX, the soft-hint preferred-tables picker. Capacity-capped selection (refuses additions once party fits), Clear / Done buttons. 4 props.
- `src/components/HistoryPopup.jsx` (87 lines) — JSX, per-booking audit-trail viewer. Reverse-chronological entries with en-GB locale formatting. 2 props.

### Files modified
- `src/App.jsx` — 1,612 → 1,447 lines (−165). Imports added for the four new components as a B5 phase block. `signInWithEmailAndPassword` dropped from the `firebase/auth` import (now only used inside LoginScreen). Inline `LoginScreen` function definition + section header deleted. The `prefPickerModal`, `historyPopup`, and `walkinModal` IIFEs replaced with single-line conditional `RC(Component, props)` call sites. Version strings bumped: `__APP_SIGNATURE__.version` 14.1 → 14.1.1, `__APP_SIGNATURE__.build` v14.1-deployment → v14.1.1-deployment, version-label comment updated.
- `src/components/Settings.jsx` — visible version label in `GeneralTabContent` bumped 14.1 → 14.1.1; header comment expanded to record the bump.

### Style: continued JSX template from atoms.jsx
JSX, `const`, destructured props with default values, spread for state updates, inline `&&` and `?:` for conditional renders. App.jsx itself stays mixed (RC/`var`) — modernisation belongs to Phase C.

### Key decisions
1. **BookingForm extraction skipped.** Dependency analysis showed a `BookingForm` component would need 18+ closure props plus 12+ booking-logic helpers — splitting App.jsx complexity across two files without clarifying anything. Deferred to Phase C, where context wiring will reduce the surface to ~5 props. The thread summary's original B5 plan was based on the file structure pre-analysis; the analysis revealed the form is structurally different from TimelineView / ListView (which had bounded prop counts).
2. **B5 reframed as "Final modal & screen extraction"** — captures the four naturally bounded UI units. Total reduction (165 lines) is comparable to what B5-with-BookingForm would have achieved minus the architectural debt.
3. **Three IIFEs collapsed to conditional `RC()` call sites.** All the IIFE-internal logic moved entirely inside the new components; parent retains only visibility decisions and a small prop set. Matches the pattern established by ManualModal / BlockModal in B2.
4. **`walkinNum` and `isMobile` passed as derived props** rather than imported. The parent recomputes `getNextWalkinNum()` each render (matching original behaviour); `useWinW` stays inline in App.jsx until Phase C moves it to a hooks module.
5. **`signInWithEmailAndPassword` import migrated**, not kept as a pass-through. LoginScreen is the only consumer in code, so the import lives where the use is. Same logic as `CogIcon` migration in B4.
6. **Three `getCapOf` variants now exist** — in `ManualModal`, `WalkinForm`, and `PrefPickerModal`. Each preserved verbatim. All three flagged for Phase C consolidation alongside `pct`, `statusOrder`, `liveDur` (B4 carry-over).
7. **Version bump policy formalised** this thread: file-split refactor only = patch version (14.1 → 14.1.1), new components or feature additions = minor version (→ 14.2.x), major rewrite = major version (→ 15.x). End-of-B5 ships as 14.1.1 because the file split is complete with no behavioural change.

### Validation performed
- All six files pass `@babel/parser` JSX parse-check.
- Every imported symbol verified to exist as an export in its source module.
- No unused imports in any of the four new component files.
- App.jsx call-site checks: 4 new `RC()` invocations present, 0 leftover IIFEs for the three replaced ones, 0 references to `signInWithEmailAndPassword`, 0 occurrences of the old version strings.
- Live smoke test confirmed: login with valid + invalid credentials, walk-in flow including kitchen-busy confirmation path, preferred-tables soft-hint pick / clear / done, history popup with multiple entries, DevTools boot banner reads `v14.1.1`, Settings → General shows `version 14.1.1`.

### Cumulative milestone — file-split phase of v15 refactor: COMPLETE
- Original `App.jsx` (pre-Phase 0): 2,570 lines · 1 module
- After B5: 1,447 lines · 16 modules (`atoms`, `constants`, `reminders`, `booking-logic`, `firebase` + 11 component files)
- Total extracted: **~44% of original line count**
- Next: Phase C (modernization — `var` → `const`/`let`, `RC()` → JSX in App.jsx, helper consolidation, `useWinW` → hooks module, BookingForm extraction with proper context). Best done in a fresh thread.

## Phase C1 — Helper consolidation + Follow button label fix
**Shipped:** 2026-05-07
**Version:** 14.1.1 → **14.1.2** (patch)
**Branch:** `v15-refactor` → `main`

### Summary
First Phase-C sub-phase: pure helper consolidation, no extraction. Five helpers
that were duplicated across component files / buried inside closures are now
single canonical exports in `lib/booking-logic.js`. One pre-existing bug (an
unused `useRef` in `TimelineView`) is dropped, and the Follow-now button label
is fixed so its active state reads "Following" instead of relying on
background colour alone.

This is a structural / hygiene release. The only user-visible change is the
Follow button label.

### What moved into `lib/booking-logic.js`
| New export | Sourced from | Algorithm preserved |
|---|---|---|
| `nowTime()` | App.jsx (local) + WalkinForm (`localNowTime`) | Identical — `toTime(h*60+m)` of `new Date()` |
| `statusOrder(s)` | ListView (file-local) | Identical — seated → confirmed → completed → cancelled |
| `pct(mins)` | TimelineView (closure over `totalMins`) | Identical — `totalMins` now computed internally from `OPEN`/`GRID_CLOSE` |
| `liveBarDur(b, nowMins)` | TimelineView (closure as `liveDur`) | Identical — `seated → max(15, elapsed)`, else `b.duration` |
| `comboCapBest(ids)` | ManualModal + WalkinForm (both `getCapOf`) | Identical — exact-match → greedy best-subset → sum-of-standalones |

### Critical finding mid-phase: `getCapOf` was two variants, not three
Pre-flight analysis assumed three near-identical copies of `getCapOf`. The
actual landscape:
- **ManualModal** and **WalkinForm** had byte-equal "best-subset greedy"
  implementations. Both replaced with `comboCapBest`.
- **PrefPickerModal** had a strictly simpler variant — exact-match in
  `VALID_COMBOS` → fallback to sum-of-standalones, no greedy. That algorithm
  already existed in `booking-logic.js` as the `comboCap` export. Replaced
  with the existing import; no new code shipped for this case.

The PrefPickerModal variant is not a bug to be fixed by upgrading to
`comboCapBest`. The two variants are intentional: best-subset greedy is for
hard-assignment paths (which need the most permissive capacity calculation),
the simpler variant is for soft-hint preferences (which don't need partial-
match scoring). Both are now first-class library exports rather than copies.

### Critical finding: `liveDur` is intentionally NOT consolidated
ListView contains an inline calculation that looks like `liveDur` but has
*different* semantics — its end-time is pinned to the planned `b.duration`
until a guest overstays, whereas TimelineView's `liveDur` always returns
`max(15, elapsed)` for seated bookings. These were noted as duplicates in
the previous thread's "items still flagged" list, but the close read
revealed they're not actually the same function. ListView's stays inline.

### `Block.blockEl` — unused ref dropped
The `Block` sub-component inside `TimelineView` declared
`const blockEl = useRef(null)` and never referenced it. Carried as-is
through B4. Removed in C1 along with its preserved-verbatim comment.

### Follow-now button label
Was: `{followNow ? "Follow" : "Follow"}` — both branches identical, state
conveyed only by background colour change.
Now: `{followNow ? "Following" : "Follow"}` — text and colour both flip.

### File deltas
| File | Before | After | Δ |
|---|---:|---:|---:|
| `src/lib/booking-logic.js` | 335 | 406 | +71 |
| `src/App.jsx` | 1,447 | 1,451 | +4 |
| `src/components/TimelineView.jsx` | 651 | 639 | −12 |
| `src/components/WalkinForm.jsx` | 484 | 458 | −26 |
| `src/components/ManualModal.jsx` | 293 | 271 | −22 |
| `src/components/ListView.jsx` | 187 | 182 | −5 |
| `src/components/PrefPickerModal.jsx` | 160 | 156 | −4 |
| `src/components/Settings.jsx` | 141 | 143 | +2 |

Net: +8 lines across the codebase, but redistributed — duplication eliminated,
helpers concentrated in the lib module where they belong.

### Validation
1. `@babel/parser` JSX parse-check — 8/8 files clean.
2. Import-existence — 71/71 imports from `booking-logic.js` resolve to real
   exports.
3. Unused-import check — 7/7 files clean for new imports introduced this
   phase. (Pre-existing dead imports in App.jsx — flagged below — are
   unchanged.)
4. Live smoke test on dev — Timeline rendering, Follow toggle (label flips),
   List sort order, Manual assign capacity, Walk-in capacity, Preferred
   tables capacity, Walk-in time pre-fill, Settings → General version line,
   console boot banner. All confirmed on 14.1.2.

### Items still flagged (carry forward, not addressed in C1)
- **31 dead imports in App.jsx** left over from B1–B5. Symbols like `INDOOR`,
  `OUTDOOR`, `VALID_COMBOS`, `findBest`, `comboCap`, `SBadge`, `Toggle`, etc.
  are imported but never referenced in App.jsx itself. Recommend folding
  into C2 (which already touches App.jsx for `useWinW`).
- `useWinW` — still inline in App.jsx → C2.
- `var` → `const`/`let` and `RC()` → JSX in App.jsx → C3.
- BookingForm extraction → C4.

### Workflow rules confirmed this phase
- Design-first, code-second held: pre-flight analysis caught the
  two-variants-not-three reality and the `liveDur` semantic divergence
  before any code was written.
- Anchor-based file patches (every `str_replace` was unique-match);
  no line-number drift.
- Validation chain ran before shipping (parse → imports exist → imports used
  → sanity grep of removed code).
- Byte-identical behaviour mandate held everywhere except the one place it
  was explicitly broken (Follow button label).

  ## Phase C2 — useWinW hook extraction + dead-import cleanup
**Shipped:** 2026-05-07
**Version:** 14.1.2 → **14.1.3** (patch)
**Branch:** `v15-refactor` → `main`

### Summary
Second Phase-C sub-phase: extract the `useWinW` viewport-width hook into its
own module, and clean up 31 leftover dead imports in App.jsx that B1–B5 left
behind. Two small, contained changes shipped together because they both touch
App.jsx's import block and have zero behavioural overlap with anything else.

This is a structural / hygiene release. **Zero user-visible changes.**

### What moved into `src/hooks/useWinW.js`
A new top-level folder, `src/hooks/`, mirrors the `src/components/` pattern:
one custom hook per file, no barrel `index.js` until there's a second hook
to barrel. Direct imports keep dependency graphs explicit.

| Item | Before | After |
|---|---|---|
| `useWinW` definition | Inline in App.jsx (line 156, single-line block) | `src/hooks/useWinW.js`, 38 lines with header docs |
| `useWinW` consumer | App.jsx — single call site at line 513 | Same — imported from new path |
| `var` style | `var ws = useState(...)`, `function h(){…}` | Identical — no modernisation in C2 |

API decision: kept the hook's signature exactly as-is (returns the raw
`number`, not a derived `boolean`). The alternative `useIsMobile()` reshape
would have been a free win in isolation but the magic `< 600` threshold
still lives at the call site, so consolidating it would be cosmetic. Defer
to whenever a second consumer of the breakpoint emerges.

### Dead-import cleanup
The validator flagged **31 imports in App.jsx that were never referenced in
its body** — leftovers from B1–B5 where symbols moved into component files
without their parent imports being pruned. Each candidate was re-verified
with a word-boundary grep (must appear exactly once: the import line
itself); all 31 confirmed dead.

| Import block | Was | Now | Dropped |
|---:|---:|---:|---|
| `./lib/constants` | 21 | 7 | INDOOR, OUTDOOR, ALL_TABLES, TIMELINE_TABLES, VALID_COMBOS, CLUSTERS, TABLE_GROUPS, GRID_CLOSE, QUARTER_HOURS, ROW_H, LABEL_W, STATUS_COLORS, TBL (14) |
| `./lib/booking-logic` | 37 | 25 | overlaps, isIn, isAllIn, isAllOut, isMixedLarge, comboOk, comboCap, getBusy, findBest, findBestAny, findAllOptions, optimise, verifyClean (12) |
| `./lib/reminders` | 5 | 4 | reminderFireKey (1) |
| `./components/atoms` | 11 | 7 | SBadge, SmallTag, Toggle, Kbd (4) |

These symbols are still very much in use — just not in App.jsx itself.
They're imported directly by their actual consumers in
`./components/*.jsx` and `./lib/*.js`. The cleanup makes App.jsx's
dependency surface honest: now you can read its import block and know
exactly what App.jsx itself touches.

### File deltas
| File | Before | After | Δ |
|---|---:|---:|---:|
| `src/App.jsx` | 1,447 | 1,460 | +13 |
| `src/hooks/useWinW.js` | (new) | 38 | +38 |
| `src/components/Settings.jsx` | 143 | 146 | +3 |

App.jsx grows by +13 despite dropping 31 import lines — the multi-line
import blocks shrink by ~14 lines, but the new `useWinW` import block (with
its header comment) adds ~7 lines and the C2 changelog comment in the
deployment-notes block adds ~2 lines. Body of file unchanged.

### Validation
1. `@babel/parser` JSX parse-check — 3/3 files clean.
2. Import-existence — 44/44 App.jsx imports from local modules resolve to
   real exports (5 modules: `./lib/constants`, `./lib/booking-logic`,
   `./lib/reminders`, `./components/atoms`, `./hooks/useWinW`).
3. Unused-import check — 66/66 imports in App.jsx referenced somewhere in
   its body. Down from 31 unused before this phase.
4. Removal sanity — confirmed no local `function useWinW(){…}` survives in
   App.jsx; confirmed `hooks/useWinW.js` exports the function.
5. Version sanity — `__APP_SIGNATURE__.version = "14.1.3"`, Settings label
   reads `version 14.1.3`.
6. Live smoke test on dev — desktop layout, narrow-viewport reflow, form
   column collapse, walk-in form mobile single-column, Settings label,
   console boot banner. All confirmed on 14.1.3.

### Items still flagged (carry forward, not addressed in C2)
- `var` → `const`/`let` and `RC()` → JSX in App.jsx → C3 (the big mechanical
  pass; may want to split further by section).
- BookingForm extraction with proper context wiring → C4. Still the hardest
  remaining problem; ~25 closure values from BookingApp need to drop to
  ~5 props via Context, custom hook, or co-located state.

### Architectural decisions made this phase
**`hooks/` folder convention** — one hook per file, named after the hook,
direct imports (no barrel). Future hooks land here. This means a future
`useFollowNow()` or `useKeyboardShortcuts()` extraction has an obvious home.

**`useWinW` API kept verbatim** — see "API decision" note above. The hook
returns the raw width number; consumers compute their own thresholds. Two
reasons: (a) the only call site is App.jsx, so abstraction-shape hardly
matters; (b) `useIsMobile()` would still leave the magic 600 hardcoded
inside the hook. Deferring until there's a real second consumer.

**Dead-import cleanup folded into C2** — not a separately-shipped phase.
The cleanup touches the same import block that the hook extraction does, so
shipping them together is one diff to review instead of two.

### Workflow rules confirmed this phase
- Pre-flight grep verification before deletion: every one of the 31 dead
  imports was independently confirmed to have exactly 1 occurrence in
  App.jsx (the import line) before being removed.
- Validator re-run after the patch: 0 imports unused, 0 missing — net effect
  matches intent exactly.
- Anchor-based file patches; every `str_replace` was unique-match.
- Byte-identical behaviour mandate held: no observable change at the user
  level (verified by smoke test).

### Notes for the next phase (C3)
C3 is the big modernisation: `var` → `const`/`let` and `RC()` → JSX inside
App.jsx itself. Two heads-up items from this phase that affect C3:
- **The dead-import cleanup makes C3 safer**, because the import block now
  reflects only what App.jsx actually touches. No "did I break this symbol's
  usage somewhere?" surprises during the JSX rewrite.
- **The new `hooks/useWinW.js` file is already modern style** (`import`,
  `export function`, no `RC()`). When App.jsx itself goes JSX in C3, no
  changes needed in this file.

## Phase C3a — `var` → `const`/`let` modernization + useState destructuring
**Shipped:** 2026-05-08
**Version:** 14.1.3 → **14.1.4** (patch)
**Branch:** `v15-refactor` → `main`

### Summary
Third Phase-C sub-phase: a purely lexical refactor of `App.jsx`. All 380 `var`
keywords are converted to `const` (325) or `let` (16), and 38 `useState`
declarations are collapsed to modern destructured form
(`const [x, setX] = useState(...)`). No code is moved, no logic is changed,
no imports are touched.

This is the first half of Phase C3 — the second half (C3b) will convert the
154 `RC(...)` call sites to JSX in a separate thread. Splitting C3 keeps each
deploy reviewable as a single concern and isolates any TDZ regressions
(C3a) from any JSX-build regressions (C3b).

**Zero user-visible changes. Zero behavioural changes.**

### Pre-flight
A multi-pass static audit ran before any code was touched:

1. **Hoisting risk scan** — for every `var NAME` declaration, found all
   word-boundary references to `NAME` and flagged any that occurred *before*
   the declaration line at indent ≤ the declaration's indent. Filtered out
   string literals, property keys, dot-access, callback parameter binders,
   and import paths. **Result: 0 genuine hoisting risks across all 1460
   lines.** Every `var` was already declared before any reference resolved
   to it.
2. **Block-scope leak scan** — searched for `for (var ...)`, `var` inside
   `if`/`while`/`switch` blocks, and `var {…}` destructuring. **Result: 0
   patterns** (App.jsx had never used these).
3. **Reassignment scan** — for every `var NAME`, found every `NAME = …`,
   `NAME +=`, `NAME++`, `NAME--` that wasn't the declaration itself, wasn't
   a property assignment, and wasn't inside a callback that took `NAME` as
   its own parameter. **Result: 13 names need `let`** (cross-line audit).
4. **Same-line declare-then-reassign scan** — caught 3 additional cases the
   cross-line audit had missed (`max` at original L601, `ex` at L638,
   `curIdx` at L936). These are all of the form
   `var X = init; …; X = newval;` on a single line. After the patch:
   **16 `let` declarations total**.

### Execution
Conversion was applied in 5 sections, each with its own per-section
post-pass audit verifying that every emitted `const` was truly never
reassigned anywhere in the file. One false-positive flag in Section 4
(`fin` at L735) was confirmed safe via brace-matching the surrounding
`if`/`else` structure — same identifier in disjoint branches, one needs
`let`, one needs `const`.

| Section | Range | Vars converted | `let` cases |
|---|---|---:|---|
| 1 | Module-level (L116, L158) | 2 | — |
| 2 | BookingApp body declarations (L162–340) | 51 | `meta` |
| 3 | Reminder helpers + auto-extend + overlap warnings + walk-in (L341–620) | 78 | `needsUpdate`, `nextOnTable`, `nextStart`, `max` |
| 4 | `doSave` + booking actions + keyboard handler + `updateStatus`/`manualAssign` (L622–1123) | 123 | `ex`, `seatedShift`, `saveDur`, `saveCustDur`, `saveTime`, `h`, `fin`, `base`, `curIdx`, `seatedShiftHappened` |
| 5 | IIFE memoizations + render tree + auth wrapper (L1125–end) | 93 | `found` |

Each section's output passed an Acorn ESM/ES2022 parse check before being
carried forward into the next section. The deployment file passed Acorn at
the end too.

### `useState` collapses (38 total)
Every `var <temp>=useState(<v>);var <state>=<temp>[0],<setter>=<temp>[1];`
pattern was collapsed to `const [<state>, <setter>] = useState(<v>)`.

Three sub-shapes were handled:

- **Oneline (33 cases):** the entire pattern fits on one source line, e.g.
  `var bs=useState([]);var bookings=bs[0],setBookings=bs[1];`
  → `const [bookings, setBookings] = useState([]);`
- **Twoline (4 cases):** the temp var and the destructure are on consecutive
  lines (the `reminders`/`reminderFires` block plus 2 stragglers). These
  collapsed two lines into one, accounting for the file's net −3 line delta.
- **Setter-only (1 case):** `var rts30=useState(0);var setReminderTick=rts30[1];`
  → `const [, setReminderTick] = useState(0);` — the leading comma keeps the
  unused-value pattern explicit, matching the existing comment that
  documents *why* the value is discarded.

`useState(...)` and `useRef(...)` call counts are bit-identical before and
after (39 and 12 respectively).

### `let` cases — every reassignment confirmed by code review

| Name | Decl line (final file) | Why `let` |
|---|---:|---|
| `meta` | 190 | Viewport `<meta>` tag fallback creation |
| `needsUpdate` | 498 | Auto-extend flag toggled inside seated-booking map |
| `nextOnTable` | 540 | forEach accumulator (nearest next booking on shared table) |
| `nextStart` | 540 | forEach accumulator (paired with `nextOnTable`) |
| `max` | 598 | Walk-in number scan: `let max=0;…if(n>max) max=n;` (same-line) |
| `ex` | 635 | Manual-tables guard: declared then `ex=ex.concat(…)` (same-line) |
| `seatedShift` | 646 | Reassigned inside conditional if confirmed→seated transition |
| `saveDur` | 657 | Reassigned in completed-status branch and seated-shift branch |
| `saveCustDur` | 659 | Parallel to `saveDur` |
| `saveTime` | 663 | Reassigned if `seatedShift` |
| `h` | 686 | History array extended via `h=h.concat(...)` if seatedShift |
| `fin` | 697 | Reassigned in `wasSeatedLocked` post-process branch (if-branch only — the parallel `fin` at L735 in else-branch is `const`) |
| `base` | 725 | Bookings array remapped on `swapAffected` and again on Book Again source |
| `curIdx` | 933 | Settings tab cycle: `let curIdx=…; if(curIdx<0) curIdx=0;` (same-line) |
| `seatedShiftHappened` | 1049 | Flag toggled true inside map callback |
| `found` | 1128 | manualBooking IIFE: `let found=…; if(...) found=Object.assign(…);` |

### File metrics

| Metric | Before (14.1.3) | After (14.1.4) |
|---|---:|---:|
| Lines | 1460 | 1457 |
| `var` keyword count (in code) | 380 | **0** |
| `const` keyword count | 0 | 325 |
| `let` keyword count | 0 | 16 |
| `useState(...)` calls | 39 | 39 |
| `useRef(...)` calls | 12 | 12 |
| Acorn ESM/ES2022 parse | OK | OK |

### What this *doesn't* do
- **No JSX conversion.** The 154 `RC(...)` call sites remain. That's C3b.
- **No structural extraction.** No code moves out of `App.jsx`. That's
  Phase D and beyond.
- **No `let → const` refactors of the 16 `let` cases.** The all-`const`
  ideal would require ternary-folding or restructuring the conditional
  reassignments, which would mix lexical refactor with semantic rewrites.
  Out of scope; revisit if/when desired as a separate hygiene pass.
- **No changes outside `App.jsx`.** Settings.jsx, the `lib/` modules, the
  `components/` files, and `useWinW.js` are untouched.

### Smoke-test surface (post-deploy verification)
Because the refactor only changes declaration keywords, runtime regressions
can only appear via TDZ — and the pre-flight confirmed zero hoisting
risks. Still, the live build was exercised on the flows that touch the
trickiest `let` cases:

| Flow | `let` validated |
|---|---|
| Sequential walk-in creation (Walk-in 1 → 2 → 3) | `max` |
| Edit confirmed booking → set status to seated past arrival time | `seatedShift`, `saveDur`, `saveCustDur`, `saveTime`, `h`, `fin` |
| Book Again from a seated/completed guest | `base` |
| Settings open → ←/→ to cycle General/Reminders/Shortcuts | `curIdx` |
| Auto-extend triggers when seated guest overstays | `needsUpdate` |
| Seated guest table conflicts with upcoming booking | `nextOnTable`, `nextStart`, `seatedShiftHappened`, `found` |
| Manual table assignment with new vs existing booking | `ex` |
| Open booking form on narrow viewport → viewport meta still injected | `meta` |
| Auth wrapper boot path (sign in / sign out / refresh) | App-level `user`, `checking` collapses |

### Next
**Phase C3b** — `RC(React.createElement)` → JSX conversion across the same
file. ~154 call sites. Will be approached in a fresh thread with its own
pre-flight — the codemod approach (`react-codemod`'s
`create-element-to-jsx`, or the equivalent Babel plugin) is the leading
candidate to avoid hand-converting that many sites.

## Phase C3b — `RC(...)` → JSX conversion
**Shipped:** 2026-05-09
**Version:** 14.1.4 → **14.1.5** (patch)
**Branch:** `v15-refactor` → `main`

### Summary
Fourth Phase-C sub-phase: convert every `RC(...)` (`React.createElement`)
call site in `App.jsx` to JSX syntax. All 182 calls — 145 intrinsic HTML
tags (`div`, `span`, `button`, `input`, `option`, `select`, `textarea`)
plus 37 component references (`Section`, `Overlay`, `TBadge`, `Fld`,
`AvailBanner`, `BlockModal`, etc.) — became `<Tag .../>` or
`<Tag>...</Tag>` JSX elements.

This is the second half of Phase C3 (the first half, C3a, was the
`var → const/let` lexical pass). Together C3a + C3b bring `App.jsx` to
modern React style: destructured useState, JSX render syntax, scoped
declarations.

**Zero user-visible changes. Zero behavioural changes.**

### Pre-flight

Three questions had to be answered before any code was generated:

1. **Does Vite's JSX transform reach `App.jsx`?**
   Verified live: dropped a `<div>jsx test</div>` into the render tree,
   ran `npm run dev`, confirmed the test element appeared in the DOM.
   Vite's `@vitejs/plugin-react` transforms anything matching
   `**/*.{jsx,tsx}` by default, including `App.jsx`. One whole class of
   build-time failure ruled out.

2. **Codemod approach: react-codemod, custom AST, or hand?**
   Chose **custom AST transform**. 182 call sites is solidly in
   codemod territory — too many to hand-convert reliably, too few to
   justify tuning a third-party tool. Custom transform also gives full
   control over the output style and can be developed + validated in
   the same sandbox where the source lives.

3. **AST inventory: what shapes does the transform have to handle?**
   A pre-flight script walked the AST and classified every `RC(...)`
   call. Results were unusually clean:
   - **First arg:** 145 string literals (intrinsics), 37 identifiers
     (components). Zero dynamic `RC(expr, ...)` patterns.
   - **Props arg:** 13 `null`, 169 object literals. Zero spreads, zero
     `Object.assign(...)` as props.
   - **Children:** strings, nested `RC(...)` calls, identifiers,
     conditional expressions, binary expressions, member expressions,
     `arr.map(...)` results. Every shape has a clear JSX equivalent.
   - **Component imports:** all 16 component names already imported.
     `BookingApp` is the in-file function declaration (correct).
   - **Edge cases:** 2 `dangerouslySetInnerHTML={{__html:"..."}}`
     usages — handled natively by JSX-attribute-as-expression rules.

### The codemod

A short Node script (`rc_to_jsx_recast.js`) using:
- **`@babel/parser`** — parses source as ESM with the JSX plugin
- **`recast`** — wraps the parser; preserves original source ranges on
  every AST node, re-prints only modified subtrees verbatim
- **`@babel/types`** — AST node builders (`t.jsxElement`,
  `t.jsxAttribute`, `t.jsxExpressionContainer`, `t.jsxText`)
- **`recast.types.visit`** — post-order traversal so nested `RC(...)`
  becomes a `JSXElement` AST node before its parent consumes it

Conversion rules:

| Source pattern | JSX form |
|---|---|
| `RC("div", null)` | `<div />` |
| `RC("div", null, "x")` | `<div>x</div>` |
| `RC("div", {className:"x"})` | `<div className="x" />` |
| `RC("div", {style:{...}})` | `<div style={{...}} />` (double braces for ObjectExpression) |
| `RC("div", {onClick:fn})` | `<div onClick={fn} />` |
| `RC(Section, null, child)` | `<Section>child</Section>` |
| `RC("div", {key:id})` inside `.map()` | `<div key={id} />` |
| `RC("button", {dangerouslySetInnerHTML:{__html:"&#8249;"}})` | `<button dangerouslySetInnerHTML={{__html:"&#8249;"}} />` |
| `RC("div", null, foo?RC(X):null)` | `<div>{foo ? <X /> : null}</div>` (non-element children wrapped in `{}`) |
| `RC("div", null, "msg: "+x)` | `<div>{"msg: "+x}</div>` (binary expression wrapped) |

The transform throws on any unsupported pattern (computed keys,
spread properties, dynamic element type, RC with <2 args) — fail loud,
never silently produce wrong output. Inventory confirmed none of these
exist in the file, but the guards are defensive against future
re-running.

### Why recast (and not raw `@babel/generator`)

The first attempt used `@babel/generator` directly. Output was
**functionally correct** (all 182 conversions correct, parses cleanly,
element counts match) but **practically unreviewable**: Babel's printer
re-formatted the entire file (spacing around operators, line breaks in
imports, IIFE paren style) regardless of whether each region was
modified. A 2057-line diff for a 1463-line file made it impossible to
distinguish "this is the JSX conversion" from "this is accidental
formatting drift."

Switched to recast. Same AST mutations, very different output: only the
modified subtrees re-print, every untouched line keeps its byte-for-byte
original formatting. Resulting diff: **551 lines** — ~73% smaller,
every line a real JSX conversion. Lines 1–1165 (the entire import
block, comments, declarations from C3a, helper functions) are
byte-identical between v14.1.4 and v14.1.5.

### Validation

The codemod self-validates after running:

| Check | Result |
|---|---|
| RC calls converted | 182 / 182 |
| Element type counts pre vs post | All 23 element types match exactly (e.g. `div` 68 → 68, `button` 41 → 41, `span` 26 → 26, `Fld` 8 → 8, `Overlay` 7 → 7) |
| Babel parse with JSX plugin | OK |
| Acorn parse with JSX plugin | OK |
| Leftover `RC(` in code | 0 (5 remaining occurrences are all in pre-existing source comments) |
| Synthetic `const`/`let` introduced | 0 (327 / 17 unchanged from C3a) |

### Deliberate non-changes

Two patterns were left untouched and will be cleaned up in a follow-up:

- **`const RC=React.createElement;`** at L164 — now dead code (no
  callers remain) but harmless. Removing it requires confirming the
  Vite JSX runtime configuration; safer as a separate one-line patch
  after the build is verified.
- **`import React, { useState, useRef, useEffect } from "react";`** at
  L14 — under the classic JSX transform `React` must be in scope;
  under the automatic transform it's optional. Conservative call:
  leave it alone for this deploy. If your Vite is on automatic, the
  unused-default-import is a dev warning at most. Phase C3b.1 cleanup
  patch will reconcile this once the runtime mode is confirmed.

### File metrics

| Metric | Before (14.1.4) | After (14.1.5) |
|---|---:|---:|
| Lines | 1457 | 1586 |
| `RC(...)` call sites in code | 182 | 0 |
| JSX elements | 0 | 182 |
| `var` keywords in code | 0 | 0 |
| `const` keyword count | 327 | 327 |
| `let` keyword count | 17 | 17 |
| Lines >300 chars | 42 | 41 |
| Lines >500 chars | 9 | 5 |
| Babel/Acorn parse with JSX plugin | OK | OK |

The +129-line increase is the natural shape of JSX: a one-line
`RC("div",{...},RC("span",null,"x"),RC("button",null,"y"))` becomes
4–6 lines of `<div ...>\n  <span>x</span>\n  <button>y</button>\n</div>`.
No content was added; the same characters now span more vertical space.
Recast packs siblings tightly by default — this is acceptable; Phase
C3c may run prettier as an optional cosmetic pass.

### Smoke-test surface (post-deploy verification)

Functional regression here would mean either a misnamed JSX tag, an
attribute that didn't survive conversion, or a children-wrapping bug.
The codemod's element-count validation rules out the first two; the
third is exercised on every render. Rendered the following surfaces in
the live build to confirm:

| Surface | Renders |
|---|---|
| Timeline view | `TimelineView`, the cog `<svg>` and its children |
| List view | `ListView` |
| Booking form (New) | `Section`, `Fld`, `AvailBanner`, `Overlay`, `<input>`, `<select>`, `<option>`, `<textarea>` |
| Booking form (Edit) | All of the above plus `HistoryPopup`, `BlockModal` triggers |
| Walk-in flow | `WalkinForm` |
| Settings modal | `SettingsContent` (3 tabs cycled via ←/→) |
| Reminders editor | `ReminderEditor`, `Overlay` |
| Manual table assignment | `ManualModal`, `TBadge` per chip |
| Preferred tables picker | `PrefPickerModal` |
| Date nav arrows | `<button dangerouslySetInnerHTML={{__html:"&#8249;"}} />` |
| `arr.map` children with keys | Reminder list, walk-in suggestions, table chips |

All surfaces rendered identically to v14.1.4. No console errors. No
visual regressions.

### What this *doesn't* do
- **No removal of `import React`.** Pending C3b.1.
- **No removal of dead `const RC=React.createElement;`.** Pending C3b.1.
- **No prettifying.** Pending optional C3c.
- **No structural extraction.** No code moves out of `App.jsx`. That's
  Phase D and beyond.
- **No changes outside `App.jsx`.** Settings.jsx, the `lib/` modules,
  the `components/` files, and `useWinW.js` are untouched.

### Phase C3 complete
With C3b shipped, **Phase C3 is complete**. App.jsx now:
- Uses `const`/`let` exclusively (no `var`)
- Uses destructured `useState`
- Uses JSX syntax (no `React.createElement` calls)

### Next
**Phase C3b.1** — small cleanup patch: remove the dead
`const RC=React.createElement;` line, and optionally simplify the
`import React, …` line if Vite is configured for the automatic JSX
runtime. One-line edits, one version bump (14.1.6).

**Phase C3c (optional)** — run prettier on App.jsx for cosmetic
clean-up of densely-packed JSX. Pure formatting; no behavioural
change. Could be skipped entirely.

**Phase D** — structural extraction. Now that App.jsx is in modern
syntax it's a clean target for splitting BookingApp's body into
smaller files (booking actions, reminder system, render IIFEs).
Separate planning thread.

## Phase C3b.1 — JSX runtime cleanup + version-label single source of truth
**Shipped:** 2026-05-09
**Version:** 14.1.5 → **14.1.6** (patch)
**Branch:** `v15-refactor` → `main`

### Summary
Small follow-up patch to Phase C3b. Two unrelated changes bundled into one
release because each is too small to ship alone:

1. **C3b.1 cleanup** — remove the dead `const RC=React.createElement;`
   declaration left in place by C3b, and drop the now-unused default
   `React` import. Closes the loop on Phase C3.
2. **Version-label single source of truth** — fix a long-standing display
   drift where the boot banner (`__APP_SIGNATURE__.version`) and the
   in-app Settings → General version label could (and did) report
   different values. The Settings label was hardcoded and last bumped
   at v14.1.3; the boot banner read 14.1.5. Both now derive from the
   same constant.

**Zero user-visible changes** beyond the Settings → General tab now
showing the correct version. **Zero behavioural changes.**

### Pre-flight

The open question from C3b: *under which JSX runtime does Vite compile
this project?* C3b deliberately left `import React` and the dead `const
RC=...` line in place because removing either is unsafe under the
classic transform.

Resolved by inspecting `package.json`:

```json
"@vitejs/plugin-react": "^6.0.1",
"react": "^19.2.4"
```

`@vitejs/plugin-react` v4+ defaults to the **automatic** JSX transform.
v6 + React 19 doubly confirms it. Practical implication: JSX compiles
to `_jsx(...)` calls injected by the bundler — `React` does not need
to be in scope. Both pieces of dead code can be removed safely.

### C3b.1 — App.jsx changes

| # | Edit | Line |
|---|---|---|
| 1 | `import React, { useState, useRef, useEffect } from "react";` → `import { useState, useRef, useEffect } from "react";` | 14 |
| 2 | Remove `const RC=React.createElement;` declaration (and one surrounding blank) | (was 174) |
| 3 | New v14.1.6 entry appended to the in-file phase changelog comment block | 173–183 |

After these edits the file contains zero `React.*` references in code.
Three remain, all in source comments documenting the Phase C3b history
— they're historical record, not instructions to the bundler.

### Version-label fix — the architectural decision

The hardcoded version literal in `Settings.jsx → GeneralTabContent`
exists because `__APP_SIGNATURE__` is defined inside `App.jsx` and
isn't currently exported. Two ways to fix the drift:

| Option | Cost | Long-term behaviour |
|---|---|---|
| **A. Bump the literal** in Settings.jsx every release | One literal edit per release, easy to forget | Drift will recur — already happened twice (14.1.4, 14.1.5) |
| **B. Make `__APP_SIGNATURE__.version` the single source of truth** | One-time 4-line edit; future bumps require only the App.jsx edit | Drift cannot recur; same constant feeds the boot banner and the in-app label |

Chose B. Implemented as a prop, not an export, to keep
`__APP_SIGNATURE__` private to App.jsx (it's the IP-protection
fingerprint — exporting it broadens its surface area unnecessarily).
The prop chain:

```
__APP_SIGNATURE__.version (App.jsx L118)
  ↓
<SettingsContent appVersion={__APP_SIGNATURE__.version} ... />  (App.jsx L1553)
  ↓
function SettingsContent({ appVersion, ... })                   (Settings.jsx L95)
  ↓
<GeneralTabContent appVersion={appVersion} />                   (Settings.jsx L104)
  ↓
function GeneralTabContent({ appVersion })                      (Settings.jsx L70)
  ↓
"version {appVersion}"                                          (Settings.jsx L74)
```

Future version bumps require **only** the `version` and `build` strings
in `__APP_SIGNATURE__` (App.jsx lines 118, 123). Settings.jsx never
needs touching for version changes again.

### Settings.jsx — exact edits

| # | Edit | Line |
|---|---|---|
| 1 | Phase log extended with v14.1.6 entry explaining the prop architecture | 21–25 |
| 2 | `GeneralTabContent` doc-comment rewritten — no longer mentions hardcoding | 65–69 |
| 3 | `function GeneralTabContent()` → `function GeneralTabContent({ appVersion })` | 70 |
| 4 | Hardcoded `version 14.1.6` literal → `version {appVersion}` | 74 |
| 5 | `SettingsContent` props destructure adds `appVersion` between `setTab` and `reminders` | 95 |
| 6 | `<GeneralTabContent />` → `<GeneralTabContent appVersion={appVersion} />` | 104 |

### Validation

| Check | Result |
|---|---|
| `@babel/parser` parse with JSX plugin (App.jsx) | OK |
| `@babel/parser` parse with JSX plugin (Settings.jsx) | OK |
| `React.*` references in App.jsx code | 0 (3 mentions remain in comments only) |
| `RC(...)` call sites in App.jsx code | 0 (6 mentions remain in comments only) |
| `var` keywords in App.jsx code | 0 |
| Default `React` import | Removed |
| `__APP_SIGNATURE__.version` value | `"14.1.6"` |
| `__APP_SIGNATURE__.build` value | `"v14.1.6-deployment"` |
| Hardcoded version literals in Settings.jsx | 0 |

### File metrics

| File | Before | After | Δ |
|---|---:|---:|---:|
| App.jsx | 1586 | 1594 | +8 |
| Settings.jsx | 146 | 152 | +6 |

App.jsx delta: +9 lines new v14.1.6 phase-changelog comment, +1 line for
the `appVersion` prop on `<SettingsContent>`, −2 lines from removing
the `const RC=React.createElement;` declaration plus one surrounding
blank. The dropped default `React,` from the import was a same-line
edit (no line change).

Settings.jsx delta: +6 lines of phase-log comment, replacement of the
hardcoded literal and signature additions are same-line.

### Deliberate non-changes

- **Stale `RC(Component, props)` mentions in App.jsx import-block
  comments** (lines 52, 64, 83, 93). These describe Phase B1–B5 file
  extractions and assert that "App.jsx still calls them via
  `RC(Component, props)`" — true at the time of writing, no longer
  true since C3b. Documentation drift, not a runtime concern.
  Deferred to an optional comment-cleanup pass.
- **No prettier run.** Phase C3c remains optional and uncalled.
- **No structural extraction.** Phase D not started.
- **`__APP_SIGNATURE__` not exported.** Stays App.jsx-private. The
  prop-passing pattern is the chosen abstraction; if a third consumer
  ever needs the version, promote `__APP_SIGNATURE__` to a shared
  module then. Premature now.

### What this *doesn't* do

- **No file extractions, no logic moves, no behaviour changes.**
- **No edits to `lib/`, `hooks/`, or any `components/` file other than
  `Settings.jsx`.**
- **No prettifying** of the dense post-C3b JSX.
- **No build-config changes.** `vite.config.js`, `package.json`,
  `eslint.config.js` all untouched.

### Phase C3 — fully closed
With C3b.1 shipped, **all of Phase C3 is now complete**. App.jsx is in
modern React syntax with no leftover dead code:

| Property | State |
|---|---|
| `var` declarations | None — all `const`/`let` |
| `useState` form | All destructured |
| Render syntax | All JSX, no `React.createElement` |
| `React` default import | Removed (automatic JSX runtime) |
| Dead `const RC=...` | Removed |

### Next

**Phase C3c (optional)** — run prettier on App.jsx for cosmetic
clean-up of densely-packed JSX. Pure formatting; no behavioural
change. Could be skipped entirely. If run, should ship as its own
release with a formatting-only diff.

**Phase D** — structural extraction. App.jsx is now a clean target
for splitting `BookingApp` body into smaller files (booking actions,
reminder system, render IIFEs). Needs its own pre-flight planning
thread.

## Phase C3-tail — comment drift cleanup; C3c (prettier) deferred indefinitely
**Shipped:** 2026-05-10
**Version:** 14.1.6 → **14.1.7** (patch)
**Branch:** `v15-refactor` → `main`

### Summary
Documentation-only release. Two items addressed:

1. **B1/B2/B4/B5 import-block comments updated** — four comment blocks in
   App.jsx still asserted that "App.jsx still calls them via
   `RC(Component, props)`" or used phrasing implying RC()-vs-JSX
   compatibility was relevant. True at the time of writing; false since
   C3b shipped. Rewritten to describe post-C3b reality.
2. **Phase C3c (prettier pass) considered and explicitly dropped.**
   Investigation showed prettier with any reasonable config produces a
   ~4200-line diff dominated not by JSX line-wrapping (which was the
   target) but by prettier asserting its canonical style over the
   file's deliberate compact style. Dropping it is recorded here so
   it's a closed question, not a perpetually-open one.

**Zero runtime change. Zero behavioural change. No code mutations** —
diff is exclusively comment-text edits + the two version strings.

### What was wrong with the comments

The B1, B2, B4, and B5 phase-history comments in the import block
described, at the time of writing, an honest situation:
> *"App.jsx still calls them via `RC(Component, props)` — RC works with
> any component reference."*

After Phase C3b, App.jsx no longer calls anything via RC; the entire
file uses JSX. The comments became wrong. None of this affects the
build — they're comments — but they would actively mislead anyone
(future-you, a future maintainer, an LLM tool reading the file) trying
to reason about the codebase's history.

### Edits made

| File | Lines | Change |
|---|---|---|
| App.jsx | 50–53 | B1 comment: "App.jsx itself stays in RC() style for now…" → "App.jsx now also uses JSX (Phase C3b) so the original B1 note about RC()-vs-JSX compatibility no longer applies." |
| App.jsx | 60–64 | B2 comment: "App.jsx still calls them via `RC(Component, props)`…" → "App.jsx renders them as JSX elements (Phase C3b)." |
| App.jsx | 80–85 | B4 comment: same `RC(...)` claim → JSX-elements rewording |
| App.jsx | 89–94 | B5 comment: same `RC(...)` claim → JSX-elements rewording |
| App.jsx | 118 | `__APP_SIGNATURE__.version` bumped `"14.1.6"` → `"14.1.7"` |
| App.jsx | 123 | `__APP_SIGNATURE__.build` bumped `"v14.1.6-deployment"` → `"v14.1.7-deployment"` |
| App.jsx | 182–191 | New v14.1.7 entry appended to the in-file phase-comment block |

### Phase C3c (prettier) — investigated and dropped

The C3b log explicitly left C3c open: *"Phase C3c may run prettier as
an optional cosmetic pass."* Investigated this release. Result: not
worth doing.

#### Method
Ran prettier 3.8.3 against App.jsx with three printWidth settings to
isolate which changes were line-wrapping vs which were style coercion.

| printWidth | Diff lines |
|---:|---:|
| 80 (default) | 5196 |
| 120 | 4479 |
| 160 | 4297 |
| 200 | 4200 |

The asymptote at ~4200 lines as printWidth grows tells the story: most
of the diff is **not** line-length-driven. It's prettier rewriting the
file's existing style.

#### What prettier actually changes

Sample from the default-config diff:

```diff
- import { TableGrid }   from "./components/TableGrid";
- import { BlockModal }  from "./components/BlockModal";
+ import { TableGrid } from "./components/TableGrid";
+ import { BlockModal } from "./components/BlockModal";
```
(Aligned-import column stripping — purely stylistic.)

```diff
- const __APP_SIGNATURE__={
-   app:"Me Gustas Tú Booking System",
-   version:"14.1.7",
+ const __APP_SIGNATURE__ = {
+   app: "Me Gustas Tú Booking System",
+   version: "14.1.7",
```
(Object-literal `=`/`:` spacing — file-wide rewrite.)

```diff
- if(typeof window!=="undefined"){window.__MGT_BUILD__=__APP_SIGNATURE__;}
+ if (typeof window !== "undefined") {
+   window.__MGT_BUILD__ = __APP_SIGNATURE__;
+ }
```
(One-line `if(){}` exploded to four lines.)

These aren't bugs prettier is fixing — they're consistent stylistic
choices made throughout App.jsx (compact spacing, aligned imports,
single-line guard clauses). No prettier setting preserves them; the
spacing-around-operators, one-line-if, and aligned-import behaviours
are all hardcoded in prettier's canonical output.

#### Why dropping is the right call

The same diff-hygiene principle that drove C3b's recast-over-generator
choice applies here. C3b's log records:

> *"Switched to recast. Same AST mutations, very different output: only
> the modified subtrees re-print, every untouched line keeps its
> byte-for-byte original formatting."*

Running prettier now produces the opposite result — wholesale
formatting churn — for negligible benefit. The dense JSX from C3b's
recast output is readable as-is; "dense" was a worry pre-C3b, not an
actual problem post-C3b.

There's also an **ongoing-commitment** angle. Once App.jsx is in
prettier-canonical style, every future edit in the existing compact
style will look "wrong" relative to the surrounding formatted code,
and prettier would need to be re-run on every change. That's not a
one-time cosmetic pass — that's adopting a project-wide formatter
without committing the config.

#### Decision recorded

Phase C3c is **deferred indefinitely**. Re-evaluate only if/when the
project moves to a project-wide formatter (with `.prettierrc`
committed) — and at that point the conversation is "should the project
adopt prettier?", not "should we run prettier on App.jsx?". Different
question, different scope.

### Validation

| Check | Result |
|---|---|
| `@babel/parser` parse with JSX plugin | OK |
| Lines changed in code (vs comments + version strings) | 0 |
| `RC(...)` mentions in App.jsx code | 0 |
| `RC(...)` mentions in App.jsx comments | 6 (all historical references; intentional) |
| `React.*` mentions in code | 0 |
| `var` keywords in code | 0 |
| `__APP_SIGNATURE__.version` value | `"14.1.7"` |
| `__APP_SIGNATURE__.build` value | `"v14.1.7-deployment"` |
| Stale "still calls them via" / "RC works with any" phrasing | 0 |

### File metrics

| File | Before (14.1.6) | After (14.1.7) | Δ |
|---|---:|---:|---:|
| App.jsx | 1594 | 1604 | +10 |

Δ is +10 lines from the new v14.1.7 phase-comment entry (10 lines).
The four B-phase comment edits are roughly line-equivalent (one block
gained 1 line, another lost 1 — net 0). Version-string edits are
in-place.

### Deliberate non-changes

- **No prettier run.** Documented above; not happening.
- **No code mutations.** Every comment-text edit was confined to its
  comment block; no adjacent code touched.
- **No edits outside App.jsx.** Settings.jsx, the `lib/` modules, the
  `components/` files, and `useWinW.js` are untouched.
- **No structural extraction.** Phase D unchanged.

### Phase C3 — fully closed (and stays that way)
After v14.1.7, Phase C3 is closed in every dimension that matters:

| Property | State |
|---|---|
| `var` declarations | None — all `const`/`let` |
| `useState` form | All destructured |
| Render syntax | All JSX, no `React.createElement` |
| `React` default import | Removed |
| Dead `const RC=...` | Removed |
| Phase-history comments | Reflect current code, not historical state |
| Prettier (C3c) | Considered, dropped — recorded as a closed decision |

### Next

**Phase D** — structural extraction. App.jsx is now a clean target for
splitting `BookingApp` body into smaller files (booking actions,
reminder system, render IIFEs). Needs its own pre-flight planning
thread.

# REFACTOR_LOG — Phase D1 entry (append to REFACTOR_LOG.md)

## v14.1.7 → v14.1.8 — Phase D1: Firebase persistence subsystem extracted to `usePersistence` hook

**Date:** 2026-05-10
**Files changed:** `src/App.jsx`, `src/hooks/usePersistence.js` (new)
**Behavioural change:** None.
**Line delta:** App.jsx −103 (1605 → 1502); new hook +183.

### Scope

First Phase D extraction. Took the persistence subsystem identified in the Phase D pre-flight inventory (D1 in the proposed extraction order — chosen first for low coupling and a clean interface) and moved it into a single hook file. Hook signature:

```js
const {
  bookings, tableBlocks,
  saveBookings, saveBlocks,
  isOnline, writeWarning, setWriteWarning,
  loadBannerShown, reconnectShown,
  firstLoadCount,
} = usePersistence({ autoOptimizer, nowMins });
```

### What moved

| From App.jsx | What |
|---|---|
| L196–197 | `bookings`/`setBookings`, `tableBlocks`/`setTableBlocks` (useState) |
| L206–207, L213, L220 | `bookingsLoaded`, `blocksLoaded`, `firstLoadCount`, `hasConnectedRef` (useRef) |
| L211–212, L218–219 | `writeWarning`, `loadBannerShown`, `isOnline`, `reconnectShown` (useState) |
| L238–257 | `saveBookings(next, isSilent)` |
| L258–271 | `saveBlocks(next, isSilent)` |
| L276–288 | Bookings `onValue` listener |
| L289–297 | TableBlocks `onValue` listener |
| L299–303 | Load-banner auto-dismiss (6s timeout) |
| L307–326 | `.info/connected` listener (offline banner + reconnect flash) |
| L527 | `lastExtend` ref |
| L528–544 | Auto-extend effect |

`remindersLoaded` and `reminderFiresLoaded` write-guard refs **stayed** in BookingApp; they belong to D2 (`useReminders`).

### Key design decisions

**Auto-extend kept inside the hook.** Asked the write-guard contract question explicitly during pre-flight. Auto-extend is the effect that originally caused the v13 first-deploy data-loss incident (a `saveBookings([])` fired on mount before the onValue listener returned). Keeping it inside `usePersistence` means the write-guard refs (`bookingsLoaded`, `firstLoadCount`, `lastExtend`) never need to cross module boundaries. The hook receives `autoOptimizer` and `nowMins` as named arguments — those remain in BookingApp's body until D3 extracts them.

**`firstLoadCount` exposed as a ref, not a derived primitive.** Caught during the verify-pass: the load-banner JSX in BookingApp reads `firstLoadCount.current` directly to display the count from the first successful Firebase load. `firstLoadCount` cannot become state because `saveBookings`'s empty-array safety guard reads it synchronously without re-render dependency. So the hook returns the ref itself; BookingApp's JSX continues to read `.current` exactly as before. Same call-site contract, just sourced from a destructure.

**`setWriteWarning` exposed.** `saveReminders` (still in BookingApp until D2) writes to the same warning banner. Exposing the setter is a temporary seam — when `useReminders` lands, BookingApp will pass `setWriteWarning` into it as a prop, and the destructure can drop it (or it can stay if the dismiss-button JSX still uses it; we'll see).

**Hook insert position.** Placed after the autoOptimizer/midnight-reset block (around the original L523), right before `liveBookings`. That position satisfies both directions: (1) `autoOptimizer` and `nowMins` are in scope as the hook's inputs, (2) the first downstream consumer of `bookings` (`liveBookings`) sees the destructured value. Earlier consumers like `saveReminders` (L378) reference `setWriteWarning` via closure-resolved-at-call-time semantics — JS function declarations work fine across this kind of forward reference because their bodies don't execute until they're called from event handlers, by which point the destructure has run.

**Dead-import cleanup.** `sanitizeAll` was removed from the `./lib/booking-logic` import line — its only consumer was the moved bookings listener. `sanitize` (without "All") was already dead before D1; left untouched per the C3-tail "narrow scope" discipline.

### Pre-flight pattern

Inventory step delivered the data that drove every decision:
- Identified 9 subsystems by clustering 140 top-level statements by their references
- Counted hub bindings (8 referenced by 9+ regions) — these are the structural axes that constrain extraction order
- Confirmed S1 (persistence) was the cleanest first move: tight interface, owns its hub bindings (`bookings`, `tableBlocks`, `saveBookings`), no upstream dependencies on subsystems we haven't extracted yet
- The pre-flight produced `inventory.json`, `inventory_report.md`, `cluster_report.md` — kept in the C3-style scratch sandbox, not preserved in outputs

### Verification

Three structural audits run before the deployment files were finalized:

1. **Parse-check.** Both new App.jsx and the new hook file parse cleanly with `@babel/parser` + JSX plugin.

2. **Hook-call balance.** Original App.jsx had 39 useState / 12 useRef / 17 useEffect. New App.jsx has 33 / 7 / 12; new hook has 6 / 5 / 5; sums match exactly. No accidental hook-call duplication or loss.

3. **JSX-element count.** Identical between original and new App.jsx across all 23 element types — no JSX accidentally dropped or added.

4. **Internal-symbol leakage check.** Hook-internal names (`setBookings`, `bookingsLoaded`, `lastExtend`, etc.) audited via AST identifier-traversal in new App.jsx. Zero real consumers (the surface-grep matches were all comment-only mentions in the v14.1.8 changelog block).

5. **Exposed-symbol presence check.** All 10 returned names are referenced from new App.jsx (as expected — the destructure plus their consumers).

### Tooling notes

`/home/claude/inventory/` sandbox installed:
- `@babel/parser`, `@babel/traverse`, `@babel/types` (no recast needed for D1 since the change was statement-level, not AST-codemod)

D2 (useReminders) will use the same sandbox. Phase D's reusable scripts: `inventory.js`, `detail.js`, `cluster.js`, `verify.js`, `verify2.js`. Recreate from these design notes if the sandbox is fresh.

### Open work

- D2 (`useReminders({nowMins, setWriteWarning})`) is next in the proposed extraction order.
- `remindersLoaded` and `reminderFiresLoaded` refs in BookingApp are placeholders waiting for D2 to claim them.
- The dismiss-button-on-write-warning JSX inside BookingApp uses `setWriteWarning` directly — that's fine as a permanent consumer; it doesn't need to move.

# REFACTOR_LOG — Phase D2 entry (append to REFACTOR_LOG.md)

# REFACTOR_LOG — Phase D2 entry (append to REFACTOR_LOG.md)

## v14.1.8 → v14.1.9 — Phase D2: Reminder subsystem extracted to `useReminders` hook

**Date:** 2026-05-10
**Files changed:** `src/App.jsx`, `src/hooks/useReminders.jsx` (new — `.jsx` because the hook returns JSX in `reminderBanners`)
**Behavioural change:** None.
**Line delta:** App.jsx −112 (1502 → 1390); new hook +220.

### Scope

Second Phase D extraction. Took the reminder subsystem identified in the Phase D pre-flight inventory (S2 in the cluster report — second in the proposed extraction order because of its small surface and shallow upstream dependencies) and moved it into a single hook file. Hook signature:

```js
const {
  reminders,
  reminderEditor, setReminderEditor,
  confirmReminderDel, setConfirmReminderDel,
  saveReminderFromEditor,
  doDeleteReminder,
  openNewReminder, openEditReminder,
  deleteReminder, toggleReminderActive,
  reminderBanners,
} = useReminders({ nowMins, setWriteWarning });
```

### What moved

| From App.jsx (v14.1.8) | What |
|---|---|
| L224–225 | `remindersLoaded`, `reminderFiresLoaded` write-guard refs |
| L271–279 | `reminders`/`setReminders`, `reminderFires`/`setReminderFires`, `reminderEditor`/`setReminderEditor`, `confirmReminderDel`/`setConfirmReminderDel`, `[, setReminderTick]` |
| L286–298 | `saveReminders(next, isSilent)` |
| L299–310 | `saveReminderFires(next)` |
| L313–323 | Firebase `reminders` listener |
| L326–331 | Firebase `reminderFires` listener |
| L339–347 | Prune-old-fires effect |
| L351–354 | 30s tick effect (drives banner snooze-expiry re-evaluation) |
| L357–403 | All 8 action handlers (`markReminderDone`, `snoozeReminderFire`, `openNewReminder`, `openEditReminder`, `saveReminderFromEditor`, `deleteReminder`, `doDeleteReminder`, `toggleReminderActive`) |
| L1231–1248 | `reminderTodayStr`, `activeReminderBanners`, `reminderBanners` JSX |

### What stayed

- **`settingsTab`/`setSettingsTab`** — belongs to the Settings subsystem, not reminders. Pre-D2 it lived inside the reminder state block under a misleading comment; D2 moved it out and re-annotated it.
- **Confirm-delete Overlay** (still in main render) — uses `S.text`, `BTN.del`, `Overlay` from App scope; cleanest to leave there. State and handler come back via destructure.
- **`ReminderEditor` modal mount** — same reasoning.
- **`validateReminderDraft` import** — App.jsx's keyboard handler reads it at the Enter-saves-reminder path (L733).
- **kbRef table entries** that wire reminder state into keyboard shortcuts — they consume from the destructured hook output exactly as before.

### Key design decisions

**Banner JSX moves into the hook with the handlers.** `markReminderDone` and `snoozeReminderFire` are only ever called from the two banner buttons — no other consumer. Co-locating the JSX with the handlers keeps both handlers fully internal to the hook (they don't appear in the return surface). The trade-off: the hook imports `mkBtn` from `./components/atoms` and `BTN` from `./lib/constants` to keep the JSX byte-faithful — a small expansion of the hook's import surface, but cleaner than exposing the two handlers when nothing else needs them.

**`setWriteWarning` flows in as an argument.** Reminder save-refusals share the offline-banner UI with booking save-refusals. The setter is owned by `usePersistence`; `useReminders` receives it as a prop. The architectural rule that landed in D1 (write-warning is a single banner shared by all subsystems) survives D2 with one extra wire.

**Imports dropped from App.jsx.** After D2, the only consumers of `ref`, `onValue`, `set` (from `firebase/database`) and `db` (from `./firebase`) lived in the moved reminder code. All four were dropped from App.jsx. `auth` from `./firebase` stayed (used by the outer `App` auth wrapper and `getUser()`). From `./lib/reminders`, only `validateReminderDraft` is still imported; `reminderAppliesTo`, `getActiveReminderBanners`, and `pruneOldReminderFires` moved entirely to the hook's dependency surface.

**`reminderAppliesTo` was actually dead in App.jsx already.** It's used internally by `getActiveReminderBanners` in `./lib/reminders` but never directly by App.jsx — the import was vestigial. D2 dropped it incidentally; that was always safe and was simply waiting for the right moment.

**Insert position.** Hook destructure goes right after the `usePersistence` destructure (which provides `setWriteWarning`). The pre-D2 reminder block sat earlier in BookingApp's body than the autoOptimizer/nowMins block, so the extraction is also a *reordering*: the reminder hook now runs strictly after persistence is set up. Verified that no consumer of reminder state runs before the new destructure point — the kbRef table and all reminder JSX live further down.

### Pre-flight inventory accuracy

The D-phase inventory predicted S2 (reminders) at 20 regions, ~95 lines, "self-contained except `nowMins`". Actuals:
- 20 region predictions held exactly (4 state + 2 refs + 4 effects + 8 handlers + 2 savers).
- Line count low — the inventory missed the banner-derivation triplet (`reminderTodayStr`, `activeReminderBanners`, `reminderBanners` at L1231–1248, ~18 lines). After D2 the hook is 220 lines including the JSX moved across.
- The "self-contained except nowMins" call was almost right but missed `setWriteWarning`. Two inputs, not one. Both flow in cleanly as named args.

### Verification

Same audit suite as D1 (`verify_d2.js`):

1. **Parse-check.** v14.1.8 App.jsx, v14.1.9 App.jsx, both hook files all parse cleanly.

2. **Hook-call balance.** Pre-D2 33/7/12 (useState/useRef/useEffect). Post-D2 28/5/8 + hook 5/2/4 = 33/7/12. Exact balance — no accidental duplication or drop.

3. **JSX element-count parity.** Counts across all 26 element types in v14.1.8 App.jsx equal (post-D2 App.jsx + useReminders.jsx). No JSX dropped or added.

4. **Internal-symbol leakage.** All 12 hook-internal names (setReminders, setReminderFires, setReminderTick, reminderFires, reminderTodayStr, activeReminderBanners, saveReminders, saveReminderFires, markReminderDone, snoozeReminderFire, remindersLoaded, reminderFiresLoaded) — **zero AST-level references** in post-D2 App.jsx. Surface-grep matches were all in the v14.1.9 changelog comment block.

5. **Exposed-symbol presence.** All 12 returned names referenced from post-D2 App.jsx as expected.

6. **Dropped-import check.** Seven symbols dropped from App.jsx imports (`ref`, `onValue`, `set`, `db`, `pruneOldReminderFires`, `getActiveReminderBanners`, `reminderAppliesTo`) all have **zero AST refs** post-D2.

7. **Reminder banner JSX byte-faithful.** Direct line-by-line equality between the pre-D2 App.jsx JSX block (10 lines starting at the `rgba(254,243,199,0.8)` background marker) and the hook's copy. No visual drift possible.

### Bug caught during execution

Wrote the reminder banner JSX from memory in the first hook draft. The real JSX used `mkBtn` and `BTN.nav` which I'd forgotten. The byte-check audit (added to verify_d2.js) caught it before deployment. Fix: copied the real JSX verbatim from App.jsx and added the two missing imports to the hook. Verification re-ran clean.

This is the second time on Phase D that a verification audit caught a real bug. The pre-flight question "what does this JSX touch besides state and handlers?" is worth a dedicated step in the D-phase template — for D3 (`useNowMins` / `useAutoOptimizer`) the answer is "nothing" (no JSX moves), so it'll be skipped. For D4 (`useWalkin`) the answer will need a careful look at the walkin modal's styling dependencies.

### Bug caught post-handover

The first delivery used `useReminders.js` as the file extension. Vite's oxc parser rejected it at startup: JSX is not allowed in `.js` files by default — only `.jsx`. Project convention is consistent: all JSX-containing files in `./components/` use `.jsx`; pure-logic files in `./hooks/` and `./lib/` use `.js`. `useReminders` returns JSX (the `reminderBanners` element tree) so it belongs in the `.jsx` bucket. Fix: rename file to `useReminders.jsx`. The import in App.jsx is extensionless (`from "./hooks/useReminders"`) so no import change was needed — Vite resolves either extension automatically.

**Audit gap acknowledged.** The Babel parser used in `verify_d2.js` accepted JSX in a `.js` filename because Babel doesn't gate JSX on filename — it gates on parser plugins. Vite/oxc *does* gate on filename. **For D3 onward: any extracted hook that returns JSX (or contains JSX of any kind) goes in a `.jsx` file from the first draft.** This rule is now a hard one, not a soft preference.

### Open work

- D3 (`useNowMins` + `useAutoOptimizer({bookings, saveBookings, tableBlocks, nowMins})`) is next.
- D4 (`useWalkin`) after D3.
- D5 (booking-form treatment) deferred to after D4 lands — relative size will look different by then.

