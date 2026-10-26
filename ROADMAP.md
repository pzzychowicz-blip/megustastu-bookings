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
  `META_APP_ID` + `META_ES_CONFIG_ID`, all done 17 October). **The number (decided
  2026-10-26): Patryk's own Spanish number, already on the Business app**, not a
  disposable SIM. Before connecting it: v18.12.0 merged (simulator chats never send for
  real; Settings → WhatsApp → Auto-reply turned OFF on the sandbox, so his contacts get no
  greeting), the simulator's Clear conversations (the chats from before v18.12.0 carry no
  `sim` mark and would still send live), `WA_LLM_MODE=mock` on the sandbox (his contacts' messages never reach
  Gemini), and the Business app's greeting message off. All of that was done on
  2026-10-26. **The gate (R-5) ran on 2026-10-26 and Meta refused the direct route**, in
  Live and in Development mode alike: "Me Gustas Tú can't onboard customers right now",
  shown before any screen about a WhatsApp account or a number, so the number was never
  connected and nothing was imported. **The verdict (R-11): the Tech Provider route**
  (Patryk). Business verification of the *Me Gustas Tu* portfolio first (waiting on the
  owner's censal certificate), then Tech Provider onboarding and App Review for advanced
  access to `whatsapp_business_messaging` and `whatsapp_business_management` on the
  sandbox app, then the gate again; the go-live page's T1–T4 has the detail. R-17's
  sandbox settings stay in place for that rerun. **After the rerun's verdict:** disconnect the number (R-10) and wipe the
  imported WhatsApp data from DEV (conversations, messages, `waContacts`), since it is
  six months of his real chats. **Findings the rehearsal owns:** the `extras` shape FB.login takes (Embedded Signup Builder,
  "Check a launch config"); whether `META_WA_TOKEN` may send and retry the syncs on the
  converted account, which as a Tech Provider decides more than it did (Meta's coexistence
  page says a Tech Provider uses business tokens exclusively, and `api/wa-onboard.js` uses
  the signup's business token once and keeps none, so a refusal means keeping that token
  in an environment variable for production); history chunk sizes against Vercel's 4.5 MB
  request cap; whether an echo ever names a message
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

- **The public repository (#12): restrict the PROD browser API key by HTTP referrer,
  about 2026-10-25.** The DEV key has been restricted since mid-October (six entries,
  probed 2026-10-18). The PROD list and how to check and undo it are in SECURITY.md §4:
  `megustastu-bookings.vercel.app` (bare and `/*`) and
  `megustastu-bookings.firebaseapp.com/*` for reset links. Confirm it against the Vercel
  project's domains first. The step is Patryk's, in Google Cloud → APIs & Services →
  Credentials; a wrong list stops sign-in on every device until it is corrected.

## Designed, not implemented

Nothing at present.

## Ideas

The **2026-07-24 `/engineering:tech-debt` scan's feature shortlist** is spent: its last
two ideas, deposits reporting and structured guest tags, shipped in v18.5.0.

- **A voice note becomes a booking draft** (Patryk, 2026-10-14, after go-live checklist
  item A5-7). v18.8.0 stores and plays a customer's voice note, and nothing reads it: the
  parse runs on text only. Gemini takes audio, so the note could be fetched as the media
  proxy fetches it (`mediaInfo` + `downloadMedia`, `api/_lib/meta.js`) and parsed like a
  message. **Built after go-live** (Patryk, 2026-10-18), once real customers send them; the
  simulator's audio message can test it without Meta.

- **MGT names written back to the phone** (2026-10-15, planning v18.9.0). The phone is the
  master for contact names because Meta has no API that writes one. If the restaurant
  iPhone's Contacts sync to a Google account, the Google People API could create or rename
  the contact, and the Business app would then send the name back to MGT. Only workable
  with that Google account; check what the phone syncs to first.
