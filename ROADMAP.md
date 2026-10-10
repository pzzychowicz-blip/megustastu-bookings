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

- **A tap the pick rules refuse does nothing, and says nothing** (v18.6.1). The
  table picker and the walk-in form ignore a tap that would break a rule from
  Settings → Layout → "Tables picked together" (`pickBlockedBy` returns the rule).
  Say which rule, the way a refused drop does. **And taking a table OUT of a set is
  never asked**: pick 10, 11, 12, 13, deselect 11, and 10+12+13 saves (the rule was
  the same before it moved to the layout). Decide whether the deselect is refused or
  Save is, then ask `pickBlockedBy` there.

- **Two code changes gate the WhatsApp go-live** (2026-09-19 plan, § A4 of
  `megustastu-bookings context/WhatsApp module/MGT_WhatsApp_Cloud_API_Go-Live_Plan.md`).
  (1) **Photos in the inbox** — staff send the menu as a picture and customers send
  photos back, while `api/_lib/meta.js` sends text only and `api/wa-inbound.js` stores
  any non-text message as `"[image message]"`; Meta holds the files (7 days received,
  30 days sent), so nothing new is stored here. (2) **A public `/privacy` page** —
  Meta will not switch the app to Live, and so will not deliver real webhooks, without
  a reachable privacy-policy URL. (The Graph v26.0 bump and the stale Gemini comment
  shipped in v18.3.1; set the Meta app's WEBHOOK version to v26.0 in the dashboard at
  go-live, since the code cannot.)

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

- **Measure `gemini-3.5-flash-lite`, and clear `gemini-3.1-flash-lite` out before
  7 May 2027** (v18.4.1, 2026-10-07). The code default moved to 3.5 without a live
  run, because no key was available where it was written. Still to do, on the sandbox:
  (a) run the simulator's canned scenarios in live mode and record accuracy and time
  per parse against `TIMEOUT_MS` (15 s) in `api/_lib/gemini.js`; (b) check every
  deployment's `GEMINI_MODEL` env var — one that still names `gemini-3.1-flash-lite`
  overrides the default and stops working on 7 May 2027, the id's shutdown date;
  (c) read the free-tier requests per minute and per day in AI Studio → Rate limits,
  which Google no longer publishes in the docs.

- **The WhatsApp draft checks the request before Accept** (Patryk, 2026-10-06; waits
  for go-live). Today the draft card says nothing about availability and the form
  shows it only after Accept. Decided: (a) a status line on the draft — it fits,
  "Kitchen may be busy at HH:MM", or "No tables for N at HH:MM"; (b) nearby times
  that work, as the booking form lists them; (c) an **Add to waitlist** button on the
  draft; (d) a suggested reply offering the alternatives or the waitlist. Only for a
  draft with a usable size, date and time. The scan goes through `useDeferredCompute`,
  never render, and reuses `findFreeSlot` → `trialFits`, `getKitchenLoad`,
  `findTimes` / `findKitchenFriendlyTimes` and `formatSugg`; the waitlist button
  follows `addFormToWaitlist`'s rule (`phoneForSave`); the reply is a template.

The next seven come from the **2026-09-23 tech-debt scan** and its `/code-review`. `#N` is the item's number
in its register, and the report
(`megustastu-bookings context/MGT_Bookings_Tech_Debt_Scan_2026-09-23.md`) has the
evidence for each.

