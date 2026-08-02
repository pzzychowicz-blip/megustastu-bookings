# CLAUDE.md

Instructions for Claude (and Claude Code) when working in this repository.

This file is the living architecture record. When a change adds a feature or makes a
decision, record it here (file-structure block + locked-decisions). Keep per-file notes
scannable; archive old per-version sub-notes when a block gets long.

---

## Project

**Me Gustas Tú (MGT) Booking System** — private staff-facing booking management web app for a restaurant in the Canary Islands.

- **Owner / sole developer:** Patryk Zychowicz (pz.zychowicz@gmail.com)
- **Stack:** React 19, Vite, Firebase Realtime Database + Auth, deployed on Vercel
- **Repo:** `github.com/pzzychowicz-blip/megustastu-bookings`
- **Live:** `https://megustastu-bookings.vercel.app/`
- **Current version:** see `src/App.jsx` → `__APP_SIGNATURE__.version` (single source of truth)
- **Layout context:** 9 outdoor tables (1A, 1B, 2, 3, 4, 5A, 5B, 6, 7) + 4 indoor (i1–i4). Operating hours 13:00–22:00.
- **Sibling app:** MGT Scheduling (`github.com/pzzychowicz-blip/megustastu-scheduling`) — same UI conventions, separate repo, separate Firebase project. Use it as the style/pattern reference; keep the two consistent. Improve a shared pattern in one app → port it to the other rather than letting them drift.

---

## File structure

