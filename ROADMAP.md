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

- **PWA / offline shell — withdrawn in v17.4.1. The iOS re-test was RUN on
  2026-08-18 and it does not settle the question.** Result on the iPhone against
  PROD (v17.10.0): bookings loaded normally, `getRegistrations()` → **0**,
  `controller: false`, `firebase:previous_websocket_failure` → **null**.

  That confirms three preconditions and answers nothing else:
  1. **The v17.4.1 kill switch demonstrably worked.** No worker is registered or
     controlling on iOS, so a future candidate starts from a clean slate. This
     was condition-zero for ever re-adding one and it is now evidenced, not
     assumed.
  2. PROD is healthy on iOS today.
  3. That device carries no cached websocket-failure flag.

  **Why it cannot discriminate, so nobody repeats it expecting an answer.** The
  two candidate causes of the v17.4.0 freeze were the service worker and the
  CSP blocking Firebase's JSONP long-poll fallback on a device holding that
  flag. With the flag absent *and* v17.5.1's `forceWebSockets()` making the
  JSONP path unreachable anyway, the CSP theory predicts a healthy load — and so
  does "the worker was at fault, and it is gone". **A healthy load is predicted
  by both, so observing one distinguishes nothing.** What v17.5.1 did change is
  that the CSP mechanism can no longer recur at all; the worker's innocence is
  still unproven.

  **The bar is therefore unchanged.** A real test needs a candidate worker on an
  HTTPS deploy exercised on a physical iPhone/iPad — a service worker cannot
  register over a LAN IP, so it can never be tested against the local dev
  server. Conditions 1–3 below stand in full:
  1. A way to run the candidate worker on a real iPhone/iPad against
     production-scale data — remote-debug via Safari Web Inspector, or a
     separate Vercel project pointed at a production-sized copy.
  2. A kill switch kept deployed alongside it from day one.
  3. A staged rollout — one device, in service, for a full shift — before the
     tablets get it.

  Read `CLAUDE.md`'s two Gotchas rows first: "A shipped service worker CANNOT be
  withdrawn by deleting it" and "A SW must be testable on the target device
  before it ships". The offline win remains small — Firebase already queues
  offline writes, and the worker only cached the HTML/JS shell the normal HTTP
  cache handles — so the bar is high on purpose.

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
