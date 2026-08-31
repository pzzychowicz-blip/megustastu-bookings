# ROADMAP

Pending work only — deferred features, follow-ups, and ideas that haven't shipped
yet. Nothing else belongs in this file: no rationale docs, no shipped-version
history (that's `REFACTOR_LOG.md`), no architecture notes (that's `CLAUDE.md`).

**Keep this current.** When an item ships, delete its entry here in the same
PR/commit that ships it — the shipped details go in `REFACTOR_LOG.md` instead.
When new deferred work or an idea surfaces, add it here. The `mgt-workflow`
skill is responsible for checking this file at the relevant points in a
session and keeping it in sync.

---

## Deferred

- **Decide the status mark's non-text contrast (WCAG 1.4.11).** v17.15.7 put
  `StatusIcon` on the floor-plan table. Measured, composited over the plan card,
  the white mark is **pending 1.83:1 light / 2.20:1 dark, confirmed 2.92:1 light
  / 3.58:1 dark, seated 4.59 / 4.58** — three of six under the 3:1 a graphical
  object wants. Not a new defect: the identical pairing already ships on the
  timeline block's rail and in `SBadge`, and the recorded `--block-pending` /
  `--block-confirmed` text exemptions (floors 1.75 / 2.8) agree with these
  numbers. Fixing it means a `paint-order: stroke` halo or a `--block-*` outline
  on the mark — a **new treatment**, applied to every status surface at once or
  not at all, so it wants its own version and Patryk's sign-off. If the answer
  is "record it, don't change it", the note belongs beside the existing
  exemption paragraph in `tests/contrast.test.js`.
- **A deleted booking can be resurrected by a stale write (rules change,
  needs sign-off).** Found by the v17.15.7 emulator rig; crash-test spec §5
  Scenario D. `database.rules.json`'s `$bid` validate is
  `!newData.exists() || (… && (!data.exists() || <CAS>))`, and once the booking
  is gone the `!data.exists()` disjunct short-circuits the CAS entirely — so any
  write with a numeric `updatedAt` recreates it, including an offline device's
  queued edit naming a `baseUpdatedAt` that was deleted. Verified against the
  emulator; a cancelled table reappears with the stale device's contents. The
  current behaviour is PINNED in `tests/rules/database-rules.test.js`
  ("PROBE — a deleted booking can be resurrected") so a fix fails those tests
  deliberately rather than silently. Fixing it means either a tombstone
  (`deletedAt`, which changes the data shape and the delete path) or requiring
  `baseUpdatedAt === 0` on the create branch (which would reject a legitimate
  offline re-create). **Not a tooling change** — `database.rules.json` is
  deployed by hand to PROD via the console, so it wants its own version and
  Patryk's sign-off.
- **Run the Firebase rules suite in CI.** `npm run test:rules`
  (`tests/rules/database-rules.test.js`, 78 tests against the real
  `database.rules.json`) runs on a developer machine only. CI cannot run it as
  it stands: `.github/workflows/ci.yml` is `ubuntu-latest` with no JVM, and the
  emulator is a Java jar. Adding it means a `setup-java` step plus installing
  `firebase-tools` in the job — perhaps a minute per PR for a suite that changes
  only when `database.rules.json` does, so it may be better gated on a path
  filter than run every time. Until this lands, a rules regression is caught
  only if someone remembers to run the command.
- **The Plan legend chip has no `boxShadow: var(--shadow-flat)`**, which its
  TimelineView twin has carried since v17.11.0. v17.15.7 matched the twin in
  every other respect (inline-flex, gap, `StatusIcon` at `IC.inline`) and left
  this deliberately out of scope: it is a decision about a chip on a different
  card, and the plan's header row has no other shadowed chip. One line either
  way — make the two legends identical, or record why they differ.

## Designed, not implemented

- **WhatsApp Cloud API integration (Phase 1b).** Designed but not built — see
  `MGT_WhatsApp_Inbox_Phase1b_Design_Summary.md`. Integration points: the
  `BookingFormModal` callback surface + a new `InboxPanel` component. On
  merge, the WA module's `whatsapp.js` must import
  `normalizePhone`/`formatPhone`/`matchCustomerByPhone` from
  `src/lib/customers.js` rather than keeping its own copies (the
  complementarity contract established in v16.0.0's customer layer).

## Ideas

_(nothing pending)_