```
src/
├── App.jsx                          orchestration layer (~2360 lines; v17.3.3–.5 de-monolith: keyboard → useKeyboardShortcuts, toasts/banners → StatusToasts/AppBanners, and doSave split IN-FILE into doSaveEdit/doSaveNew + a validating doSave() orchestrator — bodies verbatim, still closures inside BookingApp)
├── firebase.js                      DEV/PROD env switch (import.meta.env.DEV) — DO NOT bypass the split; v17.5.1 also calls `forceWebSockets()` BEFORE `getDatabase()` (must precede it — the SDK asserts transports are chosen before the first Database instance). Do not remove: the long-poll fallback it disables is JSONP, which our CSP blocks, and one cached WebSocket failure would otherwise brick a device permanently
├── hooks/
│   ├── usePersistence.js            Firebase + write-guards (loaded/empty + v15.2.0 freshness-resync gate + v16.0.0 wake-race fix: a gap trip resets isConnectedRef so resync waits for a FRESH .info/connected) + v15.5.0 per-booking-node diff-write (+ v16.0.0 baseUpdatedAt CAS + StrictMode patch-dedupe; blocks via revGuard) + lazy array→keyed migration + auto-extend + auto-complete-after-close (v15.1.0) + v17.3.0 `bookingsReady` state (false until the FIRST bookings snapshot lands — drives App's "⟳ Loading bookings…" floating toast)
│   ├── usePresence.js               v17.3.0 — real-time device presence for the connection-dot popover. Subscribes to .info/connected → on connect pushes ONE ephemeral child `presence/{pushKey}` {email, ua (deviceLabel from userAgent), since:serverTimestamp} with onDisconnect().remove() (self-cleans on tab-close/sleep/drop); subscribes to `presence` → returns {devices[], myKey}. EXEMPT from the CAS/revGuard rule (ephemeral, per-connection, disjoint push-key path — no stale-overwrite class); `presence` inherits the top-level .write:auth!=null with NO .validate, so NO Firebase console step
│   ├── useReminders.jsx             reminder state + listeners + banner JSX (v16.0.0: ref-mirror saves — the set()-in-updater shape is GONE — + revGuard CAS writes)
│   ├── useNowMins.js                15s clock tick
│   ├── useAutoOptimizer.js          optimizer thermostat + daily reset (cutoff/auto-switch editable via useOptimizerSettings — v15.0.0)
│   ├── useWalkin.js                 walk-in state + handlers (v17.5.0: `walkinBaseline` STATE snapshot set in openWalkin only → returns `walkinDirty` for the unsaved-changes guard)
│   ├── useWinW.js                   viewport-width hook
│   ├── useThemeMode.js              dark-mode resolver (localStorage pref → isDark; writes data-theme)
│   ├── useOperatingHours.js         PER-WEEKDAY open/close + closed days → constants.js live bindings via hoursFor(date)/setActiveDayHours; Firebase settings/operatingHours (v14.4.0; 24h v14.5.0; per-weekday v15.0.0)
│   ├── useDayShifts.js              editable Afternoon/Evening split hour → Firebase settings/dayShifts (v14.6.0; 2nd settings node; split clamped to weekRange() v15.0.0)
│   ├── useOptimizerSettings.js      editable optimizer cutoff (0–24, full-day) + auto-switch → Firebase settings/optimizer (v15.0.0; 3rd settings node)
│   ├── useBookingDefaults.js        editable default booking-duration tiers — a VARIABLE-LENGTH list `tiers:[{max,dur}…]` (sorted, ≤6) + catch-all restDur (size s → first tier with s≤max, else restDur; feeds getDur via the DUR_TIERS live binding; legacy flat t1Max… shape converts on read) + running-late thresholds (lateEnabled/lateWarnMin/lateNoShowMin) + table-turn prediction (freeSoonEnabled + v16.3.0-correction freeSoonWindow — minutes ahead the "freeing soon" line/pills look, 5–60 step 5, default 15) + v17.0.0-round-7 banner master switches (overlapWarnEnabled/reshuffleSuggestEnabled, default on) + v17.6.0 separation between bookings (turnaroundEnabled default OFF — sanitized `=== true`, the INVERSE of the default-on `!== false` idiom — + turnaroundMin 5–60 step 5, default 15; drives setTurnBuffer) → Firebase settings/bookingDefaults (v16.1.0; 5th settings node; revGuard CAS)
│   ├── useWaitlist.js               waitlist CRUD → Firebase `waitlist` (6th collection; reminders-pattern loaded-guard; ref-mirror save — set() OUTSIDE the updater, see the sync-echo gotcha; auto-prunes past dates) (v16.0.0)
│   ├── useDeferredCompute.js        post-paint deferred computation (v16.3.0 perf phase 2) — {value,pending}; runs the compute AFTER a guaranteed paint (rAF→setTimeout, + a 120ms fallback because a HIDDEN tab fires no rAF — hit live in the Preview pane), run-token superseding, value=null while (re-)checking (never a stale answer). Used by the form/walk-in availability scans; the ⏳ row's Reveal ease is the visual grace
│   ├── useRecurring.js              standing/weekly booking RULES → Firebase `recurring` (7th collection, whole-node object {v,enabled,horizonWeeks,rules[]}; revGuard CAS on recurringRev; ref-mirror save). Occurrences are normal /bookings children (see the generator in App.jsx). v16.3.0-correction: DEFAULT OFF — DEFAULT_RECURRING.enabled=false + sanitize `enabled: src.enabled===true` (absent/legacy node ⇒ off), so the whole feature (incl. the form "Repeat weekly" toggle) stays hidden until enabled in Settings (v16.3.0)
│   ├── useRevealRows.js             extracted per-row ease-in/out lifecycle (renderIds/openIds/sig/prune) shared by LateBanner + WaitAvailBanner (v16.3.0)
│   ├── useKeyboardShortcuts.js      v17.3.3 — the global keyboard shortcuts + the v17.3.1 neutral-space List-deselect mousedown, extracted VERBATIM from App.jsx (first de-monolith extraction). App passes ONE ctx object per render; the hook refreshes a ref from it in a dep-less effect (lint-clean vs the old in-render write) and mounts its two window listeners once. SUMMARY_KEY ("s")/WEEK_KEY ("m") + the SETTINGS_TABS/validateReminderDraft imports moved here with the handler. Adding a shortcut = add state/handler to the ctx at the App call site AND read it as K.<name> here
│   ├── useGeneralSettings.js        v17.0.0 — settings/general (6th settings node; revGuard CAS generalRev): restaurantName · currency · phonePrefix · regularMin · lateCollapseMax · waitMatchWin · undoSecs (the ex-hard-coded literals; seeds = historical values, absent node = no-op) + v17.2.0 defaultBookingSize/defaultWalkinSize (starting party size of the new-booking/walk-in forms, seed 2 = the ex-literals; openNew merges size into its EMPTY_FORM spread, useWalkin takes a defaultWalkinSize arg)
│   ├── useUserPrefs.js              v17.6.0 — settings/users/{uid}/prefs (8th settings node, revGuard CAS `prefsRev` nested INSIDE each $uid). The FIRST settings node that is not restaurant-wide: theme · reduceMotion · planGestures · navLocked · splitEnabled follow the signed-in ACCOUNT to any device. App width, the 4 Timeline zoom values and the saved split LAYOUT stay per-device on purpose (screen properties). Tri-state fields — `null` means "this user has never chosen", which is what makes the device-fallback seeding work; never coerce an absent field to `false`
│   └── useLayout.js                 editable table layout (tables add/remove/rename · capacity · zone · join-groups · combos · v15.9.0 optimizer priorities · v17.0.0 floorPlan {room,tables:{id:{x,y,shape,w,h,rot,chairs}},walls,doors} — sanitizeFloorPlan auto-places missing tables, NOT in layoutSignature) → constants.js live bindings via setLayout; sanitize enforces single-group membership + normalizes priorities (whole-object DEFAULT fallback, per-field empty); Firebase settings/layout (v15.0.0; 4th settings node)
├── components/
│   ├── BookingFormModal.jsx         booking form (controlled component; v16.0.0 phone-autocomplete dropdown + Regular/no-show customer chips — CLICKABLE (▸/▾): reveal the past-bookings / no-shows list via Reveal, the WA ConversationView disclosure ported; chipHist keyed by normalized phone so a phone edit self-closes it + "Add to waitlist" under the no-tables banner) — v16.4.0: NAME-field autocomplete too (searchGuestsByName, new bookings only — phone customers collapse by phone, phone-LESS guests are ONE ROW PER BOOKING/never merged, each row shows phone-or-"no phone" + last date); Regular chip = "Regular · N past visits" ONLY at regularCount≥2, else "1 past visit". v17.3.0: both autocomplete dropdowns fetch up to 20 matches and scroll (maxHeight 264, overflowY:auto) instead of hard-capping at 5/6 — ~5 rows visible, the rest reachable by scroll (better on small screens)
│   ├── TimelineView.jsx             Gantt-style timeline (horizontal scroller; v16.0.0 start-time chips — CONFIRMED blocks only (seated/completed never chip) + ALL-OR-NOTHING across the day's confirmed blocks (shown only when every confirmed block ≥140px — completed blocks' frozen tiny widths must never kill the others' chips), v16.1.1 chip wrapped in a HORIZONTAL Reveal so the sibling name eases in lockstep instead of snapping (was a Presence transform-slide → jump) + " ⚠" label marker for 2+ no-show phones; v16.1.0 running-late amber border on confirmed blocks + quick-status "No show" option at the noshow stage — overstay warnings keep border precedence; v16.1.1 quick-status popup buttons get .mgt-hover-scale; v17.0.0-correction drag&drop — drag a block vertically to another row (mouse 6px threshold; touch hold ~800ms past the quick-status) → App's dropOnTable moves or SWAPS table sets; v17.2.0 per-device zoom/follow settings via scalar props followZoom/followLeadMins/maxZoom (App's tlSettings — the ex-hard-coded 4×/30min/5×) + group hover-lift: data-bk + mouseenter/leave toggle .mgt-group-hover on ALL of a multi-table booking's cells (DOM classList, no React state))
│   ├── ListView.jsx                 sorted card list; completed/cancelled fold into a controlled Collapsible — open state in BookingApp for keyboard-nav sync (v15.1.0); v16.0.0 amber "⚠ no-show ×N" tag; v16.1.0 running-late amber border + "N min late" tag + one-tap "No show" button at the noshow stage; v17.3.1 `focusReq` prop — a scroll-REQUEST counter (App's `listFocusReq`, bumped only at the PROGRAMMATIC selection sites: search-jump + ↑/↓ nav, never a card click) scrolls the focused card into view via its existing `data-flip-id`, re-firing on a rAF+120/300/550/850ms schedule so the SlideView/finished-fold animations can't land it off-centre; App also clears the selection on a mousedown/touchstart with no `closest("[data-flip-id]")` ancestor — neutral space — gated on List view + the keyboard handler's `anyModal`, and on **Esc** as the last branch of the Escape z-order chain (v17.0.0 round 8: the 🔍/⚙ pair it carried since v16.4.0 moved OUT to App's date-nav row — see ViewTools.jsx; List has no chrome of its own again); v17.6.0 the duration tag survives the visit — seated keeps the live green "N min", completed gains a muted "stayed N min" from `stayedMins(b)`, and renders NOTHING when that returns null (a direct confirmed→completed never had its duration truncated, so its number would be the schedule, not the stay)
│   ├── LateBanner.jsx               "Running late" in-flow banner — one Reveal-eased row per today's late confirmed booking (lifecycle now in useRevealRows, v16.3.0); No-show button slides in via Presence → onNoShow=doCancelBooking(id,true); byId Map avoids O(n·m); v16.3.0 COLLAPSIBLE header (count) + per-row ✕ dismiss (App's lateDismissed Set → lateBannerMap; list/timeline keep the unfiltered lateMap); v16.4.0 default-COLLAPSED when >2 late (open init = lateMap size ≤2; initial-only, no auto-recollapse)
│   ├── BannerRows.jsx               v17.0.0 review fix #6 — shared shell for the in-flow rows banners (collapsible count header · outer Reveal · per-row Reveal via useRevealRows). LateBanner + OverlapBanner + (v17.1.0) WaitAvailBanner supply only title + a renderRow(id) render-prop; v17.1.0 optional bg/border/textColor token props (default amber warn family; waitlist passes the green suggest family). collapseMax = settings/general lateCollapseMax for ALL THREE
│   ├── OverlapBanner.jsx            v17.0.0 round 7 — Overlap warnings on the BannerRows shell (per-row Reassign + ✕ dismiss); master switch settings/bookingDefaults.overlapWarnEnabled; dismissed Set in App (overlapDismissed, session-only, day-change reset)
│   ├── WaitAvailBanner.jsx          v16.3.0 waitlist "table free" in-flow banner (suggest/green) — one row per TODAY'S waiting party a table currently fits (App's waitAvail), Book (bookFromWaitlist) + ✕ dismiss. v17.1.0: on the BannerRows shell (green tokens via the shell's token props) + honors "Collapse banners above". Replaced the old 6s waitFreeToast
│   ├── StatusToasts.jsx             v17.3.4 — the v15.8.0 floating TRANSIENT-toast layer extracted VERBATIM from App.jsx (de-monolith #2): one-slot priority crossfade (loading→resync→reconnect→syncfix→waitadded→undo→dragmsg→reshuffled→load), always-mounted container, Undo pill via onUndo prop. Rendering ONLY — all state stays in BookingApp (Phase D3); App mounts it in the relative wrapper around SlideView{mainView}
│   ├── AppBanners.jsx               v17.3.4 — the three simple PERSISTENT in-flow banners (offline / write-error / inefficiency), each in its own Reveal, extracted VERBATIM from App.jsx (de-monolith #2). ineffShow is computed in App and passed as a boolean; the row banners (Overlap/Late/WaitAvail/reminders) were already components and stay mounted by App right after this
│   ├── SearchPanel.jsx              v16.3.0 global booking search Overlay — auto-focused input, searchBookings across ALL dates (upcoming-first), tap → jump to the day + focus in List (pendingSelectRef survives the day-change reset). Header 🔍 + "/" shortcut
│   ├── DaySheet.jsx                 v16.3.0 printable day sheet — print-ONLY DOM portalled to <body> (sibling of #root); @media print in index.html hides #root + reveals it; HARD-CODED LIGHT (print stays light); Print button in the Summary body
│   ├── Summary.jsx                  day-summary panel — covers by hour + shift; lives IN the date-nav row (flex:1, grows downward when expanded) + today-only live status bar (seated·upcoming·seats-filled) (v14.6.0; relocated + status bar v14.8.0; "Summary" word dropped + Week→"More" button v14.9.0)
│   ├── WeekView.jsx                 "More" at-a-glance popover (from Summary's More button / `M`) — Week list + Month calendar grid (segmented Week/Month toggle, `W`/`M` keys); per-day covers/bookings, tap to jump (v14.7.0 week; Month view v14.9.0)
│   ├── ViewSwitcher.jsx             v17.5.0 — the T/L/P buttons (extracted from App's inline .map) + the Split View gesture and toolbar. RMB / 450ms press-and-hold opens SplitMenu, matching the timeline/plan quick-status idiom. **The hold timer is cancelled from WINDOW-level pointerup/pointercancel**, not the button's — SplitMenu portals a scrim above the button, so the button's own release may never arrive (the portalled-scrim gotcha). `didLongRef` swallows the trailing click. Both gestures fully inert when `splitEnabled` is off or `isMobile`; in a split BOTH pane views render accent and the focused one is marked by SplitLayout's corner brackets
│   ├── SplitLayout.jsx              v17.5.0 — the two-pane container (purely presentational: it takes the two already-built view ELEMENTS). Draggable divider (`setPointerCapture` on the divider is safe — it has no child click targets, which is the actual condition of the kills-click gotcha; primary-button-only + `buttons===0` bail), ratio committed on pointer-UP only so localStorage isn't written per frame, double-click resets to 50/50, capture-phase `onPointerDownCapture` sets the focused pane. Each pane is a non-scrolling **frame** (carries the `flexBasis`) wrapping the scroller — which is what pins the focused-pane **corner brackets** (an absolutely positioned child of a scroller would scroll away with the content) and what makes the flat `4%` hover-lift gutter self-scale. Only works inside the `shellFixed` layout — the scrollers are `overflow:auto;minHeight:0` and need a definite-height ancestor chain
│   ├── SplitMenu.jsx                v17.5.0 — the **2-step** split setup popup (direction → which second view), on QuickStatusPopup's exact shell. Opening the popup IS the intent, so there is no "Add to split view" confirm step and no Cancel button — the scrim click and the Esc chain (first branch, z=300) are the two ways out (body portal, z=300 scrim, same tokens/radius/44px buttons). Step 3 offers only the two REMAINING views, so the same view can never occupy both panes (which would collide on the singleton timelineZoom / selectedListId / showFinished state)
│   ├── ViewTools.jsx                v17.0.0 round 8 — the 🔍 Find-a-booking + ⚙ Settings pair, mounted ONCE in App's date-nav row (right of Summary) so it sits in the same place for ALL THREE views; Timeline's legend + List's card-header copies are gone, Plan gains it
│   ├── WalkinForm.jsx               walk-in entry form (v16.0.0 "Add to waitlist" under the no-tables banner; v17.1.1 the Plan-path pre-selected table (`_pre` draft flag from openWalkin) survives guest-count edits — plain-path steppers still reset tables — and wToggle deselects a selected-but-busy table)
│   ├── WaitlistPanel.jsx            waitlist Overlay (v16.0.0) — day's entries FCFS, fits-now chip, Book (prefills the booking form) + two-tap Remove
│   ├── ManualModal.jsx              manual table-assign UI (v16.4.0: active Swap-busy panel = saturated orange bg + WHITE title/subtitle for readability, was pale peach + warn-text; v17.5.0 `onDirty` prop — its table picks are component-local so it REPORTS dirtiness up, with an unmount-only `onDirty(false)` cleanup)
│   ├── PlanView.jsx                 v17.0.0 — the Plan (floor) view, 3rd main view (T·L·P): renders layout.floorPlan top-down (shared glyphs from FloorPlanEditor); v17.5.0 the time SLIDER is gone — a scroll-under-a-fixed-marker `TimeAxis` ruler drives occupancy fills, and the scrub range now runs to **GRID_CLOSE** not CLOSE (you can reach the tail where a late booking runs out); the Now button keeps its exact dual action (`setSliderTouched(false)` + `setSlider(clampExact(nowMins))`, today-only, accent at `atNow`) and additionally re-centres the strip — v17.6.0 **smoothly** (`reCentre(true)`), the same glide as a tap-to-jump; the date change and the per-minute clock follow stay instant, and `centre()` downgrades any glide to a jump under "Reduce animations". The header row (Now · selected-time badge · legend) is the `.mgt-plan-headrow` grid in index.html, NOT inline styles: the badge sits in the middle column so it lands exactly on TimeAxis's fixed centre marker (siblings of equal width ⇒ 50% of one is 50% of the other), and it needs a **media query** to fall back to a left-aligned single line below 600px — PlanView takes no width prop, and an inline `gridTemplateColumns` would out-specify the class. **v17.6.0: `clampSlider` is GONE.** While following, the selection is the EXACT minute (`clampExact`, no rounding), so the Plan badge and the tape centre land on the same minute as TimelineView's now-line; hand-scrubbing still steps by 15 because **TimeAxis snaps its own scroll**, which is where the quarter grid always actually came from. The old round-to-nearest-15 was described as load-bearing for the seated-start clamp, but it only ever compensated for the follow position being rounded away from the clock — those clamps now key on raw `nowMins` and are strictly simpler. Occupancy fills (seated/confirmed/pending/free/blocked; v17.1.1 seated occupancy START clamps to the slider grid — the seated-shift time can sit ABOVE the nearest-15-rounded slider, which read as "status change shows late in Plan"); tap → day-queue popover (→ openEdit, "Walk-in here" on FREE-today tables ONLY — the v17.1.1 seated-takeover was REMOVED in v17.1.2: an occupied table never offers a walk-in); RMB/hold → QuickStatusPopup (current-else-next); wheel/pinch zoom + pan + double-tap reset — all gated on the v17.1.2 `gesturesEnabled` prop (per-device Settings toggle; off = touchAction auto, view resets to 1×, hint shortens); freeing-soon pill at now; v17.1.1 fills fade via TableGlyph shapeStyle (360ms ease-out — the timeline Seated→Completed timing)
│   ├── FloorPlanEditor.jsx          v17.0.0 — drag-&-drop plan editor (Settings→Layout "Floor plan"): snap-10 SVG canvas, drag tables/doors (commit on pointer-up), two-tap walls (then fully editable: body drag + endpoint handles), door flip (Opens left/right), all distances cm; inspector (shape/size/rot/per-side chairs + capacity-mismatch warn). v17.1.0: the shared glyphs moved OUT to FloorGlyphs.jsx (re-exported here) so this whole editor rides the lazy Settings chunk
│   ├── FloorGlyphs.jsx              v17.1.0 — chairPositions/TableGlyph/DoorGlyph extracted from FloorPlanEditor (multi-export geometry unit) so PlanView (main chunk) shares the shapes WITHOUT pulling the lazy editor into the startup bundle
│   ├── SettingsChrome.jsx           v17.1.0 — the LIGHT Settings exports needed eagerly: SETTINGS_TABS (still the ONE tab list — App ←/→ nav + TabBar) + CogIcon (ViewTools ⚙). Lets Settings.jsx lazy-load; Settings.jsx re-exports both for back-compat
│   ├── TimeAxis.jsx                 v17.5.0 — the Plan view's time scrubber: a **tape-measure ruler that scrolls under a FIXED centre marker** (replaced the `<input type=range>`, then the first attempt's row of tappable blocks, which read as a segmented control). Drag/scroll → whatever is under the centre is selected, snapping to 15 min on idle; tapping anywhere scrolls that time to centre. Mirrored ticks top+bottom with hour labels between (the two edges are what make it read as a tape), occupancy heat-tint per quarter, full-height now marker, and a `mgt-detent` squash replayed via `key={selected}`. Spans OPEN…**GRID_CLOSE** = TimelineView's exact range. **`padding-inline: 50%` on the scroller** lets the ends reach the centre AND makes the maths fall out: the track position under the marker is exactly `scrollLeft` (verified live). Scrolling is cheap because React re-renders only when the selected QUARTER changes — a per-pixel update would re-run PlanView's occupancy scan and repaint the floor SVG. NOT memo'd on purpose: it reads live bindings memo can't see, so gating happens in its memo'd parent via `hoursSig`
│   ├── QuickStatusPopup.jsx         v17.0.0 — the quick-status popup extracted VERBATIM from TimelineView so PlanView shares the gating (pending → Confirmed+Cancelled only; late one-tap No show)
│   ├── PrefPickerModal.jsx          preferred-tables picker
│   ├── BlockModal.jsx               table-block editor
│   ├── HistoryPopup.jsx             per-booking audit trail
│   ├── LoginScreen.jsx              auth gate (unauthenticated entry)
│   ├── ConnectionStatus.jsx         Firebase connection dot right of Log out (v16.2.0; ported from MGT Scheduling) — green/red illuminated dot (from usePersistence `isOnline`); click → popover with status line + signed-in email; closes on outside-click/Esc. v17.3.0: also lists ALL connected devices (from usePresence — email · deviceLabel · "since", current tagged "This device", list scrolls at maxHeight 200)
│   ├── ReminderEditor.jsx           reminder edit modal (z=250)
│   ├── Reminders.jsx                reminder list tab body
│   ├── Settings.jsx                 settings modal shell + tabs (General/Layout/Customers/Reminders/Shortcuts — 5th tab v16.0.0); LAZY-loaded as of v17.1.0 (React.lazy chunk with all tab bodies + the floor-plan editor); SETTINGS_TABS + CogIcon live in SettingsChrome.jsx (re-exported here) — still ONE tab list, never duplicate; General = per-weekday hours · optimizer cutoff(0–24)/auto-switch · shifts · booking-duration tiers · running-late thresholds (v16.1.0) · v17.1.0 "Reduce animations" + v17.1.2 "Plan zoom & pan" + v17.5.0 "Lock navigation" (default OFF, so only `"1"` is stored — the INVERSE of the usual convention) and "Split view" (default ON, normal convention: only `"0"` is stored) per-device toggles + v17.2.0 "Timeline zoom" per-device steppers (default/Follow/max zoom + follow lead — App's tlSettings/onSetTlSetting) and Preferences party-size steppers, sections collapsible (v15.0.0)
│   ├── CustomersSettings.jsx        Customers-tab body (v16.0.0) — search by name/phone over customerIndex, per-row visits/no-show/waitlist chips, expandable booking history, armed-confirm "Delete customer & all data" (parent's deleteCustomer does the writes); v16.4.0 4th totals tile "N no-show, no phone" (count only, shown when >0 — phone-less no-shows aren't in the phone-keyed index; never aggregated into an identity per the no-merge rule)
│   ├── LayoutSettings.jsx           Layout-tab body (v15.0.0) — FULL layout editor: Tables (add/remove/rename·cap·zone, orphan-booking warning on remove/rename) + collapsible Combos (editable join-groups → auto-combo cap overrides + cross-group mega add/edit/remove) + collapsible Table priorities (v15.9.0 — size bands · combo preferences · anchors/mixed-require · swap rules; rename remaps priorities refs too) + kitchen limit; takes `bookings` for orphan detection
│   ├── Shortcuts.jsx                keyboard cheatsheet
│   ├── TableGrid.jsx                13-table picker (used by Manual/Block modals)
│   └── atoms.jsx                    Overlay (+ pinned-footer slot), Fld, Section, Collapsible (v15.0.0; optional controlled mode `open`/`onToggle` v15.1.0), Reveal (graceful height show/hide via grid-rows 0fr↔1fr + delayed unmount; overflow:visible when open+settled, clip only while animating so inner hover-lifts aren't clipped — v15.8.0; v16.1.1 optional `horizontal` = grid-COLUMNS 0fr↔1fr + inline-grid, eases occupied WIDTH — used by the timeline start-time chip so the sibling name eases in lockstep), Presence/Toast (generic enter/exit wrapper with in/out class + delayed unmount + cached children; Toast = the toast-class alias — v15.8.0), ModalPresence/usePresence (PresenceContext so Overlay/ReminderEditor self-animate close — v15.8.0), AutoHeight (ResizeObserver eases content-height changes; overflow:visible at rest, clip ONLY while the height transition runs so inner hover-lifts aren't clipped — supersedes the earlier "always hidden"; optional `linear` — used in Settings tabs / Manual·Walkin·Pref·Reminder·Week bodies — v15.8.0), SlideView (slide wrapper, clips only while animating — v15.8.0; v17.5.0 optional `fill` = `flex:1;minHeight:0;display:flex;flexDirection:column`, needed in the `shellFixed` layout where it must pass a definite height through instead of collapsing to content height), useFlip (WAAPI list-reorder hook — v15.8.0), TBadge, AvailBanner, Toggle (knob/track ease — v15.8.0), mkInp, mkBtn, **mkArea** (v17.7.0 — the multi-line mkInp: `resize:vertical` + `alignContent:"center"`, used by ALL THREE textareas. The centring is load-bearing, not cosmetic: a textarea starts its text at the TOP, which on a pill is where the box is NARROWEST, so the corner curve was clipping the first characters of the placeholder. Centring moves the text to the pill's widest point. No effect once content fills the box; degrades to top-aligned where `align-content` is unsupported)
└── lib/
    ├── booking-logic.js             pure functions (optimizer, sanitisation, derivations, daySummary); v15.0.0: isIn via ZONE_OF, date-finders read hoursFor(date); v15.9.0: ALL optimizer heuristics data-driven via PRIORITIES (IS_MGT_LAYOUT no longer imported); v16.1.0: getDur reads the DUR_TIERS live binding + lateState(b,today,nowMins,cfg) → null|"warn"|"noshow"; v17.6.0: `stayedMins(b)` → the actual stay of a COMPLETED booking or null — reads the new sanitize-whitelisted `stayedMin` stamp (written by App's two completion paths on a real seated→completed transition ONLY), falling back to `duration` when a pre-v17.6.0 booking's history records a seated entry
    ├── constants.js                 layout config — DEFAULT_LAYOUT (incl. v15.9.0 priorities seed = the ex-hard-coded MGT heuristics) + setLayout/buildLayout reassign LIVE bindings (ALL_TABLES/INDOOR/OUTDOOR/TIMELINE_TABLES/TOTAL_SEATS/ZONE_OF/TABLE_GROUPS/VALID_COMBOS/CLUSTERS/KITCHEN_TABLE_LIMIT/IS_MGT_LAYOUT/PRIORITIES) + per-weekday hours (WEEK_HOURS/hoursFor/weekRange) + DUR_TIERS/setDurTiers duration tiers (v16.1.0) + v17.6.0 TURN_BUFFER/setTurnBuffer (the separation between bookings, in minutes; 0 = off = the default, so an unconfigured app is byte-for-byte v17.5.1); colours, S/BTN style tokens (v15.0.0) + v17.7.0 `R` = the pill-radius scale (pill/auth/sheet/card/inset → the `--r-*` tokens); assign by ROLE, never by the old number
    ├── reminders.js                 reminder helpers (validate, fire-window, prune)
    ├── drafts.js                    v17.5.0 — `sameDraft(a,b)` behind the unsaved-changes guard. NOT JSON equality: key order differs between openEdit's literal and openNew's Object.assign spread; `<input type=number>` returns a STRING; `customDur:null`/`deposit:""` are the same nothing; table arrays are sets in spirit. Values normalise to strings, arrays sort, null/undefined/""/false all collapse to "" (tests/drafts.test.js)
    ├── dbError.js                   v17.5.1 — `dbError(path)` builds the THIRD argument every `onValue()` must pass (the optional error/cancel callback), and `onDbError(fn)` lets usePersistence subscribe so any listener failure anywhere surfaces in the UI. All 16 listeners pass it. Origin: a cancelled read produced NOTHING — no log, no banner, no state change — because `setBookingsReady(true)` lives in the success path, so the app showed "⟳ Loading bookings…" forever and was structurally incapable of reporting its own failure
    ├── revGuard.js                  revision-CAS writer for whole-node collections (v16.0.0) — attachRev/writeWithRev; every write = atomic update({node, nodeRev: base+1}), Security Rules reject a non-+1 rev; recovery is free via the SDK's rollback echo
    └── customers.js                 phone-identity layer (v16.0.0) — normalizePhone/formatPhone/matchCustomerByPhone (VERBATIM from the WA sandbox's whatsapp.js; complementarity contract: the WA module imports these from HERE on merge) + isNoShow (flag OR legacy history entry — zero-migration backfill) + customerIndex/searchCustomers/noShowMap + v16.4.0 searchGuestsByName (booking-form NAME autocomplete — phone customers by phone + phone-LESS bookings one-row-each, NEVER merged). Customers are DERIVED from bookings — no separate collection.
```

