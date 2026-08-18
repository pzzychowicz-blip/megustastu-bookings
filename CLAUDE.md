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
│   ├── usePersistence.js            v17.10.1 reconnect watchdog (`goOnline(db)` after 20s of a disconnected FOREGROUND page, on the existing 10s heartbeat — see the Gotchas row on the 5-minute backoff; `forceReconnect` is also exported for the popover's "Reconnect now") + Firebase + write-guards (loaded/empty + v15.2.0 freshness-resync gate + v16.0.0 wake-race fix: a gap trip resets isConnectedRef so resync waits for a FRESH .info/connected) + v15.5.0 per-booking-node diff-write (+ v16.0.0 baseUpdatedAt CAS + StrictMode patch-dedupe; blocks via revGuard) + lazy array→keyed migration + auto-extend + auto-complete-after-close (v15.1.0) + v17.3.0 `bookingsReady` state (false until the FIRST bookings snapshot lands — drives App's "⟳ Loading bookings…" floating toast)
│   ├── usePresence.js               v17.3.0 — real-time device presence for the connection-dot popover. Subscribes to .info/connected → on connect pushes ONE ephemeral child `presence/{pushKey}` {email, ua (deviceLabel from userAgent), since:serverTimestamp} with onDisconnect().remove() (self-cleans on tab-close/sleep/drop); subscribes to `presence` → returns {devices[], myKey, offset}. **v17.8.0: onDisconnect alone leaks.** It arms ONE fire-once server op; if the socket drops between arming it and the `set()` landing, the server fires the (empty) removal and the SDK then REPLAYS the queued `set()` on reconnect — writing a child with no onDisconnect, i.e. immortal. Reordering the calls only moves the window. So a live connection re-proves itself with a 45s `lastSeen` heartbeat, a child counts as connected only inside STALE_MS (150s), and children past PRUNE_MS (10min) are deleted. **The staleness filter is enforced on READ**, so a pre-existing leak is hidden the moment the code runs, with no write needing to succeed; deletion is 4× more conservative because hiding is reversible and deleting isn't. The prune is ARMED on connect and CONSUMED by the next `presence` snapshot — it cannot run in the `.info/connected` handler, which resolves before the first snapshot exists (the first version did, and never fired). A pre-v17.8.0 child has no `lastSeen`, so the filter falls back to `since`. `.info/serverTimeOffset` is subscribed because the whole model compares a serverTimestamp to local time. EXEMPT from the CAS/revGuard rule (ephemeral, per-connection; the prune touches other keys but only to delete already-dead ones, which is idempotent); `presence` inherits the top-level .write:auth!=null with NO .validate, so NO Firebase console step
│   ├── useReminders.jsx             reminder state + listeners + banner JSX — the ONLY hook that returns JSX, which is why the v14.2.x token sweep of `src/components` never saw its banner (themed at last in v17.8.0; needed a new `--app-success-solid` token) (v16.0.0: ref-mirror saves — the set()-in-updater shape is GONE — + revGuard CAS writes; v17.8.0 owns `reminderBaseline`/`reminderDirty` for the unsaved-changes guard, diffed via a local `flatReminder()`)
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
│   ├── TimelineView.jsx             Gantt-style timeline (horizontal scroller; v16.0.0 start-time chips — CONFIRMED blocks only (seated/completed never chip) + ALL-OR-NOTHING across the day's confirmed blocks (shown only when every confirmed block ≥140px — completed blocks' frozen tiny widths must never kill the others' chips), v16.1.1 chip wrapped in a HORIZONTAL Reveal so the sibling name eases in lockstep instead of snapping (was a Presence transform-slide → jump) + " ⚠" label marker for 2+ no-show phones; v16.1.0 running-late amber border on confirmed blocks + quick-status "No show" option at the noshow stage — overstay warnings keep border precedence; v16.1.1 quick-status popup buttons get .mgt-hover-scale; v17.0.0-correction drag&drop — drag a block vertically to another row (mouse 6px threshold; touch hold ~800ms past the quick-status) → App's dropOnTable moves or SWAPS table sets; v17.2.0 per-device zoom/follow settings via scalar props followZoom/followLeadMins/maxZoom (App's tlSettings — the ex-hard-coded 4×/30min/5×) + group hover-lift: data-bk + mouseenter/leave toggle .mgt-group-hover on ALL of a multi-table booking's cells (DOM classList, no React state); v17.9.0 **the block reads left-to-right — identity, then status**: `time · name · size` on the left and a fixed-width flag rail on the right (deposit · preferred · locked · repeat-no-show · overstaying · Assign), where before a ★ sat between the chip and the name and the size and flags were concatenated INTO the name string — so the line you scan a grid of blocks for started and ended at positions that varied per booking. The size is an 18px `SIZE_RING` (shared with `WaitGhost`, same anti-drift reason as `HOUR_PILL`; its 0.55 white border is a recorded measurement — `--blk-rule`'s 0.3 renders at **1.21:1 on pending**, i.e. absent, and no white can reach 3:1 there). The `=` handle is `AssignIcon` with a 2px divider. **Two traps worth carrying:** `flex: 1`'s ZERO BASIS is the load-bearing part — splitting that span into name+ring as `0 1 auto` tipped narrow blocks out of flexbox's grow phase into its SHRINK phase, which squeezed the start-time chip to "19:0"; and the chip's width threshold is now `chipRoomFor(b,…)` rather than a flat 140, because every rail item is `flexShrink:0` so the name's remaining room depends on how flagged the booking is — at 140 a two-flag block kept its chip and rendered the guest name at ZERO width. Dropping the chip hands 42px back to the name, which is the right trade. v17.8.0 **waitlist ghosts** — `waitGhosts` (memo'd in App, scoped to the viewed date) draws each waiting party a table currently fits as a dimmed PENDING block on its matched row, tappable → `onBookWait` → App's `bookFromWaitlist`. **It is TimelineBlock's own style object verbatim** (geometry, radius, border, shadow, chip, `Name (size)` label grammar, and — v17.8.0 — the group hover-lift, under its OWN `data-wg` attribute rather than `data-bk`, because waitlist and booking ids both come from `genId()` and one shared namespace is one collision away from a ghost lifting an unrelated booking) with `opacity` turned down — 0.55, or 0.4 + a dashed edge when `resh` (a match only reachable by re-optimising, which can sit over a visibly occupied table). The polish round rewrote it this way after the first version layered a 0.3-alpha fill under a full-strength label: a label above its own fill must pick its own colour, it picked `--text-secondary`, and that token INVERTS between themes — so the ghost's text changed colour on a theme flip while every real block's `--text-on-accent` did not. **Rule: a "quieter version of X" dims X, it does not re-specify X** — anything that re-specifies is free to drift from it. The `⏳` sits BETWEEN the time chip and the name, in the column a real block uses for its ★ / ⚠ / [L]: trailing the name it was the first thing the ellipsis ate, so the marker meaning "proposal, not booking" vanished on exactly the narrow blocks where the dimming is hardest to read)
│   ├── ListView.jsx                 sorted card list. **v17.10.0: the CARD opens the edit form** and the Edit button is gone — the card had a pointer cursor and (v17.9.1) a hover tint, both promising a click does something, while what it did was set an invisible keyboard selection with a button inside it repeating what the card already looked like it would do. It still selects first, so ↑/↓ resume from the card you opened; `listFocusReq` is deliberately NOT bumped (that counter is for PROGRAMMATIC selection, and scrolling under a finger that just tapped is the bug it was added to avoid). Consequence: **every control inside the card must go through the local `stopped()` wrapper** or it does its own job AND opens the form — one forgotten control fails in a way that looks like the form opening at random. The action row is three groups: Assign left · status changers pushed right · the ways a booking ENDS hard right after a wider gap. Completed/cancelled fold into a controlled Collapsible — open state in BookingApp for keyboard-nav sync (v15.1.0); v16.0.0 amber "⚠ no-show ×N" tag; v16.1.0 running-late amber border + "N min late" tag + one-tap "No show" button at the noshow stage; v17.3.1 `focusReq` prop — a scroll-REQUEST counter (App's `listFocusReq`, bumped only at the PROGRAMMATIC selection sites: search-jump + ↑/↓ nav, never a card click) scrolls the focused card into view via its existing `data-flip-id`, re-firing on a rAF+120/300/550/850ms schedule so the SlideView/finished-fold animations can't land it off-centre; App also clears the selection on a mousedown/touchstart with no `closest("[data-flip-id]")` ancestor — neutral space — gated on List view + the keyboard handler's `anyModal`, and on **Esc** as the last branch of the Escape z-order chain (v17.0.0 round 8: the 🔍/⚙ pair it carried since v16.4.0 moved OUT of the view entirely — to App's date-nav row, then in v17.9.0 to App's header; List has no chrome of its own again); v17.6.0 the duration tag survives the visit — seated keeps the live green "N min", completed gains a muted "stayed N min" from `stayedMins(b)`, and renders NOTHING when that returns null (a direct confirmed→completed never had its duration truncated, so its number would be the schedule, not the stay)
│   ├── LateBanner.jsx               "Running late" in-flow banner — one Reveal-eased row per today's late confirmed booking (lifecycle now in useRevealRows, v16.3.0); No-show button slides in via Presence → onNoShow=doCancelBooking(id,true); byId Map avoids O(n·m); v16.3.0 COLLAPSIBLE header (count) + per-row ✕ dismiss (App's lateDismissed Set → lateBannerMap; list/timeline keep the unfiltered lateMap); v16.4.0 default-COLLAPSED when >2 late (open init = lateMap size ≤2; initial-only, no auto-recollapse)
│   ├── BannerRows.jsx               v17.0.0 review fix #6 — the shared per-row Reveal lifecycle (useRevealRows) for Late/Overlap/WaitAvail, which supply a `renderRow(id)` render-prop. **v17.8.0: it renders ROWS ONLY.** Its pane, its collapsible count header and its `tone`/`tint`/`collapseMax` props all moved up to NotificationStrip, so every section — a row list or a single sentence — is headed on identical terms and one collapse bounds the total height (per-banner collapse structurally cannot)
│   ├── OverlapBanner.jsx            v17.0.0 round 7 — Overlap warnings on the BannerRows shell (per-row Reassign + ✕ dismiss); master switch settings/bookingDefaults.overlapWarnEnabled; dismissed Set in App (overlapDismissed, session-only, day-change reset)
│   ├── WaitAvailBanner.jsx          v16.3.0 waitlist "table free" in-flow banner (suggest/green) — one row per TODAY'S waiting party a table currently fits (App's waitAvail), Book (bookFromWaitlist) + ✕ dismiss. v17.1.0: on the BannerRows shell (green tokens via the shell's token props) + honors "Collapse banners above". Replaced the old 6s waitFreeToast
│   ├── StatusToasts.jsx             v17.3.4 — the v15.8.0 floating TRANSIENT-toast layer extracted VERBATIM from App.jsx (de-monolith #2): one-slot priority crossfade (loading→resync→reconnect→syncfix→waitadded→undo→dragmsg→reshuffled→load), always-mounted container, Undo pill via onUndo prop. Rendering ONLY — all state stays in BookingApp (Phase D3); App mounts it in the relative wrapper around SlideView{mainView}
│   ├── AppBanners.jsx               v17.3.4 — offline / write-error / inefficiency. **v17.8.0: exports `appBannerSections(props)` — a FUNCTION, not a component.** NotificationStrip needs each section's tone/title/count as DATA (to build its collapsed summary and to sort by severity); a component could only hand back opaque JSX and App would have had to duplicate the same facts beside it. ineffShow is still computed in App and passed as a boolean
│   ├── SearchPanel.jsx              v16.3.0 global booking search Overlay — auto-focused input, searchBookings across ALL dates (upcoming-first), tap → jump to the day + focus in List (pendingSelectRef survives the day-change reset). Header 🔍 + "/" shortcut
│   ├── DaySheet.jsx                 v16.3.0 printable day sheet — print-ONLY DOM portalled to <body> (sibling of #root); @media print in index.html hides #root + reveals it; HARD-CODED LIGHT (print stays light); Print button in the Summary body
│   ├── Summary.jsx                  day-summary panel (v17.9.0: the **More** button left the header cluster for the expanded body, beside Print day sheet — the header is the day's figures plus the control that reveals them, and More opens a different screen entirely. Consequence Patryk accepted knowingly: More is only visible while the summary is expanded, which is not its default; the `M` shortcut still opens the popover from anywhere) — covers by hour + shift; lives IN the date-nav row (flex:1, grows downward when expanded) + today-only live status bar (seated·upcoming·seats-filled) (v14.6.0; relocated + status bar v14.8.0; "Summary" word dropped + Week→"More" button v14.9.0)
│   ├── WeekView.jsx                 "More" at-a-glance popover (from Summary's More button / `M`) — Week list + Month calendar grid (segmented Week/Month toggle, `W`/`M` keys); per-day covers/bookings, tap to jump (v14.7.0 week; Month view v14.9.0)
│   ├── ViewSwitcher.jsx             v17.5.0 — the T/L/P buttons (extracted from App's inline .map) + the Split View gesture and toolbar. RMB / 450ms press-and-hold opens SplitMenu, matching the timeline/plan quick-status idiom. **The hold timer is cancelled from WINDOW-level pointerup/pointercancel**, not the button's — SplitMenu portals a scrim above the button, so the button's own release may never arrive (the portalled-scrim gotcha). `didLongRef` swallows the trailing click. Both gestures fully inert when `splitEnabled` is off or `isMobile`; in a split BOTH pane views render accent and the focused one is marked by SplitLayout's corner brackets
│   ├── SplitLayout.jsx              v17.5.0 — the two-pane container (purely presentational: it takes the two already-built view ELEMENTS). Draggable divider (`setPointerCapture` on the divider is safe — it has no child click targets, which is the actual condition of the kills-click gotcha; primary-button-only + `buttons===0` bail), ratio committed on pointer-UP only so localStorage isn't written per frame, double-click resets to 50/50, capture-phase `onPointerDownCapture` sets the focused pane. Each pane is a non-scrolling **frame** (carries the `flexBasis`) wrapping the scroller — which is what pins the focused-pane **corner brackets** (an absolutely positioned child of a scroller would scroll away with the content) and what makes the flat `4%` hover-lift gutter self-scale. Only works inside the `shellFixed` layout — the scrollers are `overflow:auto;minHeight:0` and need a definite-height ancestor chain
│   ├── SplitMenu.jsx                v17.5.0 — the **2-step** split setup popup (direction → which second view), on QuickStatusPopup's exact shell. Opening the popup IS the intent, so there is no "Add to split view" confirm step and no Cancel button — the scrim click and the Esc chain (first branch, z=300) are the two ways out (body portal, z=300 scrim, same tokens/radius/44px buttons). Step 3 offers only the two REMAINING views, so the same view can never occupy both panes (which would collide on the singleton timelineZoom / selectedListId / showFinished state)
│   ├── Icons.jsx                    v17.10.0 — the app's icon set (v17.8.0 origin). v17.10.0 adds `ChairIcon` (seated) + `DoubleCheckIcon` (completed) and `StatusIcon`, the ONE status→mark source the List card, the edit form's Status row and the quick-status popup all read (a COMPONENT, not the map — a const export here breaks Fast Refresh, and a caller should ask rather than index). ChairIcon's geometry is the DepositIcon lesson applied again: five variants rasterised at the shipped size, of which a profile chair read as a lowercase "h", a profile chair with an overhang as a plus sign, two back-posts as a capital "H", and a backrest WIDER at the seat than at the back as a table with something on it. The overhang is what makes it a tabletop; backrest and seat at the SAME width read as one object. v17.9.0 origin note follows. **Every CONTROL mark is drawn here.** v17.8.0 drew the line at "does this render as a colour emoji, or is its font coverage patchy" and kept ✕ ‹ › ▲ ▼ ▸ ▾ ✓ ★ as text; v17.9.0 narrowed that, because **an icon set that covers only the glyphs with a rendering BUG is not a set, it is a patch** — the app drew its dismiss control as a text ✕ two millimetres from a hand-drawn SVG cog, the same "not one medium" defect the emoji argument was written about. House style (from CogIcon, which moved INTO the set in v17.9.0 so it finally takes the shared wrapper and a `size` prop — outside it, it was hard-coded 20×20 and rendered a 20px cog beside a 17px search in the SAME pair): 24×24, no fill, `currentColor` stroke, round caps, `strokeWidth` easing up below 18px. Chevrons are ONE shape at four rotations, so a turning disclosure and a pointing nav arrow cannot drift apart. **TWO things stay text, as a CATEGORY rather than an exception list:** prose arrows inside sentences ("Settings → Opening hours", the history entries) — an SVG mid-sentence is a rendering bug, not an icon; and Shortcuts' keycap labels (← → ↑ ↓ ⇧), which depict the key you press, so drawing them breaks the mapping that screen exists to show. **It was three.** The timeline's bracketed `[L]`/`[!]`/`!!` were kept "because they are ASCII and belong to the truncating label string" — and v17.9.0's second pass found both halves false, in the same commit that moved ★ out of that string for the opposite reason. **Truncating with the name is wrong precisely FOR the exception flags**: locked means the optimizer must not move this party, `!!` means someone is sitting in a table the next booking needs, and the ellipsis ate them first — so they vanished on exactly the crowded evening when they matter. And "it is ASCII" is not a reason to look different from every other mark on the same 36px surface; that is the emoji argument's own mistake in a plainer costume. **Watch for the reuse before drawing a new icon** — `!!` renders the identical `warnings` entry the strip's Overlap section does, so it takes `OverlapIcon`; only two icons were drawn for three markers. The deposit flag was the worst of the four: it printed the **currency symbol from settings/general**, so "money has been taken" was a different shape per restaurant setting — it is `DepositIcon` now, with the amount, which the symbol never showed, in the hover title. **v17.9.1 redrew it as a BANKNOTE**: at the size a block flag actually renders at (11px then, `IC.control` 14 now), v17.9.0's two concentric circles read as a target, not as money — and a note has an outline nothing else in the set shares (everything else here is round, diagonal or a chevron), so it is identifiable by silhouette before any detail resolves. Two shapes and no more; the size that decides an icon is the size it SHIPS at, not the 24 it is drawn at. **It took three passes, between two competing constraints.** The first note was 12 of 24 units tall with an r-2.6 hole — half the optical mass of the star beside it, and the hole closed to solid (an interior shape must be ≥ ~3× the stroke or it fills in, the same reason `LockIcon` has no keyhole). The correction over-shot to 19×15, a ratio of 1.27:1 — a rounded SQUARE, which hands back the very silhouette argument the note was chosen for. It ships at **20×13 (1.54:1)** and deliberately no flatter: rasterised at 14px and magnified, 20×12 and 21×11 are better note shapes, but the rectangle can only flatten by squeezing the circle, and at 20×12 the hole is back to the ~2.3px that failed. **Aspect ratio and interior detail are in direct competition at this size, and the interior wins — a note-shaped blob is not a banknote either.** Judge it rasterised at the shipped size (a canvas blit magnified 10×), never drawn at 24. And the replacement had to stay currency-NEUTRAL — a drawn `$` would hand back the exact defect the v17.9.0 change removed, in a shape that merely looks deliberate. **A glyph scan cannot see an HTML entity**: App.jsx and WeekView drew their nav chevrons with `dangerouslySetInnerHTML` `&#8249;`/`&#8250;`, invisible to the sweep until the icons around them changed. **And update the COPY with the glyphs** — LayoutSettings' "Reorder with ‹ ›" and WeekView's two hint lines described marks that no longer existed.
│   ├── NotificationStrip.jsx        v17.8.0 — the ONE pane every in-flow notification shares. Six banners could be live at once, each with its own pane and margin, and on a busy evening they pushed the timeline off the bottom of the tablet. Collapsed height is ONE row however many fire (the point: the cost of a bad evening stops scaling with how bad it is); collapsed it shows `sections[0]` + "+N more". **Severity order lives in App, not here** — it is a judgement about this restaurant's operations, and the collapsed summary reading `sections[0]` makes "worst first" load-bearing. Sections are `{id,tone,tint,icon,title,count,node}` — `icon` is a COMPONENT (re-rendered at two sizes: the section header, and the collapsed per-category tally). With several live, the right side is an icon+count per section rather than a bare total, so "1 reminder, 2 waiting" is legible without expanding — and it does NOT disappear when the strip opens (v17.8.0 correction): the lid's contents must not change under the finger that tapped it, and the tally is the one part that stays useful open, because the sections scroll and the lid doesn't. **Adding a section means adding an icon**, or it falls back to the old dot. The strip also owns `Closed this day` and `Couldn't load bookings` (v17.8.0 audit) — the first was drawn separately in TimelineView and PlanView and missing from List, the second was a floating toast despite being permanent and unrecoverable. the banner components keep their rows/actions/Reveal lifecycle and lose only their pane and header (the strip heads every section on the same terms, so a one-sentence section looks like a row list). With exactly ONE section live the strip takes that section's own title instead of a generic lid + redundant sub-header. `collapseMax` = settings/general lateCollapseMax, which now bounds the STRIP rather than one banner
│   ├── WalkinForm.jsx               walk-in entry form (v16.0.0 "Add to waitlist" under the no-tables banner; v17.1.1 the Plan-path pre-selected table (`_pre` draft flag from openWalkin) survives guest-count edits — plain-path steppers still reset tables — and wToggle deselects a selected-but-busy table)
│   ├── WaitlistPanel.jsx            waitlist Overlay (v16.0.0) — day's entries FCFS, fits-now chip, Book (prefills the booking form) + two-tap Remove
│   ├── ManualModal.jsx              manual table-assign UI (v16.4.0: active Swap-busy panel = saturated orange bg + WHITE title/subtitle for readability, was pale peach + warn-text; v17.5.0 `onDirty` prop — its table picks are component-local so it REPORTS dirtiness up, with an unmount-only `onDirty(false)` cleanup)
│   ├── PlanView.jsx                 v17.0.0 — the Plan (floor) view, 3rd main view (T·L·P): renders layout.floorPlan top-down (shared glyphs from FloorPlanEditor); v17.5.0 the time SLIDER is gone — a scroll-under-a-fixed-marker `TimeAxis` ruler drives occupancy fills, and the scrub range now runs to **GRID_CLOSE** not CLOSE (you can reach the tail where a late booking runs out); the Now button keeps its exact dual action (`setSliderTouched(false)` + `setSlider(clampExact(nowMins))`, today-only, accent at `atNow`) and additionally re-centres the strip — v17.6.0 **smoothly** (`reCentre(true)`), the same glide as a tap-to-jump; the date change and the per-minute clock follow stay instant, and `centre()` downgrades any glide to a jump under "Reduce animations". The header row (Now · selected-time badge · legend) is the `.mgt-plan-headrow` grid in index.html, NOT inline styles: the badge sits in the middle column so it lands exactly on TimeAxis's fixed centre marker (siblings of equal width ⇒ 50% of one is 50% of the other), and it needs a **media query** to fall back to a left-aligned single line below 600px — PlanView takes no width prop, and an inline `gridTemplateColumns` would out-specify the class. **v17.6.0: `clampSlider` is GONE.** While following, the selection is the EXACT minute (`clampExact`, no rounding), so the Plan badge and the tape centre land on the same minute as TimelineView's now-line; hand-scrubbing still steps by 15 because **TimeAxis snaps its own scroll**, which is where the quarter grid always actually came from. The old round-to-nearest-15 was described as load-bearing for the seated-start clamp, but it only ever compensated for the follow position being rounded away from the clock — those clamps now key on raw `nowMins` and are strictly simpler. Occupancy fills (seated/confirmed/pending/free/blocked; v17.1.1 seated occupancy START clamps to the slider grid — the seated-shift time can sit ABOVE the nearest-15-rounded slider, which read as "status change shows late in Plan"); tap → day-queue popover (→ openEdit, "Walk-in here" on FREE-today tables ONLY — the v17.1.1 seated-takeover was REMOVED in v17.1.2: an occupied table never offers a walk-in); RMB/hold → QuickStatusPopup (current-else-next); wheel/pinch zoom + pan + double-tap reset — all gated on the v17.1.2 `gesturesEnabled` prop (per-device Settings toggle; off = touchAction auto, view resets to 1×, hint shortens); freeing-soon pill at now; v17.1.1 fills fade via TableGlyph shapeStyle (360ms ease-out — the timeline Seated→Completed timing)
│   ├── FloorPlanEditor.jsx          v17.0.0 — drag-&-drop plan editor (Settings→Layout "Floor plan"): snap-10 SVG canvas, drag tables/doors (commit on pointer-up), two-tap walls (then fully editable: body drag + endpoint handles), door flip (Opens left/right), all distances cm; inspector (shape/size/rot/per-side chairs + capacity-mismatch warn). v17.1.0: the shared glyphs moved OUT to FloorGlyphs.jsx (re-exported here) so this whole editor rides the lazy Settings chunk
│   ├── FloorGlyphs.jsx              v17.1.0 — chairPositions/TableGlyph/DoorGlyph extracted from FloorPlanEditor (multi-export geometry unit) so PlanView (main chunk) shares the shapes WITHOUT pulling the lazy editor into the startup bundle
│   ├── SettingsChrome.jsx           v17.1.0 — the LIGHT Settings exports needed eagerly: SETTINGS_TABS (still the ONE tab list — App ←/→ nav + TabBar) + CogIcon, which v17.9.0 moved into Icons.jsx and this file now RE-EXPORTS. Lets Settings.jsx lazy-load; Settings.jsx re-exports both for back-compat
│   ├── TimeAxis.jsx                 v17.5.0 — the Plan view's time scrubber: a **tape-measure ruler that scrolls under a FIXED centre marker** (replaced the `<input type=range>`, then the first attempt's row of tappable blocks, which read as a segmented control). Drag/scroll → whatever is under the centre is selected, snapping to 15 min on idle; tapping anywhere scrolls that time to centre. Mirrored ticks top+bottom with hour labels between (the two edges are what make it read as a tape), occupancy heat-tint per quarter, full-height now marker, and a `mgt-detent` squash replayed via `key={selected}`. Spans OPEN…**GRID_CLOSE** = TimelineView's exact range. **`padding-inline: 50%` on the scroller** lets the ends reach the centre AND makes the maths fall out: the track position under the marker is exactly `scrollLeft` (verified live). Scrolling is cheap because React re-renders only when the selected QUARTER changes — a per-pixel update would re-run PlanView's occupancy scan and repaint the floor SVG. NOT memo'd on purpose: it reads live bindings memo can't see, so gating happens in its memo'd parent via `hoursSig`
│   ├── QuickStatusPopup.jsx         v17.0.0 — the quick-status popup extracted VERBATIM from TimelineView so PlanView shares the gating (pending → Confirmed+Cancelled only; late one-tap No show). v17.10.1: its CARD carries `user-select:none` — the buttons are covered by index.html's control rule, but the guest name is a `<div>` and this popup opens under a finger that is still pressed
│   ├── PrefPickerModal.jsx          preferred-tables picker
│   ├── BlockModal.jsx               table-block editor (v17.8.0 `onDirty` prop — its From/To are component-local so it REPORTS dirtiness up, ManualModal-style, with the unmount-only `onDirty(false)` cleanup; dirty = add-mode with a time actually changed from the default window)
│   ├── HistoryPopup.jsx             per-booking audit trail
│   ├── LoginScreen.jsx              auth gate (unauthenticated entry). v17.9.0: shows the app mark (`/icon.svg` — the SHIPPED icon file, never a re-drawn copy, so it cannot drift from the family `scripts/gen-icons.py` maintains) and the **configured restaurant name**. That name was the last surviving `"Me Gustas Tú"` literal, and it survived for a structural reason: this screen renders BEFORE sign-in and `settings/general` is behind `auth != null`, so a read here is permission-denied. It comes from a `localStorage` mirror (`RESTAURANT_NAME_KEY` / `readCachedRestaurantName`, both owned by `useGeneralSettings.js`) — correct on any device that has signed in once, seed on one that never has. **Key, writer and reader live in ONE file on purpose**: the theme's equivalent mirror is split across three sites and needs a written "keep the convention in sync" warning because of it
│   ├── ConnectionStatus.jsx         v17.10.1 "Reconnect now" under the status line, rendered ONLY while disconnected (offering it on a healthy connection invites someone to drop a working socket) — the manual half of usePersistence's reconnect watchdog. Firebase connection dot in the header (v16.2.0; ported from MGT Scheduling) — green/red illuminated dot (from usePersistence `isOnline`); click → popover with status line + signed-in email; closes on outside-click/Esc. v17.3.0: also lists ALL connected devices (from usePresence — email · deviceLabel · "since", current tagged "This device", list scrolls at maxHeight 200). v17.8.0: **Log out lives HERE**, right-aligned on the status row — it belongs with the identity the popover already shows, and the header flexWrapped to three rows on a phone with it there; rendered only when `onLogout` is passed. `sinceText` takes the `offset` prop (see usePresence) because these are serverTimestamps
│   ├── ReminderEditor.jsx           reminder edit modal (z=250)
│   ├── Reminders.jsx                reminder list tab body
│   ├── Settings.jsx                 settings modal shell + tabs (General/Layout/Customers/Reminders/Shortcuts — 5th tab v16.0.0); LAZY-loaded as of v17.1.0 (React.lazy chunk with all tab bodies + the floor-plan editor); SETTINGS_TABS + CogIcon live in SettingsChrome.jsx (re-exported here) — still ONE tab list, never duplicate; General = per-weekday hours · optimizer cutoff(0–24)/auto-switch · shifts · booking-duration tiers · running-late thresholds (v16.1.0) · v17.1.0 "Reduce animations" + v17.1.2 "Plan zoom & pan" + v17.5.0 "Lock navigation" (default OFF, so only `"1"` is stored — the INVERSE of the usual convention) and "Split view" (default ON, normal convention: only `"0"` is stored) per-device toggles + v17.2.0 "Timeline zoom" per-device steppers (default/Follow/max zoom + follow lead — App's tlSettings/onSetTlSetting) and Preferences party-size steppers, sections collapsible (v15.0.0)
│   ├── CustomersSettings.jsx        Customers-tab body (v16.0.0) — search by name/phone over customerIndex, per-row visits/no-show/waitlist chips, expandable booking history, armed-confirm "Delete customer & all data" (parent's deleteCustomer does the writes); v16.4.0 4th totals tile "N no-show, no phone" (count only, shown when >0 — phone-less no-shows aren't in the phone-keyed index; never aggregated into an identity per the no-merge rule)
│   ├── LayoutSettings.jsx           Layout-tab body (v15.0.0) — FULL layout editor: Tables (add/remove/rename·cap·zone, orphan-booking warning on remove/rename) + collapsible Combos (editable join-groups → auto-combo cap overrides + cross-group mega add/edit/remove) + collapsible Table priorities (v15.9.0 — size bands · combo preferences · anchors/mixed-require · swap rules; rename remaps priorities refs too) + kitchen limit; takes `bookings` for orphan detection
│   ├── Shortcuts.jsx                keyboard cheatsheet
│   ├── TableGrid.jsx                13-table picker (used by Manual/Block modals)
│   └── atoms.jsx                    Overlay (+ pinned-footer slot), **ModalTitle** (v17.9.1 — the pill at the top of a modal; SEVEN hand-written copies before it, identical but for the fill and for the SHADOW, where four had drifted onto `var(--shadow-btn)` and three still carried a hand-written white-inset literal. Those three sat on theme-invariant solids so it was a consistency defect rather than a live bug — but three copies of a value nobody can retune is the condition that produces the live bug next time. **It is also where the title-pill COLOUR RULE finally lives**: a create/act surface wears its action's own colour (`--app-new`, `--app-walkin`, `--accent`, `--btn-tables`) so the modal reads as the button that opened it expanded; a configure/read surface wears a neutral (`--app-btn-grey-strong`). `background` is required and has no default — a default would be a silent eighth answer to that question. v17.9.1 changed no pill's colour; see ROADMAP for the two still arguable), Fld, Section, Collapsible (v15.0.0; optional controlled mode `open`/`onToggle` v15.1.0), Reveal (graceful height show/hide via grid-rows 0fr↔1fr + delayed unmount; overflow:visible when open+settled, clip only while animating so inner hover-lifts aren't clipped — v15.8.0; v16.1.1 optional `horizontal` = grid-COLUMNS 0fr↔1fr + inline-grid, eases occupied WIDTH — used by the timeline start-time chip so the sibling name eases in lockstep), Presence/Toast (generic enter/exit wrapper with in/out class + delayed unmount + cached children; Toast = the toast-class alias — v15.8.0), ModalPresence/usePresence (PresenceContext so Overlay/ReminderEditor self-animate close — v15.8.0), AutoHeight (ResizeObserver eases content-height changes; overflow:visible at rest, clip ONLY while the height transition runs so inner hover-lifts aren't clipped — supersedes the earlier "always hidden" — v15.8.0; **v17.8.0 the `linear` opt-in prop is GONE and the easing is `M.resize` unconditionally** — exactly two call sites had ever set it, Patryk named one of them as the reference for how a modal should resize, and the reason generalises to every AutoHeight: see the motion section's linear exception; **v17.9.1 `watch`** = an identity to re-measure on synchronously, pre-paint — the RO is one frame late by design, which on a whole-content SWAP let the new content paint unclipped for a frame. **v17.10.0: the animation runs over the VISIBLE range on BOTH paths** — the observer's too, via the shared pure `clampRange(live,next,cap)` — `min(prev,cap) → min(next,cap)` with the true height retaken at the end, `cap` being the enclosing scroll port's probed ceiling PLUS its `scrollTop`. A caller that never overflows its port takes the plain path untouched, which is why Week/Month/Stats is byte-identical), SlideView (slide wrapper, clips only while animating — v15.8.0; v17.5.0 optional `fill` = `flex:1;minHeight:0;display:flex;flexDirection:column`, needed in the `shellFixed` layout where it must pass a definite height through instead of collapsing to content height), useFlip (WAAPI list-reorder hook — v15.8.0), TBadge, AvailBanner, Toggle (knob/track ease — v15.8.0), mkInp, mkBtn, **mkSel** (v17.8.0 — the dropdown mkInp: `paddingRight: 18`. A `<select>` paints its arrow inside its own padding box, hard against padding-right, and mkInp's 12px lands it deep inside a pill's right CAP — 21.5px wide on the 43px control, since CSS clamps `--r-pill` to half the box. Text is immune because it spans enough height that the curve has receded behind it, which is exactly why the LEFT 12px looks right and the right 12px does not. A single small glyph at the end of a pill wants padding ≈ the radius. `LayoutSettings`' local `SEL_INP` applies the same reasoning against its own smaller box rather than importing this), **mkArea** (v17.7.0 — the multi-line mkInp, used by ALL THREE textareas: `resize:vertical` + `alignContent:"center"` + **v17.7.1 `borderRadius: R.inset`**. A textarea starts its text at the TOP, which is where a rounded box is NARROWEST, so a radius wider than the 12px horizontal padding eats the first characters. v17.7.0 answered that with the centring alone, which fixes it ONLY while the content is shorter than the box — `align-content` has nothing to distribute once the text overflows, and every caller is `rows={2}`, so the third line typed makes the field scroll, returns the text to the top edge, and on `--r-pill` (999px → clamped to half the ~60px box = 30px vs 12px padding) slices the topmost VISIBLE line at every scroll position. **The radius, not the alignment, is the guarantee** — `R.inset` (10px) stays inside the padding at any height/scroll/resize. The centring survives as balance for short content only)
└── lib/
    ├── booking-logic.js             pure functions (optimizer, sanitisation, derivations, daySummary); v15.0.0: isIn via ZONE_OF, date-finders read hoursFor(date); v15.9.0: ALL optimizer heuristics data-driven via PRIORITIES (IS_MGT_LAYOUT no longer imported); v16.1.0: getDur reads the DUR_TIERS live binding + lateState(b,today,nowMins,cfg) → null|"warn"|"noshow"; v17.6.0: `stayedMins(b)` → the actual stay of a COMPLETED booking or null — reads the new sanitize-whitelisted `stayedMin` stamp (written by App's two completion paths on a real seated→completed transition ONLY), falling back to `duration` when a pre-v17.6.0 booking's history records a seated entry
    ├── constants.js                 layout config — DEFAULT_LAYOUT (incl. v15.9.0 priorities seed = the ex-hard-coded MGT heuristics) + setLayout/buildLayout reassign LIVE bindings (ALL_TABLES/INDOOR/OUTDOOR/TIMELINE_TABLES/TOTAL_SEATS/ZONE_OF/TABLE_GROUPS/VALID_COMBOS/CLUSTERS/KITCHEN_TABLE_LIMIT/IS_MGT_LAYOUT/PRIORITIES) + per-weekday hours (WEEK_HOURS/hoursFor/weekRange) + DUR_TIERS/setDurTiers duration tiers (v16.1.0) + v17.6.0 TURN_BUFFER/setTurnBuffer (the separation between bookings, in minutes; 0 = off = the default, so an unconfigured app is byte-for-byte v17.5.1); colours, S/BTN style tokens (v15.0.0) + v17.7.0 `R` = the pill-radius scale (pill/auth/sheet/card/inset → the `--r-*` tokens); assign by ROLE, never by the old number + v17.8.0 `M` = the motion scale (tap/move/shift/status/exit → the `--t-*`/`--ease-*` tokens, each already pairing a duration with its direction curve; `M.resize` is the documented LINEAR exception, AutoHeight-only; `M.dur`/`M.easeOut` are the raw WAAPI-only escape hatch)
    ├── reminders.js                 reminder helpers (validate, fire-window, prune)
    ├── waitlist-match.js            v17.8.0 — `placeWaitlist(...)`, the pass that decides WHICH TABLE the app offers each waiting party. Extracted VERBATIM from App.jsx's `waitAvail` effect so it could be tested at all (tests/waitlist-match.test.js). **Matching is SEQUENTIAL and FCFS** (`createdAt` asc): each party that lands is appended to a local `holds` array as a synthetic `_locked` booking the NEXT party's scan sees as occupied. Before v17.8.0 every entry was matched independently against the same snapshot, so identical inputs gave identical answers and several parties were offered the same table at the same minute — individually true, jointly impossible, and booking the first silently falsified the rest. `_locked` is load-bearing: `applyOpt` copies a locked booking's tables through verbatim, so a hold reserves its slot instead of being optimised out from under the ghost drawn for it. Cheap-first (`findFreeSlot` before `trialFits`), a whole-pass time budget, and an anti-flap carry-forward that is ALSO held — or the queue behind it can't see it. App keeps only the React parts: the 15-min clock bucket, the ref mirror, setState
    ├── presence-state.js            v17.8.0 — `presenceState(node, now, myKey, canPrune)` → `{devices, prunable, mySince}`, extracted from usePresence. v17.8.0 turned "who is connected" from a FACT into an INFERENCE from timestamps, and an inference has edge cases the hook could not test. **The module is shaped by one asymmetry: hiding a device is free and reversible (the next 45s beat brings it back), deleting one is neither** — hence `PRUNE_MS` at 4× `STALE_MS`, hence the prune refusing to run without a real server-clock offset (on a device whose clock runs fast, an assumed 0 makes every live child look ancient and the prune empties the node), and hence a child with NO usable timestamp being hidden but never pruned. `mySince` feeds the heartbeat so it rewrites `since` verbatim instead of stamping a fresh one every beat (tests/presence-state.test.js)
    ├── time-grid.js                 v17.9.0 — `hourLabel(h)` / `hourLabelAt(mins)` / `isHourMark(mins)`, the shared vocabulary of the app's two time strips. Extracted NARROWLY: `ROADMAP.md` proposed unifying TimelineView's grid header with `TimeAxis` on the claim that both draw the same strip and "both use `pct()`", and NEITHER held — TimelineView positions by percentage, TimeAxis by pixels against a fixed `trackW` (which is what makes its `padding-inline:50%` scroll maths work), and one draws full-height gridlines with hour PILLS while the other draws mirrored tape edges with plain labels. **No component is unified**; the roadmap entry is closed by the finding. What WAS duplicated is the `HH:00` label, across 8 files in 3 apparent variants — of which only two were the same function. Settings' `cutoffLabel` looked like a seventh copy and is a DIFFERENT one: it renders 24 as `"24:00"` because the optimizer cutoff is a full-day endpoint where 0 (off all day) and 24 (on all day) both mean something, so unifying it would have collapsed them and shipped a settings bug. **"N copies of one line" is a claim to CHECK, not to act on.** `hourLabelAt` is separate from `hourLabel` because they take different UNITS. The hour-pill STYLE was duplicated too but stayed a module const in `TimelineView.jsx` — every user is in that one file, and exporting a style nothing else reads is distance, not sharing (tests/time-grid.test.js)
    ├── drafts.js                    v17.5.0 — `sameDraft(a,b)` behind the unsaved-changes guard. NOT JSON equality: key order differs between openEdit's literal and openNew's Object.assign spread; `<input type=number>` returns a STRING; `customDur:null`/`deposit:""` are the same nothing; table arrays are sets in spirit. Values normalise to strings, arrays sort, null/undefined/""/false all collapse to "" (tests/drafts.test.js)
    ├── dbError.js                   v17.5.1 — `dbError(path)` builds the THIRD argument every `onValue()` must pass (the optional error/cancel callback), and `onDbError(fn)` lets usePersistence subscribe so any listener failure anywhere surfaces in the UI. All 16 listeners pass it. Origin: a cancelled read produced NOTHING — no log, no banner, no state change — because `setBookingsReady(true)` lives in the success path, so the app showed "⟳ Loading bookings…" forever and was structurally incapable of reporting its own failure
    ├── revGuard.js                  revision-CAS writer for whole-node collections (v16.0.0) — attachRev/writeWithRev; every write = atomic update({node, nodeRev: base+1}), Security Rules reject a non-+1 rev; recovery is free via the SDK's rollback echo
    ├── serviceWorker.js             v17.10.1 — the app's half of the offline shell (`public/sw.js` is the worker). Owns the `mgt-sw` key, its reader/writer and `applyServiceWorker()` in ONE file (the LoginScreen restaurant-name precedent). **Per-device localStorage ONLY, never `settings/users/{uid}`**: clearing site data is the last-resort escape from a bad worker, and a synced flag would come straight back down and re-enable what the user just escaped. Default ON, so only `"0"` is stored. App.jsx gates registration on `bookingsReady`, so a build that cannot load its data can never cache itself
    └── customers.js                 phone-identity layer (v16.0.0) — normalizePhone/formatPhone/matchCustomerByPhone (VERBATIM from the WA sandbox's whatsapp.js; complementarity contract: the WA module imports these from HERE on merge) + isNoShow (flag OR legacy history entry — zero-migration backfill) + v17.10.0 `guestId`, the SECOND identity key — minted only when a human picks an existing phone-less guest from the name dropdown, so nothing merges by accident — with `identityKey` (phone if real, else guestId), `matchesIdentity`/`matchCustomerFor` (a UNION of the two keys, never a fallback: a guest who later supplies a number has bookings carrying one key or both, and matching either keeps them one person) + `stampGuestSeed` (the back-stamp that writes a minted id onto the booking it came from — pure, idempotent, refuses to re-home a booking already in another group; it lives in `lib/` and not in App because it decides a PERMANENT link nothing can unpick) + customerIndex/searchCustomers/noShowMap, keyed on `identityKey` since v17.10.0 — a JOINED guest is a customer in Settings → Customers with a `key`/`guestId` on the entry and `phone: ""`; an UNJOINED phone-less booking still has no identity and is still skipped. Whoever adds a consumer: `searchGuestsByName` must skip index entries with no phone (it rebuilds the guest tier itself, from the bookings, and would otherwise emit each joined guest twice), and anything keying UI state on `c.phone` collapses every guest row onto one `""` key. **But the index is NOT keyed on `identityKey` alone** (/code-review): `guestPhoneAlias` folds a guest group into the phone it LATER acquired, because "phone if real, else guestId" is the very fallback `matchCustomerFor` warns splits a guest at the moment they become identifiable. It shipped that way for one commit and made one person two rows with half the visits each — and "Delete customer & all data" cleaned only the half you clicked. A `guestId` seen with two phones takes the lexicographically smallest: arbitrary, but DETERMINISTIC, so every device agrees who a customer is. Hence `matchesIdentity` takes `guestIds` (plural), and `noShowMap` mirrors each total onto the aliased id so `nsMap[identityKey(b)]` resolves for either spelling + v16.4.0 searchGuestsByName (booking-form NAME autocomplete). Customers are DERIVED from bookings — no separate collection. **v17.10.0 adds the SECOND identity key, `guestId`** — `identityKey(b)` (phone if real, else guestId) and `matchCustomerFor({phone,guestId},…)`, of which `matchCustomerByPhone` is now a thin alias keeping its exact name/signature for the WA contract. The two keys are UNIONED, never a fallback: a guest who books three times with no phone and then gives one carries bookings with only a guestId and bookings with both, and "phone if present, else guestId" would split them at exactly the moment they became easiest to identify. `searchGuestsByName`'s never-merge rule is UNCHANGED in substance — phone-less bookings still never merge on name, because nothing in the data separates two guests called Maria — but rows sharing a `guestId` now collapse into one, and that id is only ever minted by a human picking an existing phone-less guest from that dropdown (or Book Again on one). Merging is opt-in, per guest, by someone who could see both bookings. `noShowMap` is keyed on `identityKey` for the same reason; read it as `nsMap[identityKey(b)] || 0`.
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
- All colours, spacing, button styles, badge styles, **corner radii**, **motion** and **type** flow through `src/lib/constants.js` exports (`S`, `BTN`, `BLOCK_BG`, `BLOCK_INK`, `STATUS_COLORS`, `TBL`, `R`, `M`, `T`, `FW`).
- **`R` = the v17.7.0 pill-radius scale** (`R.pill`/`auth`/`sheet`/`card`/`inset` → the `--r-*` tokens in `index.html`'s `:root`; radii are theme-agnostic, so they are NOT duplicated into the dark block). Assign **by role, never by the old number** — the same `12` meant "control" in one file and "card" in another. `--r-pill` is `999px` because CSS clamps an oversized radius to half the box, so one token is a true pill at every control height. **No new `borderRadius: <number>` literal.** **v17.8.0: ENFORCED, not described** — `npm run check:style` (`scripts/check-style-invariants.mjs`, a CI gate after lint) fails on any bare numeric radius unless its line carries an inline `/* @canvas */`. The 17 genuine exceptions (timeline blocks + their manual-assign handle and folded corner, TimeAxis ticks, progress track+fill pairs, `Kbd`) are marked at their sites, so an exemption is visible where you are reading rather than in a paragraph three files away.
  **Hard rule for any box holding WRAPPING or SCROLLING text (v17.7.1): its radius must be ≤ its horizontal padding.** A rounded box is narrowest at its top and bottom edges, so a radius past the padding clips the first/last visible line — and no vertical-centring trick saves it, because centring stops applying the moment the content overflows (that is exactly how the v17.7.0 `mkArea` fix passed QA and still shipped a bug: it was only ever tested with short content). Pills are for SINGLE-LINE controls, where the text is centred by line-height and never reaches the curve. Multi-line ⇒ `R.inset` (10px, inside mkInp's 12px padding) — see `mkArea`, and the chat bubble / reply composer in the WA sandbox. **A `<select>` needs the same clearance on its RIGHT** (v17.8.0 `mkSel`): its arrow is painted inside the padding box against `padding-right`, so mkInp's 12px lands it inside the pill's 21.5px cap. Text is immune — it spans enough height that the curve has receded behind it, which is exactly why the LEFT 12px looks right and the right 12px doesn't.
- **`T` = the v17.8.0 type scale, `FW` the weight scale.** Six role-named steps
  (`micro`/`small`/`body`/`lead`/`title`/`display`) and four named weights.
  Assign by role, never by the old number. **No new `fontSize:`/`fontWeight:`
  literal** — `npm run check:style` fails on one unless the line carries
  `/* @canvas */`. Before this there were 497 size literals in THIRTEEN values
  and sixteen distinct size/weight combinations on the app's emptiest screen,
  nine of the sizes between 9 and 18px where 11→12 is a ratio of 1.09 — below
  the threshold at which a reader perceives a step. The result is many type
  styles and no hierarchy, which does not look broken, it looks flat.
  **The two halves are one change.** There was no regular weight: 93 of 95
  elements were 500+. When everything is semibold, weight cannot carry
  emphasis, so size carries all of it, so sizes multiply and crowd. `FW.regular`
  on descriptive text is what lets the scale have six steps instead of thirteen.
  When merging sizes, **collapse DOWNWARD** — a size that shrinks cannot
  overflow its box; a size that grows can, in ways a mechanical sweep cannot be
  verified against.
- **`SP` = the v17.9.0 spacing scale, `H` the control-height scale — and these
  two are LINTED, not tokenised.** That difference from `R`/`T`/`FW` is
  deliberate and worth understanding before "finishing the job" by sweeping
  tokens through. `R` and `T` are SEMANTIC: `borderRadius: 12` genuinely did not
  say whether it meant "control" or "card", so only a role name could
  disambiguate it. `gap: 8` is not ambiguous; it is eight pixels. So spacing
  stays readable literals and `npm run check:style` is the contract — it parses
  every `padding`/`gap`/`margin` and every `height`/`minHeight` in the 24–56px
  control range, and fails on anything off the scale. `SP` and `H` are exported
  from `constants.js` for computed cases and shared style objects.
  **The audit that motivated this overstated it, and the correction is the
  lesson.** "97 distinct padding strings" sounds like chaos; the underlying
  numbers were already an even 2px progression, and the real defect was eight
  values nobody chose (1, 3, 5, 7, 9, 11, 17, 20, 22) sitting beside their
  on-scale neighbours — `"5px 11px"` in three files, `"9px 14px"` next to
  `"8px 14px"`. The other 89 strings are different paddings for different boxes.
  Forcing them into an invented role vocabulary would have been 84 judgement
  calls, each invisible until someone opened that one screen. **Count the
  DISTINCT VALUES, not the distinct strings, before deciding a scale is missing.**
  Snap DOWNWARD, as `T` does. `H` is mostly v17.8.0's sizing rule written down
  (44 is a floor, not a target); `/* @canvas */` exempts genuine layout
  dimensions — the Toggle track, table-picker cells, the timeline hour strip,
  WeekView's calendar cell, alignment indents, safe-area `calc()`.

- **`IC` = the v17.9.1 icon-size scale** (`inline` 12 · `control` 14 · `chrome` 18,
  in `constants.js`). The last unscaled axis, and the tell was not the COUNT of
  sizes (eight, between 10 and 18) but that **one control wore four of them** —
  `CloseIcon` rendered at 12, 13, 14 and 15 in different corners. Assign by role:
  a mark inside a text run or dense row · the standard mark ON a control · header
  and nav furniture where the icon IS the button. The 2px/4px gaps are the point;
  13→14 was never perceptible. No new numeric `size={n}` on an icon. (The
  timeline note dog-ear stays a hard-coded 8px inline SVG — a decorative marker
  drawn in place, not a member of the set.)

- **A checker with a blind spot still prints OK, which is worse than no checker
  (v17.9.0).** The first spacing rule required the property to be preceded by
  `{` or `,`, to skip CSS inside string literals. That condition is FALSE for a
  key in a multi-line style object — i.e. most of the codebase — so the rule saw
  almost nothing and `check:style` reported clean. Exactly the v17.8.0
  marker-placement shape: worthless precisely where it was meant to bite, while
  carrying the authority of having passed. **Reading the script cannot catch
  this; running it against known-bad input can.** `tests/style-check.test.js`
  now does, and `check-style-invariants.mjs` takes an optional directory
  argument so a fixture can be pointed at it. Any new rule gets a fixture in
  that file, both a violating case and a legitimate one.

- **An exemption marker must live INSIDE the style object (v17.8.0).**
  Appending `/* @canvas */` to the end of a line that ends in `>` or `/>` puts
  it in JSX **children** position, where React renders it as literal text —
  eight of them shipped, printing comment syntax across the Plan view's ruler
  and the Stats popover's bars. Worse, `check:style` only asked whether the
  marker was PRESENT, so the sites it was meant to bless were the sites it
  broke and it reported OK on all of them. Rule 0 now rejects the placement.
  **A checker that cannot see its own annotation is worth less than none**,
  because it also carries the authority of having passed.
- **44px is a FLOOR, not a target (v17.8.0).** The tap-target pass applied
  Apple's figure to every small control and overshot: a 44px circle beside a
  40px date field made the date-nav row stop reading as chrome. Toolbar chrome
  (timeline zoom cluster, Find/Settings, the connection dot, Summary's More)
  sits at **36**; `mkBtn`'s **40** remains the app-wide standard; genuine 44s
  are reserved for decision surfaces where a mis-tap costs something — modal
  footers and the quick-status popup. Size by what a mistake costs, not by one
  number from a guideline.
- **A literal is invisible to a token audit (v17.8.0).** The contrast pass
  measured every `--token` and still missed four fills carrying white text —
  TableGrid's selected (2.31), blocked (3.13) and swap (~1.4, white on bright
  yellow) cells, and ManualModal's swap panel (2.62) — because they were
  `rgba(...)` literals, not tokens. The same sweep found **fifteen hard-coded
  copies of token VALUES** across ten files, several of them copies of a value
  from before that same pass retuned it. **Grep the value, not the name**, and
  remember an audit that enumerates tokens has a blind spot exactly the size of
  the literals.
- **A fill that carries TEXT is chosen for its contrast against its ink, per
  theme. Alpha is for decoration (v17.8.0).** An `rgba(hue, 0.8)` fill
  composites toward what is BEHIND it, so one token lands somewhere different
  in each theme. The app shipped eight versions of fills declared in `:root`
  only, under a comment asserting they were theme-invariant; in light mode
  "Save pending" was 1.83:1, the Follow button 1.82:1, the inactive View buttons
  1.94:1 and the outdoor table pill 2.15:1, while every one of them passed in
  dark. **Dark mode is the easy case; light is where a saturated fill washes
  out.** `tests/contrast.test.js` measures every fill/ink pair in both themes
  and fails on an unregistered text-bearing fill. Small bold labels take 4.5:1;
  buttons take 3:1. `BLOCK_INK` pairs each block fill with its ink.
  **The amber pair is a RECORDED EXEMPTION, not a pass**: confirmed sits at
  2.9:1 and pending at 1.8:1 with white ink, because both alternatives were
  tried and are worse — darkening the fills destroys the matched-intensity pair
  v17.0.0 engineered, and dark ink (shipped for exactly one commit) reads as
  DISABLED next to the white-inked seated and cancelled blocks, so a status
  change looked like a state change. `tests/contrast.test.js` marks them
  `role: "exempt"`, prints the number every run, and still fails if either drops
  below a recorded floor — **an accepted contrast is not a licence to keep
  going.** What made it defensible is that the one piece of *information* on a
  block, the start time, moved onto its own opaque `--tl-hour-pill` chip —
  the same pill the hour ruler uses — so it is legible on every fill instead of
  being tinted by it.
  **v17.9.0 found that claim was not being measured.** The registry entry
  measures `--tl-hour-pill` over the PAGE (4.73 light) — that is the *ruler's*
  pill. The block chip is the same token over a saturated block and, until
  v17.9.0, at `opacity: 0.8`: 3.72–4.62:1 across all ten status×theme cases,
  below AA in every one, while the file reported the token as passing. So the
  exemption's whole justification rested on a composite nothing measured — the
  v17.8.0 lesson recurring one level down. **A token's number is not the
  screen's number wherever that token is reused over something else.** The chip
  is now full-strength (5.15–6.10:1) and quieted by `FW.medium` instead, and the
  test reads the opacity back out of `TimelineView.jsx` rather than assuming it.
  **Opacity conflates QUIET with FAINT; weight separates them** — and the chip
  was only ever "too loud" relative to a NAME sitting at 1.86–2.97:1, so dimming
  it was levelling down to the illegible element rather than fixing it.
- **A literal duplicate of a token is a token that cannot be fixed (v17.8.0).**
  TimelineView's Follow button held a hard-coded copy of `--app-btn-grey`'s
  value and was the one secondary button the contrast pass could not reach; the
  booking-form footer held two more, one of them a copy of
  `--app-success-solid` from *before* that same pass retuned it. Grep the token's
  VALUE, not just its name, when retuning one.
  **It then happened again in the commit that wrote this rule** (v17.8.0 review
  fix): the Optimizer button, eight lines below the Follow button, held the same
  `rgba(120,130,150,.55)` and stayed at 1.94:1; ReminderEditor's inactive
  Once/Weekly/weekday buttons held `…,0.45` and were left at **1.70:1**, the
  worst text contrast in the app *after* a pass whose whole subject was contrast.
  Writing the lesson into a comment beside one copy is not the same as running
  the grep. **Fixing one copy of a literal does not fix the literal** — when you
  retune a token, the very next command is a repo-wide search for its old value.
- **Two names for one concept is how a thing hides from its own audit
  (v17.8.0).** The inactive View button is `--app-btn-grey`, not `--btn-nav`, so
  a coverage check written around the `--btn-*` prefix walked straight past the
  control staff look at on every screen. When writing a check that enumerates
  tokens by prefix, enumerate what is actually THERE and diff it.
  A **third** family then hid from the same check: the timeline's own
  `--tl-*-pill` / `--tl-*-badge` fills, one of which (`--tl-now-pill`) was below
  the bar in dark. The one that matters is `--tl-hour-pill` — the amber blocks
  are a *recorded exemption* on the grounds that the start time moved onto that
  pill, so the exemption's entire justification was resting on a fill nothing
  measured. It passed, at 4.73:1, **by luck**. When a check's verdict becomes an
  argument for accepting something else, everything that argument leans on has
  to be inside the check.

  **Corollary for pill-shaped controls (v17.8.0): `--r-pill` clamps to half the SHORTER side, so only a SQUARE box is a circle.** An icon button sized by `minHeight` + horizontal padding is ~30×40 and renders as a vertical egg — which is what the three Split-View tools were, one row above the perfectly round 34×34 🔍/⚙ pair. A single-glyph button gets explicit equal `width`/`height` and `padding: 0` (and `min-*` is not enough — a flex row will stretch it back).
- Reusable JSX atoms in `src/components/atoms.jsx`: `Overlay`, `Fld`, `Section`, `TBadge`, `AvailBanner`, `Toggle`, `mkInp`, `mkBtn`.
- New UI composes from atoms, not redefining them. Add new atoms there if needed.
- **`mkBtn` already sets `boxShadow`, so `Object.assign`-ing another one REPLACES it** — a
  property, not a shadow list. `ViewSwitcher`'s split-pane marker silently stripped
  the button's `--shadow-btn` this way (v17.8.0 review fix); the fix is one
  comma-separated value, `"inset 0 -3px 0 …, var(--shadow-btn)"`. Same trap for
  any property `mkBtn`/`mkInp` already own.
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

### The offline shell (v17.10.1) — a service worker, on terms

v17.4.0's worker froze the app on iOS and was withdrawn with root cause
unestablished. v17.10.1 established it: the freeze happened **in iOS Chrome as
well as a home-screen shortcut**, and a service worker *cannot run in iOS Chrome
at all* (WKWebView exposes `navigator.serviceWorker` only under App-Bound
Domains, which a general-purpose browser cannot use). The same symptom in a
context where the worker cannot exist means one cause explains both — the CSP
blocking Firebase's JSONP fallback, already fixed in v17.5.1.

Four properties make the new one safe, and none may be dropped:

1. **It is not near the data path.** `respondWith` fires for exactly two things,
   both same-origin GET: navigations (**network-first**) and hashed assets
   (**cache-first**). Everything else falls through untouched — every Firebase
   request is cross-origin and dropped on the handler's first line. Network-first
   on navigation is what makes it structurally impossible to pin the app to a
   stale build.
2. **It installs only where the app demonstrably works** — registration is gated
   on `bookingsReady`, so a build that cannot reach Firebase can never cache
   itself and serve itself back. Disabling is NOT gated: it must work in any
   state.
3. **Two independent ways out**, both verified on the tablet: `?sw=off` (in the
   boot script, so it works when React never mounts) and re-deploying the
   v17.4.1 kill switch at the same URL.
4. **No `skipWaiting`** — a new version takes over on the next navigation, so
   nothing swaps under a shift in progress. The kill switch keeps its
   `skipWaiting`; there, immediacy is the point.

**The test rig the ROADMAP said did not exist now does:** `adb reverse tcp:5174`
makes `http://localhost:5174` a **secure context** on the tablet, so a worker
installs there exactly as it would in production. What still cannot be tested
locally is the production offline BOOT (dev modules are not under `/assets/`, and
a prod build points at PROD Firebase) — which is why the boot watchdog exists.

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

**True compare-and-swap — `baseUpdatedAt` + revision CAS everywhere (v16.0.0) — the FOURTH write-guard dimension, server-side.** Origin: the 2026-07-05 incident — a laptop asleep at home woke and its stale snapshot overwrote a night of tablet status changes, because the v15.5.0 rule only required `updatedAt` to be **greater** than stored, and a stale device stamps with its current wall clock (always greater). Greater-than is last-writer-wins, NOT staleness protection. v16.0.0 makes every write **prove it was based on the data it overwrites**: (1) **bookings** — `stampForWrite` also writes `baseUpdatedAt` (the `updatedAt` of the version this device last saw; 0 on create); the per-`$id` rule requires `baseUpdatedAt === stored updatedAt` (creates need only the stamp; deletes stay unconditional — a multi-path null can't carry a base). A stale writer (sleep/wake, zombie socket, offline-queue flush) is rejected server-side regardless of clocks; the existing `.catch → markStale → resync → drainPending` recovery replays user intent on fresh data. `baseUpdatedAt` is per-write metadata — deliberately NOT in the `sanitize` whitelist. A `lastPatchSigRef` dedupes StrictMode's dev double-dispatch (same content+base within 2s = the same write; re-dispatching would self-reject). (2) **Every whole-node collection** (`tableBlocks`, `waitlist`, `reminders`, `reminderFires`, 4× `settings/*`) — the proven v15.3.0 revision CAS, generalised in **`src/lib/revGuard.js`**: sibling `<name>Rev` integer, atomic `update({node, nodeRev: base+1})`, rule pair rejects a non-+1 rev (an empty-array write deletes the node and skips its own validate, but the REV child's rule still gates the atomic update — wipes are covered). Recovery is free: the SDK rolls back a rejected write locally and re-fires the node+rev `onValue` listeners. Rev refs advance optimistically (back-to-back + StrictMode writes chain +1,+2). (3) **Wake-race client fix**: a heartbeat-gap trip now also resets `isConnectedRef=false` (`gapTrip()`), because on wake the ref still holds its pre-sleep `true` and `resync()`'s `get()` could be served from the local cache, "succeed" with stale data, and clear the gate. Deploy: **app first, rules second** (rolling-safe — old rules ignore the new fields) — see `database.rules.README.md`. **Rule of law: any NEW persisted node must ship with either a per-child stamp CAS or a revGuard rev pair — never a bare `set()`.** **Exception (v17.3.0): the `presence` node.** It is NOT persisted app data — it's ephemeral device-presence (see `usePresence.js`): each connection writes only its OWN disjoint push-key child and self-removes via `onDisconnect().remove()`, so there is no stale-overwrite class and CAS/revGuard does not apply. **v17.8.0 widens this slightly and the exemption still holds:** the staleness prune deletes OTHER devices' children, but only ones already proven dead by a missing heartbeat, and deleting a dead key is idempotent — two devices racing on the same one is harmless. It inherits the top-level `.write: auth != null` with no `.validate`, so it ships with NO rules/console step (rolling-safe). This exemption is ONLY for genuinely ephemeral, per-connection-owned nodes — never for real data.

**Optimistic visibility for held writes (v15.6.0).** When the freshness gate HOLDS a quick-action write (device woke from sleep), `saveBookings` now ALSO applies it to local state (`setBookings(next)`) in the hold branch — so the change is **visible immediately** instead of staying invisible until `resync()` finishes (the reported "my tap did nothing" confusion). The server write is still held (no stale data written): the persist happens when the queued function replays on FRESH data. A shared **`drainPending()`** helper (the v15.4.0 retry-drain) is called from BOTH `resync()` and the live `bookings` `onValue` (after `clearStale`) so a fresh snapshot arriving mid-recovery never wipes the optimistically-shown change before it's re-applied + persisted (batched into one commit → no flicker). Scope = function-form non-silent writes only (the existing condition) — so until v15.7.0 `doSave` (value-form) kept its "keep the form open + tap Save again" behaviour, and silent auto-effects are unaffected. The `resyncing` banner was reworded from "Writes are paused" to "your changes are saved and will finish syncing".

**Post-sync conflict reconciliation (v15.6.1) — the optimiser re-runs on merged data.** Per-node merge (v15.5.0) preserves two devices' offline bookings, but each device's optimiser assigned tables without seeing the other's — so an offline same-table double-booking (e.g. both on table 6) **overlaps once synced**, and the sync path stores the merged snapshot **verbatim** (no optimiser pass). A reconciliation `useEffect` in `BookingApp` (App.jsx, sibling to the optimiser/banner machinery) now reacts to settled snapshots: it collects active dates `≥ today` with assigned tables, filters to the ones failing the pure **`verifyClean`** (booking-logic.js), and resolves only those via one **silent function-form `saveBookings`** — full reshuffle (`bookingsAfterAction(next,d,blocks,null,false,autoOptimizer)`) when `optimizerActiveFor(d,…)` (always true for future dates; true today before the cutoff), else (today + optimiser OFF) **relocate ONLY the newest non-locked conflicting booking** (sorted `updatedAt` desc + id tiebreaker → deterministic across devices) via the `forceReassign` path, looping (cap 20) until clean. The new pure **`findConflicts(bookings,date)`** returns the overlapping ids for that selection. Self-stabilising: gated on `!verifyClean` so clean syncs write nothing, and optimiser/relocate output is clean → next pass is a no-op (also breaks any Firebase echo loop); cross-device double-writes settle via the v15.5.0 per-`$id` `updatedAt` CAS; `_locked` bookings (manual/walk-in) are never moved; an unplaceable booking (full restaurant) drops out of the overlap set so the loop terminates. Gated on `!resyncing` (waits out the post-sleep stale window, re-runs on fresh data) and writes `isSilent` (auto-effect). A transient `syncFixBanner` ("Resolved a table conflict after syncing.") fires only when something actually changed (`changed` flag). Pure client change — no `usePersistence`/security-rule/shape change (rolling deploy). **v15.6.2 bug-fix:** the effect's "loaded" gate was wrongly `!loadBannerShown` — but `loadBannerShown` is the *6-second* "Firebase connected" banner flag, so the effect went dead ~6 s after any page load and only reconciled on a fresh reload (not on a live sync). Fixed to `firstLoadCount.current===null` (the real, permanent loaded signal, a ref exposed from `usePersistence`); `loadBannerShown` dropped from the dep array. **Gotcha to carry forward: `loadBannerShown` is NOT a "loaded" flag — it auto-hides after 6 s; use `firstLoadCount` (ref, null-until-loaded) for a persistent loaded check.**

**`doSave` joins optimistic-show + auto-retry (v15.7.0) — the exception is gone.** `doSave` (new/edit booking) used to build a precomputed array `fin` and call `saveBookings(fin)` (**value form**), which the optimistic-show + retry branches skip (they all gate on `typeof next==="function"`) — so a stale-gate hold bounced the form back with "tap Save again". v15.7.0 converts both `doSave` write paths to the **function form** (`saveBookings(buildNext)`), so a held new/edit save now shows optimistically + auto-retries on fresh data exactly like quick actions. **Technique = capture-intent-then-replay-on-fresh-`prev`:** the user's intent is computed **once** against current `bookings` — `genId()`/the `nb` object (new), or the captured edit fields/flags derived from `orig`+`f` (edit) — then a pure `buildNext(prev)` re-applies that intent to whatever fresh `prev` the updater receives (so a concurrent edit to OTHER bookings, which live in `prev`, is preserved). The synchronous high-stakes guards (capacity/displacement/no-table) still run **once** against current data via `const fin=buildNext(bookings)` and block the form with `setError` before any dispatch. **Duplicate-safe:** `genId()` is called once (stable id) and the retry queue only replays writes that never landed (held) or were atomically rejected — so fresh `prev` can't already contain the new id; the new-path `applyBase` also `filter`s out `newId` before `concat` (belt-and-braces). Flash is gated on the `ok` boolean (never claim "saved" for a not-yet-persisted write). Pure client change in App.jsx's `doSave` — no `usePersistence`/security-rule/shape change (rolling deploy).

**Auto-effects** (anything that writes Firebase without direct user action) must pass `isSilent=true` to suppress the user-facing banner on refusal.

**Persisted collections:** `bookings` (v15.5.0 — a **keyed object `/bookings/{id}`**, one child per booking, each carrying a per-booking `updatedAt` stamp; written via per-child diff `update`, read back as an array via `sanitizeAll`'s `Object.values`; v16.3.0 whitelists `deposit`€ + `recurringId`/`recurringDate` occurrence stamps; v17.10.0 whitelists `guestId` — a per-booking field, so no new node and no rules change), `tableBlocks`, `reminders`, `reminderFires`, `waitlist` (v16.0.0 — whole-array node, reminders-pattern loaded-guard, `useWaitlist.js`; **ref-mirror save** per the sync-echo gotcha below), `recurring` (v16.3.0 — 7th collection, whole-node object `{v, enabled, horizonWeeks, rules[]}`, standing-booking RULES; **`enabled` defaults OFF** — absent/legacy node reads as off, v16.3.0-correction; revGuard CAS `recurringRev`, `useRecurring.js`; occurrences are normal `/bookings` children generated by the App effect, NOT stored here), plus **six** `settings` objects (all restaurant-wide config → **shared** across devices): `settings/operatingHours` (#1, v14.4.0 — **per-weekday** `{days:{0..6}}` since v15.0.0), `settings/dayShifts` (#2, v14.6.0 — `{split, enabled}`), `settings/optimizer` (#3, v15.0.0 — `{cutoff, autoSwitch}`), `settings/layout` (#4, v15.0.0 — `{tables, joinGroups, comboCaps, megaCombos, kitchenLimit}`; + `priorities` v15.9.0 — the data-driven optimizer heuristics), `settings/general` (#6, v17.0.0 — `{v, restaurantName, currency, phonePrefix, regularMin, lateCollapseMax, waitMatchWin, undoSecs}`; revGuard CAS `generalRev`; `useGeneralSettings.js`), and `settings/bookingDefaults` (#5, v16.1.0 — `{v, tiers:[{max,dur}…], restDur, lateEnabled, lateWarnMin, lateNoShowMin, freeSoonEnabled, freeSoonWindow}`; a present node's missing `tiers` array = EMPTY (RTDB drops empty arrays — the priorities lesson), never the default; `freeSoonWindow` (v16.3.0-correction) = the table-turn prediction window in minutes, 5–60 step 5, default 15; `useBookingDefaults.js`). **v17.6.0 supersedes the old "per-device preferences never go in Firebase" rule.** `settings/users/{uid}/prefs` (#8, `useUserPrefs.js`) is the documented exception: it is per-USER, not restaurant-wide, and carries theme · reduceMotion · planGestures · navLocked · splitEnabled so a user's setup follows them to any device. **`localStorage` still holds all five as well, and that mirror is load-bearing** — `index.html`'s no-flash script reads `mgt-theme`/`mgt-reduce-motion` before React mounts and long before Firebase or auth resolve, so dropping it flashes the wrong theme on every load. localStorage = pre-mount cache, node = source of truth. Genuinely per-DEVICE settings (app width, the 4 Timeline zoom values, the saved split layout) stay `localStorage`-only, because they are properties of the screen. All six use the loaded-ref write-guard (small objects, so the empty-array guard doesn't apply — except `useLayout`, which additionally refuses an empty-`tables` config); see `useOperatingHours.js` / `useDayShifts.js` / `useOptimizerSettings.js` / `useLayout.js`.

**Single central save path:** route every mutation of a collection through one helper (e.g. `bookingsAfterAction`) so future conflict-detection / re-derivation has one hook point.

### Operating hours — live module bindings (v14.4.0; 24h v14.5.0; **per-weekday + closed days v15.0.0**)
`OPEN` / `CLOSE` / `GRID_CLOSE` / `QUARTER_HOURS` in `constants.js` are **mutable `let` exports** (not `var`/`const`) reassigned **only** by the module's own setters (v15.0.0: `setActiveDayHours(date)` + `setWeekHours(week)`, which replaced the single-pair `setOperatingHours(open,close)`) — because only the owning module may reassign its own exports. They're **live ESM bindings**, so reassigning them updates every importer (incl. `booking-logic.js`'s pure functions — `getBlockSlots`, `findTimes`, `pct`) with **no signature changes**. `useOperatingHours` (Firebase `settings/operatingHours`) calls the setter on each snapshot **and** sets a React state so BookingApp re-renders — that repaint is what makes the timeline/forms read the new values. `GRID_CLOSE = close + 1` — **v14.5.0: no longer clamped to 24**, so a past-midnight close (24 = 00:00, 25 = 01:00) gives GRID_CLOSE up to 26 and the timeline/grid extend past midnight (hour labels wrap via `% 24`). **Bounds (v14.5.0): open 6–22, close (open+1)–25**, enforced by `sanitizeHours` + the Settings steppers. The forms' time `min`/`max` derive from `OPEN`/`CLOSE` (padded; `max` caps at `"23:59"` when `CLOSE >= 24` because `<input type=time>` rejects "24:00"+ — BlockModal's From/To do the same off `GRID_CLOSE`). **Extend-window only — no booking may START after midnight:** capping close at 25 keeps the latest 90-min start ≤ 23:30, and `findTimes`/`findKitchenFriendlyTimes` carry a defensive `m < 24*60` guard, so the optimizer/scheduling math needs **zero** changes. **Don't capture these into a module-scope local** (breaks the live binding) — read them at call/render time.

**v15.0.0 — per-weekday + closed days.** `settings/operatingHours` is now `{days:{"0".."6"}}` (0=Sun..6=Sat, all-UTC `getUTCDay`); a legacy flat `{open,close}` reads as 7-day-uniform (`sanitizeWeek`) and migrates on first save. `WEEK_HOURS` holds the schedule; **`hoursFor(date)→{open,close,gridClose,closed}`** is THE accessor for any date — the date-carrying pure functions (`getBlockSlots`/`findTimes`/`findKitchenFriendlyTimes`) read it (no signature change) so a booking whose date ≠ viewDate stays correct, and they short-circuit on a closed day. The live `OPEN/CLOSE/GRID_CLOSE/QUARTER_HOURS` bindings hold the **active view-day's** hours; **`useOperatingHours(viewDate)` calls `setActiveDayHours` DURING render** (module mutation, no setState — safe) so children read the right values in the same paint. A **closed** day blocks bookings/walk-ins + shows a timeline "Closed" banner (fallback range for grid dims). **`weekRange()`** = stable min-open…max-close across open days; it clamps the global shift split (`useDayShifts`) — but the **optimizer cutoff is decoupled** from it (full-day 0–24, `useOptimizerSettings`).

### Layout config — live module bindings (v15.0.0)
Mirrors the operating-hours mechanism for the physical table layout. **`ALL_TABLES` / `INDOOR` / `OUTDOOR` / `TIMELINE_TABLES` / `TOTAL_SEATS` / `ZONE_OF` / `TABLE_GROUPS` / `KITCHEN_TABLE_LIMIT` / `VALID_COMBOS` / `CLUSTERS` / `IS_MGT_LAYOUT`** are `let` exports reassigned **only** by `setLayout(cfg)` (which calls the pure `buildLayout(cfg)`), seeded from `DEFAULT_LAYOUT` at the **bottom** of `constants.js` (TDZ-safe — after every `let` decl). `useLayout` (Firebase `settings/layout`) calls `setLayout` per snapshot + sets React state to repaint. **Combos are DERIVED** (Phase 4, no longer hard-coded): `buildLayout` makes `VALID_COMBOS` from `joinGroups` (every `contiguousRuns` ≥2; cap = `comboCaps[comboKey(run)]` or Σ member caps) then appends `megaCombos`; `CLUSTERS[id]` = id's full ≥2 run (standalone → `[id]`). **Zero-regression invariant:** `buildLayout(DEFAULT_LAYOUT)` reproduces the historical 40 combos (ordered) + CLUSTERS **byte-for-byte** (verify with a deep-equal node script before touching this). **Detect-and-apply:** `IS_MGT_LAYOUT` = current layout signature (tables+caps+zones+combos) === DEFAULT's; `booking-logic`'s hand-tuned heuristics (`_comboPri`, `_indoorPri`, `isMixedLarge`, the `findBest` table-7 branches, the `optimise` table-7 swap) run **only when true**, else a generic capacity path. **`TABLE_GROUPS` (table-picker grouping) follows the SAME gate** (added when the editors shipped): `setLayout` keeps the curated `TABLE_GROUP_STRUCT` (MGT picker byte-for-byte — the "1A/1B/7" merge, i1 standalone, mega-hint notes) when `IS_MGT_LAYOUT`, else the generic join-group derivation (one section per join-group with its auto-combo caps as the hint note, then standalone tables per zone) — **lazy since v15.0.1**: `buildLayout` returns a `makeTableGroups()` closure (reading the `runCapByKey` it recorded while generating the auto combos — ONE cap rule) that `setLayout` calls only on the non-MGT branch. The signature (and `MGT_SIGNATURE`) is **order-independent** (sorted), so re-adding the same combos in any order restores `IS_MGT_LAYOUT` true. **Rename a table** = remap every reference (tables + joinGroups + `comboCaps` keys via `comboKey` + `megaCombos.ids` + v15.9.0 the `priorities` refs) so combos AND priority rules survive; **remove** drops only the table (sanitize/`buildLayout` drop its combos/cluster/group + any referencing mega + any priorities ref). **Single-group membership** is enforced in `sanitizeLayout` (a table in >1 join-group → first-wins; `CLUSTERS` uses `.find`). **Don't capture these into module-scope locals** (read at call/render time); **editing `DEFAULT_LAYOUT` / the seed under HMR needs a full preview reload** — the binding seed doesn't re-propagate (constants.js live-binding gotcha).

**v15.9.0 — data-driven optimizer priorities (`PRIORITIES`).** The optimizer's hand-tuned MGT heuristics are no longer hard-coded OR `IS_MGT_LAYOUT`-gated — they read the **`PRIORITIES` live binding**, derived by `buildLayout` from `settings/layout.priorities` (`{v, bands, comboRules, anchors, swapRules, mixedRequire}`; field semantics documented at `DEFAULT_LAYOUT.priorities`, whose seed values ARE the ex-literals — regression-proven **byte-identical** for both the MGT seed and an empty config vs the pre-v15.9.0 gated paths). `IS_MGT_LAYOUT` now gates ONLY the curated `TABLE_GROUPS` picker grouping; `layoutSignature` deliberately excludes priorities, so tuning them keeps the MGT picker AND a layout edit no longer kills the heuristics. Consumers in booking-logic: `_comboPri` (first comboRule matching key+size band → avoid?+100:−weight), `_indoorPri` (ranked anchors, boost = length−index), `findBest` (first band matching size → prefer list → zoneOrder singles → non-avoided → any → combos, `combosFirst` flips the tail; NO band → generic smallest-single-else-combo), `optimise` (swapRules loop), `isMixedLarge` (`mixedRequire` = must-include set; empty = any declared cross-zone combo). **Fallback rule (gotcha):** an ABSENT `priorities` object seeds from DEFAULT (legacy node); a PRESENT object treats each missing field as EMPTY — never per-field default — because RTDB drops empty arrays (the `v:1` scalar keeps an all-empty config present). The Layout-tab editor ("Table priorities" collapsible) always writes the full shape; rename remaps all priorities refs. Deploy caveat: a pre-v15.9.0 device saving the layout wipes the field (harmless while untuned — falls back to the seed); refresh devices before tuning.

### Customer layer — phone-derived, WA-complementary (v16.0.0)
Customers are **DERIVED from the bookings list by normalized phone** (`src/lib/customers.js`) — there is NO `customers` collection, so there is nothing to migrate or keep in sync. `normalizePhone`/`formatPhone`/`matchCustomerByPhone` are the WA sandbox's primitives ported VERBATIM (same names/signatures); **complementarity contract:** when the WhatsApp module merges, its `whatsapp.js` must delete its copies and import from `customers.js` — one phone-identity primitive, never two. `isNoShow(b)` = the v16.0.0 `noShow` flag OR a legacy history entry `action:"no show"` (zero-migration backfill). "Delete a customer" (Settings → Customers) = delete every booking with that phone + their waitlist entries — permanent (no backups on the free plan), hence the armed-confirm UI. Known edge: if the customer's bookings are the ENTIRE database, the empty-array write-guard refuses the delete (safety wins; don't bypass).

**v17.10.0 — `guestId`, the identity for guests who never give a phone.** Format
`"g" + <seed booking id>`: derived from data both devices already hold, so two
clients joining concurrently mint the SAME id and converge instead of forking the
guest in two — the recurring-occurrence-id reasoning. Sanitize-whitelisted;
per-booking, so the existing per-`$id` `updatedAt` CAS covers it and there is **no
new node and no Firebase console step**.

**It is minted at exactly one kind of moment: a human asserting identity.**
Picking an existing phone-less guest from the booking form's NAME dropdown, or
Book Again on a phone-less booking. The draft then carries `guestId` plus
`guestSeed` (the source booking still needing the same stamp), and `doSave` writes
both children through **one** `saveBookings` call — `stampGuestSeed` runs inside
`buildNext`/`applyBase`, so the v15.5.0 diff-write patches them together. Its
`!b.guestId` guard is what makes a held/retried write idempotent and stops a
booking already in another group being silently re-homed. `guestSeed` is
draft-only and never persisted.

**`customerIndex` stays phone-only, deliberately** — it feeds `searchCustomers`
and the Customers settings tab, both of which assume every entry has a real phone,
and a guest entry would hand `pickCustomer` a customer with `rawPhone: ""`. Known
consequence: **joined phone-less guests do not appear in Settings → Customers.**
The form chips, the name dropdown and the no-show markers all see them.

### Waitlist active matching (v16.0.0)
`waitAvail` is **state computed by a BookingApp effect**, not a render-time derivation — the `trialFits` scans are heavy, so the effect keys on `[bookings, tableBlocks, waitlist, autoOptimizer, nowQuarter]` where `nowQuarter = Math.floor(nowMins/15)` (never the raw 15s tick). Per waiting entry: try `prefTime` first; else a 15-min first-fit scan **clamped to ±90 min around the wanted time** (a 13:45 slot is no use to a party waiting for ~20:30); no wanted time → the whole remaining day.

**v17.8.0 — entries are matched SEQUENTIALLY, in a FCFS queue, never in parallel.** Each party that lands is appended to a local `holds` array as a synthetic `_locked` booking, and the next party scans `liveBookings.concat(holds)`. Before this every entry was matched independently against the same snapshot, so identical inputs gave identical answers and several waiting parties were offered the *same table at the same minute* — individually true, jointly impossible, and it silently falsified every chip but the first the moment one was booked. `_locked` is load-bearing: `applyOpt` (the reshuffling path inside `trialFits`) copies a locked booking's tables through verbatim, so a hold reserves its slot instead of being optimised out from under the ghost already drawn for it. The queue is `createdAt`-ascending because sequential placement is only *fair* if the sequence is. A budget-skipped entry keeping its previous answer is held too, or the queue behind it can't see it. Transition-to-available (prev-id-set diff in a ref, first pass exempt) fires the green toast. The "⏳ N" badge lives in the Today slot (Presence slide; orange when someone fits now); Book prefills the form + `pendingWaitlistRef`, consumed in `doSave`'s new-booking path.

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

### Unsaved-changes guard (v17.5.0, completed v17.8.0) — every drafting surface must register
**Six** surfaces hold real drafts: the booking form, the walk-in form,
`ManualModal`'s table picks, and — added in v17.8.0 — `ReminderEditor`,
`BlockModal`, and Settings (`GsTextField` ×3 + `LayoutTabContent`'s new-table /
rename boxes). Each snapshots the draft it was **opened** with and
diffs the live state against it (`sameDraft`, `src/lib/drafts.js`) — an untouched
form closes **silently**, because a confirm on every Cancel trains staff to tap
straight through it. `openForm` (App.jsx) is the ONE door that sets the booking
form's baseline, so all four open paths (`openNew`/`openEdit`/`bookAgain`/
`bookFromWaitlist`) stay in step; every *other* `setForm` is a user edit and must
NOT touch it. Same shape in `useWalkin` (`openWalkin` only). Both baselines are
**state, not refs** — they're read during render to derive a rendered value.
`ManualModal` owns its picks and reports up via `onDirty`, with an unmount-only
cleanup firing `onDirty(false)` so a closed modal can't leave `beforeunload` armed.
`BlockModal` (v17.8.0) uses that identical shape.

**Two v17.8.0 details worth carrying forward.** (1) `ReminderEditor`'s draft is
diffed through a `flatReminder()` first: `sameDraft`'s `norm()` falls back to
key-order-sensitive `JSON.stringify` for a nested object, and `recurrence` is
rebuilt by spreads throughout the editor, so the raw draft could read as
permanently dirty. Flatten any nested draft before diffing it. (2) Settings
aggregates several independent draft holders through `SettingsContent`'s
`reportDirty(id, on)` into the ONE boolean App wants, backed by a **Set of ids,
not a counter** — an unmounting field always clears its own entry, so a tab
switch (which unmounts the whole body) can't leave a phantom count and strand
`beforeunload` armed. Its tab reset lives in `closeSettings()` so it runs on
both the clean and the discard path. Settings' steppers/toggles are deliberately
unguarded: they commit on each tap and hold no draft.

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
- **`--bg-app` is ONE flat tint per theme (v17.9.0), not a gradient.** It was six
  near-identical desaturated blues spanning a MEASURED 3.86 L\* in light and 4.00
  in dark — at the edge of visibility across a viewport, so the app paid six
  stops for something nobody could see. The shipped value is the mean of the six
  it replaced, which is why the change is invisible and the diff is a deletion.
  A 2-stop candidate at ~8 L\* was built and compared side by side in the real
  app (three live iframes, one parameter apart — the surfaces are translucent
  glass, so the backdrop tints every card and a swatch comparison answers a
  different question); Patryk chose flat. **If a gradient is ever wanted here
  again, ~8 L\* is the bar.** A backdrop either commits to being seen or commits
  to being a surface.
- **One app font (v16.0.0):** the stack lives in `index.html` as `--font-app` (body sets it; App.jsx/LoginScreen wrappers read the token). `input, textarea, select, button { font-family: inherit }` is load-bearing — form controls do NOT inherit font per the CSS spec (the Notes textarea used to render monospace). Never re-introduce an inline font-family literal; the only deliberate exception is the `Kbd` keycap atom (monospace).
- Every modal uses the **`Overlay` atom** (owns blur + mobile-sheet / desktop-card branching).
- **Popovers/dialogs use the opaque sheet token**, not the translucent card token (a card token at ~0.45 opacity reads see-through for a dialog).
- ≤4 simultaneous `backdrop-filter: blur()` (see perf gotcha above).
- **Keyboard focus is a designed state (v17.8.0).** One `:focus-visible` rule in
  `index.html` + a `--focus-ring` token per theme. Before this the app had NO
  focus rule at all and a focused button computed `outline: none` — in the one
  app here that is explicitly keyboard-driven. **`outline-offset: 2px` is what
  makes a single colour enough**: the ring lands on the page background instead
  of the control's own fill, so it never has to survive being drawn over a
  saturated accent pill. Don't add an inner hairline for that case — mkBtn's and
  mkInp's inline `boxShadow` beats a stylesheet `box-shadow` on most controls, so
  it would apply inconsistently or not at all (tried and removed). The offset
  needs 2px of room: a control flush inside an `overflow:hidden` scroller has its
  ring clipped, the same trap as the hover-lift and fixed by the same
  `padding-inline` gutters. **Nothing else in the app may wear a plain outline** —
  `ViewSwitcher`'s split-pane marker was `outline: 2px solid white` and became
  indistinguishable from focus the moment a real ring existed; it is an inset
  underline now.

- **A status button carries its OWN mark, from ONE source (v17.10.0).** Every
  button that moves a booking to another status used to be prefixed with the
  same `ChevronRightIcon` — ">Confirmed", ">Seated", ">Completed" — which marks
  "there is more this way", not what the button does; four buttons in a row, one
  glyph, no information. Worse, the quick-status popup (the one reached on the
  timeline and the floor plan, i.e. **during service**) carried no marks at all,
  so the same five decisions looked different in three places. `StatusIcon`
  (`Icons.jsx`) is now the single source all three read — the List card, the edit
  form's Status row, the popup. **It is exported as a COMPONENT, not as the bare
  map**: a plain const export from that file breaks Fast Refresh
  (`react-refresh/only-export-components` is a lint ERROR and CI gates on zero),
  and a call site should ask for "the mark for this status" rather than hold a
  table it can index wrongly. Adding a status means adding a row there, nowhere
  else. Four of the six marks were already drawn — `CheckIcon`, `CloseIcon`,
  `WaitIcon` (the hourglass already means waiting, which is what
  awaiting-confirmation is) and `NoShowIcon`; only **seated** and **completed**
  needed new shapes. Sizing: `IC.control`, not `IC.inline` — these are marks ON
  a control, and `Assign` sat in the same List row at `IC.control` already.
- **A control's LABEL is not selectable text (v17.10.1).** One rule in
  `index.html` — `button, [role="button"] { user-select: none;
  -webkit-touch-callout: none }` — because a long-press is TWO gestures at once:
  ours, and the OS starting a text selection. The quick-status popup opens under
  the finger that is still pressed, so on Android the selection landed on its own
  buttons (Copy / Share / DeepL across "Cancelled"). Both properties are set
  although only Android showed it: `user-select` is what Chrome reads,
  `-webkit-touch-callout` is Safari's, and neither platform should differ here.
  **Scoped to controls, never to a container** — inputs, textareas and divs keep
  selection, and `ListView`'s card is a `<div>` whose phone number staff select
  and copy to ring a party (the reason v17.10.0 taught that card's click handler
  to stand down mid-selection). Two testing traps, both of which produced a
  falsely clean result first time: a hold past **800ms** is the drag-arm handoff
  and dismisses the popup *by design*, so probe at ~600ms and sample state
  *during* the press; and block coordinates move on reload, so derive them from
  `getBoundingClientRect()` rather than hard-coding. Guarded by a DECLARATION
  assertion in `tests/stylesheet.test.js`, **not** a `CRITICAL_SELECTORS` entry —
  that list matches selectors, and both `button` and `[role="button"]` already
  appear in other preludes, so either entry would have passed with the rule gone.

- **v17.9.0: no control wears a typographic mark.** Dismiss, confirm, disclose,
  navigate, rename, print, download, assign, "preferred" and the status
  chevrons are all SVG from `Icons.jsx` — and so is every flag on a timeline
  block, which the first pass exempted and the second pass did not. The two
  text categories that remain (prose arrows inside sentences, keycap labels)
  are listed at `Icons.jsx` in the file-structure block — read that before
  adding a glyph to a button. Also note the traps it records: an HTML entity is
  invisible to a glyph grep, **copy that describes a glyph has to change when
  the glyph does**, and **check for a reuse before drawing** — three of the
  block's markers needed only two new icons, because one of them renders the
  same data the notification strip already had a mark for.

- **Chrome sits with what it acts on, not with other chrome (v17.9.0).**
  `ViewTools.jsx` is **gone**. v17.0.0 round 8 created it to give all three views
  ONE copy of Find-a-booking and Settings, and that goal still holds — but it
  grouped them by *appearance* (two 36px circles) into a toolbar that belonged to
  neither. They are now two buttons in App's header sharing one `CHROME_BTN`
  module const: **Settings leads the title block**, because the two lines beside
  it are the restaurant's configuration read back (name · tables · hours), and
  **Find-a-booking joins the action cluster** between "+ New" and the connection
  dot, because finding a booking is something you do, like adding one. The header
  is no less shared across views than the date-nav row was, so nothing regressed.
  `CHROME_BTN` lives in `App.jsx` rather than `atoms.jsx` for the `time-grid.js`
  reason — both call sites are in that one file, and exporting a style nothing
  else reads is distance, not sharing.

- **The waitlist is a PENDING thing, so it wears the pending amber (v17.10.0).**
  Its chrome — the ⏳ count badge in the date-nav row, both "Add to waitlist"
  buttons, and the Waitlist panel's title pill — used to share `--btn-orange`
  with No show / Reassign / Reshuffle / the swap family, i.e. the burnt orange
  that means *something has gone wrong or needs undoing*. A party waiting for a
  table has not gone wrong. The green "table free" signals stay green: those say
  an opportunity opened, which is the opposite of "still waiting".
  **The contrast cost is real and was chosen with the numbers on screen.** This
  fill under white ink is `tests/contrast.test.js`'s recorded amber exemption,
  and that exemption's stated justification — a block's meaning is carried by
  colour, position and width, and the one part that is information moved onto an
  opaque chip — **does not stretch to a button whose label is its only content**
  (1.82:1 light / 2.20:1 dark). All three candidates were built into the running
  app and compared side by side in both themes: an outline (amber border + amber
  text, the `Save pending` shape, no exemption needed), a solid fill with dark
  amber ink (3.76 / 3.12, clears the 3:1 button bar), and this. Patryk chose this,
  informed. The note now lives beside `EXEMPT_FLOOR` so the record says what it
  actually blesses; the floors still gate a regression.
- **Accent = primary action or current selection. Nothing else (v17.8.0).** It is
  not for identity and not for decoration. `--tbl-out-rgb` used to be byte-identical
  to `--accent`, so nine outdoor table pills painted the accent on every screen at
  all times and nothing could outrank a table label; outdoor is teal now. Before
  reaching for accent, check the hue is actually free — the app's slots are green
  seated/success, amber confirmed/pending, burnt orange warn, red danger, purple
  indoor, teal outdoor, graphite `--tag-flag` for booking flags.

- **Notifications are ONE surface (v17.8.0).** Every in-flow banner
  (`BannerRows` + Late/Overlap/WaitAvail, `AppBanners`, the reminder banner) and
  every floating toast (`StatusToasts`) uses the same pane: a soft semantic
  tint, a **1px** border, `R.card`, and the colour carried by a leading 8px
  **dot** — the connection popover's device. Never a 2px ring around a
  saturated wash, and **never a card inside a card**: banner rows are
  transparent and hairline-separated (`--border-soft`), because a fill+border
  row inside a fill+border container is what made these read as bolted-on alert
  boxes. Connection-shaped toasts use the header dot's own `--status-*` tokens
  so the same event is the same colour everywhere. No ⚠/⏰/⟳ glyphs — a glyph
  plus a coloured dot plus coloured text is three signals for one message.
  **All of them now live in ONE `NotificationStrip` pane** whose collapsed height
  is one row however many fire; adding a new in-flow notification means adding a
  section to App's `notifSections` in severity order, never a new pane.

- **Three label treatments (v17.8.0), and context decides which.** **SOLID**
  where a tag competes inside a busy row (ListView's `manual`/`locked`/`★`/the
  seated counter, the reminder's time chip). **OUTLINE** — no fill, a **2px**
  border in the semantic hue, text in the same family — where a chip stands
  alone as a count or a disclosure (Customers' visits/no-shows,
  `BookingFormModal`'s Regular/no-show buttons). **TEXT** where the colour
  carries itself unaided. The banned shape is the fourth one: pale semantic fill
  *plus* a matching border *plus* bold text in a third shade, which encodes one
  signal three times. The outline chip drops the fill and earns its extra border
  pixel; do not "restore" the fill.
- The SOLID/TEXT pair in full: **solid** — the fill carries the colour, text is `--text-on-accent`,
  the rim is neutral `--border-glass` (the v17.7.0 status-label decision:
  `SBadge`, `manual`, `locked`, `★`, the seated `N min`); or **plain text** —
  the colour carries itself, no fill, no border. The third shape — pale
  semantic fill + border in the matching hue + bold text in a third shade of
  it — is banned. It encodes one signal three times and is the stock badge
  every framework ships. **Which of the two you pick is decided by context,
  not taste: match whatever sits next to you.** ListView's `no-show ×N` /
  `N min late` / `€N deposit` share a row with four solid tags, so they are
  solid; `Table free · HH:MM`, `This device` and the reminder banner's time sit
  among plain text (and each already has a plain-text twin elsewhere — the
  waitlist string is printed verbatim by `WaitAvailBanner`), so they are text.
  Clickable chips are the documented exception: `BookingFormModal`'s
  Regular/no-show disclosures are buttons and a fill is their affordance.
  Watch the copy when you strip a chip — dropping the waitlist pill left the
  panel's footnote describing "a green chip" that no longer existed.

- **`--suggest-bg` is a CHIP fill, `--suggest-bg-soft` is the pane fill.** At
  banner size the 0.8-alpha chip green outshouted the amber "Running late" pane
  above it, inverting the hierarchy. A suggestion must never be louder than a
  warning.

- **Every modal is a real dialog (v17.9.1).** `Overlay` carries `role="dialog"` +
  `aria-modal="true"`, focuses its own container on open (`tabIndex -1`, not the
  first control — focusing an input pops the tablet keyboard, focusing the first
  button puts a destructive action one Enter away), restores focus to the opener
  on close, and traps Tab. **Escape is deliberately NOT handled there** —
  `useKeyboardShortcuts` owns the app-wide Escape z-order chain. The accessible
  NAME is resolved **from the DOM**, not a prop: `#mgt-modal-title` (rendered by
  `ModalTitle`, which is an `<h2>`), else the first heading in the subtree, else
  a generic label. A prop was written and thrown away — it would need to stay
  correct at twelve call sites, and **`aria-labelledby` pointing at an id that is
  not in the tree leaves the dialog NAMELESS, strictly worse than not trying.**

- **`prefers-reduced-motion` and the manual toggle are different intents
  (v17.9.1).** The OS query gets transforms and keyframes killed but keeps a
  120ms colour/opacity cross-fade — WCAG 2.3.3 is about vestibular triggers and
  asks for LESS motion, not none, and this app says a lot with motion. The
  per-device "Reduce animations" toggle keeps the TOTAL kill: its job is weak
  tablet hardware, where the cheapest frame is no frame.

- **A modal that REPLACES its body must reset its scroll port, in the click
  handler (v17.9.1).** `Overlay` exposes one via `useOverlayScroll()` (a context,
  because it owns four scroll ports and only it knows which is mounted). Settings
  calls it when switching tabs. Doing it in a **layout effect instead removes the
  jump but kills the height animation** — writing `scrollTop` forces a
  synchronous layout, and there it lands after `AutoHeight` has already set the
  new height, so the transition has nothing to animate from. Reset while the OLD
  content is still mounted.

### Theming / dark mode (mechanism shipped v14.2.0 — ported from Scheduling; see `MGT_Bookings_dark-mode_PORT_INSTRUCTIONS.md`)
- Light + dark via CSS custom properties: `:root` (light) + `[data-theme="dark"]` overrides in `index.html`; `<html data-theme="…">` set via `document.documentElement.dataset.theme`. A theme flip is **one DOM attribute change — zero React re-render** of the tree.
- **Hook:** `useThemeMode(explicitPref) → isDark` (`src/hooks/useThemeMode.js`) writes `data-theme` and follows the OS live when pref is `undefined` — the shared Scheduling contract, unchanged. A no-flash inline script in `index.html` paints the theme before React mounts (the hook alone runs too late).
- **v17.9.0: a DEV-only `?theme=dark` / `?theme=light` override, and it is the
  FOURTH site in the theme-key contract** (`readThemePref`, the Settings toggle,
  the no-flash script, the override — same key, same `"dark"`/`"light"`
  convention at every one). It exists because v17.6.0 made the theme follow the
  signed-in ACCOUNT, which overrides both `localStorage` and OS emulation — so
  there was no way to LOOK at dark mode without writing to a real user's saved
  settings. **The non-write is the feature**, enforced at both write sites: the
  prefs-seeding effect skips its theme branch entirely (both halves — the `else`
  is the dangerous one, because `themePref` holds the FORCED value and would
  write "I chose light" up for a user who chose dark), and `onToggleDark` skips
  `saveUserPrefs`. It is inert in production twice over: Vite strips the
  `import.meta.env.DEV` branch, and the no-flash script (which has no
  `import.meta.env`) gates on hostname. The override had to be honoured in the
  no-flash script too — painting the stored theme and correcting it a frame
  later in React is exactly the flash that script exists to prevent.
- **Persistence is per-device `localStorage["mgt-theme"]`** (`"dark"|"light"|`absent), NOT Firebase (theme is per-device by design; the `settings/operatingHours` node added v14.4.0 is restaurant-wide config only). `readThemePref()` (module scope in `App.jsx`) feeds the hook; the Settings General-tab `Toggle` (`onToggleDark`) writes the key. The no-flash script reads the SAME key — **keep the value convention in sync across all three.**
- **No rgba/hex literals in JS — every colour references `var(--…)`.** Migrated token-by-token in waves. **v14.2.0:** core `S` set + app background (`--bg-app`). **v14.2.1:** `constants.js` colour sets — `STATUS_COLORS` + `TBL` as **RGB-channel triplets** composed `rgba(var(--…-rgb), a)`; `BLOCK_BG` + `BTN` direct tokens (theme-invariant saturated fills; only status-chip **text** flips). **v14.2.2:** `atoms.jsx` + the full **modal/form subsystem** (every `Overlay` modal, `Section`, inputs, steppers, `Toggle`, `Kbd`, the Settings `TabBar`, in-modal banners) — surfaces + their text flip together (coupling: the shared `Overlay` backs 7 modals, so a dark sheet needs dark-themed content). Then **v14.2.3** `TimelineView` · **v14.2.4** `ListView` · **v14.2.5** the main-screen banners in `App.jsx` (offline/reconnect/load/overlap/reshuffle) completed the migration — **every in-app surface is now themed** (timeline/list canvas included; the login screen followed in v14.4.0).
- **Token families** (index.html): surfaces `--bg-sheet`/`-sheet-mobile`/`-soft`/`-input`/`-stepper`/`-tabbar`/`-tab-active`/`-card`; borders `--border-sheet`/`-soft`/`-input`/`-kbd`/`-glass`; `--scrim`; semantic text `--text-primary`/`-secondary`/`-muted`/`-faint`/`-required`/`-on-accent` + `--warn-text`/`--danger-text`/`--success-text`; banner trios `--warn-*`/`--danger-*`/`--suggest-*` (bg+border+text move together); shadows `--shadow-sheet`/`-soft`/`-input`/`-btn`. **Dialog sheets use the near-opaque `--bg-sheet`** (dark = 0.85), per the opaque-popover rule. `ReminderEditor` has its **own** modal (not `Overlay`) — theme its scrim/card directly.
- The PDF/print path stays light regardless of in-app theme (currently no in-app PDF/export exists; keep it light if one is added).

### Hover affordance — COMPLETE (v14.3.0 → v14.3.2; see `MGT_Bookings_hover-scale_PORT_INSTRUCTIONS.md`)
- Shared `.mgt-hover-scale` utility in `index.html` `<style>`: `scale(1.08)`, `120ms ease`, opaque theme-aware `--bg-hover-card` (`#ffffff` light / `rgb(50,50,53)` dark, both theme blocks), the `:hover:not(:disabled)` guard, reuses `--shadow-soft`.
- **A colour token may only sit on a surface that flips with it (v17.8.0 review fix).** The
  `--*-text` tokens INVERT between themes (`--success-text` `#166534`→`#86efac`,
  `--status-pending-text` `#854d0e`→`#fde047`). Painted on a **hard-coded** pale
  fill — which is theme-invariant by intent, like `BLOCK_BG` — that inverts the
  text out from under itself: the kitchen-suggestion chips in
  `BookingFormModal`/`WalkinForm` shipped light-green text on pale green at
  ~1.3:1 in dark mode. Those six sites are deliberately **back on hex literals**
  (`KTXT_OK`/`KTXT_TIGHT`), and that is the correct answer, not debt. **Triage a
  colour exactly like a shadow: ask whether the SURFACE UNDER it flips.** If it
  doesn't, the thing on top must not either.
- **The shadow scale is a 2×2, and v17.10.1 filled the missing cell.** Ask two
  questions: does the element read as RAISED, and does its own fill FLIP with
  the theme? Raised + flipping fill ⇒ `--shadow-btn`. Raised + fixed fill ⇒
  **`--shadow-btn-solid`**. Not raised ⇒ `--shadow-flat` either way (it has no
  inset, so the fill question does not arise). Recessed ⇒ **`--shadow-well`**.
  Floating ⇒ `--shadow-popover`; a card on `--bg-card`/`--bg-soft` ⇒
  `--shadow-card`; a text field ⇒ `--shadow-input`.
  **`--shadow-btn-solid` is the only `--shadow-*` whose INSET is identical in
  both themes**, and that is its entire content: the highlight sits on the
  element's own theme-invariant fill (`BLOCK_BG`, `--app-*-solid`, `BTN.*`), so
  tuning it per theme would be wrong; the DROP still deepens, because it lands
  on the page. It replaced **three spellings of one intent** across 14 sites
  (`0 2px 6px/0.12` ×11, `0 1px 4px/0.1` ×2, `0 1px 3px/0.15` ×1), none of
  which deepened for dark — modal footer buttons sat at 0.12 beside siblings at
  0.35. **`--shadow-btn-accent` / `--shadow-btn-success`** are the one deliberate
  exception to theme-splitting: a primary button glowing in its OWN hue is not
  elevation, so they are identical in both themes.
  **Count the DISTINCT VALUES before deciding a scale is missing** — and note
  that `--shadow-flat`'s own comment says "anything that should read as raised
  takes `--shadow-btn`", which is right for the elements it was written about
  (all on flipping fills) and was NOT the answer for these.

- **`--shadow-flat` is elevation over a fill that does NOT flip (v17.10.0).**
  Every other `--shadow-*` token leads with a white inset highlight — that is
  what makes a control look raised — and a highlight tuned for light and dimmed
  for dark is *wrong* on a fill that is identical in both themes (the v17.8.0
  white-inset-over-fixed-fill rule). So this one carries no inset. It is still
  theme-split, because the shadow falls on the PAGE and the page does flip.
  It absorbed the last of the ROADMAP's ~18 accumulated `0 1px Npx
  rgba(0,0,0,0.0x)` literals; the rest went to `--shadow-btn` (raised pills whose
  fill flips), `--shadow-card` (cards on `--bg-card` / `--bg-soft`) and
  `--shadow-popover` (floating surfaces — `StatusToasts`, matching the
  quick-status popup). **Triage each site by one question: does the ELEMENT's own
  fill flip with the theme?** A MIX counts as "no" — `BLOCK_BG[status]` spans
  three invariant fills and two that flip, so `SBadge` and the timeline's status
  swatch take `--shadow-flat`. Genuine remaining exceptions are **rings and
  glows** (`0 0 0 3px …`: the connection dot, the focus and selection rings),
  which are not drop shadows at all.
  **And a literal can hide behind a `const`** — `StatusToasts`' `toastShadow`
  survived the first pass because the sweep grepped `boxShadow: "0 …`. Grep the
  VALUE's shape, not the property it ends up on; same lesson as an HTML entity
  being invisible to a glyph scan.
- **`--shadow-input` is for RECESSED fields, `--shadow-btn` for RAISED controls.**
  The input token leads with an inset white highlight, which is what makes a
  field look sunken. Settings had ~20 BUTTONS wearing `--shadow-input` (fixed
  v17.8.0), and that one mismatch is most of why that modal never quite looked
  like the rest of the app despite sharing its palette and radii. Text inputs
  and `<select>`s keep it.
- **One stepper: `mkStep(size)` in atoms.** Settings and LayoutSettings each held
  a private, byte-identical copy before v17.8.0.
- **v17.8.0: shadow literals are allowed ONLY over theme-invariant fills — and `npm run check:style` enforces it.** The script resolves the nearest governing `background` above a white-inset shadow and fails when it is a theme token; `/* @fixed-fill */` marks the one site whose fill is beyond a line-scanner's reach. The white-inset literals it was written for are **down to two** as of v17.10.1 (TimelineView's drag lift and the `Kbd` keycap, both marked `/* @shadow */`) — the figure of 22 recorded here was true in v17.8.0 and is not any more. **Plain dark drop-shadow literals are no longer unchecked either**: v17.8.0 called them "a consistency nit, not a bug class" and predicted a noisy rule, and both halves failed. They were three spellings of one intent, none deepening for dark — a black shadow cannot invert out from under itself, but it can be invisible on the wrong ground. `check:style` **Rule 6** now matches a drop-shadow-shaped VALUE anywhere on a line (not the `boxShadow` property — that is how a literal behind a `const` escaped v17.10.0's sweep) with a NON-ZERO blur (so rings and focus glows are excluded by construction). Anchoring is load-bearing: unanchored, the pattern slides and flags `0 0 0 2px rgba(…)` as a shadow. The `--shadow-*` tokens are not cosmetic — light carries `inset 0 1px 1px rgba(255,255,255,0.6)`, dark drops it to `0.05` — so a hard-coded white inset ships a light-mode highlight into dark, 3–8× too bright. That was 24 call sites. The exception is real: TimelineView's blocks sit on `BLOCK_BG` fills, which are deliberately theme-invariant, so a fixed white inset is correct there in both themes (same reasoning as their `borderRadius` exemption). Triage by asking whether the SURFACE UNDER the shadow flips with the theme.
- **THE HOVER LIFT IS FOR CONTROLS, NOT FOR CONTAINERS OF CONTROLS (v17.9.1).**
  `scale(1.08)` is a PROPORTION — 3px on a 40px button, but ~30px on an 820px
  List card, which slid that card's own Edit and Delete buttons out from under
  the cursor between aiming and clicking (measured: Edit −24px, Delete +31px) so
  clicks landed on the card instead. Any surface that HOLDS click targets gets
  **`.mgt-ac-row`** instead: a background tint, no transform. One class covers
  autocomplete rows, the List card, the Summary panel and the notification
  strip's lid; both colours arrive as custom properties (`--row-bg`,
  `--row-bg-hover`) **because every one of those surfaces sets its resting fill
  INLINE and an inline `background` beats a stylesheet `background-color`** — a
  plain rule silently never applies. Symptom to recognise: "I have to move the
  pointer off and back on before the buttons work."
  **Routing the fill through `--row-bg` makes the class LOAD-BEARING, not
  decoration** — it now supplies the *background* of four surfaces, so dropping it
  conditionally drops their fill. `Summary` did exactly that (class withheld while
  open) and rendered fully transparent, measured `rgba(0, 0, 0, 0)`. A custom
  property is only a value; the rule that reads it is what paints. `.mgt-ac-row`
  is in `tests/stylesheet.test.js`'s CRITICAL_SELECTORS for that reason.
  **v17.10.0 walked into the inline-background trap this rule is written about,
  in the `Collapsible` header.** The header carried `background:"transparent"`
  inline; the hover rule matched, the element reported `:hover`, and the computed
  fill stayed `rgba(0,0,0,0)`. Reading the source shows nothing wrong — the class
  is there, the property is set, the rule exists. **Only reading the computed
  background while actually hovering catches it.** When you add `.mgt-ac-row` to
  an existing element, DELETE its inline `background`, don't just add `--row-bg`.
  Two more geometry notes from that header, since it is the first `.mgt-ac-row`
  surface that had to grow a padding box: a tint needs padding to read as a row
  rather than a hairline band, and the matching negative margin is what keeps the
  resting layout put — **verify that by measuring, not by arithmetic**. And
  `width:100%` plus negative horizontal margins is over-constrained (the browser
  silently drops one side), while dropping `width` entirely does NOT work on a
  `<button>` even with `display:flex`, because it keeps its shrink-to-fit
  intrinsic sizing — the header collapsed to its text, 213px instead of 337.
  `calc(100% + 20px)` + `border-box` is the spelling that holds.
- **The third affordance: `.mgt-glyph`, for SVG (v17.9.1).** Floor-plan tables can
  take neither of the other two — `.mgt-hover-scale` sets a CSS `transform`, which
  **REPLACES an element's `transform` presentation attribute**, so `TableGlyph`'s
  own `translate(x,y) rotate(r)` vanishes and the table teleports to the plan
  origin; `.mgt-ac-row`'s `background-color` paints nothing on a shape. So: a
  **halo** (`--glyph-halo`, theme-split like `--shadow-*`) on hover, applied to the
  SHAPE so chairs and the id pill stay flat, plus `.mgt-press`'s dim on `:active`.
  It is applied INSIDE `TableGlyph`, gated on the table being interactive, which is
  what makes PlanView and the plan editor agree without either knowing about it.
  **Why not `brightness()` for the hover, when the press uses exactly that:
  `brightness` multiplies channels, which is hue-safe only until one CLIPS, and a
  saturated fill clips almost at once.** Measured on the blocked-table orange: 1.35
  still orange, 1.6 plainly YELLOW — hovering a table made it look like a different
  status. Darkening cannot clip. **A filter that is safe in one direction is not
  automatically safe in the other**, and on any surface whose fill carries meaning,
  prefer an effect that adds something over one that modifies the colour.
- **Animate only the range that is VISIBLE (v17.9.1).** `AutoHeight` inside a
  scroll port eased its full height change — and Settings' General→Layout swap
  (2226px → 321px in a 611px port) spent 22 of 25 frames below the fold, because
  the modal card is `height: auto` under a `maxHeight` and cannot move until the
  box drops under the port. The card then did all 222px of its travel in three
  frames, which is what "it jumps" meant. The change now runs over the clamped
  range `min(prev,cap) → min(next,cap)` and retakes the true height afterwards;
  **every height at or above the port looks identical**, so both jumps are free.
  **When motion reads as a jump, measure what FRACTION of the animated range is on
  screen before touching the curve or the duration** — the easing may be perfect.
  **v17.10.0 applied it to the OBSERVER path too, which v17.9.1 had asserted was
  "already served correctly".** It was not: opening a Settings → Layout section
  spent 700ms of an 864ms animation below the fold with the port clipped, for
  165ms of visible travel. Both paths now share one pure `clampRange(live, next,
  cap)` (exported and tested — the arithmetic has been wrong twice), and `cap`
  gained the port's `scrollTop`, since the ceiling is where the box's bottom
  reaches the bottom of what is on screen **now** — v17.9.1 could read that as
  zero only because a tab swap resets the port's scroll first. **The General tab
  is why this hid for a version**: its content already overflows at rest, so the
  card is pinned at its max and the same wrong animation had nothing to spoil.
  "It only happens in one tab" was a clue about VISIBILITY, not about scope.
  A third branch falls out — when both ends are above the ceiling nothing can
  move, so the box takes the new height outright instead of clipping the port for
  385ms to ease to it.
  Three sub-traps are recorded at the component: the port is elastic so its ceiling
  must be probed rather than read, `transitionend` BUBBLES and `AutoHeight` nests
  (a child's transition was ending the parent's), and a ResizeObserver comparing
  content height against the box height breaks the moment those stop being equal.
- **v17.7.0: the hover rule no longer sets `border-radius`.** It used to hard-set `12px`, which squared off every pill the moment the pointer touched it. The declaration was **deleted**, not set to `inherit` — `inherit` resolves against the PARENT's radius, so a bare element inside a square parent would go square, which is the opposite of the intent. Each element now keeps its own resting radius on hover. Do not re-add a radius here. **Consequence: any `.mgt-hover-scale` element MUST set its own `borderRadius`** — the rule still applies an OPAQUE `--bg-hover-card`, so a radius-less element renders that background as a hard-edged rectangle on hover. `ConnectionStatus`'s dot button (transparent, no radius) was the FIRST case and got `borderRadius: R.pill`; **`CustomersSettings`' customer row was the second**, squaring off inside its own rounded card on hover until it got `R.card`. It has been called a one-off twice now. Treat a missing radius on a `.mgt-hover-scale` element as a bug by default, and grep the class when auditing.
- **v17.8.0: `.mgt-hover-scale` and `.mgt-press` share ONE `transition` declaration.** They are designed to compose (~30 elements carry both), they had equal specificity (0,1,0), and `transition` is a **shorthand** — so `.mgt-press`, declared later, REPLACED the hover rule's list instead of adding to it. Every element with both classes had no transform transition at all and snapped to `scale(1.08)` instead of easing: the reminder banner's Snooze/Done, the whole timeline zoom cluster, every banner ✕, the form's customer chips. Broken since v15.8.0 and invisible because the `filter` dim `.mgt-press` added still worked; v17.8.0's universal press-scale doubled it by adding a press dip that also snapped. **Two shorthand declarations of one property cannot merge — so don't have two.** One selector list, one declaration, covering every property either class animates; source order then cannot matter. Same trap applies to any future composable pair.
  **And to INLINE styles, the third copy of it** (v17.8.0 review fix): an inline `transition` beats both the class rule and `button {}`, so **any `.mgt-hover-scale` element with an inline `transition` must list `transform`** or its hover lift and its press dip both snap. Settings' TabBar named three properties and dropped the fourth — in the same commit that documented the class-level version. Grep `transition:` under `src/` when auditing.
- **v17.8.0: a stylesheet has no syntax errors, only rules that silently don't exist.** A stray `*/` after an already-closed comment left two lines of prose loose in `index.html`; CSS error recovery folds that text into the NEXT rule's *selector*, so `.mgt-press:active` was dropped outright and the press dim died app-wide. The build says nothing, lint says nothing, and the source reads fine at a glance. **Verify a CSS change by walking the live CSSOM** — `[...document.styleSheets].flatMap(s=>[...s.cssRules]).filter(r=>/yourClass/.test(r.cssText))` — for the rule you think you wrote. Reading the file cannot catch this class of bug.
- **v15.1.0: the `:hover` rule is wrapped in `@media (hover: hover) and (pointer: fine)`.** iOS Safari makes `:hover` STICKY after a tap — unguarded, the last-tapped element stayed scaled 1.08, and full-width form inputs (Date/Time in the booking form) visibly overflowed their Section on phones. Touch devices get no hover lift at all; mouse/trackpad behaviour unchanged. The guard is part of the shared contract — **ported to MGT Scheduling in its v15.1.1** (2026-06-16); keep the two in sync.
- Opt-in per element via `className="mgt-hover-scale"`. Because `mkInp`/`mkBtn` return style objects, put the class **directly on the call-site element**, not via a prop.
- **In Bookings the lift is `transform: scale(1.08)` ONLY.** Every tagged surface uses `mkBtn`/`mkInp` (inline `background`+`boxShadow`+`borderRadius`), which beat the hover rule at higher specificity (Fix 2), so each keeps its own colour/shadow/radius and only scales. `--bg-hover-card`/`--shadow-soft` still apply to a bare (background-less) element — see the radius consequence above. Disabled controls stay flat via `:not(:disabled)`; for non-`disabled` "blocked" controls (TableGrid busy cells) the class is withheld instead (`className={blocked ? undefined : ...}`).
- **`Overlay` gained an optional pinned-`footer` slot (v14.4.1).** Pass `footer={…}` and the action buttons render fixed at the modal bottom while `children` scroll above (desktop = flex-column card with a `minHeight:0` scroll body; mobile = sticky bottom bar with safe-area padding). Omitting `footer` keeps the original single-scroll behaviour (back-compat for read-only popups like `HistoryPopup`). **All action modals pass `footer`** — the 5 component modals, the inline App.jsx confirm dialogs (delete/cancel/kitchen/reshuffle/reminder-del) + the Settings modal, and `ReminderEditor` (its own z-250 modal, restructured to the same scroll-body + pinned-footer shape). Blur budget unchanged (one card renders → scrim blur(8) + card blur(20) = 2). The Hover-scale Fix-4 inner-scroller is still NOT used — the footer region has its own padding, so hover-lifts don't clip there.
- **Fix-3 timeline (`TimelineView`):** pad the *scroller* (`padding:8`), NOT the inner grid — the grid is `pct()`-positioned against the inner width, so padding the inner div shifts every block. `labelCol` mirrors the scroller's `paddingTop:8` so rows stay aligned (verified: row-top delta 0).
- **Coverage:** v14.3.0 header chrome · v14.3.1 ListView cards+buttons, TimelineView controls+blocks, Settings tabs · v14.3.2 `Toggle` atom + every modal's buttons/steppers/cells/inputs + App.jsx confirm-dialog & banner buttons.

### Press feedback — universal, opt-OUT (v17.8.0)
Every `button` dips to `scale(0.96)` on `:active`; `.mgt-hover-scale` buttons dip
to `1.02` from their lifted `1.08` so the travel stays proportional. Both are in
`index.html` next to the hover rule.

- **The specificity is load-bearing.** `.mgt-hover-scale:hover` is (0,2,0), so a
  plain `button:active` (0,1,1) LOSES and the press is invisible on desktop —
  a mouse user is always hovering the button they press. The shipped selector is
  `button:active:not(:disabled):not(.mgt-nopress)` = (0,3,1). Don't "simplify" it.
- **`.mgt-nopress` is the opt-out**, for controls that are inert but NOT
  `disabled` (TableGrid's blocked cells) — animating a tap that does nothing is
  a lie about what happened. Same principle as withholding the hover lift there.
- **iOS needs the touch listener.** Safari only delivers `:active` when a touch
  listener exists somewhere on the document; the empty passive one in
  `index.html`'s boot script is the only reason this works on the tablets.
  Remove it and the whole effect silently becomes desktop-only.
- Inline transforms still win by design (TimelineView's drag `translateY`).
- **v17.10.1: the PLATFORM tap highlight is suppressed, and the app owns 100% of
  its press feedback.** Chrome's Android default `-webkit-tap-highlight-color` is
  `rgba(51,181,229,0.4)` — Holo blue — and it is painted as a **rectangle over
  the border box, ignoring `border-radius`**, so every pill in the app flashed a
  blue rectangle on touch. Killed on `:root` (the property inherits). It was also
  the only feedback the two non-`<button>` tap targets had, so both gained the
  app's own language, and **which one they get is the v17.9.1 rule again**:
  `.mgt-ac-row:active` gives a **tint** to containers of controls (List card,
  Summary, autocomplete rows, the strip's lid) — a scale there would shrink the
  card under the button you were aiming at, because **`:active` matches
  ANCESTORS of the pressed element**; `.mgt-blk:active` gives the **dip** to the
  timeline block and waitlist ghost, which are leaf controls. Target `.mgt-blk`
  rather than widening the rule to `.mgt-hover-scale` — several containers of
  controls carry that class too.
- The older `.mgt-press` brightness dim stays and composes — `filter` and
  `transform` are orthogonal.

### Motion — two curves, three durations (v17.8.0)

Tokens in `index.html`'s `:root` (theme-agnostic, so NOT duplicated into the
dark block, same as the radii); JS reads them through **`M`** in
`lib/constants.js`. **No new easing or duration literal** — `grep -rn "ms ease\|ms linear\|cubic-bezier" src/` must come back empty apart from `M`'s own
WAAPI values.

**The split is by DIRECTION, not by element.** `--ease-out` (cubic-out,
`0.33,1,0.68,1`) for everything that arrives, opens, moves, or answers a finger;
`--ease-in`, its exact mirror, only for things leaving — an exit accelerates away because the eye
has already moved on. Before this the app had five curves (`ease`, `ease-out`,
`ease-in-out`, `linear`, Material's `.4,0,.2,1`) picked per site over eight
versions, so a modal's scrim faded `linear` while the toast inside it used
Material's curve while the button on it used `ease`: three materials in one
glance.

Durations by **what is moving**: `--t-tap` 145ms (a control answering your
finger), `--t-move` 240ms (something arriving or leaving), `--t-shift` 385ms
(geometry — heights, widths, positions).

**The curve was a quint (`0.22,1,0.36,1`) for one version and it was wrong for
travel.** A quint spends ~90% of the distance in the first third of the time —
right for a press dip, where the eye only registers arrival; wrong for anything
crossing a distance. The toggle knob proved it: the transition was applied and
correct, and the 21px slide still read as a teleport. **Diagnose "it jumps" by
sampling the intermediate positions before touching the duration** — the value
may be fine and the curve the fault. Corollary: `--t-tap` is for a control
*acknowledging* a tap. Anything that TRAVELS (a knob, a pane, a block) takes
`--t-move` or `--t-shift`, however small the control is. Two more sit outside the scale on purpose: `--t-status`,
which exists *because* TimelineView and PlanView must agree on it (a shared
number needs a shared name), and `--t-wipe`, which TimelineView's
`__statusAnims.until` window depends on.

Three exceptions, all real, and the first two are the same idea. `.mgt-dot-pulse`
keeps `ease-in-out` — a loop has no arrival and no departure, so neither
direction curve applies; it is a breath, not a move. **`M.resize`
(`--t-shift linear`) is `AutoHeight`, and only `AutoHeight`** (v17.8.0): a box
conforming to content that already changed is not travelling either, so there is
no arrival to decelerate into and ease-out only front-loads — cubic-out covers
70% of a height change in the first third of the time, then crawls, which is
exactly what "jumpy" describes. **The tell for both: ask whether anything is
going anywhere.** If nothing is, a direction curve is describing a motion that
isn't happening. Third, **`useFlip` keeps literal numbers because WAAPI cannot
read a CSS var** (it resolves to nothing and the animation silently runs
linear), which is why `M.dur`/`M.easeOut` exist and are the only values here
that can drift.

**Never `transition: all`** — it animates layout properties too and you cannot
tell what moves by reading it. Name the properties.

### Adding motion to something that has none

- **Fading in to an element's own opacity** is `.mgt-appear`, not
  `.mgt-fade-in`. It has no `to` (an omitted endpoint resolves to the element's
  computed value, so the timeline's waitlist ghost lands on its 0.55/0.4 without
  the rule knowing that number) and **no fill-mode** — `both` would pin the
  animated properties forever, which on a `.mgt-hover-scale` element means the
  lift never applies again. For the same reason it animates opacity only:
  nothing may own `transform`, because the hover and press rules do.
- **An element that must animate OUT needs its content held.** `Reveal` already
  caches its last truthy children for exactly this — pass `null` and it fades
  out what it was showing. Corollary that bit once: it only caches **truthy**
  children, so a parent must pass `null`, not a live-but-empty component (that
  is why App's strip mount site is `{notifSections.length ? <Strip…/> : null}`).
- **One `Reveal` cannot animate a SWAP.** Two disclosures sharing a Reveal
  (`show={!!panel}`, content chosen by which one is open) never change `show`
  when you switch between them, so the rows are replaced in a single frame and
  the height snaps. Give each its own Reveal: the switch is then what it really
  is, one closing while the other opens, and because both ride the same curve
  for the same duration the container height interpolates straight from A to B
  with no bulge. `BookingFormModal`'s Regular / No-shows chips, v17.8.0.
- **A list whose items animate out must remember ORDER, not content.**
  `useRevealRows` keeps departed ids alive but its `renderIds` is
  arrival-ordered. If the list is sorted by anything else, a departing item's
  remembered index **ties** with whatever shifted up into its place, and the tie
  falls through to arrival order — so it visibly jumps before it collapses. Sort
  departed items half a step above their replacement (`rank - 0.5`).
- **Not everything that appears needs an animation.** The empty-day state gets
  none: it appears mostly when you navigate to an empty day, where `SlideView`
  is already animating the whole view, and a second fade inside it just makes
  the day change feel slow.

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
| The CSP pins the inline boot script BY HASH | `vercel.json`'s `script-src` is `'self'` plus one `sha256-` of `index.html`'s inline `<script>`. **Edit that script without regenerating the hash and the browser silently blocks it in production** — build passes, lint passes, nothing throws. It had already happened before v17.10.1: the pin had drifted, so the no-flash theme script, the `data-motion` stamp and the passive `touchstart` listener (the only reason `:active` works on iOS) were all dead in PROD. `tests/csp.test.js` now fails on a drifted or stale pin and checks the built block still matches the source, since Vite processes that file. Regenerate from a sha256 of the exact bytes between the tags. Note also that **inline event handlers (`onclick=`) are blocked by the same directive** — use `addEventListener` in that script |
| Synthetic input does NOT set the UA `:active` state | Not `element.dispatchEvent`, not CDP `Input.dispatchTouchEvent` / `dispatchMouseEvent`, not `adb shell input`. Every attempt to measure a `:active` rule on the tablet read `false` — including on a plain `<button>`, which would have meant v17.8.0's universal press-scale had never worked there. It had; the measurement was of the tooling. Use CDP **`CSS.forcePseudoState`**, which answers the real question ("if this element WERE `:active`, does my rule apply?") — and always force the same state on a control that already works, as a control group. The same family of trap as v17.10.1's other two: a synthetic press also cannot arm the timeline drag and cannot raise an OS text selection. **A synthetic press is not a finger** — for anything gesture- or UA-state-shaped, the person holding the device settles in one second what an hour of instrumentation cannot |
| Firebase's reconnect backoff is 5 MINUTES, and a visible page never resets it | `RECONNECT_MAX_DELAY_DEFAULT` is `60*5*1000` for a web client (the 30s constant beside it is admin-only); `onRealtimeDisconnect_` jumps straight to that maximum whenever the window is hidden when the socket dies. The only resets are the browser `online` event and `onVisible_`, which fires ONLY on a hidden→visible edge and ONLY at exactly the maximum — so a page that stays visible has **no reset path at all**. That is why minimising the app and restoring it cures a stuck reconnect: it recreates the one edge the SDK listens for. v17.10.1's watchdog (`usePersistence`, on the existing 10s heartbeat) calls `goOnline(db)` after 20s of a disconnected FOREGROUND page. **Toggling wifi cannot reproduce the stuck state** — that fires `online`, which resets the backoff unconditionally (measured: 6.1s recovery from a 200s outage on a build with the watchdog disabled). It needs the socket to die while `navigator.onLine` stays **true**: an AP associated with no upstream, a captive portal, a NAT dropping an idle socket — ordinary restaurant wifi, which is why the report comes from the tablet and never from a desk. The watchdog is therefore deliberately **not** gated on `navigator.onLine`; that property lies in exactly the case it exists for |
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
- ~~**Tests** — no test suite~~ **STALE since v17.3.2**: a Vitest suite EXISTS — `booking-logic` · `customers` · `drafts` · `waitlist-match` · `presence-state` · `stylesheet` · `contrast` · `time-grid` · `style-check` · **`csp`**, **332 tests** as of v17.10.1 (`npm test`). CI gates build + test + **lint (0 errors, hard)** + **`npm run check:style`** on every PR via `.github/workflows/ci.yml`. No UI/component tests — UI verification is still AST audits + manual DEV QA.
  **The rule v17.8.0 added: logic that decides something the restaurant acts on does not live in a `useEffect`.** `placeWaitlist` and `presenceState` were both extracted for that reason — a double-booking fix had shipped on "it looked right in DEV". If a behaviour is worth a REFACTOR_LOG paragraph it is worth being reachable by a test: put the pure core in `lib/`, leave the hook its subscription, refs and setState.
  **Fixture trap:** `ALL_TABLES` holds `{id, capacity}` OBJECTS, not ids. A "fill every table" fixture built straight from it silently occupies nothing, and the failures point at the code. Use `ALL_TABLES.map(t => t.id)`.
  **`tests/stylesheet.test.js` guards `index.html`'s `<style>`** — a stylesheet has no syntax errors, only rules that silently don't exist (v17.8.0 lost `.mgt-press:active` to a stray `*/` and nothing noticed). It checks comment hygiene, brace balance, a CRITICAL_SELECTORS list, and — added after the same defect recurred one scope deeper — **loose prose inside a DECLARATION block**, which eats the declaration *after* it rather than the rule after it. That version made `--tbl-out-rgb` resolve to empty, which would have rendered nine table badges transparent, while every existing test passed. Entry criterion for CRITICAL_SELECTORS: does the rule fail SILENTLY when missing?
  **A regex reading of CSS is not what the browser sees.** `tests/contrast.test.js` extracts tokens with a regex and would happily measure a declaration the browser has thrown away, so parse validity needs its OWN guard and cannot be inferred from a token-reading test passing.
- **TypeScript** — pure JavaScript; no plans to migrate.
- **Storybook / component dev environment** — components are developed against the live (DEV) app.

---

## Future work

Pending/deferred work moved to **`ROADMAP.md`** (repo root) — see that file, not
here. Shipped version history lives in `REFACTOR_LOG.md`.

---

*Keep this file lean — it's auto-loaded by Claude Code and attached to fresh threads.*
