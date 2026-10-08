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

- **Automated daily PROD backup (#5), free tier only** (Patryk, 2026-09-23). It needs a
  scheduled job in a separate PRIVATE repository, because this one is public and its
  Actions artifacts and logs are world-readable. The job uses a dedicated read-only
  service account, writes the same file v18.1.1's `lib/backup.js` builds, encrypts it
  with `age` to a key only Patryk holds, and keeps N days. Undecided: GitHub Actions or
  Vercel Cron, N, and where the private key lives. Rehearse a restore on DEV first
  (`database.rules.README.md` § Backups and restore).

- **Measure `/bookings` before its size becomes a problem (#3).** Every device
  subscribes to every booking ever made, each with an uncapped `history`, and a resync
  re-reads the lot. Nothing purges old bookings. First, read Firebase console →
  Realtime Database → Usage (storage, downloads a month) and set a threshold.
  Archiving needs design, because customer history derives from all bookings. One
  figure from v18.3.5: `sanitize` alone costs the tablet 3.2 ms per 1,000 bookings on
  every snapshot, so it passes 8 ms at about 2,900 (PROD held about 1,600 on 2026-10-06).

- **Before WhatsApp goes live (#8):** load a conversation's messages when it opens
  (`messages/$phoneKey`) instead of every device subscribing to all of `/messages`, and
  set a retention period (SECURITY.md §3 lists the retention as open). Still without a
  test that runs them: `api/wa-inbound.js` (the public webhook: its raw-body read, the
  signature gate, the `statuses[]` branch, the timestamp clamp) and the three
  `api/wa-sim-*.js` handlers. (#4's five files are run by `tests/api-handlers.test.js`
  since v18.4.5.)

- **The public repository (#12).** Decide whether `LICENSE`'s "proprietary and
  confidential" fits a public repo. Optionally, restrict the browser API keys by HTTP
  referrer in Google Cloud, trying DEV first. See SECURITY.md §4.

- **Dependabot is configured but switched off (#14).** `.github/dependabot.yml` (v18.4.5)
  limits it to security updates. It does nothing until Dependabot alerts and Dependabot
  security updates are turned on in the repository's settings. `npm audit` still lists 5
  high advisories on 2026-10-07, all one chain (`@grpc/grpc-js` under
  `@firebase/firestore`, which the app does not import); their only offered fix is
  `--force`, which downgrades firebase to 9, so Dependabot will open nothing for them.

- **Keep extracting `BookingApp` by domain (#17).** `App.jsx` went from 2,545 to 5,393
  lines after the July scan and took 187 of the 616 commits, 90 of them fixes. Extract
  one domain per patch version. The save path went first, in v18.3.4 (#13): its
  decisions are `lib/booking-save.js`, App keeps the effects, and `App.jsx` is 5,340
  lines (5,727 before it). Recurring generation followed in v18.4.4 (`withOccurrences`,
  `lib/recurring.js`; `App.jsx` 5,410 lines), and backup/export in v18.4.5 (`runBackup` in
  `lib/backup.js`, `hooks/useBackup.js`, `lib/download.js`; 5,354 lines) and the timeline
  drop (`planDrop`, `lib/drop-plan.js`; 5,210 lines), and manual table assignment in
  v18.4.7 (`planAssign`, `lib/manual-assign.js`; 5,220 lines; the drop's displacement
  shares its release, `releaseSwapped`). The next domain is not chosen.

- **The booking form shows hand-picked tables as fine when Save will refuse them**
  (v18.4.9's `/code-review`; older than it). The availability preview answers "ok" for any
  `manualTables` without checking them (`BookingFormModal.jsx`), so a pick that became
  busy, or a Swap dropped because the draft left its slot, reads as normal until Save says
  "Selected tables are not available at this time."

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

- **The printed timeline's key can name a flag no block shows** (v18.4.6 `/code-review`).
  It lists the flags of every block it drew, and a block narrower than its time, size
  and marks clips them (`overflow: hidden`). Harmless, an explanation with nothing to
  point at; fixing it means the sheet deciding which flags fit, as the screen's
  `visibleRail` does.

- **Printing from the iPhone Home Screen app** (v18.4.6). iOS ignores `window.print()`
  there, so the app now says "open the app in Safari to print". A print that works in
  place needs the PDF built in the app and handed to the iOS share sheet
  (`navigator.share` with a file, which is defined there; the sheet has Print and Save to
  Files). That means a PDF library, in a lazy chunk, and both sheets drawn a second way.
  Not measured: whether the share sheet offers Print for a shared PDF, and an iPad.

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
