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
locations and measurements). **v17.10.2 shipped group A**; what follows is the
rest, in the agreed order.

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

- **v17.11.0 — what staff hit during service.** Draw the double-booking (the
  only place the interface actively misleads: measured 288px of overlap painted
  over, rendering a clash as two consecutive sittings) · `StatusIcon` on the
  timeline block (closes a corroborated S1 and WCAG 1.4.1; the component already
  ships) · share the List empty state into Timeline and Plan · bound the expanded
  strip (305px of an 860px viewport with two of six sections live) and
  date-scope it or qualify its times · derive the default timeline zoom from the
  hours span (at 06:00–01:00, 10 of 13 labels truncate and no block shows its
  time) · refuse Timeline as a split partner below a pane-width threshold ·
  split Settings → General (47 controls) into service rules vs personal
  preferences.

- **v17.12.0 — the modal stack.** Replace App.jsx's 15 modal-visibility booleans
  with one ordered stack, each entry carrying its own `onClose`. Patryk signed
  this off and put it BEFORE the accessibility work deliberately: `inert`, focus
  management and Escape then become properties of a stack entry, added once
  instead of to 15 hand-maintained lists. It retires the two recurring bug
  classes CLAUDE.md documents ("the Esc chain bypasses every `onClose`",
  "adding a new drafting surface = three wirings, not one") rather than adding a
  16th entry to each. Fold in the three dismissal Sets (`lateDismissed`,
  `overlapDismissed`, `waitNotifyDismissed`) and the eight preference states
  mirrored one at a time, both of which are the same shape.

- **v17.13.0 — reachable and announced.** Live regions on the strip, toasts and
  form errors, plus `aria-invalid` / `aria-describedby` (4.1.3 is **Level AA**
  and the app has zero of them) · `role` / `tabIndex` / Enter-Space on timeline
  blocks, plan tables and list cards (zero bookings are keyboard-reachable in any
  view) · `aria-activedescendant` and real focus for List's roving selection,
  which is 90% built and needs the ARIA half · landmarks, one `<h1>`, and `inert`
  on the background while a modal is open.

- **v17.14.0 — close the gate behind it.** A colour-literal rule in
  `check:style` (the last unguarded axis: 79 literals, 26 of them one value,
  in the category with the longest defect history) · the waitlist ghost's
  composites in `contrast.test.js` with their own floors (its guest name is
  1.50:1, the worst text in the app, and it sits in the one gap the registry
  declares it has) · icon-size and motion rules, free since compliance is already
  100% · an accessibility gate asserting landmarks, `<h1>`, label association,
  live regions and "every interactive element is focusable" · a weight pass over
  secondary text (84% is still semibold or bolder) · extract the visual system
  out of `CLAUDE.md` into a `DESIGN.md` it links to.

- **WhatsApp sandbox, before it ever points at PROD or goes `WA_SEND_MODE=live`.**
  A uid/email allow-list in `verifyStaffToken` — `verifyIdToken` proves a valid
  token for the project and nothing more, while the backend grants abilities the
  client rules do not (live Gemini calls, live sends from the restaurant's
  number) and Firebase email/password signup is on by default. Plus `sanitizeKey`
  applied to `phoneKey` at the `_lib/rtdb.js` boundary, where it is already
  applied to message ids beside it. Neither blocks the sandbox as it stands.

### Follow-up from v17.10.2

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
