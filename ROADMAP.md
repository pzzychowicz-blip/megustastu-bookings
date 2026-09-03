# ROADMAP

Pending work only — deferred features, follow-ups, and ideas that haven't shipped
yet. Nothing else belongs in this file: no rationale docs, no shipped-version
history (that's `REFACTOR_LOG.md`), no architecture notes (that's `CLAUDE.md`).

**Keep this current.** When an item ships, delete its entry here in the same
PR/commit that ships it — the shipped details go in `REFACTOR_LOG.md` instead.
An item that is SETTLED is deleted too, not annotated: a withdrawal ("it was not
there") and a deliberate won't-fix ("it is there and is not worth a version")
are both decisions rather than pending work, and an entry saying "we checked and
there is nothing here" is not pending work either. The measurement and the
decision go in `REFACTOR_LOG.md`, and any evergreen lesson in `CLAUDE.md`'s
Gotchas. When new deferred work or an idea surfaces, add it here. The `mgt-workflow`
skill is responsible for checking this file at the relevant points in a
session and keeping it in sync.

---

## Deferred

_(nothing pending)_

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
