# CLAUDE.md

Instructions for Claude (and Claude Code) when working in this repository.

This file is the living architecture record. When a change adds a feature or makes a
decision, record it here (file-structure block + locked-decisions). Keep per-file notes
scannable; archive old per-version sub-notes when a block gets long.

---

## Project

**Me Gustas Tú (MGT) Booking System** — private staff-facing booking management web app for a restaurant in the Canary Islands.

- **Owner / sole developer:** Patryk Zychowicz (pz.zychowicz@gmail.com)
- **Stack:** React 19, Vite, Firebase Realtime Database + Auth, deployed on Vercel
- **Repo:** `github.com/pzzychowicz-blip/megustastu-bookings`
- **Live:** `https://megustastu-bookings.vercel.app/`
- **Current version:** see `src/App.jsx` → `__APP_SIGNATURE__.version` (single source of truth)
- **Layout context:** 9 outdoor tables (1A, 1B, 2, 3, 4, 5A, 5B, 6, 7) + 4 indoor (i1–i4). Operating hours 13:00–22:00.
- **Sibling app:** MGT Scheduling (`github.com/pzzychowicz-blip/megustastu-scheduling`) — same UI conventions, separate repo, separate Firebase project. Use it as the style/pattern reference; keep the two consistent. Improve a shared pattern in one app → port it to the other rather than letting them drift.

---

## File structure

```
src/
├── App.jsx                          orchestration layer (~1315 lines)
├── firebase.js                      DEV/PROD env switch (import.meta.env.DEV) — DO NOT bypass the split
├── hooks/
│   ├── usePersistence.js            Firebase + write-guards + auto-extend
│   ├── useReminders.jsx             reminder state + listeners + banner JSX
│   ├── useNowMins.js                15s clock tick
│   ├── useAutoOptimizer.js          optimizer thermostat + daily reset
│   ├── useWalkin.js                 walk-in state + handlers
│   ├── useWinW.js                   viewport-width hook
│   └── useThemeMode.js              dark-mode resolver (localStorage pref → isDark; writes data-theme)
├── components/
│   ├── BookingFormModal.jsx         booking form (controlled component)
│   ├── TimelineView.jsx             Gantt-style timeline (horizontal scroller)
│   ├── ListView.jsx                 sorted card list
│   ├── WalkinForm.jsx               walk-in entry form
│   ├── ManualModal.jsx              manual table-assign UI
│   ├── PrefPickerModal.jsx          preferred-tables picker
│   ├── BlockModal.jsx               table-block editor
│   ├── HistoryPopup.jsx             per-booking audit trail
│   ├── LoginScreen.jsx              auth gate (unauthenticated entry)
│   ├── ReminderEditor.jsx           reminder edit modal (z=250)
│   ├── Reminders.jsx                reminder list tab body
│   ├── Settings.jsx                 settings modal shell + tabs (General/Reminders/Shortcuts)
│   ├── Shortcuts.jsx                keyboard cheatsheet
│   ├── TableGrid.jsx                13-table picker (used by Manual/Block modals)
│   └── atoms.jsx                    Overlay, Fld, Section, TBadge, AvailBanner, Toggle, mkInp, mkBtn
└── lib/
    ├── booking-logic.js             pure functions (optimizer, sanitisation, derivations)
    ├── constants.js                 tables, capacities, colours, S/BTN style tokens (S now var(--…)-backed for theming)
    └── reminders.js                 reminder helpers (validate, fire-window, prune)
```

**REFACTOR_LOG.md** at repo root contains the full version history with architectural decisions for each phase (B1–B5, C1–C3, D1–D4, E1+).

---

## Code conventions

### Modern declarations (Phase C3a)
- Use `const` by default; `let` only when reassignment is needed.
- Never `var` in new code. App.jsx's 380 vars were converted in C3a. (`src/lib/constants.js`
  still uses `var` by design — Phase A left it; convert opportunistically if editing it.)

