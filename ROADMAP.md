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

> One approved plan, written 2026-09-07 against v17.16.13 and shipping as **one
> release, v18.0.0**, on one branch. **Phases 0–6 have shipped** and their entries
> are deleted; see `REFACTOR_LOG.md`. **The plan is
> `…/megustastu-bookings context/MGT_Bookings_v18.0.0_Plan.md`** — phase order and
> why it is forced, data shapes, security rules, hook points, and the decisions
> already settled. It supersedes `MGT_Bookings_Production_Roadmap_Plan.md`
> (2026-09-05), which stays on disk as the record of the four-version split and
> the per-feature reasoning; where the two disagree, the v18.0.0 plan wins. This
> entry says what is pending; that file says how. Revise it there, not here.

- **Phase 7 — docs, README, ship.** The last phase. `README.md` still says
  "production, v16 · 130+ commits" and describes WhatsApp as in progress;
  `MGT_Bookings_Multi-Tenancy_Design.md` needs a revision block recording that
  phases 2 and 5 shipped ahead of it; `GLOSSARY.md` needs the release's new
  vocabulary; `database.rules.README.md` needs the v18 console step and the
  bootstrap-admin procedure. Then `/code-review and ship`.

  **After the merge, in order:** confirm the prod boot banner reads 18.0.0 → the
  PROD rules console step (app first, rules second) → create the bootstrap admin
  by hand → assign every real account a level → verify the lockout guard refuses
  to demote the last admin → **only then** flip `enforceRoles`, outside service
  hours.

## Ideas

_(nothing pending)_
