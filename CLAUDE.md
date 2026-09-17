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
                                     security rules entirely — see the CAS exemptions under the Rule of law below, which are about exactly
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
    // …then the write itself — for bookings a per-child diff update(), NEVER a whole-node set() (see 5 below)
  }
  // ... resolve `next` (value or updater fn), then persist
}
```

**Origin:** post-v13-deploy data-loss incident. Auto-extend effect fired `saveBookings([])` on mount before `onValue` returned. The pattern was retrofitted to all Firebase writes.

**The guards, in the order a write meets them.** Mechanics: `src/hooks/usePersistence.js` and its pure core `src/lib/write-path.js` (per-file notes in `src/hooks/CLAUDE.md` and `src/lib/CLAUDE.md`). How each guard was found is in `REFACTOR_LOG.md` under the version named.

1. **Loaded + non-empty** — the pattern above.
2. **Freshness / resync gate (v15.2.0).** Origin: a laptop asleep with the tab open woke and wrote its stale snapshot over a night of tablet bookings before the reconnect's fresh `onValue` arrived. A 10s heartbeat bumps `lastBeatRef`; a gap `> STALE_GAP_MS` (90s — must stay ≫ the heartbeat, or every beat false-trips it) means the event loop was frozen. The gap is checked **at write time**, before any `setState`, so a post-wake write is refused race-free. `markStale()` sets `staleRef` and the `resyncing` banner; `resync()` force-pulls `bookings` + `tableBlocks` with `get()`, gated on `isConnectedRef` (an offline `get()` can serve the stale cache). A gap trip also resets `isConnectedRef` (`gapTrip()`, v16.0.0), because on wake it still holds its pre-sleep `true`. The gate clears on a live `onValue` or a successful `resync()`; resume events (`focus`/`pageshow`/`visibilitychange`) are gap-gated nudges, and brief network blips never trip it, so offline editing is untouched.
3. **Server-side compare-and-swap (v16.0.0).** Greater-than `updatedAt` stamps were last-writer-wins, not staleness protection — on 2026-07-05 a sleeping laptop's wall clock let a stale snapshot overwrite a night of status changes. Every write now **proves it was based on the data it overwrites**:
   - **Per-child nodes** (`bookings`, `vouchers`, `roles`, `invites`): `stampForWrite` writes `updatedAt` (monotonic per device and above the last-seen server value, so clock skew cannot block it) plus `baseUpdatedAt`, the version this device last saw. The per-`$id` rule requires `baseUpdatedAt === stored updatedAt`, and `baseUpdatedAt === 0` on a create (v17.16.1, CT-2A-01 — the old `!data.exists()` disjunct short-circuited the CAS, so a stale edit naming a DELETED version brought a cancelled booking back). Deletes stay unconditional; a multi-path null carries no base. `baseUpdatedAt` is per-write metadata, deliberately NOT in the `sanitize` whitelist.
   - **Whole-node collections** (`tableBlocks`, `waitlist`, `reminders`, `reminderFires`, `recurring`, `templates`, the nine `settings/*` nodes and `settings/users/$uid/prefs` — sixteen pairs): `src/lib/revGuard.js` — a sibling `<name>Rev` integer and an atomic `update({node, nodeRev: base+1})`; the rule rejects anything but +1. The SDK rolls a rejected write back and re-fires the listeners; rev refs advance optimistically (back-to-back writes chain +1, +2).
   - **Rules shape (v17.16.7):** there is NO root `.write` — RTDB write permission cascades DOWN and cannot be revoked lower, so every writable path carries its own grant, and every rev CAS sits in `.write`, which IS evaluated for a delete where `.validate` is not (CT-2A-06: a `remove()` that skipped the rev). `bookings` has no grant and `bookings/$bid` has one (CT-2A-04) — **the app makes no whole-node `bookings` write anywhere.**
   - **Per-field `.validate` on a booking** (`name`/`date`/`time`/`size`/`duration`/`status`/`tables`) means "if PRESENT, the right shape", never "must be present", because `sanitize` fills every gap on read. `date` and `status` are pinned as `matches(<pattern>) || newData.val() === data.val()` (v17.16.11): a stored value carried through unchanged is always allowed, and only a new or changed value must be well-formed — which is why it needed no audit of PROD. The date pattern is an OPTIONAL GROUP, `/^([0-9]{4}-[0-9]{2}-[0-9]{2})?$/`, because `""` is a shape `sanitize` emits and the RTDB regex engine rejects a mid-expression `^`. `time` stays unpinned — `isReadableTime` accepts `"9:30"`/`"13:00:00"`/`":"` on purpose — and table ids are not checked against the layout; both would refuse writes to data that already exists.
   - **StrictMode dedupe:** `lastPatchSigRef` drops a dev double-dispatch only when both carry the same (content, `baseUpdatedAt`) signature within 2s. When the double-invoked updater reads two different `prev` values, the stale dispatch is correctly CAS-rejected — DEV noise, never a data risk. Keeping `baseUpdatedAt` in the signature is pinned (CT-2A-08); without it two patches are indistinguishable to the server.
   - A rejected write recovers through `.catch → markStale → resync → drainPending`. Deploy is **app first, rules second** (rolling-safe) — see `database.rules.README.md`.
4. **Save feedback + retry (v15.4.0, v15.6.0, v15.7.0, v17.16.9).** `saveBookings`/`saveBlocks` return a boolean (`true` = dispatched) and every handler gates its success UI on it — `const ok = saveBookings(fn); if (ok && …) flash();` — so a refused write is **never** shown as saved. The red `setWriteWarning` banner is reserved for hard failures (not loaded, empty array, retries exhausted). A held or server-rejected **function-form, non-silent** write parks in `pendingRetriesRef` and replays on fresh data after `clearStale()`, up to `MAX_RETRIES` (3), after which it waits in `parkedRef` for the banner's retry/discard. **Value-form and silent writes never queue** — replaying a precomputed array would re-write stale data; they recompute next tick. A held write is applied to local state at once, and `drainPending()` runs from both `resync()` and the live `bookings` `onValue`, so a fresh snapshot cannot wipe the optimistic change. `doSave` uses the function form too (v15.7.0): intent is captured once (`genId()`, the edit fields), a pure `buildNext(prev)` replays it on whatever `prev` arrives, the synchronous guards (capacity/displacement/no-table) run once against `const fin=buildNext(bookings)`, and `applyBase` filters out `newId` before `concat`, so a replay cannot duplicate.
5. **Per-booking storage + diff-write (v15.5.0).** `bookings` is a keyed object `/bookings/{id}`, so two devices editing different bookings — even both offline — write disjoint paths and Firebase merges them. A save computes from the `bookingsRef` mirror (never inside a `setState` updater — Gotchas) and sends a multi-path `update(ref(db,"bookings"), patch)` of changed children plus `{id: null}` deletions; an empty diff writes nothing, and `bookingChanged` ignores `updatedAt` so a server echo is not a change. A legacy **array** node is migrated once (`migratedRef`, connected-gated) by a multi-path `update()` of children, and `arrayShapeRef` holds per-child writes until the keyed shape echoes. Two ordering details in that migration are load-bearing: old keys are read off the SNAPSHOT (so a row `sanitizeAll` dropped is still cleared), and the keyed rows are `Object.assign`ed OVER the nulls (so an id equal to an old index is not deleted by the patch writing it).

**Post-sync conflict reconciliation (v15.6.1).** The per-node merge keeps both devices' offline bookings, but each device's optimiser placed tables without seeing the other's, so an offline double-booking **overlaps once synced** — and sync stores the snapshot verbatim. An effect in `BookingApp` runs `src/lib/reconcile.js`: `dirtyDates` (dates `≥ today` failing `verifyClean` — a clean sync writes nothing), then one **silent** function-form `saveBookings` — a full reshuffle where `optimizerActiveFor`, otherwise relocating only the newest non-locked conflicting booking (`updatedAt` desc, id tiebreak — deterministic across devices; `findConflicts`) via `forceReassign`, at most 20 passes. `_locked` bookings are never moved, and an unplaceable booking drops out so the loop ends. It is gated on `!resyncing` and on the real loaded signal: **`loadBannerShown` is NOT a loaded flag (it auto-hides after 6s) — use `firstLoadCount` (a ref, null until loaded).** It must compare content, never identity: `bookingsAfterAction` returns its input array when nothing moved (`src/CLAUDE.md`'s Gotchas row on an effect that dispatches a new array every run). The `syncFix` toast shows only when something changed.

**Auto-effects** (anything that writes Firebase without direct user action) must pass `isSilent=true` to suppress the user-facing banner on refusal.

**Rule of law: any NEW persisted node must ship with (1) either a per-child stamp CAS or a `revGuard` rev pair — never a bare `set()` — and (2) its own `.write` grant in `database.rules.json`, or it is simply unwritable** (which fails loudly in DEV rather than working there unguarded in PROD). **The grant requirement has no exemptions.** Skipping the CAS is allowed only where the test "can a rule actually bind every writer of this node?" says a CAS would be pointless or unnecessary — and the list of such shapes is closed:
- **Ephemeral per-connection nodes — `presence`** (`usePresence.js`): each connection writes only its OWN push-key child and self-removes via `onDisconnect().remove()`; the staleness prune deletes other devices' children only once a missing heartbeat proves them dead, which is idempotent. Its grant is an explicit `auth != null` on `presence/$key`.
- **Nodes whose principal writer is the Admin SDK — `conversations/$phoneKey`, `messages/$phoneKey`**: `api/_lib/rtdb.js` writes through firebase-admin, which bypasses rules ENTIRELY, so a CAS would constrain only the browser — a pin that looks like a guarantee while guaranteeing nothing. The grant sits at `$phoneKey`, not `$phoneKey/$mid`: permission cascades down, so one grant covers per-message writes and deleting a conversation while a whole-node wipe stays denied (hence `clearAllWaData()` deletes per key). `templates` and `settings/whatsapp` have one writer each and DO use rev pairs (`templatesRev`, `whatsappRev`).
- **Append-only nodes — `activity`**: nothing can ever be rewritten, by anyone, which is stronger than a CAS rather than an exemption from one. The rule binds the only writer, the browser, on three clauses: `uid === auth.uid` and `email === auth.token.email` refuse an entry written as somebody else, and `at === now` one filed at a time of the author's choosing. Deleting is admin-only and per entry — the node itself has no `.write`, so it cannot be wiped in one call — and serves both a range clear and the retention prune, with a compensating log line that a clear happened.

Nothing else skips a CAS.

**Persisted collections** (authoritative paths and predicates: `database.rules.json`; per-hook notes: `src/hooks/CLAUDE.md`):
- **`bookings`** — `/bookings/{id}` on the per-child CAS. `sanitizeAll` walks `Object.entries` and `sanitize(b,key)` resolves `b.id || key || genId()` (v17.16.13): a row stating its own `id` keeps it, and only a row written by something else (an Admin-SDK backend, a console edit, a rules probe) reaches the key arm — mapping `Object.values` once minted a new id on every read and grew the node by a booking per pass. The legacy ARRAY arm passes NO key: an index is a position, not an identity. `genId()` ids are path-safe `[0-9a-z]`, as every RTDB child key must be. Whitelisted per-booking fields include `updatedAt`, `deposit`, `recurringId`/`recurringDate`, `guestId`, `anonymized` and `voucherCode`; a new field must join FIVE lists (Gotchas).
- **`vouchers`** — `/vouchers/{CODE}`: the CODE is the child key, so a number exists at most once by construction. Per-child CAS, written by `useVouchers.js` through `lib/write-path.js`'s generic diff. **A voucher is never DELETED, only voided** — enforced at three layers: the hook has no delete function, its patch builder logs and drops a `null`, and the rule's `.write` requires `newData.exists()`. That is what lets `generateCode` exclude every code that has ever existed. Never copy `/bookings`' leading `!newData.exists() ||` disjunct into this rule: it short-circuits on a delete and would free a number for re-issue (an emulator test fails if you do). The ledger is `redemptions/{bookingId}`, keyed by BOOKING, so a redemption is idempotent, and `remaining` is RECOMPUTED as `value − redeemedTotal(ledger)`, never decremented. A booking's half is its `voucherCode` field, covered by the booking CAS.
- **`roles` + `invites`** — per-child CAS through `useRoles.js` and the same generic diff. A row carries TWO capability maps, `extras` and `denies/{cap}` — objects keyed by capability because rules cannot search an array, with keys SORTED on read for `contentKey`'s key-order-sensitive compare. A level is a default, not a floor (Patryk's call): `denies` removes what the level grants, and `setCapability` keeps the two mutually exclusive by choosing from `levelGrants(role, cap)`. A deny is a PRESENT `true`, never `false`, because the rules test `.val() !== true`. `can()` checks the enforcement flag BEFORE the deny, so a deny stored while experimenting cannot leak through a switch that is off. `isAdminEntry` checks the deny FIRST, in the same order as the rule — without it an admin strips their own `settingsAdmin` by writing a deny, and `wouldRemoveOwnAdmin` sees `role: "admin"` on both sides and reports no change. `CAPABILITIES` has eighteen entries in four groups and `GATED_CAPS` is every one of them (`tests/roles.test.js` fails otherwise). `SETTINGS_TABS.caps` is a LIST and `visibleTabs` tests ANY. `dataExport` is the one gated capability with no rule behind it: the backup is built client-side from reads, and `.read` is `auth != null` at the root. No empty-collection guard, deliberately — `/roles` starts at zero, and a role row is one line an admin retypes.
- **`activity`** — `/activity/{pushId}`, append-only (Rule of law above). `useActivityLog.js` adds `at`, `uid` and `email`; `at` must be the `{".sv":"timestamp"}` sentinel, since a client `Date.now()` never equals the server's `now`. **That clause is in `.write` and NOT `.validate` on purpose**: `.validate` re-runs over the merged node when a redaction rewrites `subject/name`, so there it would make every entry permanently un-redactable and silently break erasure. The redaction is gated on `customerDelete`. **Guest names are never stored**: the text holds `{b:<id>}` tokens resolved against the live bookings, so an anonymised booking reads "Data removed" with no pass over the log; only a DELETED booking's entry carries `subject` plus an indexed `guestKey` — one field to find it by, one to erase. `lib/activity.js` decides what an entry SAYS; `lib/activitySink.js` is the hand-off every writer emits into.
- **`tableBlocks`** — a whole array under `tableBlocksRev`. Each block's `id` is minted at READ time by `sanitizeBlocks` at BOTH read sites (the listener AND `resync()`) and is not written back by a migration — the next `saveBlocks` persists it. A legacy block's id is DETERMINISTIC from its CONTENT (`bl_<hash>_<n>`), so two reads agree and `removeBlock` (filtering on the id `BlockModal` captured) cannot become a silent no-op after a resync (v17.16.4, CT-2B-06). The ordinal is the first one NOT ALREADY TAKEN, seeded with the ids the node already stores — `hash36` is 32-bit and collides. Content, never array POSITION: a stale index would resolve to a DIFFERENT block. `addBlock` still calls `sanitizeBlock(block)` with one argument and gets a `genId()`, because a new block has no stored identity. It is a mint, not a whitelist: `reason` is read by `DaySheet` and written by nothing, so a whitelist would silently drop it.
- **`waitlist`** (`useWaitlist.js`, ref-mirror save), **`reminders`**, **`reminderFires`** — whole arrays on rev pairs.
- **`recurring`** — `{v, enabled, horizonWeeks, rules[]}` + `recurringRev` (`useRecurring.js`); `enabled` defaults OFF, so an absent node reads as off. Occurrences are ordinary `/bookings` children generated by the App effect, NOT stored here.
- **`templates`**, **`conversations`**, **`messages`** — the WhatsApp module (see the Rule of law above).
- **Settings — restaurant-wide config, shared across devices, each on a rev pair, all on the loaded-ref write guard** (small objects, so the empty-array guard does not apply):
  - `settings/operatingHours` — per-weekday `{days:{0..6}}` (`useOperatingHours.js`)
  - `settings/dayShifts` — `{split, enabled}` (`useDayShifts.js`)
  - `settings/optimizer` — `{cutoff, autoSwitch}` (`useOptimizerSettings.js`)
  - `settings/layout` — `{tables, joinGroups, comboCaps, megaCombos, kitchenLimit}` + `priorities` (`useLayout.js`, which also refuses an empty-`tables` config)
  - `settings/general` — `{v, restaurantName, currency, phonePrefix, regularMin, lateCollapseMax, waitMatchWin, undoSecs}` (`useGeneralSettings.js`)
  - `settings/bookingDefaults` — `{v, tiers:[{max,dur}…], restDur, lateEnabled, lateWarnMin, lateNoShowMin, freeSoonEnabled, freeSoonWindow}` (`useBookingDefaults.js`); a present node's missing `tiers` array means EMPTY (RTDB drops empty arrays), never the default
  - `settings/voucherDefaults` — `{v, expiryMonths}`, where `0` means never (`useVoucherDefaults.js`). Named so, and not `settings/vouchers`, for the reason `settings/bookingDefaults` is not `settings/bookings`: two paths a character apart, one holding records and one config, is a trap.
  - `settings/whatsapp` (`useWaSettings.js`)
  - `settings/admin` — `{v, enforceRoles, modules, activityRetentionDays}` + `adminRev`, the ONLY settings node that is admin-only in the rules unconditionally. It lives in `useRoles.js`, because `can()` is meaningless without the flag. Every writer sends the WHOLE node through one `writeAdmin(fields)` merging onto the `adminRef` mirror, and the listener assigns that mirror on the line above its `setState` — otherwise one toggle silently resets the others.
- **`settings/users/{uid}/prefs`** + `prefsRev` (`useUserPrefs.js`) — the one PER-USER node (v17.6.0): theme, reduceMotion, planGestures, navLocked and splitEnabled follow the account. `localStorage` keeps all five as a pre-mount cache, and that mirror is load-bearing: `index.html`'s no-flash script reads `mgt-theme`/`mgt-reduce-motion` before React, Firebase or auth resolve. Genuinely per-DEVICE settings (app width, the Timeline zoom values, the saved split layout) stay `localStorage`-only.

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