### JSX, not RC (Phase C3b/C3b.1)
- All JSX uses literal JSX syntax (`<div>...</div>`), not `React.createElement` or `RC()`.
- Do **not** add `import React from "react"` — the project uses the automatic JSX runtime via `@vitejs/plugin-react` v6.
- Import only specific hooks: `import { useState, useEffect } from "react"`.

### Filename rules (Phase D2 post-handover rule — hard)
- Any file containing JSX must use the `.jsx` extension.
- Pure-logic hooks/libs use `.js`.
- Vite/oxc rejects JSX in `.js` files at startup. Verify via `npm run build` for new hooks.

### One unit per file
- One hook per file in `src/hooks/`. Filename matches export (`useXxx.{js,jsx}`).
- One component per file in `src/components/`. PascalCase filename matches export.
- Exception: `Settings.jsx` exports `SettingsContent`, `TabBar`, `GeneralTabContent`, `CogIcon`; `atoms.jsx` is the multi-export atoms file.

### Style tokens
- All colours, spacing, button styles, badge styles flow through `src/lib/constants.js` exports (`S`, `BTN`, `BLOCK_BG`, `STATUS_COLORS`, `TBL`).
- Reusable JSX atoms in `src/components/atoms.jsx`: `Overlay`, `Fld`, `Section`, `TBadge`, `AvailBanner`, `Toggle`, `mkInp`, `mkBtn`.
- New UI composes from atoms, not redefining them. Add new atoms there if needed.
- **`mkInp` / `mkBtn` return *style objects*** (not JSX) — usage is `<input style={mkInp()}>` /
  `<button style={mkBtn({...})}>`. (Note: the sibling Scheduling app's equivalents return JSX;
  Bookings differs. Don't assume a `className`/prop passthrough — it isn't there.)
- Prefer the **`Toggle` atom** (`Toggle({ on, onClick })`) over `<input type="checkbox">` for
  booleans (native checkbox is fine only for multi-select grids / native forms).

### Conditional rendering
- Prefer ternaries: `cond ? <X /> : null`
- Avoid `cond && <X />` — reduces a class of falsy-render bugs (the `0 && <X/>` trap).

### Comments
- Heavy commenting is expected — single-developer codebase with long context gaps.
- Section headers use `// ── Name ──...` for grep-ability.
- Phase notes use `// Phase X (vY.Y.Y): ...` at the top of moved blocks.

---

## Architecture decisions

### Hooks vs components — when to use which
- **Hook:** stateful logic the parent renders with. Plumbing moves; rendering stays. Use for cross-cutting concerns (persistence, timers, feature flags) and state-machines whose outputs the parent renders with.
- **Component:** UI unit with its own internal complexity. Everything moves; parent embeds it.
- See `REFACTOR_LOG.md` Phase D vs Phase E for the worked-through reasoning.

### Controlled-component pattern (WalkinForm, BookingFormModal)
- Form state lives in parent, component receives it as props.
- Component fires callbacks to mutate parent state (`onSave`, `onClose`, `onOpenPrefPicker`, etc.).
- Pass setters directly only for the form draft itself (`setForm`/`setDraft`); wrap other parent-state mutations in named callbacks.
- Sub-modals stay in parent's render tree even when triggered from inside the component — keeps z-stack ordering predictable.

### Optimizer scope (Phase D3 Option A — permanent)
- `autoOptimizer` thermostat lives in `useAutoOptimizer`. Daily reset: off at 15:00, on at new-day-start.
- The banner stack (`reshuffledBanner`, `ineffBanner`, `overlapBanner`) and related state (`reshuffled`, `dismissedIneff`, `confirmReshuffle`) intentionally **stay in BookingApp**. They reach into form/view/persistence concerns and `flash()` has 8 call sites — extracting would just spread the surface.

### confirmKitchen state — legitimately shared
- Owned by BookingApp. Both `doSave` (form path, in App.jsx) and `saveWalkin` (in `useWalkin`) raise it.
- `useWalkin` receives `{confirmKitchen, setConfirmKitchen}` as args. Same pattern with `setWriteWarning` between `usePersistence` and `useReminders`.

