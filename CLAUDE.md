# CLAUDE.md

Instructions for Claude (and Claude Code) when working in this repository.

This file is the living architecture record. When a change adds a feature or makes a
decision, record it here (file-structure block + locked-decisions). Keep per-file notes
scannable; archive old per-version sub-notes when a block gets long.

**App-code architecture decisions and gotchas live in `src/CLAUDE.md`**, which loads
whenever Claude opens a file under `src/`; record new ones there. Test-suite notes are
in `tests/CLAUDE.md`, the icon pipeline in `scripts/CLAUDE.md`, and measurement traps
(readings that measured the tooling, not the app) in the `mgt-measurement-traps` skill.

**The visual system lives in `DESIGN.md`** (v17.13.0, extended v17.14.0) — token scales, surfaces,
colour and contrast, hover/press/motion, the icon set, and the accessibility
contract. Read it before changing how anything looks or behaves on screen; the
two sections here that point at it carry the non-negotiables. A design decision
gets recorded there, not here.

**The vocabulary lives in `GLOSSARY.md`** — one name per thing, three columns
(what you see on screen · the correct term, with its code identifier · what it
does). It names things; it does not decide them, so where a row summarises this
file or `DESIGN.md`, those win. A version that adds a user-visible surface adds
its row there, in the same PR — the way `ROADMAP.md` is kept current.

---

## Project

