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

### The seven-pass review (2026-08-19) — closed

**v17.14.0 emptied it.** The 2026-08-19 seven-pass review shipped across five
versions: v17.10.2 (the findings that needed no decision), v17.11.0 (the ones
staff hit during service), v17.12.0 (the accessibility retrofit), v17.13.0 (the
gate behind all three) and v17.14.0 (the modal stack, and every remaining
follow-up from all four). Source of truth for any individual finding remains
`MGT_Bookings_SevenReview_2026-08-19/` in the context folder.

**Two items were closed as DECISIONS rather than fixes**, both with the numbers
and the pixels in front of Patryk, the way the v17.10.0 amber exemption was
settled. They are recorded in v17.14.0's `REFACTOR_LOG.md` entry and are not
pending work:

- The **waitlist ghost's guest name** stays at its shipped opacity. The dimming
  IS the "proposal, not booking" signal, the ⏳ marker and dashed edge carry the
  meaning independently of the text, and `tests/contrast.test.js` floors all
  eight cases so it cannot deepen without saying so.
- The **List keeps `list`/`listitem` semantics**. `role="grid"` would need the
  "Completed & cancelled" fold restructured out of the row sequence, and that
  restructuring is not happening; ↑/↓ are functionally correct as they stand.

**Do not re-flag these five — they were checked and dismissed during the
review:** the 44px "target size failure" (that is WCAG 2.5.5, Level **AAA**; the
AA bar is 2.5.8 at 24×24 and the app passes it everywhere — leave the 36/40/44
ladder alone) · `weekdayOf` in `constants.js` vs `DaySheet.jsx` (different return
types, renamed in v17.10.2, never merge them) · the notification strip's
"duplicate header" (a mid-animation artifact of `Reveal`'s cached children) ·
impeccable's `side-tab` flag on `TimelineView.jsx` (a CSS triangle — the note
dog-ear; keep the suppression) · contrast numbers measured from
`backgroundColor` alone (must composite the real paint stack — gradients and
per-element opacity — or the figures are wrong in both directions).

### WhatsApp sandbox hardening — scoped to the `wa-sandbox` branch

**Not addressable from `main`.** `verifyStaffToken` and `_lib/rtdb.js` exist only
on the `wa-sandbox` branch, so this cannot ship inside an app version; it lands
whenever that branch next moves. Confirmed by grep during v17.14.0.

Both are needed **before the sandbox ever points at PROD or goes
`WA_SEND_MODE=live`**, and neither blocks it as it stands:

- A uid/email allow-list in `verifyStaffToken`. `verifyIdToken` proves a valid
  token for the project and nothing more, while the backend grants abilities the
  client rules do not (live Gemini calls, live sends from the restaurant's
  number) and Firebase email/password signup is on by default.
- `sanitizeKey` applied to `phoneKey` at the `_lib/rtdb.js` boundary, where it is
  already applied to message ids beside it.

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