### Auth shell
- `App()` (App.jsx) is the auth gate: `onAuthStateChanged` → `<LoginScreen/>` when signed out, else `<BookingApp/>`. App-wide hooks that need the authed shell mount in `BookingApp`, not `App`.

---

## Critical patterns

### Firebase write-guard pattern — MANDATORY
Every Firebase write must be guarded by a `dataLoaded` ref that flips true only after the initial `onValue` callback returns, **and** refuses an empty-array write when the first load saw data. Without this, an effect that fires before Firebase loads can save `[]` over real data.

```js
const bookingsLoaded = useRef(false);

function saveBookings(next, isSilent) {
  function persist(computed) {
    if (!bookingsLoaded.current) {
      console.warn("[SAFE] Refused to write — initial read has not completed.");
      if (!isSilent) setWriteWarning("...");
      return;
    }
    // Empty-array safety: refuse to wipe non-empty DB with empty in-memory state
    if (Array.isArray(computed) && computed.length === 0
        && firstLoadCount.current !== null && firstLoadCount.current > 0) {
      console.warn("[SAFE] Refused to write empty array.");
      if (!isSilent) setWriteWarning("...");
      return;
    }
    set(ref(db, "bookings"), computed).catch(function(){});
  }
  // ... resolve `next` (value or updater fn), then persist
}
```

**Origin:** post-v13-deploy data-loss incident. Auto-extend effect fired `saveBookings([])` on mount before `onValue` returned. The pattern was retrofitted to all Firebase writes.

**Auto-effects** (anything that writes Firebase without direct user action) must pass `isSilent=true` to suppress the user-facing banner on refusal.

**Persisted collections:** `bookings`, `tableBlocks`, `reminders`, `reminderFires`. There is **no** Firebase `settings` node — per-device preferences (e.g. theme) use `localStorage`, not Firebase.

**Single central save path:** route every mutation of a collection through one helper (e.g. `bookingsAfterAction`) so future conflict-detection / re-derivation has one hook point.

### Optimizer cutoffs
- 15:00 auto-cutoff for today's bookings — `autoOptimizer` flips off.
- Midnight reset — `autoOptimizer` flips on for the new day.
- Seated bookings are never reshuffled (enforced in `trialFits` / `applyOpt`).
- Walk-ins are `_manual:true _locked:true` — never reshuffled.

### `bookingsAfterAction` is the central save path
- Any code path that modifies bookings should pass through `bookingsAfterAction(bookings, viewDate, tableBlocks, savedId, isNew, autoOptimizer)`. Handles optimizer-aware reshuffle + seated-shift on Confirmed→Seated.
- Direct `saveBookings(arr)` calls without going through this helper risk an inconsistent schedule.

### `formRef.current` vs `form`
- The booking form has both a state `form` and a mirror ref `formRef`.
- Event handlers and async callbacks read `formRef.current` (always fresh) instead of `form` (potentially stale within the same render cycle).
- The mirror is maintained by `useEffect(() => { formRef.current = form; }, [form]);`

### Performance gotcha — backdrop-filter blur
- `backdropFilter: blur(...)` is expensive. >4 simultaneous instances on tablet hardware causes severe scroll/interaction lag.
- **Hard limit: ≤4 intentional blur instances visible at once.** Reuse the `Overlay` atom (canonical blur) rather than adding new blurred surfaces. (Bookings once shipped 51 → prod perf bug; never reintroduce.)

---

## UI / style rules

- Translucent / glass, iOS-inspired surfaces; rounded corners; the shared accent (`#007AFF`).
- Every modal uses the **`Overlay` atom** (owns blur + mobile-sheet / desktop-card branching).
- **Popovers/dialogs use the opaque sheet token**, not the translucent card token (a card token at ~0.45 opacity reads see-through for a dialog).
- ≤4 simultaneous `backdrop-filter: blur()` (see perf gotcha above).