- **Daily PROD backup (#5): running since 2026-10-09, restore rehearsed 2026-10-10.**
  The job is in the private repository `pzzychowicz-blip/mgt-backups` (this one is
  public, so its Actions logs and artifacts are world-readable): every day at 04:30 UTC
  it reads the database as a read-only service account, builds the file v18.1.1's
  `lib/backup.js` builds (imported from this repository's `main`), encrypts it with
  `age` to a key only Patryk holds, and keeps it 90 days. Its README has how to open
  one. The rehearsal: the first run's file (1,640 bookings, 2,326,413 bytes) decrypted
  with his key, imported at the root of DEV through the console, exported again and
  compared: 15 of 15 nodes identical. DEV was then put back from its own export (20 of
  20 identical). **Still owed:** Patryk storing the key in the password manager and on
  paper, then deleting `~/mgt-backup-key.txt`. **Not proven:** that the service
  account is refused a write; its role says so and nobody should try one against PROD.
  A change to `src/lib/backup.js` that breaks its import fails the next run there, and
  GitHub emails him.

- **Delete customer: a rule removal refused four times, or cut short, leaves the
  paused rule** (v18.6.0). The removal is retried by itself three times (300, 600,
  900 ms). If all four attempts are refused, or the page is closed or reloaded before
  one lands, the rule stays, paused, still holding the name and phone, and is deleted
  by hand in Settings. Closing that needs something stored (a mark on the rule that
  any device sweeps), which raises `SCHEMA`; Patryk chose the retry without it
  (2026-10-10).

- **Find a booking's folded Done row, on the tablet itself** (v18.6.0). Built and
  measured in the Browser pane at the tablet's keyboard-up size (998 × 231) with the
  focus events dispatched by script, since the pane's document does not take focus.
  To check on the HONOR tablet after the merge: with the keyboard up the Done row is
  gone and three result rows show; closing the keyboard brings Done back.

- **Design the bookings archive at 2,500 bookings or 2.5 GB a month (#3).** Every
  device subscribes to every booking ever made, each with an uncapped `history`, and
  a resync re-reads the lot. Nothing purges old bookings. Archiving needs design,
  because customer history derives from all bookings.
  **The threshold (Patryk, 2026-10-09):** start that design when the load banner
  reads 2,500 bookings (it prints the count on every connect), or when a month's
  downloads pass 2.5 GB in Firebase console → Realtime Database → Usage, whichever
  comes first. The first is the one expected: `sanitize` costs the tablet 3.2 ms per
  1,000 bookings on every snapshot (v18.3.5), so 8 ms at about 2,900, and PROD held
  about 1,600 on 2026-10-06.
  **PROD on 2026-10-09** (the console, 10 Sept to 9 Oct): storage 1.48 MB (about
  0.93 MB thirty days earlier), downloads 549.63 MB (largest day about 80 MB),
  connections 4 at most. Against the free plan (1 GB, 10 GB a month, 100): 0.15%,
  5.5%, 4%. About 15 whole-database loads a day, so the plan's download limit is
  reached at about 22 MB, roughly three years off at this rate. `REFACTOR_LOG.md`
  v18.5.0 has the table and DEV's node-by-node sizes. Not read: the peak-load graph.

- **Before WhatsApp goes live (#8):** load a conversation's messages when it opens
  (`messages/$phoneKey`) instead of every device subscribing to all of `/messages`, and
  set a retention period (SECURITY.md §3 lists the retention as open). Still without a
  test that runs them: `api/wa-inbound.js` (the public webhook: its raw-body read, the
  signature gate, the `statuses[]` branch, the timestamp clamp) and the three
  `api/wa-sim-*.js` handlers. (#4's five files are run by `tests/api-handlers.test.js`
  since v18.4.5.)

- **The public repository (#12): restrict the browser API keys by HTTP referrer**
  (decided 2026-10-08: the DEV key first, PROD after a week on DEV shows nothing). The
  step is Patryk's, in Google Cloud → APIs & Services → Credentials; a wrong list locks
  every device out of sign-in until it is corrected. SECURITY.md §4 has the DEV key's
  four entries, how to check them (a fresh sign-in, then an hour), and how to undo it
  (2026-10-09). Still owed: Patryk applying the DEV list; then, a week later, the PROD
  list, which is proposed there and must be confirmed against the Vercel project's
  domains first.

- **Keep extracting `BookingApp` by domain (#17).** `App.jsx` went from 2,545 to 5,393
  lines after the July scan and took 187 of the 616 commits, 90 of them fixes. Extract
  one domain per patch version. The save path went first, in v18.3.4 (#13): its
  decisions are `lib/booking-save.js`, App keeps the effects, and `App.jsx` is 5,340
  lines (5,727 before it). Recurring generation followed in v18.4.4 (`withOccurrences`,
  `lib/recurring.js`; `App.jsx` 5,410 lines), and backup/export in v18.4.5 (`runBackup` in
  `lib/backup.js`, `hooks/useBackup.js`, `lib/download.js`; 5,354 lines) and the timeline
  drop (`planDrop`, `lib/drop-plan.js`; 5,210 lines), and manual table assignment in
  v18.4.7 (`planAssign`, `lib/manual-assign.js`; 5,220 lines; the drop's displacement
  shares its release, `releaseSwapped`), and status changes in v18.5.0 (`planStatus`,
  `planCancel`, `completeCleared`, `lib/status-change.js`; 5,091 lines), and delete and
  undo in v18.5.1 (`planDelete`, `planUndo`, `lib/delete-undo.js`; 5,093 lines) with
  Book Again's draft (`againDraft`, `lib/booking-save.js`) and the Overlap banner's
  Reassign (`planReassign`, `lib/manual-assign.js`; 4,984 lines), and in v18.6.0 the redeem
  prompt's answer and the voucher carry (`planSettle`, `settleEffects`, `carryOffer`,
  `carryTransform`, `lib/voucher-settle.js`; 4,987 lines after a version that also added
  to App). That was the last of the five measured 2026-10-08. **The render, begun
  2026-10-10:** measured at 1,484 lines from the first top-level JSX constant (84
  statements; the `return` 562, `notifSections` 118, the clash derivations 95, the
  four view elements 140). The clash derivations are `lib/clash-view.js` (`App.jsx`
  4,980 lines). **What is left of the render is prop wiring** (read 2026-10-10):
  `notifSections` is 57 lines of code (the 118 counted the comments after it) and
  would need about 40 values passed for 10 to 15 lines saved; the Settings mount is
  94 lines, 88 of them one prop each, and a wrapper saves about 6. Patryk dropped
  both. They shrink only when the state behind them moves into hooks by domain,
  which is a design of its own and not started. **The form's save, 2026-10-10:**
  what `doSave` and `save` still decided inline is `draftForSave`, `draftRefusal`,
  `formSeatClash` and `kitchenAsk` (`lib/booking-save.js`); `doSave` is 64 lines (132
  in the table below), `save` 27 (31), `App.jsx` 4,898. What `doSave` keeps is the
  order of its questions, the refs and the setters; `doSaveNew` and `doSaveEdit` were
  already plans since v18.3.4.
  **Re-measured 2026-10-09** (`App.jsx` 4,987 lines; the functions declared directly in
  `BookingApp`, by length, with the commits since 2026-07-24 that touched their lines
  and how many of those say fix, /code-review or correction; `git log -L` on today's
  line range, so the counts follow the lines back and are approximate):
  `doSave` 132 lines, 18 commits, 2 fixes · `doSaveNew` 59, 18, 3 · `deleteCustomer` 45,
  8, 1 (its decisions are already `planCustomerDelete`; what is left is comments and
  effects) · `settleVoucher` 39, 8, 3 (likewise) · `doClearActivity` 37, 3, 2 ·
  `delBooking` 34, 8, 1 · `save` 31, 3, 1 · `addFormToWaitlist` 31, 4, 0 · `doSaveEdit`
  30, 31, 7. The render (from the first top-level JSX constant to the end) is 1,471
  lines, 29% of the file. By churn the next candidate is the form's save
  (`doSave` + `doSaveNew` + `doSaveEdit` + `save`: 252 lines, `doSaveEdit` alone 31
  commits and 7 fixes), whose decisions v18.3.4 already moved to `lib/booking-save.js`;
  by size it is the render. Not chosen: Patryk's call.

- **A parked write was seen stored without Retry, once, and not reproduced** (v18.4.9,
  DEV; investigated again 2026-10-08). The stored booking carries the edit's history
  stamp (10:46:33.804Z) and a write stamp of 10:47:49.550Z, so the same in-page change
  was replayed, 28 s after that session's turn ended and with no tool call running.
  `retryParked` has one caller, the banner's button, and no shortcut. One clean trial
  (the rejection turned off from the page, no reload, 120 s, through real visibility
  changes and two clicks by Patryk on the strip header): 0 `saveBookings` calls, 0
  `retryParked` calls, the booking unchanged. Editing `usePersistence.js` made Vite
  reload the page 4 times of 4, which destroys a parked write, so a trial that removes
  the switch by a file edit proves nothing unless the page is shown to have survived.
  Patryk does click in the shared pane during a check and does not recall pressing Retry.
  **The instrument is in place since v18.6.0, on DEV only** (`lib/write-trace.js`,
  compiled out of every build): `window.__mgtTrace` holds the last 200 entries, in
  memory, of every click (capture phase, `isTrusted`, the control's text, whether the
  page was visible) and of each park, Retry, Discard and replay, and those four print
  a `[trace]` console line; a Retry carries its call stack and the clicks of the 10 s
  before it. A reload empties it, so **if it recurs, read `window.__mgtTrace` before
  anything else**, and keep Vite's log line for any edit. Remove the module and its
  six lines in `usePersistence.js` (the import and five guarded calls) once the fault is explained or a few months pass
  without it.

## Designed, not implemented

Nothing at present.

## Ideas

The **2026-07-24 `/engineering:tech-debt` scan's feature shortlist** is spent: its last
two ideas, deposits reporting and structured guest tags, shipped in v18.5.0.