**MGT Bookings** — private staff-facing booking management web app for *Me Gustas Tú*, a restaurant in the Canary Islands. The APP is MGT Bookings; the RESTAURANT is Me Gustas Tú (and is configurable — `settings/general.restaurantName`). v17.15.2 separated the two: they had been spliced in `DaySheet`'s printed footer, which composed the app's own name out of a restaurant setting. **v18.0.0 phase 2 finished the job in both directions.** The app's name is `APP_NAME` (`src/lib/constants.js`), because it was FOUR hand-typed literals and one had already drifted — `Settings.jsx`'s footer said "MGT Booking System", singular, with a word the other three dropped, and nothing in the repo could see it: `check:style` looks for literals of colour and geometry, so N copies of one string that happen to disagree are invisible to every gate. Six sites read it now; two of them (`ErrorBoundary`'s heading and its build-line fallback) were found by grep after the plan's table had enumerated four. The **seven** copies that CANNOT import — three in `index.html` (`<title>`, `apple-mobile-web-app-title`, the boot watchdog's heading), two in the manifest (`name`/`short_name`), two in `public/sw.js` (the offline page's `<title>` and body copy, plus its header comment) — are pinned to the constant by `tests/stylesheet.test.js`, which asserts each site AND the COUNT per file, so a rename fails the build until every one follows and a NEW copy fails it too. The first version of that guard pinned four and its comment said two; the three it missed were the boot watchdog and the offline page, i.e. the screens a user sees when the app is broken. **A guard that describes its own coverage in prose does not have it** — count, don't claim. And the restaurant's name seeds from the TENANT (`profile.name`) rather than from a literal or from `APP_NAME`: byte-identical for MGT, correct for the next tenant, and it removes the "check PROD's `settings/general` before merging" precondition the plan had carried. A FALLBACK from restaurant name to app name (`DaySheet`'s heading) is fine; a COMPOSITION of the two is what v17.15.2 removed.

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
├── App.jsx · firebase.js · index.css · tenants/   notes in `src/CLAUDE.md`, with the app-code architecture decisions and gotchas (firebase.js is the DEV/PROD switch — DO NOT bypass the split)
├── hooks/                           see `src/hooks/CLAUDE.md` — moved so it loads only when working under that directory
├── components/                      see `src/components/CLAUDE.md` — moved so it loads only when working under that directory
└── lib/                              see `src/lib/CLAUDE.md` — moved so it loads only when working under that directory

api/                                 **serverless functions — new to `main` in v18.0.0 phase 5**, and the first code in this
                                     repo that does not run in the browser. Vercel deploys the directory WHOLESALE, so
                                     there is no build-time way to keep a file out of production: every gate here is a
                                     RUNTIME one, checked as the handler's first statement. `wa-inbound.js` is a **public
                                     URL the moment this merges** — the single riskiest fact in the release, and the reason
                                     phase 5b exists. `_lib/` holds the shared halves (`env` · `gemini` · `inbound-core` ·
                                     `meta` · `rtdb`); `rtdb.js` writes through **firebase-admin**, which bypasses the
                                     security rules entirely — see the CAS-exemption paragraph below, which is about exactly
                                     that. The three `wa-sim-*.js` endpoints are the simulator's and must return 404 unless
                                     `WA_SIM_ENABLED === "1"`. Node ESM resolves these imports, so anything under `src/lib`
                                     they reach must carry explicit `.js` extensions — the chain is
                                     `api/* → whatsapp.js → customers.js → booking-logic.js → constants/day/vouchers`.
                                     **v18.0.0 phase 5b gates the three sim handlers on `simEnabled()`** (`WA_SIM_ENABLED === "1"`),
                                     as each handler's FIRST statement — before the method check and before staff auth, so the
                                     answer is indistinguishable from "no such endpoint": a 405 or a 401 would both confirm the
                                     handler is there. Fail-closed, and measured across five env values — absent, empty, `"0"`,
                                     `"true"` and `"1"` — where only the last opens it. **Since the phase-5 review those three
                                     are also excluded from a deployment by `.vercelignore`**, so PRODUCTION routes FOUR
                                     functions (`wa-inbound` · `wa-send` · `wa-recheck` · `wa-config`) and the sandbox branch
                                     appends `!api/wa-sim-*.js` to get its three back — APPENDING, because a merge silently
                                     reinstates a deleted line. The runtime gate stays: two independent answers, and the
                                     404 is the one that still holds if the ignore file is ever edited. `_lib/` is
                                     underscore-prefixed so Vercel does not route it. **`wa-config.js` (phase 5) answers
                                     "which server-side keys are configured" as a BOOLEAN PER KEY and never a value** —
                                     it is what the Admin tab's Integrations section renders. It cannot leak a secret by
                                     mistake because it never holds one (`Boolean(env(k, null))` is the whole of it), and it
                                     is staff-auth gated because a map of which integrations are unconfigured is a map of
                                     where a deployment is soft. The client keeps its own labels and groups and asks only the
                                     question a browser cannot answer — presentation there, fact here, so the key list is not
                                     one list in two places
```

**REFACTOR_LOG.md** at repo root contains the full version history with architectural decisions for each phase (B1–B5, C1–C3, D1–D4, E1+).

**ROADMAP.md** at repo root holds pending work only — deferred features, follow-ups, ideas. Nothing shipped belongs there; nothing pending belongs in `REFACTOR_LOG.md`. Keep it current: remove an entry the moment it ships, add one the moment new deferred work surfaces. See the `mgt-workflow` skill for when to check/update it.

**Icons in `public/` are generated by `scripts/gen-icons.py` — never hand-edit the generated SVGs.** How to regenerate them (and why the mark carries no type) is in `scripts/CLAUDE.md`.

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

### Style tokens — see `DESIGN.md`
Every colour, radius, size, weight, spacing, control height, icon size and
motion value comes from a role-named scale in `src/lib/constants.js`
(`S` · `BTN` · `BLOCK_BG` · `BLOCK_INK` · `STATUS_COLORS` · `TBL` · `R` · `T` ·
`FW` · `SP` · `H` · `IC` · `M`), backed by CSS custom properties in
`src/index.css` (in `index.html` until v17.15.1). **`DESIGN.md` holds the whole system and the reasoning behind
each scale.** The part you cannot skip:

- **No new literal.** `npm run check:style` is a CI gate and fails on a bare
  `borderRadius` / `fontSize` / `fontWeight` / padding / margin / gap /
  `height` / `minHeight` number, a white-inset shadow over a theme-flipping
  fill, a drop-shadow literal, a **colour** literal, a numeric icon `size`, or
  a hand-written duration/curve.
- **SIX exemption markers, and they live in two places.** Four go inline in
  the STYLE OBJECT, never in JSX children position: `/* @canvas */` (geometry
  and type one-offs), `/* @fixed-fill */` (the surface under this does not flip
  with the theme), `/* @shadow */` (a genuine one-off shadow), `/* @motion */`
  (the WAAPI escape hatch). A marker in children position RENDERS AS TEXT —
  Rule 0 rejects that placement because eight of them once shipped. The other
  two go inside the OPENING TAG, because what they exempt is the tag rather
  than a declaration: `<button /* @no-lift <reason> */ …>` (Rule 10, the hover
  lift) and `<Overlay /* @static-height <reason> */ …>` (Rule 12 — a modal body
  not wrapped in `<AutoHeight>`, which resizes the card in one frame when its
  contents change). **Both tag markers take a REASON and the reason is checked**:
  Rule 12 shipped with nine, and each was verified by reading the body before it
  was written — seven confirm dialogs whose body is one fixed sentence, the
  Settings overlay (which delegates to `SettingsContent`'s own
  `AutoHeight watch={cur}`), `HistoryPopup` (a list built once per open) and
  `VoucherRedeemModal`, whose only variable content is a `Reveal` and a Reveal
  eases its own height. That last one is why the rule cannot be "does this body
  change height": not statically decidable, and it would have been wrong about
  the one modal that solves the problem another way. What IS decidable is
  whether the house pattern was applied, and if not, whether anybody said why.
- **A fill that carries text is registered in `tests/contrast.test.js`**, in
  both themes, or the coverage guard fails the build.
- **`mkInp` / `mkBtn` return style objects**, not JSX — the sibling Scheduling
  app differs. Compose new UI from `atoms.jsx`; add atoms there rather than
  redefining them.
### Conditional rendering
- Prefer ternaries: `cond ? <X /> : null`
- Avoid `cond && <X />` — reduces a class of falsy-render bugs (the `0 && <X/>` trap).

### Comments
- Heavy commenting is expected — single-developer codebase with long context gaps.
- Section headers use `// ── Name ──...` for grep-ability.
- Phase notes use `// Phase X (vY.Y.Y): ...` at the top of moved blocks.

---

## Architecture decisions

Hooks vs components, the controlled-component pattern, optimizer scope, `confirmKitchen`
and the auth shell are in `src/CLAUDE.md`.

### The offline shell (v17.10.1) — a service worker, on terms

v17.4.0's worker froze the app on iOS and was withdrawn with root cause
unestablished. v17.10.1 established it: the freeze happened **in iOS Chrome as
well as a home-screen shortcut**, and a service worker *cannot run in iOS Chrome
at all* (WKWebView exposes `navigator.serviceWorker` only under App-Bound
Domains, which a general-purpose browser cannot use). The same symptom in a
context where the worker cannot exist means one cause explains both — the CSP
blocking Firebase's JSONP fallback, already fixed in v17.5.1.

Four properties make the new one safe, and none may be dropped:

1. **It is not near the data path.** `respondWith` fires for exactly two things,
   both same-origin GET: navigations (**network-first**) and hashed assets
   (**cache-first**). Everything else falls through untouched — every Firebase
   request is cross-origin and dropped on the handler's first line. Network-first
   on navigation is what makes it structurally impossible to pin the app to a
   stale build.
2. **It installs only where the app demonstrably works** — registration is gated
   on `bookingsReady`, so a build that cannot reach Firebase can never cache
   itself and serve itself back. Disabling is NOT gated: it must work in any
   state.
3. **Two independent ways out**, both verified on the tablet: `?sw=off` (in the
   boot script, so it works when React never mounts) and re-deploying the
   v17.4.1 kill switch at the same URL.
4. **No `skipWaiting`** — a new version takes over on the next navigation, so
   nothing swaps under a shift in progress. The kill switch keeps its
   `skipWaiting`; there, immediacy is the point.

**The test rig the ROADMAP said did not exist now does:** `adb reverse tcp:5174`
makes `http://localhost:5174` a **secure context** on the tablet, so a worker
installs there exactly as it would in production. What still cannot be tested
locally is the production offline BOOT (dev modules are not under `/assets/`, and
a prod build points at PROD Firebase) — which is why the boot watchdog exists.

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

**Freshness / resync gate (v15.2.0) — THIRD write-guard dimension.** Beyond "loaded" + "non-empty", `saveBookings`/`saveBlocks` also refuse when the local snapshot may be **stale**. Origin: a laptop left asleep with the tab open from ~18:00 overwrote a night of tablet bookings when it woke at ~01:30 — the frozen clock interval fired the auto-extend/auto-complete effects against the stale in-memory snapshot and wrote it *before* the reconnect's fresh `onValue` arrived (the sync write wins that race). Mechanism (all in `usePersistence.js`): a 10s **heartbeat** bumps `lastBeatRef`; a gap `> STALE_GAP_MS` (90s) means the event loop was frozen (sleep). The gap is checked **at write time** (top of `saveBookings`/`saveBlocks`, before any `setState`) so a post-wake stale write is refused **race-free**, regardless of interval-firing order. `markStale()` sets `staleRef` + shows the `resyncing` banner ("⟳ Syncing the latest data…") and `resync()` force-pulls the server's current `bookings`+`tableBlocks` via `get()` (gated on `isConnectedRef` — an offline `get()` can serve the stale cache and must not clear the gate). The gate clears on any live `onValue` snapshot or a successful `resync()`. Resume events (`focus`/`pageshow`/`visibilitychange`) are gap-gated nudges; brief network blips keep the loop alive (gap small) so offline editing + the offline queue are untouched.

**Save feedback + auto-retry (v15.4.0).** A stale-block is no longer a red error — it's a transient, auto-recovering state. `saveBookings`/`saveBlocks` now **return a boolean** (`true` = dispatched, `false` = blocked by the stale gate). Every action handler in App.jsx gates its success UI on it — `const ok = saveBookings(fn); if (ok && …) flash();` — so a refused write is **never** shown as "Booking saved." (the original bug: `flash()` fired unconditionally). The stale-block branch dropped its `setWriteWarning` (red); the red banner is now reserved for genuine hard failures (not-loaded, empty-array, retry-exhausted). **Auto-retry queue (`pendingRetriesRef`, function-form + non-silent only):** a blocked or server-rejected user write is parked as its original updater `fn` and replayed on freshly-resynced data inside `resync()`'s `.then` (after `clearStale()`), capped at `MAX_RETRIES` (3) → then a single red error. Replaying the **function** re-applies the mutation on fresh `bookings` (pure transform of `prev`, so safe); **value-form / silent writes (the auto-extend & auto-complete effects) never queue** — replaying a precomputed stale array would re-write stale data; they recompute next tick. **`doSave` (new/edit booking) WAS the exception (v15.4.0–v15.6.x)** — high-stakes, so on a block it kept the form open + an in-form "tap Save again" message instead of silent background retry. **v15.7.0 removed the exception** (see the v15.7.0 note below): `doSave` now passes the **function form** like every quick action, so a held new/edit save shows optimistically + auto-retries too. NB: a heartbeat-interval-sized `STALE_GAP_MS` (must stay ≫ the 10s heartbeat, hence 90s) — a threshold below 10s would let every heartbeat false-trip the gate.

**Per-booking-node storage + diff-write (v15.5.0) — the structural multi-device-merge layer.** `bookings` is now a **keyed object `/bookings/{id}`** (one child per booking), NOT a single array — so two devices editing **different** bookings (even both offline) write **disjoint paths** and Firebase merges them, instead of racing on one array node. Reads are unchanged: `sanitizeAll` already `Object.values()`-es an object, so `onValue`/`resync` deserialize a keyed node to the same in-memory array, and **all ~39 `saveBookings`/`bookingsAfterAction` call sites are untouched** (the app still thinks in arrays). The change is in `persist()`: instead of writing the whole array, it **diffs** `prev` vs `computed` (both forms now route through the functional `setBookings` updater so `prev` is available) and pushes a **multi-path `update(ref(db,"bookings"), patch)`** of ONLY changed children (`{id: stamped}`) + deletions (`{id: null}`); an empty diff skips the write. **Conflict protection replaces `bookingsRev`** with a per-booking **`updatedAt`** stamp (added to the `sanitize` whitelist so it survives reads; `bookingChanged` compares content *excluding* it so a server echo isn't a false change). `stampForWrite` issues a stamp monotonic-per-device (`lastStampRef`) AND strictly above the booking's last-seen server value — **clock-skew-proof** (a behind-clock device still writes an acceptable stamp) and — under the v15.5.0 greater-than rule this paragraph describes — **StrictMode-proof** (the dev double-write gets a *higher* stamp → accepted, no spurious reject). **That second property did NOT survive v16.0.0's CAS**, which is the next paragraph; see `lastPatchSigRef` there. **Per-`$id` Security Rule:** allow a delete, else require numeric `updatedAt` strictly greater than the stored value (create allowed when none) — rejects a stale same-booking write AND any pre-v15.5.0 whole-array write (no `updatedAt`). **Lazy migration:** the first v15.5.0 client to load a legacy **array** node (`Array.isArray` — Firebase returns an array only for sequential integer keys) converts it once (`migratedRef` + connected-gated; `genId()` is path-safe `[0-9a-z]`); an `arrayShapeRef` **holds** per-child writes until the keyed shape echoes so a string key is never mixed into the integer array (held writes queue + replay via the v15.4.0 path). **v17.16.7: it is a multi-path `update()` of CHILDREN, not the whole-node `set()` it was for nine versions** — the old integer keys nulled and the keyed rows written in one atomic patch, same semantics. A whole-node `bookings` write is exactly the capability CT-2A-04 is about, so it could not be excepted from the rules fix; **after this the app makes NO whole-node `bookings` write anywhere**, which is what lets the rules and the client agree rather than the rules merely tolerating the client. Two ordering details are load-bearing and both are commented at the site: the old keys are read off the SNAPSHOT rather than off the sanitised array, so a row `sanitizeAll` dropped still has its slot cleared instead of surviving as a hole; and the keyed rows are `Object.assign`ed OVER the nulls, so a booking whose id happens to equal an old integer index is not deleted by the very patch writing it. Leaving the migration denied instead was rejected: `arrayShapeRef` holds EVERY booking write until the keyed shape echoes, so a legacy array node would have left the app permanently read-only for bookings rather than merely unmigrated. **Deploy is a HARD CUTOVER** (the new app and the v15.3.0 rule are mutually incompatible) — swap the rule + refresh all devices together at a quiet time; see `database.rules.README.md`.

**True compare-and-swap — `baseUpdatedAt` + revision CAS everywhere (v16.0.0) — the FOURTH write-guard dimension, server-side.** Origin: the 2026-07-05 incident — a laptop asleep at home woke and its stale snapshot overwrote a night of tablet status changes, because the v15.5.0 rule only required `updatedAt` to be **greater** than stored, and a stale device stamps with its current wall clock (always greater). Greater-than is last-writer-wins, NOT staleness protection. v16.0.0 makes every write **prove it was based on the data it overwrites**: (1) **bookings** — `stampForWrite` also writes `baseUpdatedAt` (the `updatedAt` of the version this device last saw; 0 on create); the per-`$id` rule requires `baseUpdatedAt === stored updatedAt`. **v17.16.1: a CREATE now requires `baseUpdatedAt === 0`** rather than only a numeric stamp — which is exactly what `stampForWrite` writes when it has no `old`, so a genuine create is unaffected while a stale offline edit naming a DELETED version is refused (CT-2A-01: the `!data.exists()` disjunct used to short-circuit the CAS, so a cancelled booking came back live on its old table). Deletes stay unconditional — a multi-path null can't carry a base. The same version adds per-field `.validate` on `name`/`date`/`time`/`size`/`duration`/`status`/`tables` (CT-2A-03's server half): each is "if PRESENT, must be the right shape", never "must be present", because `sanitize` fills every gap on read and a required field the app later stops writing would be a rejected write in production. `status` was checked as a string but its VALUE set deliberately not pinned, and table ids are not checked against the layout — both would refuse writes touching data that already exists. **v17.16.11 pinned `date` and `status` after all, by removing that trade rather than accepting it** (the CT-2A-03 follow-on, and the last entry in `ROADMAP.md`'s Deferred section): each predicate is `matches(<pattern>) || newData.val() === data.val()`, so a stored value CARRIED THROUGH UNCHANGED is always allowed — which is exactly what `sanitize` does with one — while a value being INTRODUCED or CHANGED must be well-formed, and on a create `data.val()` is null so the pattern is the only way in. **That is why it needed no audit of PROD**, which is what the entry had been waiting on. Two details found by RUNNING it: the date pattern is an OPTIONAL GROUP `/^([0-9]{4}-[0-9]{2}-[0-9]{2})?$/` and not an alternation, because `""` is a shape `sanitize` emits and the RTDB regex engine rejects a mid-expression `^` outright; and `time` is still NOT pinned, because `isReadableTime` accepts `"9:30"`/`"13:00:00"`/`":"` on purpose, so the client's own output is wider than any pattern worth writing and a grandfather clause cannot help with values the app is still free to produce. Table ids stay unchecked, for the reason above. A stale writer (sleep/wake, zombie socket, offline-queue flush) is rejected server-side regardless of clocks; the existing `.catch → markStale → resync → drainPending` recovery replays user intent on fresh data. `baseUpdatedAt` is per-write metadata — deliberately NOT in the `sanitize` whitelist. A `lastPatchSigRef` dedupes StrictMode's dev double-dispatch **only when both dispatches carry the same base** (same content+base within 2s = the same write; re-dispatching would self-reject). **v17.16.10 corrected the unqualified claim this sentence used to make.** `contentKey` deletes `updatedAt` and NOTHING ELSE, so the signature is (content, `baseUpdatedAt`) — and StrictMode's double-invoked updater can read two different `prev` values (one pre-resync, one post-resync), so the two dispatches carry DIFFERENT bases, produce different signatures, escape the 2s window, and the stale one is correctly rejected by the CAS. Measured on unmodified v17.16.8: **six consecutive ordinary status changes each exhausted the retries** and raised the write-error banner in DEV. **No PROD impact** — StrictMode is dev-only and the rejected write is the redundant one — so this is DEV noise plus a documentation defect, never a data risk. The signature keeping `baseUpdatedAt` is deliberate and pinned (CT-2A-08, v17.16.6): dropping it is exactly what would make two patches indistinguishable to the server. (2) **Every whole-node collection** (`tableBlocks`, `waitlist`, `reminders`, `reminderFires`, 4× `settings/*`) — the proven v15.3.0 revision CAS, generalised in **`src/lib/revGuard.js`**: sibling `<name>Rev` integer, atomic `update({node, nodeRev: base+1})`, rule pair rejects a non-+1 rev (an empty-array write deletes the node and skips its own validate, but the REV child's rule still gates the atomic update. **v17.16.1 corrects the words that followed — "wipes are covered".** True of the APP's write path, which always sends both keys, and false of the RULES: a client that calls `remove()` on the node and omits the rev is not constrained by the rev's rule at all (CT-2A-06, verified against the emulator — node gone, rev left behind). And it could not be fixed by adding a rule: **RTDB write permission cascades from the root `.write` and cannot be revoked lower down** — measured, a child `.write:false` does not deny the delete. **v17.16.7 closed it by DELETION**: the root grant is gone and each writable path carries its own, with the rev CAS moved from `.validate` to `.write` on all twelve pairs — the same predicate character for character, but `.write` IS evaluated for a delete and `.validate` is not, which is the whole of CT-2A-06. `bookings` carries no grant and `bookings/$bid` carries it, which is CT-2A-04; deleting ONE booking is unaffected because the app has only ever written children). Recovery is free: the SDK rolls back a rejected write locally and re-fires the node+rev `onValue` listeners. Rev refs advance optimistically (back-to-back + StrictMode writes chain +1,+2). (3) **Wake-race client fix**: a heartbeat-gap trip now also resets `isConnectedRef=false` (`gapTrip()`), because on wake the ref still holds its pre-sleep `true` and `resync()`'s `get()` could be served from the local cache, "succeed" with stale data, and clear the gate. Deploy: **app first, rules second** (rolling-safe — old rules ignore the new fields) — see `database.rules.README.md`. **Rule of law: any NEW persisted node must ship with either a per-child stamp CAS or a revGuard rev pair — never a bare `set()`.** **Exception (v17.3.0): the `presence` node.** It is NOT persisted app data — it's ephemeral device-presence (see `usePresence.js`): each connection writes only its OWN disjoint push-key child and self-removes via `onDisconnect().remove()`, so there is no stale-overwrite class and CAS/revGuard does not apply. **v17.8.0 widens this slightly and the exemption still holds:** the staleness prune deletes OTHER devices' children, but only ones already proven dead by a missing heartbeat, and deleting a dead key is idempotent — two devices racing on the same one is harmless. It has no `.validate` and never needed a CAS. **What v17.16.7 changed is the OTHER half of that sentence: it no longer ships with no console step.** Since the root `.write` grant went, `presence/$key` carries an explicit `auth != null` — the same permission it always inherited, now stated. **So the Rule of law gains a second clause: a new persisted node needs a `.write` grant in `database.rules.json` as well as its CAS, or it is simply unwritable.** That is the safe direction and it fails LOUDLY in DEV rather than working there and being unguarded in PROD, which is the trade the restructure bought. This CAS exemption is ONLY for genuinely ephemeral, per-connection-owned nodes — never for real data; the grant requirement has no exemptions. **v17.16.8 adds the SECOND CAS exemption, and it IS real data, so the sentence above needed correcting rather than quoting.** The WhatsApp sandbox's `conversations/$phoneKey` and `messages/$phoneKey` get a per-child `.write` grant and no CAS — because `api/_lib/rtdb.js` writes both through **firebase-admin** (on the `wa-sandbox` branch until v18.0.0 phase 5 merged it; the reasoning never depended on which branch it sat on), and Admin SDK writes bypass security rules ENTIRELY. A CAS there would constrain the browser while the backend doing most of the writing walks past it: a pin that looks like a guarantee while guaranteeing nothing, which is the same defect `tests/CLAUDE.md` records for `test:rules`' openjdk prefix. So the exemption test is no longer "is this ephemeral" but **"can a rule actually bind every writer of this node"** — `presence` passes the old test, these pass the new one, and a node with only client writers passes neither and gets its CAS. The other two WA nodes have exactly one writer each and DO get rev pairs (`templatesRev`, `whatsappRev`). The grant sits at `$phoneKey` and not at `$phoneKey/$mid` on purpose: permission cascades DOWN, so one grant covers the per-message writes and the delete-this-conversation call while the whole-node wipe stays denied — which is CT-2A-06 still holding, and is why the sandbox's `clearAllWaData()` had to become a per-key delete loop. The grant requirement still has no exemptions. **v18.0.0 session 8 adds a THIRD entry to this list, and it is the one that is not an exemption at all.** `/activity/{pushId}` has no CAS because it is **append-only**: a CAS proves a write was based on the version it overwrites, and an entry that can never be EDITED is holding the stronger property, not being excused from the weaker one. **Session 11 narrowed the delete half of that sentence and it is worth reading as written.** The clause used to say "no delete except an admin's prune of anything past 365 days", and the twelve-month floor is gone: an admin may now delete ANY entry, because "remove by date or a range of dates" and a retention prune are the same operation on the same node and no rule can tell them apart. What survives is the property the CAS exemption actually rests on — **nothing can be rewritten**, ever, by anyone — plus a compensating log line that a clear happened. Deleting is admin-only, per-entry (the node itself has no `.write`, so it cannot be wiped in one call), and tamper-EVIDENT for one pass rather than impossible. It also carries its own `.write` grant, so the Rule of law's SECOND clause is satisfied rather than excepted. The exemption test from v17.16.8 — "can a rule actually bind every writer of this node" — passes here too: the only writer is the browser, and the rule binds it on three separate clauses (author uid, author email, and `at === now`). **So the list of shapes that may skip a CAS is now: ephemeral per-connection nodes (`presence`), nodes whose principal writer is the Admin SDK and therefore unbindable (`conversations`/`messages`), and nodes that are append-only by rule (`activity`). Nothing else.**

**Optimistic visibility for held writes (v15.6.0).** When the freshness gate HOLDS a quick-action write (device woke from sleep), `saveBookings` now ALSO applies it to local state (`setBookings(next)`) in the hold branch — so the change is **visible immediately** instead of staying invisible until `resync()` finishes (the reported "my tap did nothing" confusion). The server write is still held (no stale data written): the persist happens when the queued function replays on FRESH data. A shared **`drainPending()`** helper (the v15.4.0 retry-drain) is called from BOTH `resync()` and the live `bookings` `onValue` (after `clearStale`) so a fresh snapshot arriving mid-recovery never wipes the optimistically-shown change before it's re-applied + persisted (batched into one commit → no flicker). Scope = function-form non-silent writes only (the existing condition) — so until v15.7.0 `doSave` (value-form) kept its "keep the form open + tap Save again" behaviour, and silent auto-effects are unaffected. The `resyncing` banner was reworded from "Writes are paused" to "your changes are saved and will finish syncing".

**Post-sync conflict reconciliation (v15.6.1) — the optimiser re-runs on merged data.** Per-node merge (v15.5.0) preserves two devices' offline bookings, but each device's optimiser assigned tables without seeing the other's — so an offline same-table double-booking (e.g. both on table 6) **overlaps once synced**, and the sync path stores the merged snapshot **verbatim** (no optimiser pass). A reconciliation `useEffect` in `BookingApp` (App.jsx, sibling to the optimiser/banner machinery) now reacts to settled snapshots: it collects active dates `≥ today` with assigned tables, filters to the ones failing the pure **`verifyClean`** (booking-logic.js), and resolves only those via one **silent function-form `saveBookings`** — full reshuffle (`bookingsAfterAction(next,d,blocks,null,false,autoOptimizer)`) when `optimizerActiveFor(d,…)` (always true for future dates; true today before the cutoff), else (today + optimiser OFF) **relocate ONLY the newest non-locked conflicting booking** (sorted `updatedAt` desc + id tiebreaker → deterministic across devices) via the `forceReassign` path, looping (cap 20) until clean. The new pure **`findConflicts(bookings,date)`** returns the overlapping ids for that selection. Self-stabilising: gated on `!verifyClean` so clean syncs write nothing, and optimiser/relocate output is clean → next pass is a no-op (also breaks any Firebase echo loop); cross-device double-writes settle via the v15.5.0 per-`$id` `updatedAt` CAS; `_locked` bookings (manual/walk-in) are never moved; an unplaceable booking (full restaurant) drops out of the overlap set so the loop terminates. Gated on `!resyncing` (waits out the post-sleep stale window, re-runs on fresh data) and writes `isSilent` (auto-effect). A transient `syncFixBanner` ("Resolved a table conflict after syncing.") fires only when something actually changed (`changed` flag). Pure client change — no `usePersistence`/security-rule/shape change (rolling deploy). **v15.6.2 bug-fix:** the effect's "loaded" gate was wrongly `!loadBannerShown` — but `loadBannerShown` is the *6-second* "Firebase connected" banner flag, so the effect went dead ~6 s after any page load and only reconciled on a fresh reload (not on a live sync). Fixed to `firstLoadCount.current===null` (the real, permanent loaded signal, a ref exposed from `usePersistence`); `loadBannerShown` dropped from the dep array. **Gotcha to carry forward: `loadBannerShown` is NOT a "loaded" flag — it auto-hides after 6 s; use `firstLoadCount` (ref, null-until-loaded) for a persistent loaded check.**

**`doSave` joins optimistic-show + auto-retry (v15.7.0) — the exception is gone.** `doSave` (new/edit booking) used to build a precomputed array `fin` and call `saveBookings(fin)` (**value form**), which the optimistic-show + retry branches skip (they all gate on `typeof next==="function"`) — so a stale-gate hold bounced the form back with "tap Save again". v15.7.0 converts both `doSave` write paths to the **function form** (`saveBookings(buildNext)`), so a held new/edit save now shows optimistically + auto-retries on fresh data exactly like quick actions. **Technique = capture-intent-then-replay-on-fresh-`prev`:** the user's intent is computed **once** against current `bookings` — `genId()`/the `nb` object (new), or the captured edit fields/flags derived from `orig`+`f` (edit) — then a pure `buildNext(prev)` re-applies that intent to whatever fresh `prev` the updater receives (so a concurrent edit to OTHER bookings, which live in `prev`, is preserved). The synchronous high-stakes guards (capacity/displacement/no-table) still run **once** against current data via `const fin=buildNext(bookings)` and block the form with `setError` before any dispatch. **Duplicate-safe:** `genId()` is called once (stable id) and the retry queue only replays writes that never landed (held) or were atomically rejected — so fresh `prev` can't already contain the new id; the new-path `applyBase` also `filter`s out `newId` before `concat` (belt-and-braces). Flash is gated on the `ok` boolean (never claim "saved" for a not-yet-persisted write). Pure client change in App.jsx's `doSave` — no `usePersistence`/security-rule/shape change (rolling deploy).

**Auto-effects** (anything that writes Firebase without direct user action) must pass `isSilent=true` to suppress the user-facing banner on refusal.

**Persisted collections:** `activity` (v18.0.0 session 8 — the **11th**, and the
first with no CAS because it needs none: `/activity/{pushId}` is **create-only**,
which is STRONGER than a compare-and-swap rather than an exemption from one — a
CAS proves a write was based on what it overwrites, and here nothing may be
overwritten at all. Three clauses in `.write` carry it: `uid === auth.uid` and
`email === auth.token.email` refuse an entry written as somebody else, and
`at === now` refuses one filed at a time of the author's choosing — which forces
the client to send `{".sv":"timestamp"}`, since a client `Date.now()` can never
equal the server's `now` (measured against the emulator, both ways). **That
clause is in `.write` and NOT `.validate` on purpose**: `.validate` re-runs over
the merged node when a redaction rewrites `subject/name`, where `at` is
deliberately unchanged, so the same predicate there would make every entry
permanently un-redactable and silently break erasure. The only other operations
are an admin PRUNE of anything older than 365 days and that one redaction,
gated on `customerDelete`. **Guest names are never stored**: the text holds
`{b:<id>}` tokens the viewer resolves against the live bookings list, so an
anonymised booking reads "Data removed" with no pass over the log — only a
DELETED booking's entry carries `subject` plus an indexed `guestKey`, which is
one field to find it by and one field to erase. `lib/activity.js` decides what an
entry SAYS, `lib/activitySink.js` is the module-level hand-off every writer emits
into, `hooks/useActivityLog.js` writes and reads it. See the Rule-of-law
paragraph above and `database.rules.README.md`), `vouchers` (v18.0.0 — the 8th, a **keyed object `/vouchers/{CODE}`** where the CODE **is** the child key, so "a number exists at most once" is a property of the storage rather than a check somebody remembers; per-child `updatedAt`/`baseUpdatedAt` CAS exactly like `/bookings/$bid`, written by `useVouchers.js` through `lib/write-path.js`'s generic diff. **A voucher is never DELETED — only voided**, and that is enforced at three layers rather than by convention: the hook has no delete function, its patch builder logs and drops a `null`, and the rule's `.write` requires `newData.exists()`. The reason is `generateCode`, which excludes every code that has ever existed and can only do that because every code that has ever existed is still a child. The plan's own §1.6 draft rule copied `/bookings`' leading `!newData.exists() ||` disjunct, which short-circuits the whole predicate on a delete — correct there, and here it would free a number for re-issue to a second customer; restoring that draft fails exactly one emulator test. **The ledger is `redemptions/{bookingId}`**, keyed by BOOKING, which makes a redemption idempotent by construction — and `remaining` is RECOMPUTED as `value − redeemedTotal(ledger)` rather than decremented, because a decrement applied twice is wrong where a recompute is not. **A booking's half is the `voucherCode` field**, per-booking so the existing per-`$id` CAS covers it, and it must join **FIVE** lists, not three — see the Gotchas row), `bookings` (v15.5.0 — a **keyed object `/bookings/{id}`**, one child per booking; **v17.16.13: the CHILD KEY is that booking's identity of last resort** — `sanitize(b,key)` resolves `b.id || key || genId()` and `sanitizeAll` walks `Object.entries`, because mapping `Object.values` threw the key away and a row whose stored value carried no `id` field was minted a NEW id on every read. The write-diff then saw a create, `stampForWrite` stamped `baseUpdatedAt: 0`, the per-`$id` rule ACCEPTS that for a create, and the node grew by one booking per pass — measured 538→541 across four listener fires. It is CT-2B-06's block-id defect one collection over, except that a booking's identity was recoverable and was being discarded. A row stating its own `id` keeps it; only a row written by something else — an Admin-SDK backend, a console edit, a rules probe — reaches the key arm. The legacy ARRAY arm passes NO key: an index is a position, not an identity, each carrying a per-booking `updatedAt` stamp; written via per-child diff `update`, read back as an array via `sanitizeAll`'s `Object.values`; v16.3.0 whitelists `deposit`€ + `recurringId`/`recurringDate` occurrence stamps; v17.10.0 whitelists `guestId` — a per-booking field, so no new node and no rules change), `tableBlocks` (whole-array node under the `tableBlocksRev` CAS; **v17.15.3: each block carries an `id`, minted at READ time by `sanitizeBlocks` at BOTH read sites — the listener AND `resync()`** — and deliberately NOT written back by a migration pass: `saveBlocks` writes the whole array, so the first add or remove persists every id and the node self-heals. **v17.16.4 (CT-2B-06) found the hole in that last clause and made the mint DETERMINISTIC rather than closing it**: the REMOVE is the operation a legacy node breaks. A `genId()` mint answers "what read was this", not "which block is this", so two reads of one unchanged node disagreed about every id in it — and `removeBlock` filters on the id `BlockModal` captured when it opened, so a resync landing in between made Unblock a silent no-op. A legacy block's seed is now its own CONTENT (the field set + an ordinal, `bl_<hash>_<n>`), so two reads agree; **the ordinal is the first one NOT ALREADY TAKEN, against a set seeded with the ids the node already stores** (/code-review), because the invariant `removeBlock` depends on is that every id in ONE result is distinct and a content hash alone does not give it — `hash36` is 32-bit, so two blocks with different content can share a hash and both take ordinal 1, which is the v17.15.3 defect reintroduced by its own fix (constructed, pinned in the tests), and a mint can also land on a previously-minted id that `saveBlocks` has since persisted; `addBlock` still calls `sanitizeBlock(block)` with one argument and still gets a `genId()`, because a brand-new block has no stored identity to derive from. **Content and not array POSITION**, which is the whole of the choice: an index seed is stable only while nothing is inserted, and a stale index that resolved would resolve to a DIFFERENT block — turning a harmless no-op into unblocking the wrong table. A content key either finds the same block or finds none. It is a MINT, not a whitelist: `reason` is read by `DaySheet` and written by nothing, so a `sanitize`-shaped whitelist would silently drop it), `reminders`, `reminderFires`, `waitlist` (v16.0.0 — whole-array node, reminders-pattern loaded-guard, `useWaitlist.js`; **ref-mirror save** per the sync-echo gotcha below), `recurring` (v16.3.0 — 7th collection, whole-node object `{v, enabled, horizonWeeks, rules[]}`, standing-booking RULES; **`enabled` defaults OFF** — absent/legacy node reads as off, v16.3.0-correction; revGuard CAS `recurringRev`, `useRecurring.js`; occurrences are normal `/bookings` children generated by the App effect, NOT stored here), `roles` + `invites` (v18.0.0 phase 3 — the 9th and 10th, both
keyed objects on the per-child `updatedAt`/`baseUpdatedAt` CAS, `useRoles.js`
through the same generic `lib/write-path.js` diff; `extras` is an OBJECT keyed by
capability because rules cannot search an array, and its keys are SORTED on read
for `contentKey`'s key-order-sensitive compare. **A row carries TWO such maps.**
v18.0.0 phase 3 shipped `extras` alone, arguing a level should be a FLOOR so
"what can this person do?" is never a subtraction the reader holds in their
head; Patryk's call reversed it, because a level that cannot be reduced is a
minimum rather than a default and the restaurant's real answer to "this one
person should not be moving tables" was otherwise "invent a fourth level". So
`denies/{cap}` removes what the level grants, and the two are mutually exclusive
BY CONSTRUCTION — `setCapability` clears both and picks one from
`levelGrants(role, cap)`, so the screen only ever asks "should this person have
this?" and "why can't they do X?" has exactly one answer. Three consequences
that are easy to get wrong: a deny is a PRESENT `true` and never `false`,
because the rules test `.val() !== true` and must not have to tell absent from
false; `can()` checks the enforcement flag BEFORE the deny, so a deny stored
while experimenting cannot leak out through a switch that is off; and
`isAdminEntry` checks the deny FIRST, which is the whole of the last-admin
invariant surviving — without it an admin strips their own `settingsAdmin` by
writing a deny, and `wouldRemoveOwnAdmin` sees `role: "admin"` on both sides and
reports no change at all (same clause, same order, in the rule). **And
`GATED_CAPS` became every capability**: it used to be the complement of the
staff floor, which was right while extras could only add, and a deny can remove
any of the eighteen — so the seven that had never needed a gate (take, edit,
status, move, block, waitlist, redeem) got one in the same commit, and
`tests/roles.test.js` fails the build until they have. **`CAPABILITIES` is EIGHTEEN
entries in four groups, not the thirteen the plan drafted**: Patryk's call
during phase 3 split `settingsWrite` — which had been one tick covering "hours,
layout, defaults and reminders", four decisions of very different weight — into
`reminderManage`, `recurringManage`, `hoursEdit`, `layoutEdit` and what was
left, plus `dataExport` for the backup. Each keeps `manager` as its floor, so
the split changed nobody's access on the day it shipped and only made the access
separable afterwards. Two consequences worth carrying: a Settings TAB stopped
being one capability (`SETTINGS_TABS.caps` is a LIST and `visibleTabs` tests
ANY, with `GeneralTabContent` gating its own sections, or holding `hoursEdit`
alone would have shown every control on that tab); and `dataExport` is the one
gated capability with no rule behind it, because the backup is built
client-side out of reads and `.read` is `auth != null` at the root — the
capability list states that rather than letting the enforced chip imply
otherwise. **No empty-collection guard, and
that is deliberate**: `/roles` legitimately reaches zero — it starts there — and
a role row is one line an admin retypes, where an empty `bookings` or `vouchers`
write destroys records nobody can reconstruct), plus **eight** `settings` objects (all restaurant-wide config → **shared** across devices; v18.0.0 adds `settings/voucherDefaults` — `{v, expiryMonths}` + `voucherDefaultsRev`, `useVoucherDefaults.js`, the default validity period with `0` meaning never. Named `voucherDefaults` and NOT `vouchers` for this repo's own precedent: `/bookings` has `settings/bookingDefaults` and deliberately not `settings/bookings` — two paths a character apart, one holding records and one holding config, is a trap the codebase already declined once): `settings/operatingHours` (#1, v14.4.0 — **per-weekday** `{days:{0..6}}` since v15.0.0), `settings/dayShifts` (#2, v14.6.0 — `{split, enabled}`), `settings/optimizer` (#3, v15.0.0 — `{cutoff, autoSwitch}`), `settings/layout` (#4, v15.0.0 — `{tables, joinGroups, comboCaps, megaCombos, kitchenLimit}`; + `priorities` v15.9.0 — the data-driven optimizer heuristics), `settings/general` (#6, v17.0.0 — `{v, restaurantName, currency, phonePrefix, regularMin, lateCollapseMax, waitMatchWin, undoSecs}`; revGuard CAS `generalRev`; `useGeneralSettings.js`), and `settings/bookingDefaults` (#5, v16.1.0 — `{v, tiers:[{max,dur}…], restDur, lateEnabled, lateWarnMin, lateNoShowMin, freeSoonEnabled, freeSoonWindow}`; a present node's missing `tiers` array = EMPTY (RTDB drops empty arrays — the priorities lesson), never the default; `freeSoonWindow` (v16.3.0-correction) = the table-turn prediction window in minutes, 5–60 step 5, default 15; `useBookingDefaults.js`), `settings/admin` (#10, v18.0.0 phase 3 — `{v,
enforceRoles, modules}` + `adminRev`, and the ONLY settings node that is
admin-only in the rules unconditionally; it lives in `useRoles.js` rather than a
hook of its own, because `can()` is meaningless without the flag and the flag is
meaningless without `can()`. **v18.0.0 phase 4 adds `modules`, and it needed NO
rules change** — a new FIELD on a node already admin-only to write and carrying
no `.validate`; a new NODE would have needed both a CAS and its own `.write`
grant, which is why the registry lives here rather than at `/modules`. Two
consequences of the node now having more than one field: every writer sends the
WHOLE node under the rev CAS, so both go through one `writeAdmin(fields)` that
MERGES onto an `adminRef` mirror — `setEnforceRoles` built its payload from its
own argument alone, which was correct with one field and would have silently
reset `modules` on every toggle — and the listener assigns that mirror on the
line above its `setState`, where a stale one would not be a skipped field but
the OTHER switch reverting). **v17.6.0 supersedes the old "per-device preferences never go in Firebase" rule.** `settings/users/{uid}/prefs` (#8, `useUserPrefs.js`) is the documented exception: it is per-USER, not restaurant-wide, and carries theme · reduceMotion · planGestures · navLocked · splitEnabled so a user's setup follows them to any device. **`localStorage` still holds all five as well, and that mirror is load-bearing** — `index.html`'s no-flash script reads `mgt-theme`/`mgt-reduce-motion` before React mounts and long before Firebase or auth resolve, so dropping it flashes the wrong theme on every load. localStorage = pre-mount cache, node = source of truth. Genuinely per-DEVICE settings (app width, the 4 Timeline zoom values, the saved split layout) stay `localStorage`-only, because they are properties of the screen. All six use the loaded-ref write-guard (small objects, so the empty-array guard doesn't apply — except `useLayout`, which additionally refuses an empty-`tables` config); see `useOperatingHours.js` / `useDayShifts.js` / `useOptimizerSettings.js` / `useLayout.js`.

**Single central save path:** route every mutation of a collection through one helper (e.g. `bookingsAfterAction`) so future conflict-detection / re-derivation has one hook point.

**App-code patterns are in `src/CLAUDE.md`:** the operating-hours and layout live module
bindings, the customer layer, waitlist matching, the module registry, per-user
preferences, the turnaround buffer, optimizer cutoffs, `bookingsAfterAction` as the
central save path (and its one exception, `undoLastAction`), the fixed shell, Split
View, the unsaved-changes guard, and `formRef.current` vs `form`.

---

## UI / style rules — see `DESIGN.md`

The visual system moved to **`DESIGN.md`** in v17.13.0: surfaces and glass,
theming and the token families, the three label treatments, the shadow 2×2,
hover / press / motion, the icon set's house style, and the accessibility
contract. It was 57% of this file, and none of it is needed to answer a
question about the optimizer, the write guards or the data shape.

**Read `DESIGN.md` before changing how anything looks or behaves on screen.**
What stays here is the short list that ships a bug when unseen:

- **≤4 simultaneous `backdrop-filter: blur()`.** This was a real production
  perf bug on the tablet (51 instances). Reuse the `Overlay` atom rather than
  adding a blurred surface.
- **Every modal uses `Overlay`**, which owns the blur, the mobile-sheet /
  desktop-card branching, `role="dialog"`, the focus trap and focus restore.
  **"Every" became literally true in v17.15.0**, and `tests/a11y.test.js`
  enforces it structurally: `var(--scrim)` may appear in exactly ONE file. A
  modal needing to sit above another is wrapped in a positioned div with a
  higher z-index (ReminderEditor 250, the discard confirm 260) — never given a
  hand-written scrim. The popups paint `--tl-popup-scrim` instead, because a
  popup is not a dialog and must not claim to be one.
  Escape is NOT handled there — `useKeyboardShortcuts` owns it, and it never
  touches a mount-site `onClose`. Since v17.14.0 it acts on the topmost entry
  of the modal STACK (`MODAL_Z` in `useModalStack.js`, the z-order as data) via
  the `escapeAction` table, so a surface's guarded close is named once.
- **No colour literal in JS.** Every colour is a `var(--…)` token; see the
  marker list above for the deliberate exceptions.
- **A colour token may only sit on a surface that flips with it.** The
  `--*-text` tokens invert between themes; on a hard-coded pale fill they
  invert out from under themselves. Triage a colour exactly like a shadow: ask
  whether the SURFACE UNDER it flips.
- **Accessibility is enforced by `tests/a11y.test.js`** (v17.13.0), and three
  of its rules were learned by shipping their violation: `role="button"` never
  goes on a container of controls (a button's children are presentational);
  `inert` marks the page BEHIND a dialog, never `<main>` (which holds the toast
  live region); and a live region must already be in the DOM when its content
  changes. Adding a role also SUBSCRIBES the element to every shared CSS rule
  written for that role — grep `src/index.css` before adding one, especially to
  an SVG.
- **A hidden control can be present and useless in ways nothing shows you**
  (v17.14.0's skip link). Hiding it with `display:none` or `visibility:hidden`
  makes it unfocusable, so it can never be reached while looking correct in the
  source — hide by TRANSLATION. A fragment link moves focus to its target only
  if the target can hold focus, so `<main>` carries `tabIndex={-1}`; without it
  the page scrolls and the next Tab starts from the header again, which looks
  exactly like the link working. And it must sit OUTSIDE any subtree that takes
  `inert`, for the same reason a live region must.
- **Making something focusable makes the browser scroll it into view on
  mousedown**, which moves it out from under the finger — see the Gotchas table in `src/CLAUDE.md`.

---

## Workflow

### Versioning & the ship flow — see the `mgt-workflow` skill

- Version source of truth: `src/App.jsx` → `__APP_SIGNATURE__.version`. **Every meaningful change bumps it**, in the same branch/PR.
- One version per branch, one branch per PR, branched off fresh `main`. The full step-by-step (branch naming, bump, REFACTOR_LOG entry, build, PR, verification suite) lives in the **`mgt-workflow` skill** — load it before any edit under `src/` or any commit/branch/PR.
- `gh` CLI is at `/opt/homebrew/bin/gh` (not on `$PATH`).
- Interactive git flags (`-i`) aren't supported in this environment.
- **Commit as you go; push only when asked.** A finished, green change gets its own
  commit without waiting for permission — one change per commit, never bundled. Pushes,
  PRs and merges are the opposite: explicit every time, never a standing permission. If
  you're on `main`, branch first. Full rules in the `mgt-workflow` skill (§8).

### Local dev server — `npm run dev` ONLY (LOCKED)
- **Every coding session sets up BOTH a localhost dev server (`npm run dev`, DEV Firebase) AND the Preview bridge** (`preview_start` on the dev URL) at the start — not just for visual changes — so any change can always be verified live before declaring it done. The "skip the server" note below is subordinate to this: for pure-logic/doc/planning work the pair comes up the moment edits begin.
- For any session that touches **visual code**, start `npm run dev` at the start and keep it running; tell Patryk the localhost URL. Vite HMR is <1s; suggest ⌘⇧R if an edit doesn't appear.
- **Never run `npm run preview`.** `npm run dev` only — it hits the **DEV Firebase project** (the safe sandbox). Prod-build verification is **Patryk's** job; Claude never loads the production app.
- DEV is the sandbox by design — never click Save against PROD data while inspecting. The split is enforced in `src/firebase.js` via `import.meta.env.DEV`; **never bypass it.**
- **Skip the server** for pure-logic/hook changes with no visual surface, doc-only commits, and planning/exploration (start it once edits begin).
- DEV sign-in `auth/invalid-credential` on localhost is almost always environmental, not a code bug.

### Trigger phrases — see the `mgt-workflow` skill
Already lazy-loaded and covers the exact same phrases ("give me the deployment version", "give me changelog", "sum up this thread") with the same file-naming and dual-folder rules — this section used to duplicate it verbatim.

## Common operations

### Debugging
- **Version mismatch:** DevTools console boot banner; `window.__MGT_BUILD__`.
- **Firebase issues:** Firebase Console for live state; console for `[SAFE]` refusal logs and the `[firebase] DEV/PROD` badge.
- **State inspection:** React DevTools (BookingApp's state tree).
- **Re-render storms:** React DevTools profiler. Common culprit: an un-memoised derivation in BookingApp (no `React.memo` in use yet — add only when profiling proves need).

---

## Gotchas and constraints

App-code gotchas (state and effects, components, accessibility, gestures, motion, the
WhatsApp client code) are in `src/CLAUDE.md`, test-suite gotchas in `tests/CLAUDE.md`,
and measurement traps in the `mgt-measurement-traps` skill. The rows here apply
repo-wide: data writes, the service worker, CSP, database rules, the build, secrets.

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
| `mkInp`/`mkBtn` | Return **style objects** in Bookings (not JSX) — no prop passthrough |
| Worktree paths | In a worktree session, Edit/Read absolute paths must include `.claude/worktrees/<name>/…` or they silently target `main`'s checkout |
| Firebase `set()` inside a setState updater | **Corrupts data, not just doubles writes** (proven live, v16.0.0): RTDB fires local listeners synchronously on `set()`, the echo lands mid-update, StrictMode re-applies the queued updater on echo state → a concat updater persists the entry TWICE. Use the ref-mirror shape (`useWaitlist.js` / `useReminders.jsx`): compute from a ref, then `setState` + the write as plain statements. **v17.16.0 corrects what this row used to claim.** It said "All hooks are converted as of v16.0.0 — never reintroduce the updater-side write", and that was false of the most important write path in the app: `saveBookings` / `saveBlocks` (`usePersistence.js`) call `persist(prev,computed)` — which performs the `update()` — from INSIDE their `setBookings` updater, and always have (CT-2A-09, v17.15.7 crash test). **The corruption this row was written about has not occurred there, and the reason is worth knowing rather than trusting**: v15.5.0's per-child diff `update()` is IDEMPOTENT (the same patch applied twice writes the same children the same way) where the whole-node concat `set()` that caused the v16.0.0 incident is not, and the StrictMode double-dispatch is separately caught by `lastPatchSigRef`'s 2s content+base signature. So it is MITIGATED, not structurally removed — two defences either of which could be edited away by someone who read this row and believed the shape was already gone. **v17.16.10 closed it (CT-2A-09) and there is now NO exception**: both functions compute from a `bookingsRef` / `blocksRef` mirror and then `setState` and write as plain statements, the `useWaitlist.js` shape. So this row is once again what it claimed to be in v16.0.0 — except that it is now true. **The invariant that replaces the mitigation:** every `setBookings` / `setTableBlocks` in `usePersistence.js` assigns its mirror on the line above it (four and three respectively); a new set site that forgets one hands the next save a stale `prev`, and the diff would read that as fields changing BACK, so it would write rather than skip. Two things the conversion fixed beyond the rule: `saveBookings` returns a `dispatched` boolean read on the line after the write, which only appeared synchronous because React EAGERLY evaluates the first update on an idle fiber — an internal optimisation, not a contract, and the same one that invokes the updater a second time at render, which is the dev double-dispatch `lastPatchSigRef` exists to absorb |
| A new per-booking FIELD | It has to join **FIVE** lists, not the three `booking-logic.js` holds, and the last two are the silent ones. `sanitize`, `UNDO_FIELDS` and `diffBooking` make a field survive a READ, an undo and a history entry — **none of them makes it get WRITTEN.** `doSaveNew` and `doSaveEdit` build the booking object field by field and `openEdit` builds the form draft the same way, so a field missing from those three never reaches storage at all. Found in v18.0.0 by RUNNING the app: `voucherCode` was in all three lists, every test passed, and attaching a voucher then completing the booking produced no redeem prompt because the stored booking had no `voucherCode`. **The `openEdit` one is the dangerous one and would have shipped silently** — without it, opening and re-saving any booking WIPES the field, which is `UNDO_FIELDS`' failure mode one layer up and invisible until somebody edits a booking that had one. `deposit` is in all five, which is what makes them findable; `tests/booking-logic.test.js` now scans `App.jsx` for the pairing (three site-specific assertions plus the general rule that any line setting `deposit:` and `status:` together must set the new field too), proven by sabotage — removing the `openEdit` seed fails two tests where all 921 passed before |
| Recurring occurrence ids are DETERMINISTIC | `"r"+ruleId+"_"+date` (path-safe: hyphens/underscores OK in RTDB keys). Idempotency + cross-device convergence rely on this + the `recurringId`/`recurringDate` stamps: two devices generating concurrently produce the SAME id, and the 2nd create is rejected by the per-`$id` `updatedAt` CAS (baseUpdatedAt 0 vs stored). Never make occurrence ids random |
| A shipped service worker CANNOT be withdrawn by deleting it | An installed SW keeps controlling the page forever; removing `/sw.js` from the deploy does **not** unregister it, and a revert cannot reach the device. The only remote fix is to ship a worker at the SAME URL whose `activate` clears the caches and calls `registration.unregister()` (browsers re-fetch `/sw.js` on navigation for any live registration) — that is what `public/sw.js` is now. This is the single most important thing to understand before ever registering one again: a SW bug is **not** revertible, unlike every other client change in this app |
| A SW must be testable on the target device before it ships | v17.4.0's worker froze the app at "⟳ Loading bookings…" on **iPhone and iPad** while desktop was fine, and it was never reproducible locally (a PROD-mode build against DEV data loads clean on desktop). It was PROD-only by design, so DEV could not exercise it at all — the one component in the release with no possible pre-deploy verification, which is exactly the one that broke. Don't ship a PROD-only code path to the restaurant's devices without a way to run it on one |
| CSP `connect-src` does NOT cover the RTDB fallback | Firebase RTDB has two transports. WebSocket is `connect-src`. The **long-poll fallback is JSONP** — it injects `<script>` tags into a hidden iframe, so it is governed by **`script-src`**, which is `'self'` + one hash in `vercel.json`. Worse, the SDK caches a single WebSocket failure in `localStorage["firebase:previous_websocket_failure"]` and then prefers long-poll on that device **forever**, so one wifi blip permanently bricked the Android tablet while identical devices were fine. v17.5.1 fixes it with `forceWebSockets()`. Widening `script-src` was tested on the affected device and is **insufficient** — the `.lp` requests then return 200s and the app *still* never loads. Don't "fix" this by loosening the CSP |
| The CSP pins the inline boot script BY HASH | `vercel.json`'s `script-src` is `'self'` plus one `sha256-` of `index.html`'s inline `<script>`. **Edit that script without regenerating the hash and the browser silently blocks it in production** — build passes, lint passes, nothing throws. It had already happened before v17.10.1: the pin had drifted, so the no-flash theme script, the `data-motion` stamp and the passive `touchstart` listener (the only reason `:active` works on iOS) were all dead in PROD. `tests/csp.test.js` now fails on a drifted or stale pin and checks the built block still matches the source, since Vite processes that file. Regenerate from a sha256 of the exact bytes between the tags. Note also that **inline event handlers (`onclick=`) are blocked by the same directive** — use `addEventListener` in that script |
| A rule that has to COUNT children | RTDB has no `numChildren()`. `hasChildren()` answers "any at all", and there is no iteration, no query and no string manipulation — so "never leave `/roles` with no admin" is not expressible as written, and neither is "claim the invitation matching my email". Both were in an approved plan. **The move is to find the DERIVED invariant that IS expressible**, not to build the state the literal reading needs: v18.0.0 refuses an admin stripping their OWN admin, which makes zero unreachable because only a holder may write `/roles` at all — one clause, no counter node, nothing to drift. The rejected alternative is worth knowing because it looks reasonable: a maintained `adminCount` with delta validation IS expressible, and it turns every role write into a 2-path atomic update whose repair path is the exact Firebase-console step the guard exists to avoid |
| A predicate repeated across sibling rules | `database.rules.json` has no macros, so v18.0.0's `settingsWrite` gate is written out SIXTEEN times, once per `settings/*` rule. That is this repo's most-repeated defect shape ("any set of facts written out N times will be written out N−1 times by somebody") landing in a file where it cannot be refactored away. Two mitigations and both are needed: APPLY it by script asserting each substitution lands exactly once, and SWEEP it in the emulator suite over a list DERIVED from the rules file, so a pair added later is covered without a test edit. A hand-typed sixteenth copy and a hand-typed test list are the same bug twice **v18.0.0 phase 3 adds the half a derived sweep CANNOT see.** The gate was re-pointed on four settings pairs (`operatingHours`/`dayShifts` → `hoursEdit`, `layout` → `layoutEdit`) and the sweep did not notice, because it drives a STAFF account and staff holds neither capability — sixteen rules could all still have named `settingsWrite` and every assertion would have passed. A sweep proves the gate is PRESENT; only an account carrying exactly one capability as an extra proves it is the RIGHT one, and the second half of that test is the load-bearing one: an account holding every capability EXCEPT the path's own must still be refused, or a rule left on the old name passes because a manager holds both. |
| Inlining CSS or JS into `index.html` | `public/sw.js` is **network-first for navigations** and **cache-first for `/assets/*`** — so anything inline in the HTML is re-downloaded on EVERY app open, forever, while a hashed asset is fetched once. The stylesheet was 89 kB of a 100.5 kB file for that reason (33.7 → 4.6 kB gz when it moved out in v17.15.1). Inline ONLY what must run before the bundle: the no-flash theme script, which is why it alone stays and carries the CSP hash. `tests/stylesheet.test.js` fails if a `<style>` block reappears |
| A dynamic `import()` inside a branch the bundler folded to dead code | **Still emits its chunk.** Phase 5b moved the simulator out of the entry and stopped there, on the reasonable-sounding basis that the chunks were unreachable — and `WaSimulator-*.js`, `wa-sim-*.js` and `wa-sim-scenarios-*.js` went on being written to `dist/` and served from the restaurant's CDN. Unreachable is not absent, and for developer tooling on a production deployment the second is what you want. `vite.config.js`'s `stripSimulator` plugin resolves the four simulator modules to one throwing stub in a production build, keyed on the SAME condition as `WA_SANDBOX` (`command === "serve" || VITE_FB_TARGET === "dev"`) because two conditions that merely agree today are two conditions. Verified in all three environments — dev server keeps it, a `VITE_FB_TARGET=dev` build keeps it, a production build has none of it — and note the entry chunk GREW 11 kB doing so, which is re-chunking rather than weight: `booking-logic` stopped being shared with the sim chunks and folded back in, taking eager boot bytes 123.33 → 121.09 kB gz |
| A generated file that also exists in `public/` | Vite copies `public/` **after** the bundle is emitted, so a `generateBundle` asset of the same name is silently overwritten by the source file — no warning, no error, and the built output is simply the un-generated one. Write it in **`closeBundle`**, which runs last (v18.0.0 phase 6's `tenantManifest()`, which derives `manifest.webmanifest`'s restaurant name from `src/tenants/<slug>.js`). Two more facts from that plugin. **A `vite.config.js` import of a project file must be an ABSOLUTE file URL**: Vite bundles the config into `node_modules/.vite-temp/` before running it, so `import("./src/tenants/mgt.js")` resolves against THAT directory and fails on a path that has never existed — `process.cwd()` is the project root in both `serve` and `build`. And **generate in BOTH modes from ONE loader** (a `configureServer` middleware plus `closeBundle`): a build-only generator leaves the dev server serving different bytes from production, which is the "two conditions that merely agree today are two conditions" rule this config already states about `stripSimulator` |
| A timestamp taken from a remote party | `parseInt(m.timestamp, 10) * 1000` on a Meta webhook field, guarded by `m.timestamp ? … : Date.now()` — a ternary that covers ABSENT, which is the one case that was never a problem. Measured against the emulator with correctly-signed payloads (CT-WA-02): `"abc"` → `NaN` → **RTDB refuses the write**, the message throws, the handler takes its total-failure branch and answers **500**, and Meta redelivers a 500 for up to SEVEN DAYS — identically, so the customer's message is never stored and the function is invoked on a schedule for a week. A poison pill with a bill. `"-1"` → `windowExpiresAt` in 1970, so `api/wa-send` answers 410 forever and staff can never reply to that customer, with nothing on screen saying why; `99999999999` → a window in the year 5138. **Correct retry semantics plus a permanently-failing input is a retry loop**, and the input reaching a value the database REFUSES is what turns a bad field into a bad week. Clamp to facts, not policies: not finite or not positive → now; the future → now (a delivery cannot be timestamped after it arrived, so it only absorbs clock skew); an OLD timestamp is left alone, because a redelivery after an outage is real |
| A new field on a VOUCHER | `sanitizeVoucher` is a WHITELIST, so a field missing from it is deleted by the next write to that voucher — silently, with no error anywhere. v18.0.0 session 8 added `reversals` (the record a restored balance leaves) and the whitelist line is what makes it survive; without it the trail would be erased by the next unrelated edit to the same voucher, which is `UNDO_FIELDS`' failure shape one collection over. Sort the keys of any new MAP you add, for `sortedLedger`'s reason: `write-path.js`'s `contentKey` is a key-order-sensitive `JSON.stringify` compare, so an unsorted map read back from RTDB reads as a change and writes on every pass. The test that catches the whole class is "do an unrelated write to the same voucher afterwards and assert the field is still there" |
| Deleting a voucher | **Never — void it.** The code IS the child key, so a delete frees the number for re-issue, and the rules refuse the delete outright. The reasoning is in *Persisted collections* (`vouchers`) above; this row exists so the trap is findable where traps are looked for, not to restate it |
| `undefined` as a property value on the way to Firebase | **It throws.** `set()`/`push()` reject an object holding an undefined property, so building an entry with `auto: opts.auto === true ? true : undefined` makes every human-originated write throw inside the writer. In v18.0.0 session 8 that would have been swallowed by `emitActivity`'s own try/catch — which exists so a broken log never disturbs the write it describes — and the feature would have silently logged nothing at all, with the safety net hiding the bug rather than surfacing it. **A swallowing boundary and a throwing payload are individually reasonable and jointly invisible.** Optional keys are OMITTED (`clean()`), which is also what the rules want: `auto` validates `=== true`, and RTDB has no key for an absent one |
| A secret — an API key, a token — in the database | **Never.** `.read` is `auth != null` at the root, and read permission cascades down and cannot be revoked at a child, so anything stored in RTDB is readable by every account that can sign in. Keys live in the deployment's environment variables. The reasoning is in the Integrations paragraph of the module-registry section in `src/CLAUDE.md`; this row points at it |

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
- **Measuring through the Browser pane.** Load the `mgt-measurement-traps` skill before trusting a reading taken through automation — synthetic presses, automation-tree names, drags, DEV StrictMode timing and a truncated lint summary have each produced a confident wrong answer here.

---

## Out of scope

- ~~**Multi-tenancy** — single-restaurant app; no plans to generalise.~~ **Superseded by v18.0.0.** The app is ready to be a second restaurant's app without a rewrite, under the model chosen on 2026-07-03 — one codebase, **one Firebase project per restaurant**: `VITE_TENANT` selects `src/tenants/<slug>.js`, `settings/admin.modules` is the per-restaurant lever, and credentials live in each deployment's environment variables. All five phases of the design's checklist have shipped; the design and its dated revision block are `…/megustastu-bookings context/MGT_Bookings_Multi-Tenancy_Design.md`. What stays out of scope is the OTHER model — one database namespaced by tenant — until that document's §9 triggers fire.
- **Mobile app** — web-only; mobile is responsive layout (`useWinW` → `isMobile`).
- ~~**Tests** — no test suite~~ **STALE since v17.3.2** — the Vitest suite, its CI gates, the rules-emulator suite and their gotchas are in `tests/CLAUDE.md`.
- **TypeScript** — pure JavaScript; no plans to migrate.
- **Storybook / component dev environment** — components are developed against the live (DEV) app.

---

## Future work

Pending/deferred work moved to **`ROADMAP.md`** (repo root) — see that file, not
here. Shipped version history lives in `REFACTOR_LOG.md`.

---

*Keep this file lean — it's auto-loaded by Claude Code and attached to fresh threads.*
