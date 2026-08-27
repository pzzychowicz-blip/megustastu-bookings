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
