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

- **Stage the offline shell on one device, for a full shift.** The PWA shipped
  in v17.10.1 (see `REFACTOR_LOG.md` for why the v17.4.0 worker is now believed
  innocent, and for the safety design). Two things remain, and neither is code:

  1. **The production offline boot is unverified.** Everything was exercised on
     the restaurant's Android tablet — registration, caching, `/assets/`
     cache-first, zero Firebase URLs cached, `?sw=off`, the kill switch — but
     *cached HTML plus cached hashed bundle* cannot be tested locally: in dev
     the modules are not under `/assets/`, and a production build points at PROD
     Firebase, which the dev environment must never load. After deploying, open
     the app on the tablet once online, then put the device in aeroplane mode and
     reload. It should open and show the day's bookings from cache. If it shows
     the "MGT Bookings didn't start" screen instead, that is the boot watchdog
     doing its job — tap **Reset offline copy** and report it.
  2. **A full shift on one device before the others get it.** The toggle is
     per-device (Settings → General → "Work offline"), so leave it ON for one
     tablet and OFF elsewhere until it has been through a real service.

  **If anything goes wrong:** open the app with `?sw=off` on the end of the
  address — it works even when the app will not start. To remove it from every
  device at once, re-deploy the v17.4.1 kill switch as `public/sw.js` (recover it
  from git history, the commit before v17.10.1); that path was verified on the
  tablet to clear a live worker and its cache within one update cycle.

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
