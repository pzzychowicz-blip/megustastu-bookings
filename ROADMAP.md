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

- **WhatsApp coexistence: the rehearsal, then the restaurant's number.** The code
  shipped in v18.9.0 (Embedded Signup at `/wa-connect`, the four coexistence webhooks,
  contact sync, phone replies, history import, the disconnect banner, Not a customer).
  What is left needs Meta and a phone. The sandbox's rig is ready (the four coexistence
  webhook fields, Facebook Login for Business and its Embedded Signup configuration,
  `META_APP_ID` + `META_ES_CONFIG_ID`, all done 17 October), so the rehearsal waits only for
  a disposable number that has run the Business app for a week, then follows the go-live
  page from R-5 (the gate) on. **Findings the rehearsal owns:** the `extras` shape FB.login takes (Embedded Signup Builder,
  "Check a launch config"); whether `META_WA_TOKEN` may send and retry the syncs on the
  converted account; history chunk sizes against Vercel's 4.5 MB request cap; whether the
  direct route works without Tech Provider status; whether an echo ever names a message
  MGT sent (if never, `handleEchoes` finds a phone reply by its key alone instead of
  reading the whole thread for each new one; if it can, the scan stays, or `providerMsgId`
  gets an index); and how long one history thread takes to import, which decides whether
  `importThread` reads and writes the conversation in one transaction (a customer writing
  inside that round trip has the message marked read and, on an old thread, archived; the
  transaction costs about one more round trip per thread, on the path nearest Vercel's
  time limit). Both from v18.9.0's `/code-review`. **Where the answers are:** `waLink/measured`
  in the DEV database (the largest and the slowest history delivery, each with its bytes,
  milliseconds, threads and messages; `historyBegun` above `historyDeliveries`, a delivery the
  time limit ended; `historyChunks`, the chunks that landed per phase, where a gap is one the
  4.5 MB cap refused before MGT saw it; `mgtEchoes`, absent for as long as no echo has named a
  message MGT sent), and one `[wa-inbound] coexistence delivery` line per delivery in
  Vercel's logs, which a Hobby project keeps for an hour. If the rehearsal passes, the
  restaurant's number, with the Business app's greeting message turned off.

The entries marked `#N` come from the **2026-09-23 tech-debt scan** and its `/code-review`. `#N` is the item's number
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

- **The public repository (#12): restrict the browser API keys by HTTP referrer**
  (decided 2026-10-08: the DEV key first, PROD after a week on DEV shows nothing). The
  step is Patryk's, in Google Cloud → APIs & Services → Credentials; a wrong list locks
  every device out of sign-in until it is corrected. SECURITY.md §4 has the DEV key's
  four entries, how to check them (a fresh sign-in, then an hour), and how to undo it
  (2026-10-09). Still owed: Patryk applying the DEV list; then, a week later, the PROD
  list, which is proposed there and must be confirmed against the Vercel project's
  domains first.

- **`check:style` does not see inside an `mkBtn(...)` / `mkDangerBtn(...)` argument.** A
  bare `minHeight: 32` there passes the gate (v18.10.0's review found five, now `H`
  tokens; Summary's Print and More still carry two). Teach the height rule to read the
  object passed to the style builders, then move the remaining literals.

## Designed, not implemented

Nothing at present.

## Ideas

The **2026-07-24 `/engineering:tech-debt` scan's feature shortlist** is spent: its last
two ideas, deposits reporting and structured guest tags, shipped in v18.5.0.

- **A voice note becomes a booking draft** (Patryk, 2026-10-14, after go-live checklist
  item A5-7). v18.8.0 stores and plays a customer's voice note, and nothing reads it: the
  parse runs on text only. Gemini takes audio, so the note could be fetched as the media
  proxy fetches it (`mediaInfo` + `downloadMedia`, `api/_lib/meta.js`) and parsed like a
  message.

- **MGT names written back to the phone** (2026-10-15, planning v18.9.0). The phone is the
  master for contact names because Meta has no API that writes one. If the restaurant
  iPhone's Contacts sync to a Google account, the Google People API could create or rename
  the contact, and the Business app would then send the name back to MGT. Only workable
  with that Google account; check what the phone syncs to first.
