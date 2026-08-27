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

- **The rest of the repeated names in Settings → Layout → Table priorities.**
  v17.15.4 named every `Toggle` and both buttons in the Opening-hours row, and
  the same sweep found the priorities editor renders three more controls once
  per size band with a fixed name: the ✕ ("Remove rule", from its `title`) and
  the Table order / Indoor / Outdoor segmented buttons. Three bands ship by
  default, so that is nine buttons carrying three names between them. The fix
  is the one v17.15.4 used on the band's switch — prefix the band's own
  "Party of N to M". Left out deliberately: the version was scoped to the
  switch atom, and this is the priorities editor's own audit. Worth doing with
  a look at whether any OTHER `.map` in the app renders a fixed-name control,
  which is the general shape and the one thing source review reliably misses
  (in the source it is one string; only the running page shows it as three).

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
