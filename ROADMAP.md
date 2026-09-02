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
- **Run the Firebase rules suite in CI.** `npm run test:rules`
  (`tests/rules/database-rules.test.js`, 78 tests against the real
  `database.rules.json`) runs on a developer machine only. CI cannot run it as
  it stands: `.github/workflows/ci.yml` is `ubuntu-latest` with no JVM, and the
  emulator is a Java jar. Adding it means a `setup-java` step plus installing
  `firebase-tools` in the job — perhaps a minute per PR for a suite that changes
  only when `database.rules.json` does, so it may be better gated on a path
  filter than run every time. Until this lands, a rules regression is caught
  only if someone remembers to run the command. **Whoever does this: the
  `test:rules` script prepends `/opt/homebrew/opt/openjdk/bin`, which does not
  exist on `ubuntu-latest`** — so the explicit JDK pin silently becomes a no-op
  and the job depends on whatever `java` the runner exposes. Drop the prefix in
  favour of `setup-java`, or the pin will look like a guarantee while
  guaranteeing nothing (rig `/code-review`, CR-2).

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
shipped CT-2B-08, leaving seven.**
Delete an entry as its fix lands; the detail then goes in `REFACTOR_LOG.md`.

**Every bullet below now carries its SETTLING OBSERVATION** — the single thing
you would measure to decide whether it is worth a version, and what that
measurement cost when it has already been made. That is the re-rating the
previous entry at the foot of this section asked for; it has been done, so the
entry is gone and its output is here, where the work is.

**A withdrawn finding is deleted from this file, not annotated in it** — this is
a pending-work list, and an entry saying "we checked and there is nothing here"
is not pending work. The measurement goes in `REFACTOR_LOG.md` and any evergreen
lesson in `CLAUDE.md`'s Gotchas, which is where the two v17.16.3 withdrawals
went.

**`database.rules.json` — what remains after v17.16.1.** The first two below are
ONE structural change, not two fixes.

- **CT-2A-04 (P2) + CT-2A-06 (P2) — the root `.write` grant.** CT-2A-04: an
  authenticated client can delete the entire `/bookings` node in one call.
  CT-2A-06: a whole-node `remove()` bypasses the rev CAS (node gone, rev left
  behind). **Neither can be fixed by adding a rule** — RTDB write permission
  cascades from the root's `".write": "auth != null"` and cannot be revoked
  lower down, measured against the emulator (a child `".write": false` on
  `bookings` does not deny the delete). Closing either means moving `.write` off
  the root and granting it per path. That was measured too, and carries two
  hazards: **deleting the last booking would be refused** (the natural predicate
  `newData.exists() || !data.exists()` is false when the node empties), and
  **every path not explicitly granted becomes unwritable** — `presence` failed
  immediately in the probe, the one node documented as deliberately having no
  rules. Both findings sit inside the documented single-restaurant trust model,
  and the false claims that the rev CAS covered wipes were corrected in
  v17.16.1. Wants its own version, a full per-path audit and its own emulator
  group.
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

**Version C or later — client fixes, in rough value order.** *(v17.16.2 shipped
CT-2B-01, CT-2B-02 and CT-2B-03, plus a DST date-navigation bug not in the
register — the Next-day button was a no-op on the spring-forward day.)*

- **The `getBlockSlots` sibling of CT-2A-03 (P3, new in v17.16.5).** v17.16.5
  made `sanitize` guarantee that a booking's `time` is something `toMins` can
  read. A table BLOCK's `from`/`to` reach the same `toMins`, from
  `getBlockSlots`, and have no such guard: `sanitizeBlock` is a MINT rather than
  a whitelist — its header says so, and says not to "finish" it by copying
  `sanitize`'s shape — so a block holding `from: 2000` throws in the placement
  path exactly as a booking used to. **Settling observation:** none needed for
  reachability, which is identical to the booking case (a non-app writer, since
  `tableBlocks` has no per-field `.validate`); what needs deciding is WHERE. The
  argument for the consumer rather than the mint: an unreadable block is not a
  block, so `getBlockSlots` should skip it rather than have stored data silently
  rewritten to a default time it was never given.

**P3 — minor, each its own commit if taken at all.** Re-rated in v17.16.5; the
order below is by that rating, not by the filed one.

- **CT-2A-07** — an exhausted retry (`MAX_RETRIES` 3) drops the item *after* it
  was applied optimistically to local state, behind a dismissible banner naming
  no booking. Screen and server disagree until the next echo silently reverts it.
  **Confirmed by reading (v17.16.5):** `drainPending`'s give-up branch sets the
  warning and nothing reverts the `setBookings(next)` the hold branch applied.
  **Settling observation is not needed — the DECISION is what is missing.** The
  queue holds an updater function, not a booking, so naming the lost change means
  changing what is queued; and reverting it discards work the user can see. That
  is a design question for Patryk, not a repair. Highest-value of the P3s.
- **CT-2A-11** — `undoKey`'s array separator is collidable by a pasted control
  character in a table id, which reads as "nothing changed" so an undo snapshot
  is never taken. The source comment asserts no text field can produce one and
  nothing enforces it. **Re-rated down (v17.16.5):** `notes` is a `<textarea>`
  and `sanitize` does not strip control characters, so the assertion is false as
  written — but a collision additionally needs two bookings whose whole key
  strings coincide, which no realistic paste produces. **Settling observation:**
  whether any PROD `notes` field contains a control character at all; if none
  does, the honest fix is to make the comment true (strip them in `sanitize`)
  rather than to re-engineer the key.
  Also unrated: nothing checks for duplicate booking ids, and two sharing one
  collapse in the optimiser's assignment map (`genId` collision ≈ 1 in 1.7M,
  same millisecond).
- **CT-2A-08** — the StrictMode patch-dedupe (`lastPatchSigRef`, 2 s) can swallow
  a legitimate A→B→A write with no echo between. Every reachable instance
  self-heals; no lasting divergence was constructed. **Settling observation:**
  construct one, or close the finding. It has now survived two versions without
  anybody managing to.
- **CT-2A-09** — `saveBookings`/`saveBlocks` dispatch the write from inside their
  `setState` updater. v17.16.0 corrected CLAUDE.md's claim that no such shape
  survives, and recorded why the v16.0.0 corruption has not recurred (an
  idempotent per-child diff `update()`, plus the signature dedupe). Converting it
  to the ref-mirror shape is the structural fix the rule actually prescribes.
  **Re-rated (v17.16.5): low value, high risk.** The defect is mitigated two
  layers deep and both layers are now tested (`write-path.js`, v17.16.2); the fix
  rewrites the file through which this repo has lost production data twice. Worth
  doing only as its own version, with nothing else riding along.
- **CT-2A-10** — `2**53` freezes a booking: `old + 1 === old`, so `stampForWrite`
  stops advancing and only a delete clears it. Pinned in the rules suite.
  **Re-rated to negligible (v17.16.5):** every stamp derives from `Date.now()`
  (~1.7e12), so reaching 2**53 needs a hand-written value from outside the app —
  at which point the same writer can do worse things more directly. Keep the
  rules-suite pin; do not spend a version on it.

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
