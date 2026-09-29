# ROADMAP

Pending work only — deferred features, follow-ups, and ideas that haven't shipped
yet. Nothing else belongs in this file: no rationale docs, no shipped-version
history (that's `REFACTOR_LOG.md`), no architecture notes (that's `CLAUDE.md`).

**Keep this current.** When an item ships, delete its entry here in the same
PR/commit that ships it — the shipped details go in `REFACTOR_LOG.md` instead.
An item that is SETTLED is deleted too, not annotated: a withdrawal ("it was not
there") and a deliberate won't-fix ("it is there and is not worth a version")
are both decisions rather than pending work, and an entry saying "we checked and
there is nothing here" is not pending work either. The measurement and the
decision go in `REFACTOR_LOG.md`, and any evergreen lesson in `CLAUDE.md`'s
Gotchas. When new deferred work or an idea surfaces, add it here. The `mgt-workflow`
skill is responsible for checking this file at the relevant points in a
session and keeping it in sync.

---

## Deferred

- **Four code changes gate the WhatsApp go-live** (2026-09-19 plan, § A4 of
  `megustastu-bookings context/WhatsApp module/MGT_WhatsApp_Cloud_API_Go-Live_Plan.md`).
  (1) **Photos in the inbox** — staff send the menu as a picture and customers send
  photos back, while `api/_lib/meta.js` sends text only and `api/wa-inbound.js` stores
  any non-text message as `"[image message]"`; Meta holds the files (7 days received,
  30 days sent), so nothing new is stored here. (2) **A public `/privacy` page** —
  Meta will not switch the app to Live, and so will not deliver real webhooks, without
  a reachable privacy-policy URL. (3) **`GRAPH_VERSION` v21.0 → v26.0**
  (`api/_lib/meta.js`) — v21.0 stops working on 21 January 2027. (4) **A stale comment**
  — `api/_lib/env.js`'s header names `gemini-3-flash` as the fallback model; the real
  default is `gemini-3.1-flash-lite` (`api/_lib/gemini.js:216`).

- **WhatsApp coexistence — the Business app and the Cloud API on one number**
  (decided 2026-09-21, go-live plan § 3a–3b). Replaces the ops-SIM migration: the groups
  never move and staff keep answering from the phone. **Milestone 1 is a rehearsal and
  gates everything else:** onboard a cheap disposable number running the Business app to
  the *sandbox* app through **Embedded Signup v4** (v2 is retired 15 Oct 2026), subscribe
  `history` · `smb_app_state_sync` · `smb_message_echoes`, and check that the one-shot
  24-hour history sync arrives, echoes flow both ways, and groups stay out of the API.
  If it passes, the full build: Embedded Signup in place of the single system-user token,
  the three webhook topics, echo mirroring into the inbox — load-bearing, since without it
  two staff can answer one customer — and disconnection handling (`account_update`, error
  `131060`). If it fails, the plan's Phase B comes back.

- **A WhatsApp cost counter in Settings → WhatsApp**, after go-live. Meta charges for
  every message a business sends from **1 October 2026**, replies included, so the panel
  shows messages sent this month and their cost, read from Meta's Pricing Analytics API
  (`pricing_category: SERVICE`) rather than counted locally — that way it matches the
  invoice even for anything sent outside MGT. Its own visibility capability: **manager
  and admin** by default, grantable to staff by an admin, like `hoursEdit` / `layoutEdit`.
  Decided 2026-09-21; the pricing analysis is § 4a of the go-live plan.

The next ten come from the **2026-09-23 tech-debt scan** and its `/code-review`. `#N` is the item's number
in its register, and the report
(`megustastu-bookings context/MGT_Bookings_Tech_Debt_Scan_2026-09-23.md`) has the
evidence for each.

- **Automated daily PROD backup (#5), free tier only** (Patryk, 2026-09-23). It needs a
  scheduled job in a separate PRIVATE repository, because this one is public and its
  Actions artifacts and logs are world-readable. The job uses a dedicated read-only
  service account, writes the same file v18.1.1's `lib/backup.js` builds, encrypts it
  with `age` to a key only Patryk holds, and keeps N days. Undecided: GitHub Actions or
  Vercel Cron, N, and where the private key lives. Rehearse a restore on DEV first
  (`database.rules.README.md` § Backups and restore).

- **Download backup: feedback inside Settings, and offline** (v18.1.1's `/code-review`).
  v18.1.1 reads the server, so offline it refuses, and the refusal lands in the red
  "Couldn't save" banner behind the Settings dialog. Measured: it is covered by the
  overlay and sits under `inert`, so the press looks dead until Settings closes.
  Before v18.1.1, an offline press still exported the device's in-memory copy.
  Decide an inline status line under the button, and whether offline falls back to a
  clearly-partial device export. Also check one backup on the iPad/iPhone: the
  download now fires after an async read, which only Chromium has been seen to allow.

- **Measure `/bookings` before its size becomes a problem (#3).** Every device
  subscribes to every booking ever made, each with an uncapped `history`, and a resync
  re-reads the lot. Nothing purges old bookings. First, read Firebase console →
  Realtime Database → Usage (storage, downloads a month) and set a threshold.
  Archiving needs design, because customer history derives from all bookings.

- **Before WhatsApp goes live (#4, #8, #24):**
  1. Node tests for `api/wa-send.js`, `wa-recheck.js`, `wa-config.js`,
     `_lib/inbound-core.js` and `_lib/meta.js`. No test runs any of them.
  2. Load a conversation's messages when it opens (`messages/$phoneKey`) instead of
     every device subscribing to all of `/messages`, and set a retention period.
  3. **"Delete customer & all data" must also remove the guest's `conversations/` and
     `messages/`.** Today only the Inbox's delete does.
  4. Decide whether `api/_lib/gemini.js`'s parse log keeps 200 characters of message
     text in live mode.

  SECURITY.md §3 lists all four as open.

- **Lint: triage, then decide a gate (#10).** There are 89 warnings: about 71 when the
  workflow skill was written, 88 on 2026-09-18, 89 now. The 25 `react-hooks/exhaustive-deps` sites are where stale closures hide, so
  fix each one or keep it with `-- <reason>`. Then decide whether CI gets
  `--max-warnings N`, which is a policy change.

- **The public repository (#12).** Decide whether `LICENSE`'s "proprietary and
  confidential" fits a public repo. Optionally, restrict the browser API keys by HTTP
  referrer in Google Cloud, trying DEV first. See SECURITY.md §4.

- **One field table for a booking (#13).** Its fields are written out by hand in
  eight places (CLAUDE.md's per-booking-field row), and the walk-in build in
  `useWalkin.js` is outside the pairing test's reach. Derive `sanitize`, `UNDO_FIELDS`
  and `diffBooking` from one table, and move `doSaveEdit` (327 lines, complexity 114)
  and `doSaveNew` into pure `buildBooking`/`applyEdit`. Write characterization tests
  first. This is a data-touching patch version. The phone rule goes with it (v18.2.0's
  `/code-review`): `doSave` and `addFormToWaitlist` each run `withTypedCode`, then refuse a
  number with no code in the same words, which should be one helper.

- **A trunk 0 kept after a non-UK code (found in v18.2.0's `/code-review`).** Phase 66 drops
  the home 0 after +44 only, so "+33 06 12 34 56 78", "+49 030 …" and "+31 06 …" keep
  theirs, and the same French, German or Dutch guest typed with and without it is two
  customers (`normalizePhone`, measured). Italy is the exception: its 0 belongs to the
  number ("+39 06 …", pinned in `tests/phone-countries.test.js`). Which countries get the
  rule is a decision, as phase 66's was.

- **Focus after a ⋯ card action that opens a dialog (v18.2.0's `/code-review`).** In the List,
  ⋯ → Delete (or Cancelled, or the voucher and seat prompts) leaves focus on `<body>` when the
  dialog closes. `useDialog` reads `document.activeElement` in a passive effect, after the commit
  that makes the page `inert`, and a rendering update's focus fixup can blur the opener first.
  Handing focus back in the handler (phase 57's `leavePop`) did not change it. Capture the
  restore target before the commit (at the Overlay's first render or in a layout effect), check
  it across every modal, and re-check `leavePop`. Needs a device, because focus events do not
  fire in the Browser pane.

- **In-range dependency updates, and whether to automate them (#14).** firebase 12.12 →
  12.19 needs a tablet check first (the `forceWebSockets`/JSONP history). react 19.3 and
  plugin-react 6.1 are also available, and eslint 10 and vitest 5 are waiting as majors.
  Optionally, turn on Dependabot for security updates only.

- **Keyboard shortcuts as a table (#15).** `useKeyboardShortcuts`' handler has complexity
  141, with 70 `if`s. Escape became a table in v17.14.0; do the rest the same way, with
  a pure `resolveShortcut` in `lib/` so it can be tested.

- **Keep extracting `BookingApp` by domain (#17).** `App.jsx` went from 2,545 to 5,393
  lines after the July scan and took 187 of the 616 commits, 90 of them fixes. Extract
  one domain per patch version: the save path (#13) first, then recurring generation,
  backup/export and drag-drop.

- **A booking's seating preference is soft on a day the optimiser runs (found in v18.2.0
  phase 68).** `findFreeSlot` treats "indoor"/"outdoor" as a hard constraint, but the
  optimiser behind `trialFits` falls back to ANY zone when the preferred one is full
  (`_runGreedy`'s `findBestAny`). So the booking form accepts or refuses the same party
  depending on the day: measured on DEV, 11 guests wanting indoor (the indoor combination
  seats 10) were offered outdoor 1A · 1B · 3 · 4 · 7 for tomorrow 20:00, and refused ("No
  tables available (indoor preference)") for today 21:30, after the 15:00 cutoff. The
  waitlist matches strictly since phase 68. Decide whether a stated preference is a wish or
  a rule, and make both paths say the same.

- **Recheck two things on a real iPhone (found in v18.3.0 phases 17 and 18).**

  **The sign-in shift (phase 18).** In the iOS 26 Simulator the window was scrolled when
  the app mounted in 2 of 8 sign-ins made with Return (112px in Safari, 36px in the
  home-screen app), and iOS undid it every time. S2 had twice seen the app open ~37pt too
  high after signing in. Phase 22's Go key makes Return the usual way to sign in, so on a
  real iPhone sign in with it several times, in Safari and as a home-screen app, and note
  whether the header ever stays low. Only then consider `window.scrollTo(0, 0)` at mount.

  **The keyboard (phase 17).** `Overlay` now pads by the keyboard's inset, so Save is
  never behind the keyboard, but in the iOS 26 Simulator Safari's floating address pill
  and ⌃⌄✓ form bar sat over part of the booking form's footer for some fields: Notes put the pill over Back, and on a probe page a
  bottom textarea put the bar over the whole footer. iOS reported a different visible area
  for each field (src/CLAUDE.md's Gotchas row on the keyboard). On a real iPhone, in Safari
  and as a home-screen app, tap Name, Notes and Deposit and note where the footer lands.
  Only act if the overlap is real there. The fixes that exist all pad for the bar, which
  leaves a gap in the cases that are clean now.

- **Timeline drag: scroll at the edge (A5, the motion & touch audit).** An armed drag cannot
  reach rows below the fold: on the tablet i3 and i4 sit at 821 and 865px on an 800px
  screen, and on a phone everything from table 6 down. Add a band of about 48px at each
  edge that, in a `requestAnimationFrame` loop, scrolls the body and adds the scrolled
  delta to the drag's `dy`. Drag is used every service (S3).

- **The drop freeze (audit M1).** After a drop the block sits still for about 104ms on the
  Mac with no frame painted: `dropOnTable`'s synchronous trials plus the re-render. The
  tablet's figure is unmeasured and is on v18.3.0's device list (row 04). Measure it there
  before proposing a deferral or a fix.

- **List cards and waitlist rows leave the way they arrive (O3).** `useRevealRows` with
  `speed: "move"`, a departed row ranked at `rank − 0.5` so it holds its place, and
  `useFlip`'s `isQuiet` while a row collapses. After v18.3.0's O1 (the timeline blocks'
  fade) has run on the tablet.

- **The Unplaced row's mount (O4).** Mounting it pushes every table row down by
  lanes × 44px plus the gap, in one frame. Measure frame by frame first: `useFlip` may
  already move the blocks while the labels jump. And `tableForClientY` would need the row's
  live height during a reveal, or a drop lands rows off.

- **A modal opened from the keyboard can lose its focus return (found by v18.3.0's
  `/code-review`).** Measured in the rig, from the keyboard: on a List card's ⋯ menu, choose
  Delete or Cancelled, then press Escape on the confirm. Focus lands on `<body>`, not on ⋯.
  The same happens after Find a booking (header) is closed with Escape. `useDialog` (atoms)
  records `document.activeElement` in a passive effect. By then, the commit that mounted
  the modal has made the page `inert`, and that has already blurred the opener. A probe did
  two things together: `useDialog` captured the opener at its first render
  (`useState(() => document.activeElement)`), and the ⋯ pick handed focus back to ⋯ in its
  handler (PlanView's `leavePop` pattern). With both, focus returned to ⋯ for both
  confirms. Find still landed on `<body>`, so it has a second cause of its own. Neither
  path was changed by v18.3.0. Measure every modal's return path before changing a
  primitive that all of them share.

- **Timeline fades replay after the tablet wakes (found by v18.3.0's `/code-review`).**
  `useEnterLeave`'s holds start on the next animation frame (`afterFrame`), and a hidden
  tab renders none. So bookings cancelled or added on another device while the screen was
  off pile up, and on wake they all play their fade at once: the departed ones from their
  old snapshots, possibly over whatever took their place, and the new ones fading in, all
  minutes late. This is the behaviour `lib/after-frame.js` documents ("the leaving node
  waits, inert, until the tab is shown"). Whether a change nobody saw should animate is a
  decision. One option: treat a diff taken while `document.hidden` as a replacement, the
  way a date change is. Check on the tablet first how it reads there.

- **Port v18.3.0's shared conventions to MGT Scheduling.** Once v18.3.0 has run on the
  restaurant devices, port what it shipped that Scheduling shares the shape of (grepped at
  Scheduling's `014a461`): `Overlay`'s keyboard inset (N1), `color-scheme` (N4), the
  per-scheme `theme-color` metas plus the manifest colours and its `?v=` bump (N5),
  `text-size-adjust` (N8), `enterKeyHint="go"` on the login password (N9), the
  `prefers-contrast: more` block (A10), the popover keyframe pair for
  `ConnectionStatus` (M9), and v18.3.1's `.mgt-edge` top strip (the iOS home-screen blur). Drop any item the device check turns back.

## Designed, not implemented

- **The doc-load split has three loose ends, all scope calls rather than defects**
  (`/code-review`, 2026-09-18, measured). (1) Root restates 29–34% of what it
  relocated, word for word: the five-guard summary against `src/CLAUDE.md`, the
  service-worker summary against its skill, the `api/` pointer against
  `api/CLAUDE.md` — two copies with nothing keeping them in step, which is the
  shape CLAUDE.md's own Gotchas row names. The node inventory at 0% is what a
  pointer should look like. (2) The write guards' mechanics sit in
  `src/CLAUDE.md`, which every src session loads, where 47% of them never open
  `src/hooks/`. (3) **CLAUDE.md crossed 40,000 on 2026-09-19** (`c3f2d6b`), silently,
  as predicted, and it is 40,162 characters after the scan's drift fixes. Nothing
  measures it yet, and a size-guard test waits on the decision of what leaves root.
  Deciding any of these means deciding what a root-only session must still know.

## Ideas

Both come from the **2026-07-24 `/engineering:tech-debt` scan's feature shortlist**,
whose other items shipped in v17.4.0. That plan file is gone from `~/.claude/plans/`,
so **no scope was ever recorded for either** and both need one before they are work.

- **Deposits reporting.** `deposit` is per-booking and every surface shows it one
  booking at a time; nothing aggregates it. Undecided: period, which statuses, and
  whether it is its own surface or a line on the day summary.
- **Structured guest tags.** Allergies and occasions live in free-text `notes`, which
  cannot be filtered or carried between visits and which `deleteCustomer` wipes.
  Undecided: fixed vocabulary or free tags, and whether tags are erasable personal data.