**REFACTOR_LOG.md** at repo root contains the full version history with architectural decisions for each phase (B1–B5, C1–C3, D1–D4, E1+).

**ROADMAP.md** at repo root holds pending work only — deferred features, follow-ups, ideas. Nothing shipped belongs there; nothing pending belongs in `REFACTOR_LOG.md`. Keep it current: remove an entry the moment it ships, add one the moment new deferred work surfaces. See the `mgt-workflow` skill for when to check/update it.

**`scripts/gen-icons.py`** (v17.4.2) regenerates the whole PWA icon family in `public/` — `icon.svg` · `favicon.svg` · `icon-192/512.png` · `apple-touch-icon.png` (full-bleed) · `icon-maskable-512.png` — from one source of truth, so the tiles can't drift between sizes. A **design tool, not part of `npm run build`**, but since v17.4.2 it needs only `pip install playwright pillow` and **runs anywhere** (the v17.4.0 version required macOS SF Pro + fontTools, so it couldn't run in a container or on CI — that is how a design and its "single source of truth" drift apart). `MGT_CHROMIUM` optionally points it at a system Chromium. Edit the `BARS` / `TILE_STOPS` constants there and re-run (`python3 scripts/gen-icons.py public`); **never hand-edit the generated SVGs**. The mark is the v17.4.2 booking-blocks-on-frosted-glass design and carries **no type at all**, so the SVG-`<text>` font hazard can't recur — if type ever returns it must be outlined (recover the fontTools conversion from git history at v17.4.1). Since v17.4.1 there is **no service worker**, so icons propagate on a normal browser refresh with nothing to invalidate; v17.4.2 added `?v=<version>` tokens to the icon URLs in `index.html` + the manifest to carry a change past the HTTP cache (bump them with `__APP_SIGNATURE__` whenever the icon bytes change). A home-screen shortcut still keeps the icon the OS snapshotted when it was added (iOS never refreshes it, and no query string changes that), so a tile change needs remove + re-add there.

---

## Code conventions

### Modern declarations (Phase C3a)
- Use `const` by default; `let` only when reassignment is needed.
- Never `var` in new code. App.jsx's 380 vars were converted in C3a. (`src/lib/constants.js`
  still uses `var` by design — Phase A left it; convert opportunistically if editing it.)

### JSX, not RC (Phase C3b/C3b.1)
- All JSX uses literal JSX syntax (`<div>...</div>`), not `React.createElement` or `RC()`.
- Do **not** add `import React from "react"` — the project uses the automatic JSX runtime via `@vitejs/plugin-react` v6.
- Import only specific hooks: `import { useState, useEffect } from "react"`.

### Filename rules (Phase D2 post-handover rule — hard)
- Any file containing JSX must use the `.jsx` extension.
- Pure-logic hooks/libs use `.js`.
- Vite/oxc rejects JSX in `.js` files at startup. Verify via `npm run build` for new hooks.

### One unit per file
- One hook per file in `src/hooks/`. Filename matches export (`useXxx.{js,jsx}`).
- One component per file in `src/components/`. PascalCase filename matches export.
- Exception: `Settings.jsx` exports `SettingsContent`, `TabBar`, `GeneralTabContent`, `CogIcon`; `atoms.jsx` is the multi-export atoms file.

