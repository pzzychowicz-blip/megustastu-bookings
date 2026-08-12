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

- **PWA / offline shell — withdrawn in v17.4.1. The worker may have been
  innocent (v17.5.1 finding).** v17.5.1 root-caused the *Android* tablet's
  identical "⟳ Loading bookings…" freeze to something else entirely: the CSP's
  `script-src` blocking Firebase's JSONP long-poll fallback, on any device
  carrying a cached `firebase:previous_websocket_failure` flag. The CSP went
  blocking on 2026-07-24, one day before v17.4.0 shipped. The iOS devices were
  "fixed" by clearing site data — which also clears **localStorage**, i.e. that
  same flag — so the evidence that convicted the worker fits this cause just as
  well, as `public/sw.js`'s own comment hedged at the time. **Before any PWA
  work: re-test on iOS now that v17.5.1's `forceWebSockets()` is deployed.** The
  original outage may simply not recur. Keep the conditions below regardless.
  v17.4.0 shipped an offline-shell service worker; in production it froze the
  app at "⟳ Loading bookings…" on iPhone and iPad (desktop unaffected). It
  didn't reproduce locally under a PROD-mode build against DEV data. v17.4.1
  replaced it with a kill switch (see
  `CLAUDE.md`'s Gotchas table: "A shipped service worker CANNOT be withdrawn
  by deleting it" / "A SW must be testable on the target device before it
  ships" — read both before touching this). The manifest and icon family were
  kept (inert without a worker, still used by iOS add-to-home-screen).
  **Conditions before this returns:**
  1. A way to run the candidate worker on a real iPhone/iPad against
     production-scale data — remote-debug via Safari Web Inspector, or a
     separate Vercel project pointed at a production-sized copy.
  2. A kill switch kept deployed alongside it from day one.
  3. A staged rollout — one device, in service, for a full shift — before the
     tablets get it.

  The offline win is small (Firebase already queues offline data writes; the
  worker only cached the HTML/JS shell the normal HTTP cache handles), so the
  bar for re-adding it is genuinely high.

## Designed, not implemented

- **WhatsApp Cloud API integration (Phase 1b).** Designed but not built — see
  `MGT_WhatsApp_Inbox_Phase1b_Design_Summary.md`. Integration points: the
  `BookingFormModal` callback surface + a new `InboxPanel` component. On
  merge, the WA module's `whatsapp.js` must import
  `normalizePhone`/`formatPhone`/`matchCustomerByPhone` from
  `src/lib/customers.js` rather than keeping its own copies (the
  complementarity contract established in v16.0.0's customer layer).

## Ideas

- **Plain drop-shadow literals.** ~20 inline `boxShadow: "0 1px 4px
  rgba(0,0,0,0.04)"`-style values remain, and `scripts/check-style-invariants.mjs`
  deliberately does NOT flag them: a black shadow cannot invert out from under
  itself, so this is a consistency nit rather than the bug class the white-inset
  rule guards, and a noisy check gets muted. Fold them into `--shadow-soft` /
  `--shadow-btn` opportunistically while touching those files; don't sweep.

- **Modal title pills have no colour rule.** "New booking" and "Waitlist" are
  accent; "Settings" is grey. Pick one convention (probably: accent for a
  create/act surface, neutral for a configure/read one) and apply it.

- **Settings' `Collapsible` headers clip their own text by 2px.** Found while
  verifying v17.9.0, pre-existing and unrelated to it (the v17.9.0 diff does not
  touch `Collapsible`). The header `<button>` measures 17px tall against a 19px
  `scrollHeight` — so "Restaurant", "Opening hours", "Booking durations" and
  "Preferences" each have a descender shaved. The button carries `padding: 0`
  and its tap area comes from the parent row, so the fix is probably a
  `line-height` or letting the button own the row's padding rather than adding
  height. Small, but it is on the first screen of Settings.
