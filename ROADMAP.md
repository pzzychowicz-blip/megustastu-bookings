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

- **Daily PROD backup (#5): running since 2026-10-09, restore not yet rehearsed.** The
  job is in the private repository `pzzychowicz-blip/mgt-backups` (this one is public,
  so its Actions logs and artifacts are world-readable): every day at 04:30 UTC it
  reads the database as a read-only service account, builds the file v18.1.1's
  `lib/backup.js` builds (imported from this repository's `main`), encrypts it with
  `age` to a key only Patryk holds, and keeps it 90 days. Its README has how to open
  one. The first run (manual, 2026-10-09): 14 nodes, 1,640 bookings, 2.33 MB of JSON,
  216 kB encrypted. **Still owed:** Patryk decrypting one with his key, and a restore
  rehearsed on DEV (`database.rules.README.md` § Backups and restore). **Not proven:**
  that the service account is refused a write; its role says so and nobody should try
  one against PROD. A change to `src/lib/backup.js` that breaks its import fails the
  next run there, and GitHub emails him.

- **The schema gate: any signed-in account can raise `/schema`** (v18.6.0
  /code-review). The rule lets anyone signed in write a higher number, because the
  first refreshed device has to. An account with staff rights could therefore write a
  very large one and stop every device from saving until `/schema` is lowered in the
  Firebase console. Not closed: a rule cannot know the newest build's number, and a
  "+1 only" rule breaks a device that skipped a release. To decide, if it ever
  matters: admin-only announcing (then an admin must open the app after each release
  that raises it).

- **Delete customer: a refused rule removal leaves the paused rule** (v18.6.0). Once
  the bookings are anonymised the rules are removed; if the server refuses that write
  (another device changed `recurring` in the same moment), the rule stays, paused,
  still holding the name and phone, with the "redo the change" banner. It is deleted
  by hand in Settings. A retry there is not built.

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
  to App). That was the last of the five measured 2026-10-08.
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
  If it recurs: log clicks in the page (capture phase, `isTrusted`, the target's text),
  trace `retryParked`, and keep Vite's log line for the edit.

## Designed, not implemented

Nothing at present.

## Ideas

The **2026-07-24 `/engineering:tech-debt` scan's feature shortlist** is spent: its last
two ideas, deposits reporting and structured guest tags, shipped in v18.5.0.
