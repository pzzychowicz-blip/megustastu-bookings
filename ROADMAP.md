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

- **A voucher reversal leaves no trace on the voucher.** `applyRedemption`
  stamps `by: <email>` on every ledger entry; `unredeemVoucher` deletes the entry
  through `removeRedemption` and records nothing, so a balance can be restored
  with no mark on the money record itself. The trail is not absent — the
  booking's own `history` carries the status change that triggered it, and the
  restore only ever happens behind the walk-back prompt — but `/vouchers` is a
  collection with **no backups**, and it is the one place someone would look.
  Raised by `/code-review` at v18.0.0 phase 6 and deliberately NOT fixed there:
  a reversal journal (`v.reversals[bookingId] = {amount, at, by}`, or a
  soft-delete on the entry) changes the persisted voucher shape, which is a
  feature rather than a review fix. `sanitizeVoucher` and the rules pair would
  move with it.
- **The v18.0.0 production deploy.** Pending from the moment the release merges,
  and ordered: the six steps, and where each one's detail lives, are
  `database.rules.README.md` § *v18.0.0 — the production deploy, in order*.
  Delete this entry when the last of them — `enforceRoles` on — is done.

## Designed, not implemented

_(nothing pending)_

## Ideas

_(nothing pending)_
