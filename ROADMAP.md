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

- **`.mgt-press` silently kills `.mgt-hover-scale`'s transform transition.**
  `transition` is a shorthand, so two rules of EQUAL specificity do not merge —
  the later one replaces the earlier outright. `.mgt-hover-scale` (index.html
  ~349) sets `transition: transform …`, and `.mgt-press` (~472, i.e. later)
  sets `transition: filter …, background-color …`. Every element carrying both
  classes therefore has no `transform` transition at all, and its 1.08 hover
  SNAPS instead of easing. **28 call sites in `src/` carry both.**

  Fix is one edit: declare the transition ONCE for both selectors, listing
  every property (`transform`, `background-color`, `box-shadow`,
  `border-radius`, `filter`). An element with only one class then carries a
  couple of transitions for properties it never changes, which costs nothing.

  Found and fixed in MGT Scheduling v16.0.0 phase 27, where the same two
  classes had drifted the same way. It went unnoticed there for as long as
  only a handful of buttons had both; when a later pass put `.mgt-press` on
  every button it became app-wide, which is the trajectory this repo is on.
  Verify by reading the computed style of an element with both classes — it
  should list `transform`, and today it will not.

- **No `:focus-visible` affordance anywhere.** `index.html` has zero
  `focus-visible` rules, so a keyboard user tabbing through the app gets no
  indication of where they are. This is the clearest accessibility gap in the
  app. Scheduling v16.0.0 added a global rule and it is worth porting verbatim:

  ```css
  :focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  ```

  `:focus-visible` rather than `:focus` so a mouse click does not paint a ring
  while Tab does; `outline` rather than `box-shadow` because it follows the
  element's border-radius automatically and, sitting outside the box model,
  cannot reflow layout or fight an input's inset shadow.

  Two notes specific to THIS repo, both checked rather than assumed:
  - Scheduling had to remove an `outline: "none"` from its input style first,
    because an inline style beats a global rule. **Bookings has no such
    declaration**, so the rule should reach inputs immediately.
  - `ViewSwitcher.jsx:124` already draws a deliberate `outline: 2px solid
    var(--text-on-accent)` to mark the focused pane in a split. Check the two
    do not read as the same thing on that control.

  Scheduling also folded `outline-color` / `outline-offset` into its shared
  transition list so the ring fades in rather than snapping — worth doing in
  the same edit as the item above, since it touches the same declaration.

- **The reminder banner in `useReminders.jsx` is unthemed.** Lines ~209–216 use
  raw hex/rgba literals (`#78350f`, `rgba(254,243,199,0.8)`, `rgba(22,101,52,0.8)`)
  instead of CSS custom properties, so the banner — its amber shell, its time
  chip and its green "Done" button — renders identically in light and dark and
  reads wrong in dark mode. It is the last surface the v14.2.x token migration
  missed, most likely because it lives in a **hook**, not a component, so a
  `src/components` sweep never sees it. Spotted during the v17.7.0 radius
  rollout (same reason: it wasn't in the design brief's file list). Fix = swap
  each literal for the matching `--warn-*` / `--app-*` token; no logic change.

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

- **Extend the unsaved-changes guard to the remaining draft surfaces.**
  v17.5.0 guards the booking form, the walk-in form and `ManualModal`. Still
  unguarded, by explicit scope decision: the **reminder editor** (`ReminderEditor`
  has its own z-250 modal, not `Overlay`, and re-implements the scrim click
  itself), the **Block modal**, and **Settings** drafts (`GsTextField` commits on
  blur, so closing Settings mid-edit can drop it; `LayoutSettings`' half-typed
  new table likewise). See CLAUDE.md's "Unsaved-changes guard" section for the
  three wirings each new surface needs — the Esc branch is the one that's easy
  to miss.