### Style tokens
- All colours, spacing, button styles, badge styles, **corner radii** flow through `src/lib/constants.js` exports (`S`, `BTN`, `BLOCK_BG`, `STATUS_COLORS`, `TBL`, `R`).
- **`R` = the v17.7.0 pill-radius scale** (`R.pill`/`auth`/`sheet`/`card`/`inset` → the `--r-*` tokens in `index.html`'s `:root`; radii are theme-agnostic, so they are NOT duplicated into the dark block). Assign **by role, never by the old number** — the same `12` meant "control" in one file and "card" in another. `--r-pill` is `999px` because CSS clamps an oversized radius to half the box, so one token is a true pill at every control height. **No new `borderRadius: <number>` literal** — `grep -rn "borderRadius: [0-9]" src/` must return only the documented canvas/geometry exceptions (timeline blocks + their manual-assign handle and folded corner, TimeAxis ticks, floor-plan glyphs, progress track+fill pairs, `Kbd`, `"50%"` circles). See the v17.7.0 REFACTOR_LOG entry for the full list and why each one is exempt.
- Reusable JSX atoms in `src/components/atoms.jsx`: `Overlay`, `Fld`, `Section`, `TBadge`, `AvailBanner`, `Toggle`, `mkInp`, `mkBtn`.
- New UI composes from atoms, not redefining them. Add new atoms there if needed.
- **`mkInp` / `mkBtn` return *style objects*** (not JSX) — usage is `<input style={mkInp()}>` /
  `<button style={mkBtn({...})}>`. (Note: the sibling Scheduling app's equivalents return JSX;
  Bookings differs. Don't assume a `className`/prop passthrough — it isn't there.)
- Prefer the **`Toggle` atom** (`Toggle({ on, onClick })`) over `<input type="checkbox">` for
  booleans (native checkbox is fine only for multi-select grids / native forms).

### Conditional rendering
- Prefer ternaries: `cond ? <X /> : null`
- Avoid `cond && <X />` — reduces a class of falsy-render bugs (the `0 && <X/>` trap).

### Comments
- Heavy commenting is expected — single-developer codebase with long context gaps.
- Section headers use `// ── Name ──...` for grep-ability.
- Phase notes use `// Phase X (vY.Y.Y): ...` at the top of moved blocks.

---

## Architecture decisions

### Hooks vs components — when to use which
- **Hook:** stateful logic the parent renders with. Plumbing moves; rendering stays. Use for cross-cutting concerns (persistence, timers, feature flags) and state-machines whose outputs the parent renders with.
- **Component:** UI unit with its own internal complexity. Everything moves; parent embeds it.
- See `REFACTOR_LOG.md` Phase D vs Phase E for the worked-through reasoning.

### Controlled-component pattern (WalkinForm, BookingFormModal)
- Form state lives in parent, component receives it as props.
- Component fires callbacks to mutate parent state (`onSave`, `onClose`, `onOpenPrefPicker`, etc.).
- Pass setters directly only for the form draft itself (`setForm`/`setDraft`); wrap other parent-state mutations in named callbacks.
- Sub-modals stay in parent's render tree even when triggered from inside the component — keeps z-stack ordering predictable.

### Optimizer scope (Phase D3 Option A — permanent)
- `autoOptimizer` thermostat lives in `useAutoOptimizer`. Daily reset: off at 15:00, on at new-day-start.
- The banner stack (`reshuffledBanner`, `ineffBanner`, `overlapBanner`) and related state (`reshuffled`, `dismissedIneff`, `confirmReshuffle`) intentionally **stay in BookingApp**. They reach into form/view/persistence concerns and `flash()` has 8 call sites — extracting would just spread the surface.

### confirmKitchen state — legitimately shared
- Owned by BookingApp. Both `doSave` (form path, in App.jsx) and `saveWalkin` (in `useWalkin`) raise it.
- `useWalkin` receives `{confirmKitchen, setConfirmKitchen}` as args. Same pattern with `setWriteWarning` between `usePersistence` and `useReminders`.

### Auth shell
- `App()` (App.jsx) is the auth gate: `onAuthStateChanged` → `<LoginScreen/>` when signed out, else `<BookingApp/>`. App-wide hooks that need the authed shell mount in `BookingApp`, not `App`.

---

## Critical patterns

### Firebase write-guard pattern — MANDATORY
Every Firebase write must be guarded by a `dataLoaded` ref that flips true only after the initial `onValue` callback returns, **and** refuses an empty-array write when the first load saw data. Without this, an effect that fires before Firebase loads can save `[]` over real data.

```js
const bookingsLoaded = useRef(false);

function saveBookings(next, isSilent) {
  function persist(computed) {
    if (!bookingsLoaded.current) {
      console.warn("[SAFE] Refused to write — initial read has not completed.");
      if (!isSilent) setWriteWarning("...");
      return;
    }
    // Empty-array safety: refuse to wipe non-empty DB with empty in-memory state
    if (Array.isArray(computed) && computed.length === 0
        && firstLoadCount.current !== null && firstLoadCount.current > 0) {
      console.warn("[SAFE] Refused to write empty array.");
      if (!isSilent) setWriteWarning("...");
      return;
    }
    set(ref(db, "bookings"), computed).catch(function(){});
  }
  // ... resolve `next` (value or updater fn), then persist
}
```

**Origin:** post-v13-deploy data-loss incident. Auto-extend effect fired `saveBookings([])` on mount before `onValue` returned. The pattern was retrofitted to all Firebase writes.

**Freshness / resync gate (v15.2.0) — THIRD write-guard dimension.** Beyond "loaded" + "non-empty", `saveBookings`/`saveBlocks` also refuse when the local snapshot may be **stale**. Origin: a laptop left asleep with the tab open from ~18:00 overwrote a night of tablet bookings when it woke at ~01:30 — the frozen clock interval fired the auto-extend/auto-complete effects against the stale in-memory snapshot and wrote it *before* the reconnect's fresh `onValue` arrived (the sync write wins that race). Mechanism (all in `usePersistence.js`): a 10s **heartbeat** bumps `lastBeatRef`; a gap `> STALE_GAP_MS` (90s) means the event loop was frozen (sleep). The gap is checked **at write time** (top of `saveBookings`/`saveBlocks`, before any `setState`) so a post-wake stale write is refused **race-free**, regardless of interval-firing order. `markStale()` sets `staleRef` + shows the `resyncing` banner ("⟳ Syncing the latest data…") and `resync()` force-pulls the server's current `bookings`+`tableBlocks` via `get()` (gated on `isConnectedRef` — an offline `get()` can serve the stale cache and must not clear the gate). The gate clears on any live `onValue` snapshot or a successful `resync()`. Resume events (`focus`/`pageshow`/`visibilitychange`) are gap-gated nudges; brief network blips keep the loop alive (gap small) so offline editing + the offline queue are untouched.

**Save feedback + auto-retry (v15.4.0).** A stale-block is no longer a red error — it's a transient, auto-recovering state. `saveBookings`/`saveBlocks` now **return a boolean** (`true` = dispatched, `false` = blocked by the stale gate). Every action handler in App.jsx gates its success UI on it — `const ok = saveBookings(fn); if (ok && …) flash();` — so a refused write is **never** shown as "Booking saved." (the original bug: `flash()` fired unconditionally). The stale-block branch dropped its `setWriteWarning` (red); the red banner is now reserved for genuine hard failures (not-loaded, empty-array, retry-exhausted). **Auto-retry queue (`pendingRetriesRef`, function-form + non-silent only):** a blocked or server-rejected user write is parked as its original updater `fn` and replayed on freshly-resynced data inside `resync()`'s `.then` (after `clearStale()`), capped at `MAX_RETRIES` (3) → then a single red error. Replaying the **function** re-applies the mutation on fresh `bookings` (pure transform of `prev`, so safe); **value-form / silent writes (the auto-extend & auto-complete effects) never queue** — replaying a precomputed stale array would re-write stale data; they recompute next tick. **`doSave` (new/edit booking) WAS the exception (v15.4.0–v15.6.x)** — high-stakes, so on a block it kept the form open + an in-form "tap Save again" message instead of silent background retry. **v15.7.0 removed the exception** (see the v15.7.0 note below): `doSave` now passes the **function form** like every quick action, so a held new/edit save shows optimistically + auto-retries too. NB: a heartbeat-interval-sized `STALE_GAP_MS` (must stay ≫ the 10s heartbeat, hence 90s) — a threshold below 10s would let every heartbeat false-trip the gate.

**Per-booking-node storage + diff-write (v15.5.0) — the structural multi-device-merge layer.** `bookings` is now a **keyed object `/bookings/{id}`** (one child per booking), NOT a single array — so two devices editing **different** bookings (even both offline) write **disjoint paths** and Firebase merges them, instead of racing on one array node. Reads are unchanged: `sanitizeAll` already `Object.values()`-es an object, so `onValue`/`resync` deserialize a keyed node to the same in-memory array, and **all ~39 `saveBookings`/`bookingsAfterAction` call sites are untouched** (the app still thinks in arrays). The change is in `persist()`: instead of writing the whole array, it **diffs** `prev` vs `computed` (both forms now route through the functional `setBookings` updater so `prev` is available) and pushes a **multi-path `update(ref(db,"bookings"), patch)`** of ONLY changed children (`{id: stamped}`) + deletions (`{id: null}`); an empty diff skips the write. **Conflict protection replaces `bookingsRev`** with a per-booking **`updatedAt`** stamp (added to the `sanitize` whitelist so it survives reads; `bookingChanged` compares content *excluding* it so a server echo isn't a false change). `stampForWrite` issues a stamp monotonic-per-device (`lastStampRef`) AND strictly above the booking's last-seen server value — **clock-skew-proof** (a behind-clock device still writes an acceptable stamp) and **StrictMode-proof** (the dev double-write gets a *higher* stamp → accepted, no spurious reject). **Per-`$id` Security Rule:** allow a delete, else require numeric `updatedAt` strictly greater than the stored value (create allowed when none) — rejects a stale same-booking write AND any pre-v15.5.0 whole-array write (no `updatedAt`). **Lazy migration:** the first v15.5.0 client to load a legacy **array** node (`Array.isArray` — Firebase returns an array only for sequential integer keys) writes it back once as keyed (`migratedRef` + connected-gated; `genId()` is path-safe `[0-9a-z]`); an `arrayShapeRef` **holds** per-child writes until the keyed shape echoes so a string key is never mixed into the integer array (held writes queue + replay via the v15.4.0 path). **Deploy is a HARD CUTOVER** (the new app and the v15.3.0 rule are mutually incompatible) — swap the rule + refresh all devices together at a quiet time; see `database.rules.README.md`.

**True compare-and-swap — `baseUpdatedAt` + revision CAS everywhere (v16.0.0) — the FOURTH write-guard dimension, server-side.** Origin: the 2026-07-05 incident — a laptop asleep at home woke and its stale snapshot overwrote a night of tablet status changes, because the v15.5.0 rule only required `updatedAt` to be **greater** than stored, and a stale device stamps with its current wall clock (always greater). Greater-than is last-writer-wins, NOT staleness protection. v16.0.0 makes every write **prove it was based on the data it overwrites**: (1) **bookings** — `stampForWrite` also writes `baseUpdatedAt` (the `updatedAt` of the version this device last saw; 0 on create); the per-`$id` rule requires `baseUpdatedAt === stored updatedAt` (creates need only the stamp; deletes stay unconditional — a multi-path null can't carry a base). A stale writer (sleep/wake, zombie socket, offline-queue flush) is rejected server-side regardless of clocks; the existing `.catch → markStale → resync → drainPending` recovery replays user intent on fresh data. `baseUpdatedAt` is per-write metadata — deliberately NOT in the `sanitize` whitelist. A `lastPatchSigRef` dedupes StrictMode's dev double-dispatch (same content+base within 2s = the same write; re-dispatching would self-reject). (2) **Every whole-node collection** (`tableBlocks`, `waitlist`, `reminders`, `reminderFires`, 4× `settings/*`) — the proven v15.3.0 revision CAS, generalised in **`src/lib/revGuard.js`**: sibling `<name>Rev` integer, atomic `update({node, nodeRev: base+1})`, rule pair rejects a non-+1 rev (an empty-array write deletes the node and skips its own validate, but the REV child's rule still gates the atomic update — wipes are covered). Recovery is free: the SDK rolls back a rejected write locally and re-fires the node+rev `onValue` listeners. Rev refs advance optimistically (back-to-back + StrictMode writes chain +1,+2). (3) **Wake-race client fix**: a heartbeat-gap trip now also resets `isConnectedRef=false` (`gapTrip()`), because on wake the ref still holds its pre-sleep `true` and `resync()`'s `get()` could be served from the local cache, "succeed" with stale data, and clear the gate. Deploy: **app first, rules second** (rolling-safe — old rules ignore the new fields) — see `database.rules.README.md`. **Rule of law: any NEW persisted node must ship with either a per-child stamp CAS or a revGuard rev pair — never a bare `set()`.** **Exception (v17.3.0): the `presence` node.** It is NOT persisted app data — it's ephemeral device-presence (see `usePresence.js`): each connection writes only its OWN disjoint push-key child and self-removes via `onDisconnect().remove()`, so there is no stale-overwrite class and CAS/revGuard does not apply. It inherits the top-level `.write: auth != null` with no `.validate`, so it ships with NO rules/console step (rolling-safe). This exemption is ONLY for genuinely ephemeral, per-connection-owned nodes — never for real data.

**Optimistic visibility for held writes (v15.6.0).** When the freshness gate HOLDS a quick-action write (device woke from sleep), `saveBookings` now ALSO applies it to local state (`setBookings(next)`) in the hold branch — so the change is **visible immediately** instead of staying invisible until `resync()` finishes (the reported "my tap did nothing" confusion). The server write is still held (no stale data written): the persist happens when the queued function replays on FRESH data. A shared **`drainPending()`** helper (the v15.4.0 retry-drain) is called from BOTH `resync()` and the live `bookings` `onValue` (after `clearStale`) so a fresh snapshot arriving mid-recovery never wipes the optimistically-shown change before it's re-applied + persisted (batched into one commit → no flicker). Scope = function-form non-silent writes only (the existing condition) — so until v15.7.0 `doSave` (value-form) kept its "keep the form open + tap Save again" behaviour, and silent auto-effects are unaffected. The `resyncing` banner was reworded from "Writes are paused" to "your changes are saved and will finish syncing".

**Post-sync conflict reconciliation (v15.6.1) — the optimiser re-runs on merged data.** Per-node merge (v15.5.0) preserves two devices' offline bookings, but each device's optimiser assigned tables without seeing the other's — so an offline same-table double-booking (e.g. both on table 6) **overlaps once synced**, and the sync path stores the merged snapshot **verbatim** (no optimiser pass). A reconciliation `useEffect` in `BookingApp` (App.jsx, sibling to the optimiser/banner machinery) now reacts to settled snapshots: it collects active dates `≥ today` with assigned tables, filters to the ones failing the pure **`verifyClean`** (booking-logic.js), and resolves only those via one **silent function-form `saveBookings`** — full reshuffle (`bookingsAfterAction(next,d,blocks,null,false,autoOptimizer)`) when `optimizerActiveFor(d,…)` (always true for future dates; true today before the cutoff), else (today + optimiser OFF) **relocate ONLY the newest non-locked conflicting booking** (sorted `updatedAt` desc + id tiebreaker → deterministic across devices) via the `forceReassign` path, looping (cap 20) until clean. The new pure **`findConflicts(bookings,date)`** returns the overlapping ids for that selection. Self-stabilising: gated on `!verifyClean` so clean syncs write nothing, and optimiser/relocate output is clean → next pass is a no-op (also breaks any Firebase echo loop); cross-device double-writes settle via the v15.5.0 per-`$id` `updatedAt` CAS; `_locked` bookings (manual/walk-in) are never moved; an unplaceable booking (full restaurant) drops out of the overlap set so the loop terminates. Gated on `!resyncing` (waits out the post-sleep stale window, re-runs on fresh data) and writes `isSilent` (auto-effect). A transient `syncFixBanner` ("Resolved a table conflict after syncing.") fires only when something actually changed (`changed` flag). Pure client change — no `usePersistence`/security-rule/shape change (rolling deploy). **v15.6.2 bug-fix:** the effect's "loaded" gate was wrongly `!loadBannerShown` — but `loadBannerShown` is the *6-second* "Firebase connected" banner flag, so the effect went dead ~6 s after any page load and only reconciled on a fresh reload (not on a live sync). Fixed to `firstLoadCount.current===null` (the real, permanent loaded signal, a ref exposed from `usePersistence`); `loadBannerShown` dropped from the dep array. **Gotcha to carry forward: `loadBannerShown` is NOT a "loaded" flag — it auto-hides after 6 s; use `firstLoadCount` (ref, null-until-loaded) for a persistent loaded check.**

**`doSave` joins optimistic-show + auto-retry (v15.7.0) — the exception is gone.** `doSave` (new/edit booking) used to build a precomputed array `fin` and call `saveBookings(fin)` (**value form**), which the optimistic-show + retry branches skip (they all gate on `typeof next==="function"`) — so a stale-gate hold bounced the form back with "tap Save again". v15.7.0 converts both `doSave` write paths to the **function form** (`saveBookings(buildNext)`), so a held new/edit save now shows optimistically + auto-retries on fresh data exactly like quick actions. **Technique = capture-intent-then-replay-on-fresh-`prev`:** the user's intent is computed **once** against current `bookings` — `genId()`/the `nb` object (new), or the captured edit fields/flags derived from `orig`+`f` (edit) — then a pure `buildNext(prev)` re-applies that intent to whatever fresh `prev` the updater receives (so a concurrent edit to OTHER bookings, which live in `prev`, is preserved). The synchronous high-stakes guards (capacity/displacement/no-table) still run **once** against current data via `const fin=buildNext(bookings)` and block the form with `setError` before any dispatch. **Duplicate-safe:** `genId()` is called once (stable id) and the retry queue only replays writes that never landed (held) or were atomically rejected — so fresh `prev` can't already contain the new id; the new-path `applyBase` also `filter`s out `newId` before `concat` (belt-and-braces). Flash is gated on the `ok` boolean (never claim "saved" for a not-yet-persisted write). Pure client change in App.jsx's `doSave` — no `usePersistence`/security-rule/shape change (rolling deploy).

**Auto-effects** (anything that writes Firebase without direct user action) must pass `isSilent=true` to suppress the user-facing banner on refusal.

**Persisted collections:** `bookings` (v15.5.0 — a **keyed object `/bookings/{id}`**, one child per booking, each carrying a per-booking `updatedAt` stamp; written via per-child diff `update`, read back as an array via `sanitizeAll`'s `Object.values`; v16.3.0 whitelists `deposit`€ + `recurringId`/`recurringDate` occurrence stamps), `tableBlocks`, `reminders`, `reminderFires`, `waitlist` (v16.0.0 — whole-array node, reminders-pattern loaded-guard, `useWaitlist.js`; **ref-mirror save** per the sync-echo gotcha below), `recurring` (v16.3.0 — 7th collection, whole-node object `{v, enabled, horizonWeeks, rules[]}`, standing-booking RULES; **`enabled` defaults OFF** — absent/legacy node reads as off, v16.3.0-correction; revGuard CAS `recurringRev`, `useRecurring.js`; occurrences are normal `/bookings` children generated by the App effect, NOT stored here), plus **six** `settings` objects (all restaurant-wide config → **shared** across devices): `settings/operatingHours` (#1, v14.4.0 — **per-weekday** `{days:{0..6}}` since v15.0.0), `settings/dayShifts` (#2, v14.6.0 — `{split, enabled}`), `settings/optimizer` (#3, v15.0.0 — `{cutoff, autoSwitch}`), `settings/layout` (#4, v15.0.0 — `{tables, joinGroups, comboCaps, megaCombos, kitchenLimit}`; + `priorities` v15.9.0 — the data-driven optimizer heuristics), `settings/general` (#6, v17.0.0 — `{v, restaurantName, currency, phonePrefix, regularMin, lateCollapseMax, waitMatchWin, undoSecs}`; revGuard CAS `generalRev`; `useGeneralSettings.js`), and `settings/bookingDefaults` (#5, v16.1.0 — `{v, tiers:[{max,dur}…], restDur, lateEnabled, lateWarnMin, lateNoShowMin, freeSoonEnabled, freeSoonWindow}`; a present node's missing `tiers` array = EMPTY (RTDB drops empty arrays — the priorities lesson), never the default; `freeSoonWindow` (v16.3.0-correction) = the table-turn prediction window in minutes, 5–60 step 5, default 15; `useBookingDefaults.js`). **v17.6.0 supersedes the old "per-device preferences never go in Firebase" rule.** `settings/users/{uid}/prefs` (#8, `useUserPrefs.js`) is the documented exception: it is per-USER, not restaurant-wide, and carries theme · reduceMotion · planGestures · navLocked · splitEnabled so a user's setup follows them to any device. **`localStorage` still holds all five as well, and that mirror is load-bearing** — `index.html`'s no-flash script reads `mgt-theme`/`mgt-reduce-motion` before React mounts and long before Firebase or auth resolve, so dropping it flashes the wrong theme on every load. localStorage = pre-mount cache, node = source of truth. Genuinely per-DEVICE settings (app width, the 4 Timeline zoom values, the saved split layout) stay `localStorage`-only, because they are properties of the screen. All six use the loaded-ref write-guard (small objects, so the empty-array guard doesn't apply — except `useLayout`, which additionally refuses an empty-`tables` config); see `useOperatingHours.js` / `useDayShifts.js` / `useOptimizerSettings.js` / `useLayout.js`.

**Single central save path:** route every mutation of a collection through one helper (e.g. `bookingsAfterAction`) so future conflict-detection / re-derivation has one hook point.

### Operating hours — live module bindings (v14.4.0; 24h v14.5.0; **per-weekday + closed days v15.0.0**)
`OPEN` / `CLOSE` / `GRID_CLOSE` / `QUARTER_HOURS` in `constants.js` are **mutable `let` exports** (not `var`/`const`) reassigned **only** by the module's own setters (v15.0.0: `setActiveDayHours(date)` + `setWeekHours(week)`, which replaced the single-pair `setOperatingHours(open,close)`) — because only the owning module may reassign its own exports. They're **live ESM bindings**, so reassigning them updates every importer (incl. `booking-logic.js`'s pure functions — `getBlockSlots`, `findTimes`, `pct`) with **no signature changes**. `useOperatingHours` (Firebase `settings/operatingHours`) calls the setter on each snapshot **and** sets a React state so BookingApp re-renders — that repaint is what makes the timeline/forms read the new values. `GRID_CLOSE = close + 1` — **v14.5.0: no longer clamped to 24**, so a past-midnight close (24 = 00:00, 25 = 01:00) gives GRID_CLOSE up to 26 and the timeline/grid extend past midnight (hour labels wrap via `% 24`). **Bounds (v14.5.0): open 6–22, close (open+1)–25**, enforced by `sanitizeHours` + the Settings steppers. The forms' time `min`/`max` derive from `OPEN`/`CLOSE` (padded; `max` caps at `"23:59"` when `CLOSE >= 24` because `<input type=time>` rejects "24:00"+ — BlockModal's From/To do the same off `GRID_CLOSE`). **Extend-window only — no booking may START after midnight:** capping close at 25 keeps the latest 90-min start ≤ 23:30, and `findTimes`/`findKitchenFriendlyTimes` carry a defensive `m < 24*60` guard, so the optimizer/scheduling math needs **zero** changes. **Don't capture these into a module-scope local** (breaks the live binding) — read them at call/render time.

**v15.0.0 — per-weekday + closed days.** `settings/operatingHours` is now `{days:{"0".."6"}}` (0=Sun..6=Sat, all-UTC `getUTCDay`); a legacy flat `{open,close}` reads as 7-day-uniform (`sanitizeWeek`) and migrates on first save. `WEEK_HOURS` holds the schedule; **`hoursFor(date)→{open,close,gridClose,closed}`** is THE accessor for any date — the date-carrying pure functions (`getBlockSlots`/`findTimes`/`findKitchenFriendlyTimes`) read it (no signature change) so a booking whose date ≠ viewDate stays correct, and they short-circuit on a closed day. The live `OPEN/CLOSE/GRID_CLOSE/QUARTER_HOURS` bindings hold the **active view-day's** hours; **`useOperatingHours(viewDate)` calls `setActiveDayHours` DURING render** (module mutation, no setState — safe) so children read the right values in the same paint. A **closed** day blocks bookings/walk-ins + shows a timeline "Closed" banner (fallback range for grid dims). **`weekRange()`** = stable min-open…max-close across open days; it clamps the global shift split (`useDayShifts`) — but the **optimizer cutoff is decoupled** from it (full-day 0–24, `useOptimizerSettings`).

### Layout config — live module bindings (v15.0.0)
Mirrors the operating-hours mechanism for the physical table layout. **`ALL_TABLES` / `INDOOR` / `OUTDOOR` / `TIMELINE_TABLES` / `TOTAL_SEATS` / `ZONE_OF` / `TABLE_GROUPS` / `KITCHEN_TABLE_LIMIT` / `VALID_COMBOS` / `CLUSTERS` / `IS_MGT_LAYOUT`** are `let` exports reassigned **only** by `setLayout(cfg)` (which calls the pure `buildLayout(cfg)`), seeded from `DEFAULT_LAYOUT` at the **bottom** of `constants.js` (TDZ-safe — after every `let` decl). `useLayout` (Firebase `settings/layout`) calls `setLayout` per snapshot + sets React state to repaint. **Combos are DERIVED** (Phase 4, no longer hard-coded): `buildLayout` makes `VALID_COMBOS` from `joinGroups` (every `contiguousRuns` ≥2; cap = `comboCaps[comboKey(run)]` or Σ member caps) then appends `megaCombos`; `CLUSTERS[id]` = id's full ≥2 run (standalone → `[id]`). **Zero-regression invariant:** `buildLayout(DEFAULT_LAYOUT)` reproduces the historical 40 combos (ordered) + CLUSTERS **byte-for-byte** (verify with a deep-equal node script before touching this). **Detect-and-apply:** `IS_MGT_LAYOUT` = current layout signature (tables+caps+zones+combos) === DEFAULT's; `booking-logic`'s hand-tuned heuristics (`_comboPri`, `_indoorPri`, `isMixedLarge`, the `findBest` table-7 branches, the `optimise` table-7 swap) run **only when true**, else a generic capacity path. **`TABLE_GROUPS` (table-picker grouping) follows the SAME gate** (added when the editors shipped): `setLayout` keeps the curated `TABLE_GROUP_STRUCT` (MGT picker byte-for-byte — the "1A/1B/7" merge, i1 standalone, mega-hint notes) when `IS_MGT_LAYOUT`, else the generic join-group derivation (one section per join-group with its auto-combo caps as the hint note, then standalone tables per zone) — **lazy since v15.0.1**: `buildLayout` returns a `makeTableGroups()` closure (reading the `runCapByKey` it recorded while generating the auto combos — ONE cap rule) that `setLayout` calls only on the non-MGT branch. The signature (and `MGT_SIGNATURE`) is **order-independent** (sorted), so re-adding the same combos in any order restores `IS_MGT_LAYOUT` true. **Rename a table** = remap every reference (tables + joinGroups + `comboCaps` keys via `comboKey` + `megaCombos.ids` + v15.9.0 the `priorities` refs) so combos AND priority rules survive; **remove** drops only the table (sanitize/`buildLayout` drop its combos/cluster/group + any referencing mega + any priorities ref). **Single-group membership** is enforced in `sanitizeLayout` (a table in >1 join-group → first-wins; `CLUSTERS` uses `.find`). **Don't capture these into module-scope locals** (read at call/render time); **editing `DEFAULT_LAYOUT` / the seed under HMR needs a full preview reload** — the binding seed doesn't re-propagate (constants.js live-binding gotcha).

**v15.9.0 — data-driven optimizer priorities (`PRIORITIES`).** The optimizer's hand-tuned MGT heuristics are no longer hard-coded OR `IS_MGT_LAYOUT`-gated — they read the **`PRIORITIES` live binding**, derived by `buildLayout` from `settings/layout.priorities` (`{v, bands, comboRules, anchors, swapRules, mixedRequire}`; field semantics documented at `DEFAULT_LAYOUT.priorities`, whose seed values ARE the ex-literals — regression-proven **byte-identical** for both the MGT seed and an empty config vs the pre-v15.9.0 gated paths). `IS_MGT_LAYOUT` now gates ONLY the curated `TABLE_GROUPS` picker grouping; `layoutSignature` deliberately excludes priorities, so tuning them keeps the MGT picker AND a layout edit no longer kills the heuristics. Consumers in booking-logic: `_comboPri` (first comboRule matching key+size band → avoid?+100:−weight), `_indoorPri` (ranked anchors, boost = length−index), `findBest` (first band matching size → prefer list → zoneOrder singles → non-avoided → any → combos, `combosFirst` flips the tail; NO band → generic smallest-single-else-combo), `optimise` (swapRules loop), `isMixedLarge` (`mixedRequire` = must-include set; empty = any declared cross-zone combo). **Fallback rule (gotcha):** an ABSENT `priorities` object seeds from DEFAULT (legacy node); a PRESENT object treats each missing field as EMPTY — never per-field default — because RTDB drops empty arrays (the `v:1` scalar keeps an all-empty config present). The Layout-tab editor ("Table priorities" collapsible) always writes the full shape; rename remaps all priorities refs. Deploy caveat: a pre-v15.9.0 device saving the layout wipes the field (harmless while untuned — falls back to the seed); refresh devices before tuning.

### Customer layer — phone-derived, WA-complementary (v16.0.0)
Customers are **DERIVED from the bookings list by normalized phone** (`src/lib/customers.js`) — there is NO `customers` collection, so there is nothing to migrate or keep in sync. `normalizePhone`/`formatPhone`/`matchCustomerByPhone` are the WA sandbox's primitives ported VERBATIM (same names/signatures); **complementarity contract:** when the WhatsApp module merges, its `whatsapp.js` must delete its copies and import from `customers.js` — one phone-identity primitive, never two. `isNoShow(b)` = the v16.0.0 `noShow` flag OR a legacy history entry `action:"no show"` (zero-migration backfill). "Delete a customer" (Settings → Customers) = delete every booking with that phone + their waitlist entries — permanent (no backups on the free plan), hence the armed-confirm UI. Known edge: if the customer's bookings are the ENTIRE database, the empty-array write-guard refuses the delete (safety wins; don't bypass).

### Waitlist active matching (v16.0.0)
`waitAvail` is **state computed by a BookingApp effect**, not a render-time derivation — the `trialFits` scans are heavy, so the effect keys on `[bookings, tableBlocks, waitlist, autoOptimizer, nowQuarter]` where `nowQuarter = Math.floor(nowMins/15)` (never the raw 15s tick). Per waiting entry: try `prefTime` first; else a 15-min first-fit scan **clamped to ±90 min around the wanted time** (a 13:45 slot is no use to a party waiting for ~20:30); no wanted time → the whole remaining day. Transition-to-available (prev-id-set diff in a ref, first pass exempt) fires the green toast. The "⏳ N" badge lives in the Today slot (Presence slide; orange when someone fits now); Book prefills the form + `pendingWaitlistRef`, consumed in `doSave`'s new-booking path.

### Per-user preferences (v17.6.0) — the one non-restaurant-wide settings node
`settings/users/{uid}/prefs` + `prefsRev` (`useUserPrefs.js`). Five settings
follow the signed-in **account** rather than the device: theme, reduce
animations, Plan zoom & pan, lock navigation, split view on/off.

**Device fallback is the migration.** Each setting keeps its existing
`localStorage`-backed `useState` initializer in App, so first paint and the
signed-out shell are unchanged. Then one effect, gated on `prefsLoaded` and
fired **once per uid**: a field the user has saved overrides local state; a
field they have never saved is seeded from this device's current value and
written up. That is why the model is **tri-state** — `null` means "never
chosen", and a sanitize that returned `false` for an absent field would reset
every configured device on first login.

`themePref === undefined` (follow the OS) is deliberately NOT seeded — it is
the absence of a choice, and writing it up would freeze the user to whatever
the OS said at first login.

`App` renders `<BookingApp uid={user.uid} key={user.uid} />`; the **key** is
what makes an account switch remount the subtree, so no previous user's state
survives. Rules deploy is app-first/rules-second and rolling-safe (see
`database.rules.README.md`); `$uid` is a wildcard, not an access rule — the
top-level `auth != null` still governs, matching this app's single-restaurant
trust model.

### Separation between bookings — the turnaround buffer (v17.6.0)
Minutes a table stays unavailable AFTER a party's end, so bookings aren't taken
back-to-back. Off by default (`TURN_BUFFER` seeds 0), which makes the whole
feature a no-op until Settings → General turns it on.

**The rule is: pad every END — both a stored slot's `e` and the candidate query
window's `e` — and NEVER a start.** Padding only the stored slots would stop a
new booking starting right after an existing one but still let it END exactly
when the next one starts; padding both closes that direction too, and because
only ends move the gap is exactly `TURN_BUFFER`, never twice it. The two
helpers are `bookEnd(b)` and `padEnd(e)` in `booking-logic.js`.

**Scope is PLACEMENT ONLY** (Patryk-confirmed): `findFreeSlot`, `trialFits`,
`optimise`/`applyOpt`, `findTimes`, `findKitchenFriendlyTimes`, `occupancyEnd`,
plus the UI busy-sets (`ManualModal`, `WalkinForm`, `doSave`'s manual guard).
**`verifyClean` / `findConflicts` / `checkInefficent` deliberately do NOT use
it** — switching the setting on must never flag or reshuffle a day that is
already booked back-to-back, so the Overlap banner and the v15.6.1
reconciliation effect stay quiet. `getBlockSlots` is untouched too: a block's
end time was chosen by hand and padding it would silently extend it.
`applySeatedShift` is also unbuffered — seating an existing party is a status
action, not a placement.

Visible in Timeline (a 0.28-opacity tail sibling rendered like the seated ghost
— NOT a longer block, because `liveBarDur` also gates the start-time chips and
is read by List) and in Plan (a `resetting` map → dashed muted outline; the
walk-in gate subtracts it too). Both views take the buffer as a **scalar
`turnBuffer` prop** from App, never the live binding — `React.memo` cannot see
a live binding, the same reason `hoursSig`/`layoutSig` exist.

### Optimizer cutoffs
- 15:00 auto-cutoff for today's bookings — `autoOptimizer` flips off.
- Midnight reset — `autoOptimizer` flips on for the new day.
- Seated bookings are never reshuffled (enforced in `trialFits` / `applyOpt`).
- Walk-ins are `_manual:true _locked:true` — never reshuffled.

### `bookingsAfterAction` is the central save path
- Any code path that modifies bookings should pass through `bookingsAfterAction(bookings, viewDate, tableBlocks, savedId, isNew, autoOptimizer)`. Handles optimizer-aware reshuffle + seated-shift on Confirmed→Seated.
- Direct `saveBookings(arr)` calls without going through this helper risk an inconsistent schedule.
- **ONE documented exception (v17.4.0): `undoLastAction`.** It restores the undo delta VERBATIM (`applyUndo` + `syncLiveDurations` only) and deliberately does NOT call `bookingsAfterAction` — that helper takes its optimizer branch whenever `optimizerActiveFor(date,…)` is true, which is **always true for a future date regardless of the toggle**, so a reshuffle there would instantly re-apply the very table moves undo just reversed. A conflict introduced by the restore is resolved by the v15.6.1 reconciliation effect (dates ≥ today). Do NOT "restore consistency" by adding the call back — it breaks undo.

### The fixed shell — `shellFixed` (v17.5.0)
Normally `<body>` is the scrollport (set imperatively in a mount-once effect near
the top of `BookingApp`) and the app is a plain `minHeight:100dvh` block that
grows. **`shellFixed` flips that**: the outer div becomes a `height:100dvh`
`overflow:hidden` flex COLUMN, the width-clamp div becomes `flex:1;minHeight:0`,
the header + date-nav rows get `flexShrink:0` (pinned), and ONE inner region
takes `flex:1;minHeight:0;overflowY:auto` — banners and the view scroll inside it.
A second effect writes `body.overflow=hidden` in that mode or you get a second
scrollbar outside the shell. That effect is separate from the mount-once one on
purpose: the mount effect is declared long before `navLocked` exists, so putting
`navLocked` in ITS dep array is a TDZ error.

**This is the ONE mechanism behind both "Lock navigation" and Split View** — the
flag is widened (`navLocked || !!split`), never duplicated into a second layout.
Both contributing settings default OFF, so the default render path is
byte-for-byte v17.4.2. `SlideView` needs `fill` in this mode (it would otherwise
collapse to content height inside the flex column).

Consequence worth knowing: **Split View implies a pinned nav** regardless of the
nav-lock setting, because two independently-scrolling panes need a definite
height. With `split` on, the banners pin too (a `flex:1` child of an
`overflowY:auto` parent resolves to CONTENT height, so a top/bottom split would
collapse); with only `navLocked` on, banners scroll away with the content.

### Split View (v17.5.0)
Two of Timeline/List/Plan at once, per-device, **default off** (master toggle in
Settings → General; the RMB / press-and-hold gesture is fully inert while it's
off). State is `split = {a, b, dir:"v"|"h", ratio}` or `null`, persisted in
`localStorage["mgt-split"]` through the single `applySplit` writer so state and
key can't drift. `readSplit` validates HARD and returns `null` on anything
unexpected — a hand-edited key must never wedge the app in a broken layout.

The master toggle **defaults ON** (v17.5.0 correction; `localStorage["mgt-split-enabled"]` stores only the non-default `"0"`, the normal house convention — `navLocked` is the inverted one).

**Tablet/desktop only** (`winW >= 600`): `readSplit` refuses below that, and an
effect collapses an active split when the window crosses the breakpoint. The
header already wraps to three rows on a phone and a Timeline in a ~180px pane is
unusable.

**The same view can never occupy both panes** — `SplitMenu` step 3 offers only
the two remaining, and a plain tap on a view button *replaces the focused pane*
(or swaps, if that view is already in the other one). This is load-bearing, not
tidiness: `timelineZoom`/`timelineScrollRef`/`followNow`/`selectedListId`/
`showFinished` are singletons in App, and two instances of one view would fight
over them.

**All three views are now built unconditionally** (`viewEl` map) because a split
mounts two. `createElement` without mounting is free, and `planView` was always
built this way. Every prop is already a value or a stable `VA` wrapper, so no new
plumbing was needed.

**Keyboard follows the focused pane:** App passes `view: activeView`
(`split[focusedPane]`) into `useKeyboardShortcuts`, so S/C, ↑/↓, the zoom keys
and the list-deselect all act on the right half without touching each branch;
T/L/P delegate to App's `pickView` via `K.goView`. **`activeView` must stay
declared ABOVE the `useKeyboardShortcuts` call** — the ctx object is built
mid-render, and a `const` used before its declaration is a TDZ ReferenceError
(this blanked the app once during development; the split *handlers* are function
declarations and genuinely do hoist, which is what makes the asymmetry easy to
miss).

### Unsaved-changes guard (v17.5.0) — every drafting surface must register
Three surfaces hold real drafts: the booking form, the walk-in form, and
`ManualModal`'s table picks. Each snapshots the draft it was **opened** with and
diffs the live state against it (`sameDraft`, `src/lib/drafts.js`) — an untouched
form closes **silently**, because a confirm on every Cancel trains staff to tap
straight through it. `openForm` (App.jsx) is the ONE door that sets the booking
form's baseline, so all four open paths (`openNew`/`openEdit`/`bookAgain`/
`bookFromWaitlist`) stay in step; every *other* `setForm` is a user edit and must
NOT touch it. Same shape in `useWalkin` (`openWalkin` only). Both baselines are
**state, not refs** — they're read during render to derive a rendered value.
`ManualModal` owns its picks and reports up via `onDirty`, with an unmount-only
cleanup firing `onDirty(false)` so a closed modal can't leave `beforeunload` armed.

**Adding a new drafting surface = three wirings, not one:** (1) snapshot a
baseline at its open site, (2) point its mount-site `onClose` at a
`requestClose*`, and (3) **add an Esc branch in `useKeyboardShortcuts`** — that
chain calls the state setters DIRECTLY and never touches `onClose`, so skipping
it leaves Esc a silent back door past the guard. Closes that already represent a
decision (a successful save, add-to-waitlist, the cancel-booking confirm) keep
the RAW setter and stay unguarded. `beforeunload` is registered only while
something is dirty; browsers ignore any custom message string.

### `formRef.current` vs `form`
- The booking form has both a state `form` and a mirror ref `formRef`.
- Event handlers and async callbacks read `formRef.current` (always fresh) instead of `form` (potentially stale within the same render cycle).
- The mirror is maintained by `useEffect(() => { formRef.current = form; }, [form]);`

### Performance gotcha — backdrop-filter blur
- `backdropFilter: blur(...)` is expensive. >4 simultaneous instances on tablet hardware causes severe scroll/interaction lag.
- **Hard limit: ≤4 intentional blur instances visible at once.** Reuse the `Overlay` atom (canonical blur) rather than adding new blurred surfaces. (Bookings once shipped 51 → prod perf bug; never reintroduce.)

---

## UI / style rules

- Translucent / glass, iOS-inspired surfaces; rounded corners; the shared accent (`#007AFF`).
- **One app font (v16.0.0):** the stack lives in `index.html` as `--font-app` (body sets it; App.jsx/LoginScreen wrappers read the token). `input, textarea, select, button { font-family: inherit }` is load-bearing — form controls do NOT inherit font per the CSS spec (the Notes textarea used to render monospace). Never re-introduce an inline font-family literal; the only deliberate exception is the `Kbd` keycap atom (monospace).
- Every modal uses the **`Overlay` atom** (owns blur + mobile-sheet / desktop-card branching).
- **Popovers/dialogs use the opaque sheet token**, not the translucent card token (a card token at ~0.45 opacity reads see-through for a dialog).
- ≤4 simultaneous `backdrop-filter: blur()` (see perf gotcha above).

### Theming / dark mode (mechanism shipped v14.2.0 — ported from Scheduling; see `MGT_Bookings_dark-mode_PORT_INSTRUCTIONS.md`)
- Light + dark via CSS custom properties: `:root` (light) + `[data-theme="dark"]` overrides in `index.html`; `<html data-theme="…">` set via `document.documentElement.dataset.theme`. A theme flip is **one DOM attribute change — zero React re-render** of the tree.
- **Hook:** `useThemeMode(explicitPref) → isDark` (`src/hooks/useThemeMode.js`) writes `data-theme` and follows the OS live when pref is `undefined` — the shared Scheduling contract, unchanged. A no-flash inline script in `index.html` paints the theme before React mounts (the hook alone runs too late).
- **Persistence is per-device `localStorage["mgt-theme"]`** (`"dark"|"light"|`absent), NOT Firebase (theme is per-device by design; the `settings/operatingHours` node added v14.4.0 is restaurant-wide config only). `readThemePref()` (module scope in `App.jsx`) feeds the hook; the Settings General-tab `Toggle` (`onToggleDark`) writes the key. The no-flash script reads the SAME key — **keep the value convention in sync across all three.**
- **No rgba/hex literals in JS — every colour references `var(--…)`.** Migrated token-by-token in waves. **v14.2.0:** core `S` set + app background (`--bg-app`). **v14.2.1:** `constants.js` colour sets — `STATUS_COLORS` + `TBL` as **RGB-channel triplets** composed `rgba(var(--…-rgb), a)`; `BLOCK_BG` + `BTN` direct tokens (theme-invariant saturated fills; only status-chip **text** flips). **v14.2.2:** `atoms.jsx` + the full **modal/form subsystem** (every `Overlay` modal, `Section`, inputs, steppers, `Toggle`, `Kbd`, the Settings `TabBar`, in-modal banners) — surfaces + their text flip together (coupling: the shared `Overlay` backs 7 modals, so a dark sheet needs dark-themed content). Then **v14.2.3** `TimelineView` · **v14.2.4** `ListView` · **v14.2.5** the main-screen banners in `App.jsx` (offline/reconnect/load/overlap/reshuffle) completed the migration — **every in-app surface is now themed** (timeline/list canvas included; the login screen followed in v14.4.0).
- **Token families** (index.html): surfaces `--bg-sheet`/`-sheet-mobile`/`-soft`/`-input`/`-stepper`/`-tabbar`/`-tab-active`/`-card`; borders `--border-sheet`/`-soft`/`-input`/`-kbd`/`-glass`; `--scrim`; semantic text `--text-primary`/`-secondary`/`-muted`/`-faint`/`-required`/`-on-accent` + `--warn-text`/`--danger-text`/`--success-text`; banner trios `--warn-*`/`--danger-*`/`--suggest-*` (bg+border+text move together); shadows `--shadow-sheet`/`-soft`/`-input`/`-btn`. **Dialog sheets use the near-opaque `--bg-sheet`** (dark = 0.85), per the opaque-popover rule. `ReminderEditor` has its **own** modal (not `Overlay`) — theme its scrim/card directly.
- The PDF/print path stays light regardless of in-app theme (currently no in-app PDF/export exists; keep it light if one is added).

### Hover affordance — COMPLETE (v14.3.0 → v14.3.2; see `MGT_Bookings_hover-scale_PORT_INSTRUCTIONS.md`)
- Shared `.mgt-hover-scale` utility in `index.html` `<style>`: `scale(1.08)`, `120ms ease`, opaque theme-aware `--bg-hover-card` (`#ffffff` light / `rgb(50,50,53)` dark, both theme blocks), the `:hover:not(:disabled)` guard, reuses `--shadow-soft`.
- **v17.7.0: the hover rule no longer sets `border-radius`.** It used to hard-set `12px`, which squared off every pill the moment the pointer touched it. The declaration was **deleted**, not set to `inherit` — `inherit` resolves against the PARENT's radius, so a bare element inside a square parent would go square, which is the opposite of the intent. Each element now keeps its own resting radius on hover. Do not re-add a radius here. **Consequence: any `.mgt-hover-scale` element MUST set its own `borderRadius`** — the rule still applies an OPAQUE `--bg-hover-card`, so a radius-less element renders that background as a hard-edged rectangle on hover. `ConnectionStatus`'s dot button (transparent, no radius) was exactly that case and got `borderRadius: R.pill` in the same version (12px on its 24×40 box — exactly the shape the rule used to draw). It was the only one in the app, but check any new one.
- **v15.1.0: the `:hover` rule is wrapped in `@media (hover: hover) and (pointer: fine)`.** iOS Safari makes `:hover` STICKY after a tap — unguarded, the last-tapped element stayed scaled 1.08, and full-width form inputs (Date/Time in the booking form) visibly overflowed their Section on phones. Touch devices get no hover lift at all; mouse/trackpad behaviour unchanged. The guard is part of the shared contract — **ported to MGT Scheduling in its v15.1.1** (2026-06-16); keep the two in sync.
- Opt-in per element via `className="mgt-hover-scale"`. Because `mkInp`/`mkBtn` return style objects, put the class **directly on the call-site element**, not via a prop.
- **In Bookings the lift is `transform: scale(1.08)` ONLY.** Every tagged surface uses `mkBtn`/`mkInp` (inline `background`+`boxShadow`+`borderRadius`), which beat the hover rule at higher specificity (Fix 2), so each keeps its own colour/shadow/radius and only scales. `--bg-hover-card`/`--shadow-soft` still apply to a bare (background-less) element — see the radius consequence above. Disabled controls stay flat via `:not(:disabled)`; for non-`disabled` "blocked" controls (TableGrid busy cells) the class is withheld instead (`className={blocked ? undefined : ...}`).
- **`Overlay` gained an optional pinned-`footer` slot (v14.4.1).** Pass `footer={…}` and the action buttons render fixed at the modal bottom while `children` scroll above (desktop = flex-column card with a `minHeight:0` scroll body; mobile = sticky bottom bar with safe-area padding). Omitting `footer` keeps the original single-scroll behaviour (back-compat for read-only popups like `HistoryPopup`). **All action modals pass `footer`** — the 5 component modals, the inline App.jsx confirm dialogs (delete/cancel/kitchen/reshuffle/reminder-del) + the Settings modal, and `ReminderEditor` (its own z-250 modal, restructured to the same scroll-body + pinned-footer shape). Blur budget unchanged (one card renders → scrim blur(8) + card blur(20) = 2). The Hover-scale Fix-4 inner-scroller is still NOT used — the footer region has its own padding, so hover-lifts don't clip there.
- **Fix-3 timeline (`TimelineView`):** pad the *scroller* (`padding:8`), NOT the inner grid — the grid is `pct()`-positioned against the inner width, so padding the inner div shifts every block. `labelCol` mirrors the scroller's `paddingTop:8` so rows stay aligned (verified: row-top delta 0).
- **Coverage:** v14.3.0 header chrome · v14.3.1 ListView cards+buttons, TimelineView controls+blocks, Settings tabs · v14.3.2 `Toggle` atom + every modal's buttons/steppers/cells/inputs + App.jsx confirm-dialog & banner buttons.

---

## Workflow

### Versioning & the ship flow — see the `mgt-workflow` skill

- Version source of truth: `src/App.jsx` → `__APP_SIGNATURE__.version`. **Every meaningful change bumps it**, in the same branch/PR.
- One version per branch, one branch per PR, branched off fresh `main`. The full step-by-step (branch naming, bump, REFACTOR_LOG entry, build, PR, verification suite) lives in the **`mgt-workflow` skill** — load it before any edit under `src/` or any commit/branch/PR.
- `gh` CLI is at `/opt/homebrew/bin/gh` (not on `$PATH`).
- Interactive git flags (`-i`) aren't supported in this environment.
- **Commit/push only when asked.** If you're on `main`, branch first.

### Local dev server — `npm run dev` ONLY (LOCKED)
- **Every coding session sets up BOTH a localhost dev server (`npm run dev`, DEV Firebase) AND the Preview bridge** (`mcp__Claude_Preview__preview_start` on the dev URL) at the start — not just for visual changes — so any change can always be verified live before declaring it done. The "skip the server" note below is subordinate to this: for pure-logic/doc/planning work the pair comes up the moment edits begin.
- For any session that touches **visual code**, start `npm run dev` at the start and keep it running; tell Patryk the localhost URL. Vite HMR is <1s; suggest ⌘⇧R if an edit doesn't appear.
- **Never run `npm run preview`.** `npm run dev` only — it hits the **DEV Firebase project** (the safe sandbox). Prod-build verification is **Patryk's** job; Claude never loads the production app.
- DEV is the sandbox by design — never click Save against PROD data while inspecting. The split is enforced in `src/firebase.js` via `import.meta.env.DEV`; **never bypass it.**
- **Skip the server** for pure-logic/hook changes with no visual surface, doc-only commits, and planning/exploration (start it once edits begin).
- DEV sign-in `auth/invalid-credential` on localhost is almost always environmental, not a code bug.

### Trigger phrases (in chat)
- **"give me the deployment version"** — produce a production-ready file with Firebase integration, auth, cleanup logic, logout.
- **"give me changelog"** — generate a PDF changelog (use `MGT_Changelog_Instructions.md`).
- **"sum up this thread"** — produce a markdown thread-summary continuity guide (same format as the context folder's existing `MGT_*_Thread_Summary.md` files) AND update **both working folders** every time (a `UserPromptSubmit` hook in `~/.claude/settings.json` also reminds on this phrase):
  - **Context folder** (`../megustastu-bookings context`, i.e. `/Users/patrykzychowicz/Desktop/megustastu-bookings context`) — save the summary as `MGT_Bookings_<topic>_Thread_Summary.md`, and refresh the mirror copies of `CLAUDE.md` + `REFACTOR_LOG.md` to match the repo. This folder is the durable store for summaries + working files.
  - **App repo** (this folder) — keep the canonical `CLAUDE.md` / `REFACTOR_LOG.md` current via the normal per-version flow. The repo is the source of truth; the context-folder copies are mirrors of it.
- Preview-file naming while iterating: `restaurant_booking_v{X}_preview {N}.jsx` (incrementing, never overwrite).

---

## Common operations

### Debugging
- **Version mismatch:** DevTools console boot banner; `window.__MGT_BUILD__`.
- **Firebase issues:** Firebase Console for live state; console for `[SAFE]` refusal logs and the `[firebase] DEV/PROD` badge.
- **State inspection:** React DevTools (BookingApp's state tree).
- **Re-render storms:** React DevTools profiler. Common culprit: an un-memoised derivation in BookingApp (no `React.memo` in use yet — add only when profiling proves need).

---

## Gotchas and constraints

| Issue | Constraint |
|---|---|
| Backdrop-filter performance | ≤4 simultaneous `backdropFilter: blur()` instances |
| Optimizer 15:00 cutoff | `useAutoOptimizer` auto-toggles; don't override without daily-reset logic |
| Seated bookings | Cannot be reshuffled by optimizer; manual moves only |
| Walk-ins | `_manual:true _locked:true`; immune to optimizer |
| Firebase free plan | No automatic backups. Don't rely on Firebase rollback. |
| Empty-array writes | Refused by save guards if `firstLoadCount > 0`; design around this |
| `formRef.current` vs `form` | Event handlers read the ref; renders read the state |
| Cross-view modals | ManualModal opens from form / timeline / list — keep its mount in BookingApp |
| 51-blur-instance lag | Was a real production bug on tablet; never reintroduce |
| `mkInp`/`mkBtn` | Return **style objects** in Bookings (not JSX) — no prop passthrough |
| Worktree paths | In a worktree session, Edit/Read absolute paths must include `.claude/worktrees/<name>/…` or they silently target `main`'s checkout |
| Firebase `set()` inside a setState updater | **Corrupts data, not just doubles writes** (proven live, v16.0.0): RTDB fires local listeners synchronously on `set()`, the echo lands mid-update, StrictMode re-applies the queued updater on echo state → a concat updater persists the entry TWICE. Use the ref-mirror shape (`useWaitlist.js` / `useReminders.jsx`): compute from a ref, then `setState` + the write as plain statements. All hooks are converted as of v16.0.0 (useReminders ported with the CAS change) — never reintroduce the updater-side write |
| Settings tabs — ONE list | `SETTINGS_TABS` (SettingsChrome.jsx since v17.1.0; re-exported by Settings.jsx) is the single source: the TabBar renders it AND App.jsx's ←/→ keyboard nav derives its cycle from it. **Never inline a literal tab-id list** — a hand-copied 4-item list is how arrows skipped the new Customers tab (v16.0.0 follow-up) |
| React.memo × live module bindings | v17.1.0: TimelineView/ListView/PlanView/Summary/DaySheet are `React.memo`'d. Two hard rules: (1) function props must be App's **stable `VA` wrappers** (viewActionsRef pattern) — never inline closures (defeats the memo) and never a comparator that ignores function props (stale closures); (2) a memoized component reading **live bindings** (OPEN/QUARTER_HOURS/TIMELINE_TABLES/TOTAL_SEATS/hoursFor) needs identity-only `hoursSig`/`layoutSig` props, or an hours/layout edit won't repaint it. Any object/array prop must be `useMemo`'d in App or the memo is dead |
| Inline sub-components | An inline component (defined inside another component's body) is a NEW type every render — React unmounts/remounts its whole DOM subtree (the v15.8.0 TimelineBlock lesson; v17.1.0 caught GridLines/BlockBar rebuilding 500+ grid nodes per keystroke). Hoist to module scope, pass former closures as props |
| A SCROLL container around `.mgt-hover-scale` | Same clipping trap as below, but you can't fix it with `overflow-x: visible` — the CSS spec forces the other axis to clip once one axis is `auto`. A scroller clips at its PADDING box, so the fix is to make the scrollport wider than its content: **`padding-inline: 4%`** (the lift is `scale(1.08)` = exactly 4% of card width per side, so a percentage self-scales at any width), plus a matching **negative margin** where the content must stay put. The percentage resolves against the **containing block**, so a scroller that is not itself the sized box needs a wrapper: `SplitLayout` puts each scroller inside a non-scrolling frame that carries the pane's `flexBasis`, and a flat `4%` is then correct in every direction at every ratio (card width ≤ 92% of the frame, so the 4% lift always fits inside a 4% gutter — it's provable, not tuned). Hit three times in v17.5.0 before landing there: first the lift was clipped outright in the locked-nav region and both split directions; then a hand-scaled `4 * share + "%"` applied the vertical share to a horizontal gutter, so top/bottom stayed broken (an 806px pane got 16px of room for a 31px lift); the frame removed the hand-scaling entirely |
| `overflow:hidden` around `.mgt-hover-scale` | Clips the hover lift — the "clip only while animating" rule applies to ANY container of a hover-lift, not just height animators (Reveal/AutoHeight). Rounded-corner cards rarely need clipping (children don't paint edge-to-edge); if a child must be clipped, clip only while its own animation runs (CustomersSettings rows, v16.0.0 follow-up) |
| Completed bookings & availability | **Completed = table free, everywhere** (v16.0.0 follow-up, Patryk-confirmed): every busy-set builder excludes `completed` (ManualModal, doSave manual guard, WalkinForm, `findKitchenFriendlyTimes`, `findFreeSlot`; the optimizer always did via `isActive`) — a completed visit's guests left, so a seated party can move onto its table; the past-window visual overlap on the timeline is accepted as history. `daySummary` deliberately still counts completed (covers served). Any NEW availability check must exclude completed too |
| Completion duration recompute | **Only a SEATED→Completed transition truncates `duration` to the actual span (`now − start`)** (v16.2.0). A direct Confirmed→Completed keeps the scheduled duration unchanged — else the block balloons to hours (completing a 13:00 booking at 21:00 → 8h block). Both completion paths gate on prior status: `updateStatus` (`status==="completed"&&x.status==="seated"`) and `doSave` (`orig.status==="seated"`). The close-time auto-complete (`usePersistence`) is seated-only anyway |
| Availability scans in render | **`trialFits`/`findTimes` are the app's heaviest calls — never run them synchronously in a mount/render path** (v16.3.0, profiled: one `optimise` = ~70ms–500ms whenever the day has unplaceable bookings — the retry pass — and `findTimes` used to run it per quarter-slot = 5s+; the form froze 11s). Layers: `findTimes` is cheap-first (`findFreeSlot` before the full trial) + early-stops at 10 valid slots/side (= `formatSugg`'s keep) + a **600ms hard budget** (partial suggestions beat a frozen app; the waitlist matcher has a 300ms budget); the form/walk-in scans run through **`useDeferredCompute`** (post-paint, ⏳ row while pending — the modal opens instantly regardless of data); and **`liveBookings` must stay the `useMemo([bookings,nowMins])` in App** — as a plain per-render derivation its ref changed every keystroke (the form draft lives in BookingApp) and silently defeated every downstream memo |
| rAF in a hidden tab | `requestAnimationFrame` NEVER fires while a tab is hidden/occluded (Chrome throttles to zero — hit live in the Preview pane, `visibilityState==="hidden"`). Anything gated on rAF must carry a timeout fallback (`useDeferredCompute`'s 120ms) or it deadlocks in background tabs |
| Recurring occurrence delete → skipDate ORDER | **`delBooking` must add the occurrence's date to the rule's `skipDates` BEFORE the `saveBookings` delete and UNGATED by `ok`** (v16.3.0). The generator effect fires on the bookings change; if the skipDate isn't already in `recurring` state in that same commit, it re-creates the just-deleted occurrence (a regenerate-on-delete race found in live QA). `addSkipDate` is idempotent, so an ungated call is safe even if the delete is held/retried |
| Recurring occurrence ids are DETERMINISTIC | `"r"+ruleId+"_"+date` (path-safe: hyphens/underscores OK in RTDB keys). Idempotency + cross-device convergence rely on this + the `recurringId`/`recurringDate` stamps: two devices generating concurrently produce the SAME id, and the 2nd create is rejected by the per-`$id` `updatedAt` CAS (baseUpdatedAt 0 vs stored). Never make occurrence ids random |
| PENDING status gating | v17.0.0: a pending booking's ONLY forward status is `>Confirmed`; Cancel/Delete stay reachable (decline flow), seated/completed hidden EVERYWHERE (form Status section, timeline RMB popup, List buttons, keyboard S/C no-ops). **v17.6.0 adds the reverse direction, in the EDIT FORM only:** `>Pending` walks a booking back to awaiting-confirmation, offered on `confirmed`/`cancelled` but NOT on `seated`/`completed` — those are physical facts that already happened, and "awaiting confirmation" would contradict them. The list is `statusTargets` in BookingFormModal; the List card's quick buttons deliberately do NOT offer it (the form is the considered surface). The footer's "Save & confirm" keys on the PERSISTED status, so a pending DRAFT on a confirmed booking correctly shows no extra button. Otherwise pending = confirmed (occupies table, optimizer, late-tracking, counts). Any new status surface must respect this |
| Anonymized bookings ("Data removed") | v17.0.0: `deleteCustomer` anonymizes, never deletes — keep `date/time/size/status/tables/duration/deposit/noShow` for stats; wipe `name→"Data removed"/phone/notes/history`; set `anonymized:true` (sanitize-whitelisted). Every NAME-search/autocomplete path must skip `b.anonymized` (phone paths self-exclude — phone is empty) |
| iOS + SVG touch drags | v17.0.0 round 10: WebKit's touch handling for SVG is unreliable — `touch-action` on an `<svg>`/child is IGNORED (round 7), and an explicit `setPointerCapture` on an SVG element is the shakiest path of all. Hang BOTH defences off the HTML WRAPPER instead: `touchAction:"none"` on the wrapping `<div>` (honoured, and the effective touch-action walks the ancestor chain to the descendant SVG) + the non-passive `touchmove` preventDefault listener on that div. For touch, DON'T capture at all — the spec implicitly captures a touch pointer to the pointerdown target, so moves bubble to the svg's handler anyway (capture mouse-only). Round 7 fixed only half of this (both defences were on the `<svg>`) and iOS drag stayed dead |
| A portalled scrim swallows the pointer**up** | v17.0.0 round 8: a popup/scrim portalled to `<body>` sits ABOVE the surface that armed a gesture, so the surface's `pointerup` NEVER fires and its drag/pan ref stays armed — the next stray mouse move replays the whole delta (PlanView's RMB → popup → close → the plan jumped). Arm a pan/drag only on the PRIMARY button (`e.button!==0` → bail) AND bail on a move with `e.buttons===0` (mouse can't pan with nothing held). Never rely on pointerup alone to disarm |
| setPointerCapture kills `click` | Calling `setPointerCapture` in a pointerdown handler redirects the subsequent `click` to the CAPTURING element — child onClick handlers silently never fire (hit live in PlanView's pan logic; the table-tap popover died). Don't capture on a canvas that also needs child clicks; track the pointer without capture, or gate capture on actual movement |
| A shipped service worker CANNOT be withdrawn by deleting it | An installed SW keeps controlling the page forever; removing `/sw.js` from the deploy does **not** unregister it, and a revert cannot reach the device. The only remote fix is to ship a worker at the SAME URL whose `activate` clears the caches and calls `registration.unregister()` (browsers re-fetch `/sw.js` on navigation for any live registration) — that is what `public/sw.js` is now. This is the single most important thing to understand before ever registering one again: a SW bug is **not** revertible, unlike every other client change in this app |
| A SW must be testable on the target device before it ships | v17.4.0's worker froze the app at "⟳ Loading bookings…" on **iPhone and iPad** while desktop was fine, and it was never reproducible locally (a PROD-mode build against DEV data loads clean on desktop). It was PROD-only by design, so DEV could not exercise it at all — the one component in the release with no possible pre-deploy verification, which is exactly the one that broke. Don't ship a PROD-only code path to the restaurant's devices without a way to run it on one |
| A `const` used above its declaration in a render body | Function declarations hoist; `const` does NOT — it throws a TDZ ReferenceError, and in a component body that blanks the whole app with only a generic "An error occurred in \<BookingApp\>" in the console. Hit in v17.5.0: `activeView` was declared next to the split handlers (which hoist fine) but consumed in `useKeyboardShortcuts`' ctx object 400 lines earlier. Anything the kbRef ctx reads must be declared ABOVE that call. Note lint and `npm run build` both pass — only running it catches this |
| The Esc chain bypasses every `onClose` | `useKeyboardShortcuts`'s Escape branches call the state setters DIRECTLY (`K.setShowForm(false)` …), never the modals' `onClose` props. Any behaviour you attach by wrapping a mount-site `onClose` — a confirm, a cleanup, an analytics ping — is silently skipped on Esc unless you also edit that chain (v17.5.0's unsaved-changes guard). Mobile is the mirror image: `Overlay`'s `mob` branch (`<600px`) renders NO scrim, so backdrop-click doesn't exist there and the footer button is the only exit |
| `BTN.cancel` is RED | In this app "cancel" means cancel the BOOKING, so `--btn-cancel` is `rgba(220,60,60,.75)`. Do NOT reach for it as a generic dialog "go back" — next to a red primary it reads as two danger buttons. The neutral dialog secondary is `--app-btn-slate` (see `confirmKitchen`'s "Back", v17.5.0's "Keep editing") |
| An `onValue()` without its third argument | `onValue(ref, success)` takes an OPTIONAL third **error/cancel** callback. Without it a failed read (permission denied, blocked transport, rule rejection) fires **nothing at all** — no console line, no state change — and since `setBookingsReady(true)` lives in the success path, the app shows "⟳ Loading bookings…" forever with no way to diagnose it. All 16 listeners now pass `dbError("<path>")` (`src/lib/dbError.js`); **any new one must too.** This single omission is why the v17.4.0→v17.5.0 tablet outage was misattributed to the PWA for a full release cycle |
| CSP `connect-src` does NOT cover the RTDB fallback | Firebase RTDB has two transports. WebSocket is `connect-src`. The **long-poll fallback is JSONP** — it injects `<script>` tags into a hidden iframe, so it is governed by **`script-src`**, which is `'self'` + one hash in `vercel.json`. Worse, the SDK caches a single WebSocket failure in `localStorage["firebase:previous_websocket_failure"]` and then prefers long-poll on that device **forever**, so one wifi blip permanently bricked the Android tablet while identical devices were fine. v17.5.1 fixes it with `forceWebSockets()`. Widening `script-src` was tested on the affected device and is **insufficient** — the `.lp` requests then return 200s and the app *still* never loads. Don't "fix" this by loosening the CSP |
| A green connection dot does not mean connected | `isOnline` is `useState(true)` and its offline branch is gated on `hasConnectedRef.current`, so before v17.5.1 a device that had **never** completed a handshake showed a confident green dot and no offline banner. It asserted a connection that had never existed, which is what sent the tablet investigation after an auth bug. There are now THREE states — `hasConnected` distinguishes amber "Connecting…" from green "Connected". Any new connection UI must keep that distinction |
| SVG `<text>` in a shipped icon | An icon referencing `font-family="-apple-system, …"` renders a DIFFERENT face on every non-Apple platform (the pre-redesign v17.4.0 icon did exactly this — Android and the Chrome tab disagreed with iOS). Icons must carry type as OUTLINES; `scripts/gen-icons.py` does the conversion |

---

## Lessons to carry forward (hard-won on Scheduling + Bookings)

- **Worktree path anchoring.** In a worktree, Edit/Read absolute paths **must** include `.claude/worktrees/<name>/…`. Worktree cleanup is batched — sweep stale worktrees in one pass at a milestone, not per-version.
- **StrictMode mounted-ref bug.** Set `mounted.current = true` **inside** the subscription effect, not only via the `useRef` initializer.
- **Check computed styles before iterating on visual feedback.** When Patryk says "too big" / "doesn't match", read the computed font-size / padding / dims first — visual mismatches usually have one structural root cause that geometry tuning won't fix.
- **Preserve inline styles on refactor.** When splitting a shared style object into per-element styles, grep the original for every declaration and verify each survives. Also: `{ marginLeft: n, ...someStyle }` where `someStyle` has a `margin` shorthand silently resets the margin — put the specific side **after** the spread.
- **Don't revert user-confirmed behaviour.** If Patryk approved a behaviour, don't quietly undo it later chasing an unrelated fix — ask first.
- **Grep unfamiliar atoms before use.** Verify a helper's actual return/props at a call site before relying on it (the `mkInp`/`mkBtn` JSX-vs-style-object divergence is exactly this trap).
- **Don't spawn subagents unless asked** — re-deriving context cold is the expensive path; handle multi-part tasks inline.
- **Push back on bad architecture.** If a request leads to instability or bad structure, say so and propose a better approach. Patryk is self-taught and explicitly wants this.
- **Conversation budget:** after ~25 messages, suggest a fresh thread; carry context with a "sum up this thread" summary + attach `CLAUDE.md`.

---

## Out of scope

- **Multi-tenancy** — single-restaurant app; no plans to generalise.
- **Mobile app** — web-only; mobile is responsive layout (`useWinW` → `isMobile`).
- ~~**Tests** — no test suite~~ **STALE since v17.3.2**: a Vitest suite EXISTS (`tests/booking-logic.test.js` + `tests/customers.test.js` + `tests/drafts.test.js`, 88 tests as of v17.5.0, `npm test`; CI gates build+test+**lint (0 errors, a hard gate)** on every PR via `.github/workflows/ci.yml`). Run/extend it when touching `booking-logic.js`, `customers.js` or `drafts.js`. No UI/component tests — UI verification is still AST audits + manual DEV QA.
- **TypeScript** — pure JavaScript; no plans to migrate.
- **Storybook / component dev environment** — components are developed against the live (DEV) app.

---

## Future work

Pending/deferred work moved to **`ROADMAP.md`** (repo root) — see that file, not
here. Shipped version history lives in `REFACTOR_LOG.md`.

---

*Keep this file lean — it's auto-loaded by Claude Code and attached to fresh threads.*
