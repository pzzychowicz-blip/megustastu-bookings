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
- **The Plan legend chip has no `boxShadow: var(--shadow-flat)`**, which its
  TimelineView twin has carried since v17.11.0. v17.15.7 matched the twin in
  every other respect (inline-flex, gap, `StatusIcon` at `IC.inline`) and left
  this deliberately out of scope: it is a decision about a chip on a different
  card, and the plan's header row has no other shadowed chip. One line either
  way — make the two legends identical, or record why they differ.

### Crash test v17.15.7 — confirmed and unfixed

The findings from the three adversarial QA sessions that are still open
(`MGT_Bookings_CrashTest_Phase4_FixPlan_Handoff.md` in the context folder holds
the full register and the reproductions). **v17.16.0 shipped CT-2C-01 and
CT-2A-02; v17.16.1 shipped CT-2A-01 and CT-2A-03's server half; v17.16.2 shipped
CT-2B-01, CT-2B-02 and CT-2B-03, and closed §7's `usePersistence` extraction** —
seven of twenty-two. Delete an entry as its fix lands; the detail then goes in
`REFACTOR_LOG.md`.

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

- **The three view buttons share one accessible name (P3, measured v17.16.2).**
  `ViewSwitcher.jsx:129` sets `title={gesturesOn ? "Right-click or hold to add to
  a split view" : undefined}` on the Timeline / List / Plan buttons and no
  `aria-label`. Read out of the LIVE accessibility tree, all three report that
  same string as their name — so the app's primary navigation announces as three
  identically-named controls describing a secondary GESTURE rather than the view
  each one opens, and none is sayable by voice control. Same family as the
  v17.15.4 Label-in-Name finding CLAUDE.md records, and the same "a static name
  is not one name, it is N identical ones" shape as the `.map`-rendered controls.
  Found while verifying something else (the `p` key had not switched views and
  `find("Plan")` matched nothing, which is what exposed it) — not by the a11y
  sweep, which is a static AST pass and cannot compute a name. **Worth checking
  what the browser actually computes before choosing the fix**: the buttons do
  have visible text, so `title` should only be a fallback, and the mechanism was
  not pinned down.

- **`EMPTY_FORM.date` is evaluated once at module load (P3, new in v17.16.2).**
  `constants.js` builds it at import, so an app left open across midnight holds
  yesterday's default. Not currently reachable in a saved booking: all three
  `openForm` call sites (`openNew`, `bookAgain`, `bookFromWaitlist`) set `date`
  explicitly. Fixing it means making the default a getter or dropping `date` from
  the constant — worth doing when something else touches that object.

- **CT-2C-02 (P2) — focus restoration never works, on any modal.** `Overlay`'s
  cleanup calls `prev.focus()` so the keyboard lands where it was — which is
  exactly where it does not land: the opener sits inside a subtree marked
  `inert`, an inert element cannot take focus, and the call is a silent no-op.
  Verified on "+ New" and Settings; all four inert containers cover page content,
  so there is no opener for which it works. Fix: restore focus **after** `inert`
  is lifted, not before. Invisible to `tests/a11y.test.js`, which is a static AST
  sweep.
- **CT-2B-04 (P2) — a parenthesised country code splits one customer in two, and
  the fix re-keys existing records.** `normalizePhone` keeps `+` only as the
  first character, so `"(+34) 600 123 456"` → `"34600123456"`, a different
  identity from `"+34600123456"`. Visits, no-show counts and history split; the
  repeat-no-show marker trips at 2 and may never fire; "Delete customer & all
  data" reaches only the half you clicked. Punctuation and spacing normalise
  correctly — only the plus's POSITION is wrong. **One line, but it
  retroactively re-keys customers already split in PROD, so it needs a decision
  rather than a quiet fix.**
- **CT-2B-05 (P2) — a wrong guest join files one person's visits under another's
  number.** `customerIndex` keys as `phone || alias[guestId] || guestId`, so
  after a mis-join the phone-LESS bookings of the other person land under the
  first person's number (3 visits under one key, measured) and "Delete customer &
  all data" takes all of them. Bounded: two REAL phones under one `guestId` stay
  two customers. **Open question for Patryk:** what should the delete reach after
  a mis-join? The safe answer may be to exclude bookings whose own phone differs
  from the row's key.
