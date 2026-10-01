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

The next nine come from the **2026-09-23 tech-debt scan** and its `/code-review`. `#N` is the item's number
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
  Archiving needs design, because customer history derives from all bookings.

- **Before WhatsApp goes live (#4, #8):**
  1. Node tests for `api/wa-send.js`, `wa-recheck.js`, `wa-config.js`,
     `_lib/inbound-core.js` and `_lib/meta.js`. No test runs any of them.
  2. Load a conversation's messages when it opens (`messages/$phoneKey`) instead of
     every device subscribing to all of `/messages`, and set a retention period.

  SECURITY.md §3 lists them as open. (The erasure item and the parse log shipped in v18.3.1.)

- **Lint: decide a gate (#10).** There are 64 warnings on 2026-09-30, all of them React
  Compiler advisories. Decide whether CI gets `--max-warnings N`, which is a policy
  change. One older `eslint-disable-next-line react-hooks/exhaustive-deps`
  directive carries no reason (useWaitlist):
  give it a `-- <reason>`, or fix the stale closure it hides (v18.3.2 is doing it).

- **The public repository (#12).** Decide whether `LICENSE`'s "proprietary and
  confidential" fits a public repo. Optionally, restrict the browser API keys by HTTP
  referrer in Google Cloud, trying DEV first. See SECURITY.md §4.

- **One field table for a booking (#13).** Its fields are written out by hand in
  eight places (CLAUDE.md's per-booking-field row), and the walk-in build in
  `useWalkin.js` is outside the pairing test's reach. Derive `sanitize`, `UNDO_FIELDS`
  and `diffBooking` from one table, and move `doSaveEdit` (327 lines, complexity 114)
  and `doSaveNew` into pure `buildBooking`/`applyEdit`. Write characterization tests
  first. This is a data-touching patch version.

- **In-range dependency updates, and whether to automate them (#14).** Still in range on
  2026-09-30 (`npm outdated`): vite 8.3.1, firebase-admin 14.5, eslint and `@eslint/js`
  9.39.5, globals 17.12 and eslint-plugin-react-refresh 0.5.7. eslint 10 and vitest 5
  are waiting as majors. Optionally, turn on Dependabot for security updates only.

- **Keyboard shortcuts as a table (#15).** `useKeyboardShortcuts`' handler has complexity
  141, with 70 `if`s. Escape became a table in v17.14.0; do the rest the same way, with
  a pure `resolveShortcut` in `lib/` so it can be tested.

- **Keep extracting `BookingApp` by domain (#17).** `App.jsx` went from 2,545 to 5,393
  lines after the July scan and took 187 of the 616 commits, 90 of them fixes. Extract
  one domain per patch version: the save path (#13) first, then recurring generation,
  backup/export and drag-drop.

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
