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

- **The v18.0.0 production deploy.** Pending from the moment the release merges,
  and ordered: the six steps, and where each one's detail lives, are
  `database.rules.README.md` § *v18.0.0 — the production deploy, in order*.
  Delete this entry when the last of them — `enforceRoles` on — is done.

## Designed, not implemented

_(nothing pending)_

## Ideas

Both entries below come from the **2026-07-24 `/engineering:tech-debt` scan's feature
shortlist**, whose other items shipped in v17.4.0. That plan file no longer exists in
`~/.claude/plans/`, so **no scope was ever recorded for either** — what is written here
is the idea plus what the code does today, not a design. Added 2026-09-18.

- **Deposits reporting.** A deposit is a per-booking number (`deposit`, rendered in
  `settings/general.currency`) and every surface shows it one booking at a time — the
  booking form, the list and timeline rows, and `DaySheet`'s shared money column.
  Nothing aggregates them, so "how much is held in deposits for Saturday" is a manual
  count off the day sheet. Scope unknown: which period, which statuses (a cancelled
  booking's deposit is the interesting case), and whether it is a surface of its own or
  a line on the existing day summary.
- **Structured guest tags.** A booking carries free-text `notes`, and that is where
  "nut allergy" and "birthday cake" actually live today (`seatNoteFor` raises them at
  seating). Free text cannot be filtered, counted or carried from one visit to the
  next, and `deleteCustomer`'s anonymisation wipes `notes` outright (`App.jsx`), so a returning guest's
  allergy is gone with their phone number. The idea is a structured tag set on the
  CUSTOMER identity (`guestId` / phone key, `customers.js`) rather than prose on one
  booking. Scope unknown: a fixed vocabulary or free tags, and whether tags are
  personal data that erasure must reach.