- **CT-2A-03 (P2), client half — `sanitize` guards truthiness only.**
  `time: 2000` survives `b.time || "13:00"` and then `toMins` (`t.split(":")`,
  83 call sites) throws. Also silently mis-read rather than throwing:
  `size:"many"` → a party of **2**, `duration:"long"` → **90 min**,
  `tables:"3"` → **no table**, and an unknown status for which `isActive`
  returns true. v17.16.0's error boundary contains the crash; it does not make
  the data readable.
- **CT-2A-05 (P2) — the optimiser is not order-invariant.** `optimise`'s four
  sort keys are not a total order, so ties fall back to array position.
  Measured: assignment differs in **1000/1000** shuffled days; the number of
  UNPLACED bookings differs in **2/1000** (worst: seed 47, n=24, 2 vs 3). Array
  order is not identical across devices — one that just created a booking has it
  appended, one that received it by snapshot has it key-sorted. Cross-device
  divergence is argued, not reproduced. **Open question: is a tie-break worth it
  at 2/1000?**

**P3 — minor, each its own commit if taken at all.**

- **CT-2A-07** — an exhausted retry (`MAX_RETRIES` 3) drops the item *after* it
  was applied optimistically to local state, behind a dismissible banner naming
  no booking. Screen and server disagree until the next echo silently reverts it.
- **CT-2A-08** — the StrictMode patch-dedupe (`lastPatchSigRef`, 2 s) can swallow
  a legitimate A→B→A write with no echo between. Every reachable instance
  self-heals; no lasting divergence was constructed.
- **CT-2A-09** — `saveBookings`/`saveBlocks` dispatch the write from inside their
  `setState` updater. v17.16.0 corrected CLAUDE.md's claim that no such shape
  survives, and recorded why the v16.0.0 corruption has not recurred (an
  idempotent per-child diff `update()`, plus the signature dedupe). Converting it
  to the ref-mirror shape is the structural fix the rule actually prescribes.
- **CT-2A-10** — `2**53` freezes a booking: `old + 1 === old`, so `stampForWrite`
  stops advancing and only a delete clears it. Pinned in the rules suite.
- **CT-2A-11** — `undoKey`'s array separator is collidable by a pasted control
  character in a table id, which reads as "nothing changed" so an undo snapshot
  is never taken. The source comment asserts no text field can produce one and
  nothing enforces it. Also unrated: nothing checks for duplicate booking ids,
  and two sharing one collapse in the optimiser's assignment map (`genId`
  collision ≈ 1 in 1.7M, same millisecond).
- **CT-2B-06** — on a legacy id-less `tableBlocks` node, `sanitizeBlock` mints a
  fresh id on every read, so a resync between opening the block list and tapping
  Unblock makes the removal a silent no-op. Self-limiting and fails safe.
- **CT-2B-07** — the kitchen-busy chip fires at `starts >= KITCHEN_TABLE_LIMIT`
  while the confirm fires at `starts + 1 >= LIMIT`. With the limit at 3, at
  exactly two existing starts the dialog appears with no busy chip to explain it.
  Both the booking and walk-in paths.
- **CT-2B-08** — a second join naming an already-joined seed correctly refuses to
  re-home it, but the NEW booking keeps its own minted `guestId` and lands in a
  group of one while the operator believes the two were joined. Nothing on screen
  distinguishes this from success.
- **CT-2B-09** — `stampGuestSeed` is an unconditional `.map`, so a no-op call
  returns a fresh array: the exact shape v17.14.0 removed from
  `bookingsAfterAction` and made a stated contract, in the same save path.
  Harmless today because the write diff compares content.

### The recommendation that outlives the fixes — DONE in v17.16.2

- ~~**Extract the pure core of `usePersistence.js`.**~~ Shipped as
  `src/lib/write-path.js` + `tests/write-path.test.js` (31 tests). `pastCloseMins`
  went to `booking-logic.js` in the same version. The crash test's **55%
  confidence rating is now the thing to revisit** — that was the condition it set,
  and it has been met. The rating lives in the §25 report, not in this repo.

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
