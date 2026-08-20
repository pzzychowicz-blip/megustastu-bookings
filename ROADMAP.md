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

### The seven-pass review (2026-08-19) — remaining versions

Source of truth for any individual finding: `MGT_Bookings_SevenReview_2026-08-19/`
in the context folder (`_synthesis.md` for the inventory, `01-…07-` for
locations and measurements). **v17.10.2 shipped group A, v17.11.0 the
service-visible group, v17.12.0 the accessibility retrofit and v17.13.0 the
gate behind all three**; what follows is the rest.

**Note the order changed twice.** At v17.12.0 the modal stack had been staged first, on
the reasoning that `inert`, focus management and Escape would become properties of
a stack entry. Re-checked against the code before branching, that coupling was
weaker than it read — `Overlay` already owned `role="dialog"`, `aria-modal`, the
focus trap and focus restore; the Escape chain was already correct (the stack
makes it *maintainable*, not *correct*); and `inert` needed exactly one boolean.
Patryk confirmed the swap. The one genuinely entangled piece, `anyModal`, was
brought forward INTO v17.12.0 rather than added to and cleaned up after.

**And again at v17.13.0**, which Patryk moved ahead of the modal stack. The
reasoning holds either way and is worth stating: v17.12.0 shipped roughly forty
individually-correct decisions that nothing in CI could see, and every one of
them is invisible when removed — the app looks and behaves identically to a
mouse user without them, which is the same property that let them be missing for
seventeen versions. A fix with no gate behind it has a half-life. The modal
stack, by contrast, is a refactor whose defects announce themselves the moment
you press Escape.

**Do not re-flag these five — they were checked and dismissed during the review:**
the 44px "target size failure" (that is WCAG 2.5.5, Level **AAA**; the AA bar is
2.5.8 at 24×24 and the app passes it everywhere — leave the 36/40/44 ladder
alone) · `weekdayOf` in `constants.js` vs `DaySheet.jsx` (different return types,
renamed in v17.10.2, never merge them) · the notification strip's "duplicate
header" (a mid-animation artifact of `Reveal`'s cached children) · impeccable's
`side-tab` flag on `TimelineView.jsx` (a CSS triangle — the note dog-ear; keep
the suppression) · contrast numbers measured from `backgroundColor` alone (must
composite the real paint stack — gradients and per-element opacity — or the
figures are wrong in both directions).

