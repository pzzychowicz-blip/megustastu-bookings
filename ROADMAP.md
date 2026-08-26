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
