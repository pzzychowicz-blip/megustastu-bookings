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

### Crash test v17.15.7 — confirmed and unfixed

The findings from the three adversarial QA sessions that are still open
(`MGT_Bookings_CrashTest_Phase4_FixPlan_Handoff.md` in the context folder holds
the full register and the reproductions). **v17.16.0 shipped CT-2C-01 and
CT-2A-02; v17.16.1 shipped CT-2A-01 and CT-2A-03's server half; v17.16.2 shipped
CT-2B-01, CT-2B-02 and CT-2B-03, and closed §7's `usePersistence` extraction** —
seven of twenty-two; **v17.16.3 shipped CT-2B-04 and WITHDREW CT-2C-02** as not
reproducible outside React StrictMode (measured; see `REFACTOR_LOG.md`), leaving
thirteen; **v17.16.4 shipped CT-2B-09 and CT-2B-06 and WITHDREW CT-2B-07**
(both predicates are `starts + 1 >= LIMIT`; measured, see `REFACTOR_LOG.md`),
leaving ten; **v17.16.5 shipped CT-2B-05 and CT-2A-05, and CT-2A-03's client
half — which closes that finding in both halves — leaving eight; v17.16.6
shipped CT-2B-08 and CT-2A-11 and WITHDREW CT-2A-08 (the dedupe
signature is (content, base), so two patches sharing one are indistinguishable
to the server and have the same fate — measured, see `REFACTOR_LOG.md`), leaving
five; v17.16.7 shipped CT-2A-04 and CT-2A-06 — the two P2s, and one structural
change rather than two fixes — and SETTLED CT-2A-10 as a deliberate won't-fix
(negligible on the v17.16.5 re-rating: every stamp derives from `Date.now()`, so
reaching 2**53 needs a hand-written value from outside the app; the rules-suite
pin stays, see `REFACTOR_LOG.md`), leaving **two**: CT-2A-07 and CT-2A-09.** v17.16.6 also closed the `getBlockSlots` sibling of CT-2A-03, which
is not in that count — it was raised in v17.16.5, after the register was
written. **The count is of REGISTER findings only**, stated here because the
running tally was off by one for two commits of v17.16.6 before anybody
re-derived it.
Delete an entry as its fix lands; the detail then goes in `REFACTOR_LOG.md`.

**Every bullet below now carries its SETTLING OBSERVATION** — the single thing
you would measure to decide whether it is worth a version, and what that
measurement cost when it has already been made. That is the re-rating the
previous entry at the foot of this section asked for; it has been done, so the
entry is gone and its output is here, where the work is.

**A finding that has been SETTLED is deleted from this file, not annotated in
it** — this is a pending-work list, and an entry saying "we checked and there is
nothing here" is not pending work. That covers both ways a finding settles: a
WITHDRAWAL (it was not there — CT-2C-02, CT-2B-07, CT-2A-08) and a deliberate
WON'T-FIX (it is there and is not worth a version — CT-2A-10, deleted in
v17.16.7). The two are different judgements and neither is pending. The
measurement and the decision go in `REFACTOR_LOG.md`, and any evergreen lesson
in `CLAUDE.md`'s Gotchas.

**`database.rules.json` — what remains after v17.16.7.**

- **CT-2A-03 follow-on (P3) — the rules check TYPE, never FORMAT.** v17.16.1
  validates `status`, `date` and `time` as strings and deliberately not against
  a value set or a pattern. `sanitize` guarantees type but not well-formedness,
  so a legacy `"31/08/2026"` or an unrecognised status is reachable in stored
  data — and because `persist` sends ONE multi-path `update()` that RTDB applies
  atomically, a single such booking would reject a whole optimiser reshuffle and
  leave staff unable to save a day that looks normal. **Closing this means
  auditing what PROD actually holds first**, then tightening against evidence;
  it is not a rules edit on its own. Table ids are likewise unchecked against
  the layout, which is correct — the layout is editable, so the rules would
  duplicate it and go stale.

**Client fixes — P3, minor, each its own commit if taken at all.** Re-rated in
v17.16.5; the order below is by that rating, not by the filed one. v17.16.6 took
the last of the non-P3 client entries (`getBlockSlots`), so everything left here
is either a P3 or the one rules item above.

- **CT-2A-07** — an exhausted retry (`MAX_RETRIES` 3) drops the item *after* it
  was applied optimistically to local state, behind a dismissible banner naming
  no booking. Screen and server disagree until the next echo silently reverts it.
  **Confirmed by reading (v17.16.5):** `drainPending`'s give-up branch sets the
  warning and nothing reverts the `setBookings(next)` the hold branch applied.
  **Settling observation is not needed — the DECISION is what is missing.** The
  queue holds an updater function, not a booking, so naming the lost change means
  changing what is queued; and reverting it discards work the user can see. That
  is a design question for Patryk, not a repair. Highest-value of the P3s.
- **Duplicate booking ids are unchecked** (unrated; surfaced under CT-2A-11 and
  outlived it). Two bookings sharing an id collapse in the optimiser's
  assignment map. A `genId()` collision needs the same millisecond and the same
  4 random base36 characters, ≈ 1 in 1.7M given the first. **Settling
  observation:** whether any two ids in PROD coincide at all — a one-line scan
  of the `bookings` node, which nobody has run.

- **CT-2A-09** — `saveBookings`/`saveBlocks` dispatch the write from inside their
  `setState` updater. v17.16.0 corrected CLAUDE.md's claim that no such shape
  survives, and recorded why the v16.0.0 corruption has not recurred (an
  idempotent per-child diff `update()`, plus the signature dedupe). Converting it
  to the ref-mirror shape is the structural fix the rule actually prescribes.
  **Re-rated (v17.16.5): low value, high risk.** The defect is mitigated two
  layers deep and both layers are now tested (`write-path.js`, v17.16.2); the fix
  rewrites the file through which this repo has lost production data twice. Worth
  doing only as its own version, with nothing else riding along.

## Designed, not implemented

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