- **v17.14.0 — the modal stack.** Replace App.jsx's 15 modal-visibility booleans
  with one ordered stack, each entry carrying its own `onClose`. It retires the
  two recurring bug classes CLAUDE.md documents ("the Esc chain bypasses every
  `onClose`", "adding a new drafting surface = three wirings, not one") rather
  than adding a 16th entry to each. Fold in the three dismissal Sets
  (`lateDismissed`, `overlapDismissed`, `waitNotifyDismissed`) and the eight
  preference states mirrored one at a time, both of which are the same shape.
  **`anyModal` already landed in v17.12.0** — one derivation in App, replacing
  the 17-term expression that was written out twice — so the stack's first move
  is to make that `stack.length > 0` and every reader is already pointed at it.

- **WhatsApp sandbox, before it ever points at PROD or goes `WA_SEND_MODE=live`.**
  A uid/email allow-list in `verifyStaffToken` — `verifyIdToken` proves a valid
  token for the project and nothing more, while the backend grants abilities the
  client rules do not (live Gemini calls, live sends from the restaurant's
  number) and Firebase email/password signup is on by default. Plus `sanitizeKey`
  applied to `phoneKey` at the `_lib/rtdb.js` boundary, where it is already
  applied to message ids beside it. Neither blocks the sandbox as it stands.

### Follow-up from v17.13.0

Two contrast numbers this version MEASURED and deliberately did not answer. Both
are design calls with a visual trade-off, both are recorded in
`tests/contrast.test.js` with floors so they cannot get worse, and both were
left out of a gate-closing commit on purpose — the amber exemption was decided
this way in v17.10.0, with the numbers and the pixels in front of Patryk.

- **The disabled primary button's label is not dim, it is gone.**
  `--btn-disabled` under white ink measures **1.31:1** in light. WCAG 1.4.3
  exempts inactive components, so this is not a violation — but a staff member
  who has not picked a date sees an empty grey pill where "Save booking" should
  be, in the two form footers, `ReminderEditor` and `ManualModal`. Options are a
  darker fill, or muted ink instead of white; both are one token.

- **The waitlist ghost's guest name is the lowest text contrast in the app.**
  1.39:1 light / 1.82:1 dark at the shipped 0.55 opacity, and 1.27 / 1.63 for a
  reshuffle-only match at 0.4. The amber exemption's justification does not
  reach it: that argument rests on the one piece of INFORMATION moving onto an
  opaque chip, and a ghost's chip is inside the ghost and dims with it. Raising
  the opacity erodes the "this is a proposal, not a booking" signal, which is
  the ghost's entire job — so this is a genuine trade, not an oversight to fix.

### Follow-up from v17.12.0

v17.12.0's own `/code-review` ran at xhigh and returned 10 findings; **all ten
were fixed on the branch** (commits 12–20), so nothing from it is listed here.
Three are worth remembering rather than re-deriving, and they live in `CLAUDE.md`
now: `inert` marks the page behind the dialog and not `<main>` (which also holds
the toast live region and the Undo pill); a `role` SUBSCRIBES an element to every
shared rule written for that role; and a roving tab stop must be resolved against
the elements actually rendered.

- **A visible skip link.** v17.12.0 added the landmarks, which are the
  programmatic bypass and cost nothing visually; a skip link is new chrome that
  appears on focus, which is a design decision rather than a defect fix. Worth
  doing for sighted keyboard users — the app is explicitly keyboard-driven — but
  it needs a look, not just a wiring.

- **`aria-live` on the day's own content.** Changing the viewed date, or a
  booking's status changing under you, is announced by nothing. The strip and
  the toasts now speak; the views themselves still do not. Needs care: a live
  region over a 13-booking timeline would be unbearable, so this is a
  "the day changed to Thursday 21 August, 12 bookings" summary, not a region
  over the grid.

- **A multi-table booking reads "5A and 5B and 6".** `describeBooking` joins with
  `" and "`, which is right for two tables and wrong for three. Now that the
  sentence has one source (`booking-logic.js`) this is a one-line change plus a
  test — deliberately not made in the extraction commit, whose whole claim was
  byte-identical output.

- **`role="grid"` for the List, if the finished fold ever moves.** The cards are
  `role="listitem"` because a grid's children must be rows and the
  "Completed & cancelled" `Collapsible` sits between them. If that fold is ever
  restructured, `grid`/`row`/`gridcell` is the better fit for rows that contain
  their own controls, and would make ↑/↓ semantically correct rather than merely
  functional.

### Follow-up from v17.11.0's `/code-review`

Seven findings Patryk deferred; the five substantive ones shipped in v17.11.0.

- **The empty-day prompt still disagrees on a cancelled-only day.** ListView's
  `day` includes cancelled bookings while Timeline's and Plan's exclude them, so
  on a day whose bookings were all cancelled Timeline and Plan show "Nothing
  booked for this day yet." while List renders its card list — which with
  `showFinished` off is a nearly blank screen with no prompt and no New-booking
  button, i.e. the v17.8.0 defect `EmptyDay` was written to fix. Compute one
  shared `isEmpty` in App, the way `dayClosed` and `emptyWalkin` already are.

- **`findConflicts` allocates pair objects it discards, inside the
  reconciliation loop.** It delegates to `findClashes`, which builds an object
  and runs an `Array.filter` intersection per clashing pair — for data
  `findConflicts` throws away — and the reconciler calls it up to 20 times per
  dirty date. An `idsOnly` flag, or letting `findConflicts` keep its own tight
  loop, removes it.

- **`hoursFor(viewDate)` is evaluated four times per App render** (`viewHours`,
  the notifSections `dayClosed`, the `dayClosed` const, and the header). One
  value, four names.

- **`clashSpans` emits one band per PAIR rather than per distinct span**, so
  three mutually-clashing bookings on one table draw three coincident bands.
  Merge overlapping intervals per table first.

- **The EmptyDay walk-in prop is `onWalkin` in TimelineView and `emptyWalkin` in
  PlanView.** One input, two names; the next surface will guess wrong and get a
  silently missing button.

- **`pickView`'s swap branch skips `tlPaneOk` and does not invert `ratio`.** It
  can drop the Timeline into a too-narrow pane and rely on the repair effect to
  reorient the split a render later, so a plain view tap visibly flips the
  layout. `swapSides` already inverts the ratio; this branch should too.

- **`clashRowId` has no test** despite its comment making the `\u001f` escape
  (never the raw byte) load-bearing — and `"_"`/`"-"` are reachable from
  recurring occurrence ids, the exact collision it warns about.

### Follow-up from v17.10.2

- **Make `bookingsAfterAction` return its input array on a no-op.** From
  v17.10.2's `/code-review` (altitude). That version fixed the infinite render
  loop at ONE call site; the root cause — the function returning a fresh array
  whether or not the pass changed anything — is untouched, so the sibling manual
  branch still survives only because it happens to break with `next === prev`,
  and the next `useEffect` that depends on `bookings` and calls it reintroduces
  the same loop with no warning. Fixing it at the source removes the bug class
  for every caller and makes the CLAUDE.md gotcha unnecessary. Deferred because
  it changes a function **39 call sites** depend on — that is a version of its
  own, and it belongs with the v17.12.0 App.jsx work.

- **`dayBookingsSig` rescans the whole bookings array twice per dirty date.**
  From the same review (efficiency). It filters one date out of all 513+
  bookings, and the reconciliation pass calls it twice per dirty date. Hoisting
  the `next` side where it has not been reassigned, or passing a pre-filtered
  day slice, removes most of it. Low impact — `dirty` is empty on a clean
  database — but it is in the effect that runs on every bookings change.

- **The notification strip's lid radius ignores the pane's 1px border.** From the
  same review (polish). The lid carries the pane's own 14px `R.card`, so the
  geometrically correct inner radius is 13px and a sub-pixel sliver of pane can
  show at the corners under the lid's hover veil. There is no token for "card
  minus a border", so this needs either a `calc()` or a decision to accept it.

- **Extract the post-sync reconciliation decision into `lib/`.** v17.10.2 fixed
  the infinite render loop it caused, but the decision itself still lives in a
  `useEffect` in App.jsx — which is exactly the shape the review's own rule
  names ("logic that decides something the restaurant acts on does not live in a
  `useEffect`"; `placeWaitlist` and `presenceState` were extracted for this
  reason). Only the pure `tableAssignSig` half is testable today. Natural
  companion to the v17.12.0 App.jsx work.


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
