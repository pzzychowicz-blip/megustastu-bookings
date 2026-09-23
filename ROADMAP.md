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
  first. This is a data-touching patch version.

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