### Theming / dark mode (mechanism shipped v14.2.0 — ported from Scheduling; see `MGT_Bookings_dark-mode_PORT_INSTRUCTIONS.md`)
- Light + dark via CSS custom properties: `:root` (light) + `[data-theme="dark"]` overrides in `index.html`; `<html data-theme="…">` set via `document.documentElement.dataset.theme`. A theme flip is **one DOM attribute change — zero React re-render** of the tree.
- **Hook:** `useThemeMode(explicitPref) → isDark` (`src/hooks/useThemeMode.js`) writes `data-theme` and follows the OS live when pref is `undefined` — the shared Scheduling contract, unchanged. A no-flash inline script in `index.html` paints the theme before React mounts (the hook alone runs too late).
- **Persistence is per-device `localStorage["mgt-theme"]`** (`"dark"|"light"|`absent), NOT Firebase (Bookings has no settings node). `readThemePref()` (module scope in `App.jsx`) feeds the hook; the Settings General-tab `Toggle` (`onToggleDark`) writes the key. The no-flash script reads the SAME key — **keep the value convention in sync across all three.**
- **No rgba/hex literals in JS — every colour references `var(--…)`.** Migrated token-by-token in waves. **v14.2.0:** core `S` set + app background (`--bg-app`). **v14.2.1:** `constants.js` colour sets — `STATUS_COLORS` + `TBL` as **RGB-channel triplets** composed `rgba(var(--…-rgb), a)`; `BLOCK_BG` + `BTN` direct tokens (theme-invariant saturated fills; only status-chip **text** flips). **v14.2.2:** `atoms.jsx` + the full **modal/form subsystem** (every `Overlay` modal, `Section`, inputs, steppers, `Toggle`, `Kbd`, the Settings `TabBar`, in-modal banners) — surfaces + their text flip together (coupling: the shared `Overlay` backs 7 modals, so a dark sheet needs dark-themed content). **Still literal** (pending waves): `TimelineView`, `ListView`, and the main-screen banners in `App.jsx` (offline/reconnect/load/overlap/reshuffle) — so the **timeline/list canvas is still light in dark mode** until those land; modals/forms are done.
- **Token families** (index.html): surfaces `--bg-sheet`/`-sheet-mobile`/`-soft`/`-input`/`-stepper`/`-tabbar`/`-tab-active`/`-card`; borders `--border-sheet`/`-soft`/`-input`/`-kbd`/`-glass`; `--scrim`; semantic text `--text-primary`/`-secondary`/`-muted`/`-faint`/`-required`/`-on-accent` + `--warn-text`/`--danger-text`/`--success-text`; banner trios `--warn-*`/`--danger-*`/`--suggest-*` (bg+border+text move together); shadows `--shadow-sheet`/`-soft`/`-input`/`-btn`. **Dialog sheets use the near-opaque `--bg-sheet`** (dark = 0.85), per the opaque-popover rule. `ReminderEditor` has its **own** modal (not `Overlay`) — theme its scrim/card directly.
- The PDF/print path stays light regardless of in-app theme (currently no in-app PDF/export exists; keep it light if one is added).

### Hover affordance (porting in 3 waves — see `MGT_Bookings_hover-scale_PORT_INSTRUCTIONS.md`)
- Shared `.mgt-hover-scale` utility: `scale(1.08)`, `120ms ease`, `border-radius:12px`, opaque theme-aware `--bg-hover-card`, the `:hover:not(:disabled)` guard. Magnitude/contract must match Scheduling exactly. **The rule + token shipped v14.3.0** (`index.html` `<style>`; `--bg-hover-card` = `#ffffff` light / `rgb(50,50,53)` dark in both theme blocks; reuses `--shadow-soft`).
- Opt-in per element via `className="mgt-hover-scale"`. Because `mkInp`/`mkBtn` return style objects, put the class **directly on the call-site element**, not via a prop.
- Scroll containers (esp. `TimelineView`) must be padded so lifted edge cells don't clip; the `Overlay` desktop card uses `overflow: visible` + an inner scroller for tall bodies.
- **Rollout status:** v14.3.0 = header chrome (view toggle / Walk-in / + New / Log out / date nav / date input / Today). v14.3.1 = ListView cards + action buttons, TimelineView controls + booking blocks (w/ the **Fix-3** scroller `padding:8` + `labelCol` `paddingTop:8` row-alignment mirror), Settings tabs. Pending: v14.3.2 (Overlay **Fix 4** = `overflow:visible` + `footer` inner-scroller; the `Toggle` atom; all modal buttons/inputs, field-only).
- **Fix-3 timeline note:** pad the *scroller* (not the inner grid — the grid is `pct()`-positioned against the inner width, so padding it shifts every block). `labelCol` mirrors the scroller's `paddingTop` so rows stay aligned (verified: row-top delta 0).

