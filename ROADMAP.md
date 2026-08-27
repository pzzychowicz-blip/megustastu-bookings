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

- **`SBadge`'s v17.15.5 icon didn't reach its two hand-written copies.**
  `PlanView.jsx:382` (the per-table day-queue popover) and
  `CustomersSettings.jsx:96` (a customer's booking history row) each draw the
  status pill by hand — same `BLOCK_BG`/`BLOCK_INK` shape `SBadge` uses, minted
  before the atom existed — and neither picked up `StatusIcon` when the atom
  did. Unifying them is not a pure find-replace: both sit in denser rows than
  the List card (`PlanView`'s queue row already carries time + name + status;
  `CustomersSettings`' row carries date + time + size + status + an optional
  no-show chip), so adding the icon may need `T.small` there rather than the
  atom's `T.body`, or the row needs measuring before landing it. Grep
  `BLOCK_BG\[b\.status\]` for both.

- **The List card's double-booked marker (`ClashIcon`, v17.15.5) has never been
  exercised live.** A clash can't be created through the ordinary UI — the
  assign modal marks an occupied table "busy" and refuses the pick — so it only
  arises from two devices editing offline and merging into an unresolvable
  all-locked conflict. Verify it once such a merge is reproducible (or force one
  by writing two overlapping `_locked` bookings on one table directly via the
  DEV Firebase console) rather than trying to trigger it from the app.

- **The rest of the app's `.map`-rendered controls with fixed names.**
  v17.15.5 closed the Settings → Layout → Table priorities half of this (every
  `Stepper`, the ✕s, the segmented Try-first buttons, the Prefer/Avoid chip
  controls and both `<select>`s now carry their row's identity, with four
  guards in `tests/a11y.test.js` proven against known-bad input). Sweeping the
  priorities editor turned up the same shape in three more places, none of them
  touched:
  - **`LayoutSettings`' Tables and Combos sections** — `Rename table`,
    `Remove table`, `Move left` / `Move right`, `Remove from group`,
    `Remove whole group`, `Remove combo`, `Add a table to this group`. All
    static, all once per table or per group. (Their `Stepper`s were done in
    v17.15.5, because `label` became a required prop and every one of the
    thirteen call sites had to answer it.)
  - **The four notification-strip banners** — `LateBanner`, `OverlapBanner`,
    `WaitAvailBanner` and `ClashBanner` each render one dismiss ✕ per row with
    a single static `aria-label` ("Dismiss this alert" / "…this warning" /
    "…this double-booking warning"). One per late booking, so a busy evening is
    six identically-named buttons. Each row already knows its booking; the name
    should carry it.
  - **`Reminders`' per-row Edit / Delete**, and — measured live on a 10-booking
    day — **`ListView`'s own card actions**: `Assign` ×10, `Delete` ×10,
    `cancelled` ×10, `completed` ×9, `seated` ×8. This one needs a judgement
    first, not just a fix: the card is a `role="listitem"` with a composed
    `aria-label`, so a screen-reader user gets the booking from the ancestor
    and "Assign" is unambiguous in context — but a voice-control user saying
    "click Assign" has ten targets. Decide whether ancestor context is enough
    before renaming sixty controls.

  The general rule this keeps re-proving: **in the source it is one string;
  only the running page shows it as N.** Read the computed names out of the
  live app — that is what caught the size band in v17.15.4 and the ListView
  card actions here.

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
