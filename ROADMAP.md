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

_(nothing pending)_

## Designed, not implemented

> The five entries below are one approved plan, written 2026-09-07 against
> v17.16.13 and shipping as **one release, v18.0.0**, on one branch across seven
> sessions. **The plan is
> `…/megustastu-bookings context/MGT_Bookings_v18.0.0_Plan.md`** — phase order and
> why it is forced, data shapes, security rules, hook points, and the decisions
> already settled. It supersedes `MGT_Bookings_Production_Roadmap_Plan.md`
> (2026-09-05), which stays on disk as the record of the four-version split and
> the per-feature reasoning; where the two disagree, the v18.0.0 plan wins. These
> entries say what is pending; that file says how. Revise it there, not here.

- **Vouchers (v18.0.0 phase 1).** 8th persisted collection, `/vouchers/{CODE}`
  keyed by the code itself so uniqueness is structural, per-child `updatedAt` CAS
  like `/bookings`, a redemption ledger keyed by booking id (idempotent under the
  retry queue). Balance carries over across visits; 12-month default expiry on a
  new `settings/voucherDefaults` node. 7th Settings tab. **Manual entry** — a
  number typed in rather than generated, through the same normaliser and the same
  create-only rule, with `origin: "manual"|"generated"` on the record; a number is
  never released, which is why a voucher is voided and never deleted. The case to
  not lose: the close-time auto-complete must never redeem — nobody is there to
  answer.

- **Tenant configuration layer (v18.0.0 phase 2).** `VITE_TENANT` selects a config
  module under `src/tenants/`, each exporting `{ firebaseConfig, profile }`; the
  `import.meta.env.DEV` split is preserved exactly, so localhost can never reach
  any tenant's production database. One `APP_NAME` constant replaces four
  hand-typed copies of the app's own name, one of which had already drifted to a
  third spelling. `.firebaserc` + `npm run rules:deploy` make the rules deploy
  repeatable, without removing this release's own manual console step.

- **Roles and the Admin tab (v18.0.0 phase 3).** `/roles/{uid}` + `/invites`,
  three levels named `staff`/`manager`/`admin` in code and UI alike, per-user
  `extras` granted on top of a role (an object keyed by capability — rules cannot
  search an array). The UI asks `can(cap)`, never `role === "admin"`. Ships with
  `settings/admin.enforceRoles` **off**, which is what makes the rules deploy
  rolling-safe. Never fewer than one admin, enforced in the rules and not only in
  the panel. The Admin tab is admin-only at both layers, whole tab and every
  control.

- **Module registry and Integrations (v18.0.0 phase 4).** `settings/admin.modules`
  as the on/off registry — the WhatsApp switch ships **off**, and the same
  mechanism is the multi-tenancy lever under project-per-restaurant. Integrations
  shows which server-side secrets are *set*, never their values: **no Meta or
  Gemini token may go in RTDB**, which every signed-in account can read.

- **The WhatsApp port + its crash test (v18.0.0 phases 5–6).** The `wa-sandbox`
  branch merged to production, admin-switchable and shipped off, with the
  simulator structurally incapable of running in production. `api/` is not tracked
  on `main`, so this adds serverless functions to the production Vercel project
  for the first time and makes `/api/wa-inbound` a live public URL on merge. On
  merge the module's `whatsapp.js` must import
  `normalizePhone`/`formatPhone`/`matchCustomerByPhone` from `src/lib/customers.js`
  rather than keeping its own copies (the complementarity contract from v16.0.0),
  and the sandbox's `writeWithRev` templates + per-key `clearAllWaData()` must
  survive the re-merge or it will write shapes the published rules refuse. Then
  the adversarial crash test, register prefix `CT-WA-…`, aimed at what the
  bookings one has no sections for: a public webhook, an Admin-SDK server that
  bypasses the rules entirely, prompt injection through the Gemini parse, a send
  path that reaches real customers, and per-message cost.

## Ideas

_(nothing pending)_