---

## Workflow

### Versioning — single source of truth
- Source of truth: `src/App.jsx` → `__APP_SIGNATURE__.version` (string like `"14.1.13"`).
- Propagates to: console boot banner, `window.__MGT_BUILD__`, Settings → General label (via `appVersion` prop).
- Schema `MAJOR.MINOR.PATCH`. Major/minor only on user-visible feature shifts; structural refactors bump patch.
- **Every meaningful change bumps the version**, as part of the same branch/PR — never ship without a bump.

### One version per branch — the deployment flow (LOCKED)
**One version per branch, one branch per PR. Never bundle multiple versions on a branch.** If a previous PR is still open when the next version is ready, **wait for it to merge first**.

1. After the previous PR merges: `git checkout main && git pull --ff-only`.
2. Branch off fresh `main`: `feat/v{X.Y.Z}-{slug}` for features, `chore/{slug}` for docs/tooling/refactors.
3. Make edits in `src/`.
4. Bump `__APP_SIGNATURE__` in `src/App.jsx`.
5. Update `CLAUDE.md` (file-structure + locked-decisions) **if** the change affects either.
6. **Prepend** an entry to `REFACTOR_LOG.md`.
7. `npm run build` — must succeed; note the main-bundle gz size delta.
8. Commit with a descriptive message; end it with the **Claude co-author trailer**.
9. `git push -u origin <branch>`.
10. `gh pr create --base main --head <branch> --title "…" --body "…"`; end the PR body with the **"Generated with Claude Code"** line.
11. Patryk reviews + merges. Vercel auto-deploys from `main`.
12. Confirm the prod console boot banner / build-global version matches.
13. Sync the local checkout back to `main` (`git pull --ff-only`).

- `gh` CLI is at `/opt/homebrew/bin/gh` (not on `$PATH`).
- Interactive git flags (`-i`) aren't supported in this environment.
- **Commit/push only when asked.** If you're on `main`, branch first.

### Local dev server — `npm run dev` ONLY (LOCKED)
- For any session that touches **visual code**, start `npm run dev` at the start and keep it running; tell Patryk the localhost URL. Vite HMR is <1s; suggest ⌘⇧R if an edit doesn't appear.
- **Never run `npm run preview`.** `npm run dev` only — it hits the **DEV Firebase project** (the safe sandbox). Prod-build verification is **Patryk's** job; Claude never loads the production app.
- DEV is the sandbox by design — never click Save against PROD data while inspecting. The split is enforced in `src/firebase.js` via `import.meta.env.DEV`; **never bypass it.**
- **Skip the server** for pure-logic/hook changes with no visual surface, doc-only commits, and planning/exploration (start it once edits begin).
- DEV sign-in `auth/invalid-credential` on localhost is almost always environmental, not a code bug.

### REFACTOR_LOG.md discipline
- Every shipped version gets an entry: date, files changed, behavioural-change status (almost always "None" for refactors), line delta, scope, key design decisions, verification results.
- For a same-version follow-up commit, **extend** the existing version entry rather than adding a new section.

