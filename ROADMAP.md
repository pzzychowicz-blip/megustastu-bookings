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

- **What happens to a voucher's ledger when a completed booking is walked
  back?** v18.0.0's `/code-review` removed `unredeemVoucher` from
  `useVouchers.js` as dead code — it had no caller. The question it was written
  for is real and unanswered: the edit form lets a completed booking go back to
  Confirmed or Seated, and if that booking redeemed a voucher, its ledger entry
  and the spent balance stay. Arguably right (the money was taken) and arguably
  wrong (the visit is being un-recorded). The pure inverse, `removeRedemption`,
  is still in `lib/vouchers.js` with its tests, so whichever way this is
  settled the transform exists. It is a behaviour decision for Patryk, not a
  bug — which is why the review deleted the unused write path rather than
  wiring it to a control nobody asked for.

- **The static files still name MGT.** `public/manifest.webmanifest`'s
  `description` reads *"Staff booking management for Me Gustas Tú"* — the PWA
  install card and the home-screen add sheet. v18.0.0 phase 2 made the app's own
  name one constant and pinned `index.html`'s `<title>` and the manifest's
  `name`/`short_name` to it, but a RESTAURANT name in a static file is a
  different problem: those files import nothing, so a per-tenant value there is
  a build step, not a constant. The icon family (`scripts/gen-icons.py`,
  `public/icon*.png`) is the same question one size up. Deferred rather than
  genericised, on Patryk's call — dropping the restaurant's name from MGT's
  install card today would make the manifest say less than it does now, for a
  tenant that does not exist yet.

- **CT-WA-05 · out-of-order WhatsApp status callbacks (P3).** Meta does not
  guarantee the order of `statuses[]`, and `updateMessageStatusByWamid` writes
  the status with a bare `set()` and no rank. Measured against the emulator:
  `read` then `delivered` leaves the bubble reading "delivered" for a message the
  customer has already read. Fix is a rank (`sent < delivered < read`, `failed`
  apart) that refuses a downgrade.

- **CT-WA-06 · no length cap on an OUTBOUND WhatsApp message (P3).**
  `WA_MAX_TEXT_LEN` (4000) guards both inbound paths (`api/_lib/inbound-core.js`,
  `src/lib/wa-sim.js`) and neither outbound one: `api/wa-send.js` takes
  `body.text` and the client's mock send takes the composer's value, both
  uncapped — and the outbound `lastMessageSnippet` is written whole where the
  inbound one is `.slice(0, 200)`, so it lands in the conversation-list payload
  every device downloads. Cloud API refuses a body over 4096, so LIVE mode fails
  cleanly at the provider; MOCK mode, the shipping default, stores all of it.

- **CT-WA-07 · `/api/wa-config` reports the raw mode string, not the effective
  one (P3).** It returns `env("WA_LLM_MODE", "mock")` while the backend runs on
  `llmMode()`, which compares `=== "live"` exactly. Measured: `"LIVE"`, `"Live"`,
  `"live "`, `"true"` and `"1"` each display as themselves in the Admin tab while
  the backend is in **mock**. The direction is the wrong one — it reads as more
  capable than it is, and the handler's own comment says this is the mode that
  spends money. Report `llmMode()` / `sendMode()`.

- **CT-WA-08 · thread-mode prompt interpolates the transcript raw (P3).**
  `parseThread` builds `"CUSTOMER: " + text` lines and joins them, so a customer
  can place `STAFF:` or `CUSTOMER:` mid-line under a prompt that assigns meaning
  to those labels. They cannot forge a NEW line — `\s+` is collapsed to a space,
  verified — and no LLM output mutates a booking without a staff action, so the
  worst outcome is the app telling staff that a customer is asking for something
  they are not. The single-message path is already safe: its text goes through
  `JSON.stringify` and cannot leave its quoted block. Fix is a delimiter the text
  cannot contain, or escaping the two labels.

## Designed, not implemented

> The entries below are what remains of one approved plan, written 2026-09-07
> against v17.16.13 and shipping as **one release, v18.0.0**, on one branch across
> seven sessions. Phases 0–6 have shipped and their entries are deleted; only
> phase 7 (docs, README, ship) is left, and it is described in the plan rather
> than here. See `REFACTOR_LOG.md`. **The plan is
> `…/megustastu-bookings context/MGT_Bookings_v18.0.0_Plan.md`** — phase order and
> why it is forced, data shapes, security rules, hook points, and the decisions
> already settled. It supersedes `MGT_Bookings_Production_Roadmap_Plan.md`
> (2026-09-05), which stays on disk as the record of the four-version split and
> the per-feature reasoning; where the two disagree, the v18.0.0 plan wins. These
> entries say what is pending; that file says how. Revise it there, not here.

- **One WhatsApp decision recorded rather than taken (v18.0.0 phase 5).**
  `TENANT_WA_CONTEXT` duplicates `src/tenants/<slug>.js` → `profile.waContext`.
  The tenant file used to justify this by claiming the backend "cannot import
  this file", which is false and now has a test importing it from Node to prove
  so; the env var stays because it matches how all ten other backend values
  arrive and needs no second variable naming the tenant. The alternative — the
  function importing `src/tenants/` by slug at runtime — is viable and was not
  taken. Drift is bounded: the prompt falls back to exactly the profile's string
  and a test fails if the two stop matching.

- **The `wa-sandbox` branch must append `!api/wa-sim-*.js` to `.vercelignore`.**
  Not pending work on `main` — a standing item for the next prod-sync of the
  sandbox. `main` excludes the three simulator endpoints so they do not deploy to
  the restaurant's project; the deployed sandbox calls them same-origin and needs
  them back. **Appending a negation, never deleting the exclusion**: a merge
  silently reinstates a deleted line, which is the failure
  `tests/wa-sandbox-integrity.test.js` exists for. `.vercelignore`'s own comment
  carries the instruction.

## Ideas

_(nothing pending)_
