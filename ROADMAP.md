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

- **Unify TimelineView's grid header with `TimeAxis`.** v17.5.0 added
  `src/components/TimeAxis.jsx` for the Plan view, drawing the same 24px hour
  strip / quarter ticks / centred hour pills / now marker as `TimelineView`'s
  grid header — deliberately as a second implementation rather than a refactor,
  because TimelineView's scroll-follow (`centerNow`'s fraction-per-frame loop),
  FLIP reordering, drag-and-drop and zoom are heavily tuned and entangled with
  that markup. Both now span OPEN…GRID_CLOSE and both use `pct()`, so the
  extraction is straightforward whenever it's worth doing; the risk is all in
  TimelineView, not in the shared piece.

- **Unsaved-changes guard — the last unguarded drafts.** v17.8.0 brought the
  reminder editor, the Block modal and Settings (`GsTextField` × 3 +
  `LayoutSettings`' new-table / rename boxes) into the guard, so every surface
  that holds a draft is now covered. What remains is deliberately out: the
  Settings **steppers and toggles**, which commit on each tap rather than
  holding a draft at all. If a future setting ever gains a typed field, wire it
  into `SettingsContent`'s `reportDirty` aggregator with its own id — that is
  the whole cost.

- **The 6-stop background gradient.** `--bg-app` is a `linear-gradient` across
  six near-identical desaturated blues spanning roughly 3% of perceptual
  difference — imperceptible as a gradient, and the kind of thing that reads as
  stock SaaS wallpaper. The v17.8.0 design audit flagged it but left it alone:
  it is the app's whole backdrop in both themes, so changing it is a look
  decision for Patryk rather than a consistency fix. Either commit to a gradient
  that is actually visible, or collapse it to one flat tinted neutral.

- **The type and control scales.** 13 distinct `fontSize` values (9 → 22,
  including an `11.5`) and 8 distinct button heights (28/30/32/34/36/40/44/54).
  A 1.125-step scale would cover the same range in about 7 sizes, and 34/36
  appear 11 times between them where 32 or 40 would serve. Deferred because it
  is a wide, low-risk-per-site but high-site-count sweep with no user-visible
  defect behind it — unlike the shadow/colour token debt, which was a real
  dark-mode bug and shipped in v17.8.0.

- **Modal title pills have no colour rule.** "New booking" and "Waitlist" are
  accent; "Settings" is grey. Pick one convention (probably: accent for a
  create/act surface, neutral for a configure/read one) and apply it.
