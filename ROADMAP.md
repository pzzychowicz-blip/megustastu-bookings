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

- **Measure what a full `bookings` read costs.** Firebase console → Realtime
  Database → Usage: stored data, and downloaded bytes/day. One click, PROD-safe,
  Patryk-side. It decides whether the archive below is built at all, and whether
  capping `history` gets most of the benefit on its own. Nothing else waits on it.

## Designed, not implemented

> The four entries below are one approved plan, written 2026-09-05 against
> v17.16.13. **The plan is
> `…/megustastu-bookings context/MGT_Bookings_Production_Roadmap_Plan.md`** — data
> shapes, security rules, hook points, the reasoning behind each choice, and the
> eleven decisions already settled. These entries say what is pending; that file
> says how. Revise it there, not here.

- **Vouchers (planned v17.17.0).** 8th persisted collection, `/vouchers/{CODE}`
  keyed by the code itself so uniqueness is structural, per-child `updatedAt` CAS
  like `/bookings`, a redemption ledger keyed by booking id (idempotent under the
  retry queue). Balance carries over across visits; 12-month default expiry on a
  new `settings/voucherDefaults` node. 7th Settings tab. The case to not lose:
  the close-time auto-complete must never redeem — nobody is there to answer.

- **Admin layer (planned v17.18.0).** `/roles/{uid}` + `/invites`, three levels
  named `staff`/`manager`/`admin` in code and UI alike, per-user `extras` granted
  on top of a role (an object keyed by capability — rules cannot search an
  array). Self-registration on first sign-in plus admin invitations; a
  fully-automatic invitation claim is **not expressible in RTDB rules** and would
  need a backend. Ships with `settings/admin.enforceRoles` **off**, which is what
  makes the rules deploy rolling-safe. Never fewer than one admin, enforced in
  the rules and not only in the panel.

- **Admin backend: module switches + README (planned v17.19.0).**
  `settings/admin.modules` as the on/off registry — the WhatsApp switch ships
  **off**, and the same mechanism is the multi-tenancy lever under
  project-per-restaurant. Integrations section shows which server-side secrets
  are *set*, never their values: **no Meta or Gemini token may go in RTDB**, which
  every signed-in account can read. `README.md` is stale in the same pass (says
  v16; the app is v17.16.13).

- **Bookings archive (planned v17.20.0, conditional).** Gated on the measurement
  above. Move terminal bookings older than a configurable cut-off (default 3
  months, clamped 3–24) to `/archive/{YYYY-MM}/{id}`, lazily read, never passed
  to `saveBookings`. Chosen over windowing the query because the write path's
  diff derives deletions from `prev`, so a partial array reaching it is a
  data-losing hazard class — and windowing fixes neither `resync()` nor the
  reconciler's scan past month-end. `doBackup` and the WA backend's customer
  lookup both read `/bookings` and would need the archive too.

- **Adversarial crash test for the WhatsApp module.** Same instrument as
  `MGT BOOKINGS — CRASH TEST - ADVERSARIAL QA.md`, register prefix `CT-WA-…`,
  aimed at what that one has no sections for: a public webhook, an Admin-SDK
  server that bypasses the rules entirely, prompt injection through the Gemini
  parse, a send path that reaches real customers, and per-message cost. **Run it
  after the next `wa-sandbox` prod sync** — the branch is 91 commits behind, so
  findings against it would age before they were read.

- **WhatsApp Cloud API integration (Phase 1b).** Designed but not built — see
  `MGT_WhatsApp_Inbox_Phase1b_Design_Summary.md`. Integration points: the
  `BookingFormModal` callback surface + a new `InboxPanel` component. On
  merge, the WA module's `whatsapp.js` must import
  `normalizePhone`/`formatPhone`/`matchCustomerByPhone` from
  `src/lib/customers.js` rather than keeping its own copies (the
  complementarity contract established in v16.0.0's customer layer).
  **v17.16.7 added a second precondition; v17.16.8 removed it.** The sandbox
  writes four top-level paths — `conversations`, `messages`, `templates` and
  `settings/whatsapp` — and when the root `.write` grant went, none of them was
  writable: the sandbox looked populated and silently refused to save.
  v17.16.8 grants all four, with a CAS shape decided per node rather than
  deferred (`conversations`/`messages` per-child and uncased, because the WA
  Admin backend bypasses rules entirely; `templates`/`settings/whatsapp` on real
  rev pairs). **What remains for the merge is smaller and is client work, not
  rules work:** the `wa-sandbox` changes that put `templates` behind
  `writeWithRev` and turned `clearAllWaData()` into a per-key delete loop must
  survive the re-merge onto the new prod baseline, or the sandbox will write
  shapes the published rules refuse. See `database.rules.README.md` § v17.16.8.

- **`wa-sandbox` is 91 commits behind `main`** (at `17.15.3-wa-sandbox` against
  v17.16.8). Surfaced in v17.16.8 while hardening the client there; noted rather
  than acted on, because re-merging onto a new prod baseline is the explicit
  "Update with the production version" flow and not something to do in passing.

## Ideas

_(nothing pending)_