### Trigger phrases (in chat)
- **"give me the deployment version"** — produce a production-ready file with Firebase integration, auth, cleanup logic, logout.
- **"give me changelog"** — generate a PDF changelog (use `MGT_Changelog_Instructions.md`).
- **"sum up this thread"** — produce a markdown thread-summary continuity guide (same format as the context folder's existing `MGT_*_Thread_Summary.md` files) AND update **both working folders** every time (a `UserPromptSubmit` hook in `~/.claude/settings.json` also reminds on this phrase):
  - **Context folder** (`../megustastu-bookings context`, i.e. `/Users/patrykzychowicz/Desktop/megustastu-bookings context`) — save the summary as `MGT_Bookings_<topic>_Thread_Summary.md`, and refresh the mirror copies of `CLAUDE.md` + `REFACTOR_LOG.md` to match the repo. This folder is the durable store for summaries + working files.
  - **App repo** (this folder) — keep the canonical `CLAUDE.md` / `REFACTOR_LOG.md` current via the normal per-version flow. The repo is the source of truth; the context-folder copies are mirrors of it.
- Preview-file naming while iterating: `restaurant_booking_v{X}_preview {N}.jsx` (incrementing, never overwrite).

### Deployment (Firebase env split — DONE)
1. Replace the relevant file(s) in `src/`.
2. Commit; push to a branch; open a PR (see flow above).
3. Patryk merges → Vercel auto-deploys from `main`.
4. Confirm the console boot banner shows the new version (and the `[firebase] PROD` badge in prod / `DEV` on localhost).

### Verification suite (mandatory for structural changes)
Before declaring any extraction/refactor done, run AST audit:
1. **Parse-check** all changed files via `@babel/parser` + JSX plugin.
2. **Hook-call balance** — total `useState`/`useRef`/`useEffect` across all files equals pre-change total.
3. **JSX element count** — App.jsx + extracted files equals pre-change App.jsx (allow +1 for the new wrapper on component extractions).
4. **Internal-symbol leakage** — hook/component-private names have 0 AST refs in parent.
5. **Exposed-symbol presence** — every exported name is referenced from ≥1 consumer.
6. **Hook extractions** — destructure order places each hook after its inputs are available.
7. **Component extractions** — destructured props match mount attributes exactly.

Scripts live in `/home/claude/verify/` during a refactor session; re-create from `verify_d3.js` / `verify_e1.js` if in a fresh environment.

---

## Common operations

### Adding a new hook
1. Decide pure-logic (`.js`) or returns JSX (`.jsx`).
2. Create `src/hooks/useXxx.{js,jsx}`; export `useXxx(args)` with a documented signature.
3. Apply the Firebase write-guard pattern if it owns persistent state.
4. Add import to App.jsx; call after dependencies in BookingApp body.
5. Bump `__APP_SIGNATURE__.version` + REFACTOR_LOG entry. Run verify suite.

### Adding a new component
1. Create `src/components/Xxx.jsx`; export named function with destructured props (document each prop above).
2. Use atoms from `./atoms` for styling.
3. Add import to App.jsx (or parent); mount in JSX tree.
4. Bump version + REFACTOR_LOG entry. Run verify suite.

### Adding a feature that crosses files
1. Pre-flight: identify which files change, what state moves where, what props/signatures update.
2. Confirm scope/plan before writing code.
3. Implement smallest-first: hooks/lib before consumers.
4. Bump version once, after all files are coherent. Single REFACTOR_LOG entry.

### Debugging
- **Version mismatch:** DevTools console boot banner; `window.__MGT_BUILD__`.
- **Firebase issues:** Firebase Console for live state; console for `[SAFE]` refusal logs and the `[firebase] DEV/PROD` badge.
- **State inspection:** React DevTools (BookingApp's state tree).
- **Re-render storms:** React DevTools profiler. Common culprit: an un-memoised derivation in BookingApp (no `React.memo` in use yet — add only when profiling proves need).

---

## Gotchas and constraints

| Issue | Constraint |
|---|---|
| Backdrop-filter performance | ≤4 simultaneous `backdropFilter: blur()` instances |
| Optimizer 15:00 cutoff | `useAutoOptimizer` auto-toggles; don't override without daily-reset logic |
| Seated bookings | Cannot be reshuffled by optimizer; manual moves only |
| Walk-ins | `_manual:true _locked:true`; immune to optimizer |
| Firebase free plan | No automatic backups. Don't rely on Firebase rollback. |
| Empty-array writes | Refused by save guards if `firstLoadCount > 0`; design around this |
| `formRef.current` vs `form` | Event handlers read the ref; renders read the state |
| Cross-view modals | ManualModal opens from form / timeline / list — keep its mount in BookingApp |
| 51-blur-instance lag | Was a real production bug on tablet; never reintroduce |
| `mkInp`/`mkBtn` | Return **style objects** in Bookings (not JSX) — no prop passthrough |
| Worktree paths | In a worktree session, Edit/Read absolute paths must include `.claude/worktrees/<name>/…` or they silently target `main`'s checkout |

---

## Lessons to carry forward (hard-won on Scheduling + Bookings)

- **Worktree path anchoring.** In a worktree, Edit/Read absolute paths **must** include `.claude/worktrees/<name>/…`. Worktree cleanup is batched — sweep stale worktrees in one pass at a milestone, not per-version.
- **StrictMode mounted-ref bug.** Set `mounted.current = true` **inside** the subscription effect, not only via the `useRef` initializer.
- **Check computed styles before iterating on visual feedback.** When Patryk says "too big" / "doesn't match", read the computed font-size / padding / dims first — visual mismatches usually have one structural root cause that geometry tuning won't fix.
- **Preserve inline styles on refactor.** When splitting a shared style object into per-element styles, grep the original for every declaration and verify each survives. Also: `{ marginLeft: n, ...someStyle }` where `someStyle` has a `margin` shorthand silently resets the margin — put the specific side **after** the spread.
- **Don't revert user-confirmed behaviour.** If Patryk approved a behaviour, don't quietly undo it later chasing an unrelated fix — ask first.
- **Grep unfamiliar atoms before use.** Verify a helper's actual return/props at a call site before relying on it (the `mkInp`/`mkBtn` JSX-vs-style-object divergence is exactly this trap).
- **Don't spawn subagents unless asked** — re-deriving context cold is the expensive path; handle multi-part tasks inline.
- **Push back on bad architecture.** If a request leads to instability or bad structure, say so and propose a better approach. Patryk is self-taught and explicitly wants this.
- **Conversation budget:** after ~25 messages, suggest a fresh thread; carry context with a "sum up this thread" summary + attach `CLAUDE.md`.

---

## Out of scope

- **Multi-tenancy** — single-restaurant app; no plans to generalise.
- **Mobile app** — web-only; mobile is responsive layout (`useWinW` → `isMobile`).
- **Tests** — no test suite; verification is AST audits at refactor time + manual QA in deployment.
- **TypeScript** — pure JavaScript; no plans to migrate.
- **Storybook / component dev environment** — components are developed against the live (DEV) app.

---

## Future work flagged

- **Dark mode / theming port — COMPLETE** (v14.2.0 mechanism → v14.2.1 `constants.js` → v14.2.2 `atoms.jsx` + modals → v14.2.3 `TimelineView` → v14.2.4 `ListView` → v14.2.5 `App.jsx` chrome). Every in-app surface is themed via `var(--…)` tokens in `index.html`'s `:root` / `[data-theme="dark"]` blocks. See `MGT_Bookings_dark-mode_PORT_INSTRUCTIONS.md`.
- **`.mgt-hover-scale` hover-lift port — IN PROGRESS** (3 waves; spec `MGT_Bookings_hover-scale_PORT_INSTRUCTIONS.md`). v14.3.0 = CSS rule + `--bg-hover-card` token + header chrome; v14.3.1 = ListView cards + TimelineView controls/blocks (Fix 3) + Settings tabs. Remaining: v14.3.2 (Overlay Fix 4 + `Toggle` + all modal buttons/inputs). See the "Hover affordance" UI rule above.
- **WhatsApp Cloud API integration (Phase 1b)** — designed, not implemented. See `MGT_WhatsApp_Inbox_Phase1b_Design_Summary.md`. Integration points: the `BookingFormModal` callback surface + a new `InboxPanel` component.

---

*Keep this file lean — it's auto-loaded by Claude Code and attached to fresh threads.*
