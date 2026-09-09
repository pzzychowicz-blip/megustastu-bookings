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

## Designed, not implemented

> The entry below is what remains of one approved plan, written 2026-09-07 against
> v17.16.13 and shipping as **one release, v18.0.0**, on one branch across seven
> sessions. Phases 0–4 have shipped and their entries are deleted; see
> `REFACTOR_LOG.md`. **The plan is
> `…/megustastu-bookings context/MGT_Bookings_v18.0.0_Plan.md`** — phase order and
> why it is forced, data shapes, security rules, hook points, and the decisions
> already settled. It supersedes `MGT_Bookings_Production_Roadmap_Plan.md`
> (2026-09-05), which stays on disk as the record of the four-version split and
> the per-feature reasoning; where the two disagree, the v18.0.0 plan wins. These
> entries say what is pending; that file says how. Revise it there, not here.

- **The WhatsApp port — 5c (v18.0.0 phase 5).** **5a and 5b are done.** What
  remains is **5c, tenant de-hardcoding**: the Gemini prompts carry "a small
  restaurant in the Canary Islands" (`api/_lib/gemini.js`, ~74 and ~179), to be
  read from `profile.waContext` via a `TENANT_WA_CONTEXT` env var, matching how
  everything else reaches the backend. `AUTO_ACK_TEXT` and `DEFAULT_TEMPLATES`
  are already generic EN/ES and stay seedable through the `templates` node. The
  four draft-assembly points gotcha applies unchanged: any per-tenant field that
  should influence parsing must cross `lib/wa-sim.js`,
  `api/_lib/inbound-core.js`, `mergeDraft` in `lib/whatsapp.js`, and the
  schema/prompt in `api/_lib/gemini.js` — plus a deterministic backstop if the
  LLM must populate it.

  **Not deferred, but not built either — recorded so nobody re-derives it.** The
  three `api/wa-sim-*` handlers are still DEPLOYED to production (Vercel ships
  `api/` wholesale) and answer 404 there. Excluding them via `.vercelignore` was
  considered and dropped: the sandbox branch would need its own inverted copy,
  which is a second place the same fact is written, and the runtime gate is
  measured fail-closed across five env values. Revisit only if Vercel's function
  count ever becomes a constraint — it is 6 of the Hobby plan's 12 today.

- **The WhatsApp crash test (v18.0.0 phase 6).** The adversarial pass, register
  prefix `CT-WA-…`, aimed at what the bookings one has no sections for: a public
  webhook, an Admin-SDK server that bypasses the rules entirely, prompt injection
  through the Gemini parse, a send path that reaches real customers, and
  per-message cost.

  **Phase 5 also carries `/api/wa-config`**, moved here from phase 4 (Patryk's
  call, session 4): the token-gated status endpoint returning a **boolean per
  key, never a value**, which the Admin tab's Integrations section then renders
  in place of its current "where the keys live" text. It belongs with the port
  because `api/_lib/env.js` already reads every one of those keys — writing a
  second env reader in phase 4 would have been a duplicate for this merge to
  reconcile — and because it cannot be verified before then: `npm run dev` has
  no serverless runtime, so exercising it needs `vercel dev`, which this repo
  has never run.

## Ideas

_(nothing pending)_
