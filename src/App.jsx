/**
 * MGT Bookings
 *
 * The version lives in `__APP_SIGNATURE__` below and NOWHERE else. This line
 * used to carry a number of its own and read "Version 14.1" for three majors:
 * a second copy of a fact, kept in step by nothing, which is the defect this
 * file's own Gotchas table names again and again. Read it from the signature.
 *
 * Copyright © 2026 Patryk Zychowicz. All rights reserved.
 *
 * This source code is proprietary and confidential.
 * Unauthorized copying, distribution, modification, or use
 * is strictly prohibited. See the LICENSE file in the repo root.
 *
 * Author:  Patryk Zychowicz
 * Contact: pz.zychowicz@gmail.com
 */
import { useState, useRef, useEffect, useMemo, useCallback, lazy, Suspense } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { auth } from "./firebase";

// ── Phase A extraction (v15-refactor) ────────────────────────────────────────
// Pure data and pure logic moved into ./lib/* modules. Symbols below are now
// imported rather than defined inline. Behaviour and signatures are unchanged.
//
// Phase C2 (v15-refactor): import lists pruned to only what App.jsx actually
// references in its body. Symbols only used inside ./components/* and
// ./lib/* modules are no longer imported here — they're imported directly
// by their own consumers. Eliminates 31 leftover dead imports from B1–B5.
import {
  OPEN, CLOSE, KITCHEN_TABLE_LIMIT, BLOCK_BG, S, BTN, R, EMPTY_FORM, hoursFor, weekRange, INDOOR, OUTDOOR, ALL_TABLES, M, T, FW, H, IC, APP_NAME } from "./lib/constants";

import {
  getDur, toMins, genId, sanitizeBlock,
  histEntry, diffBooking,
  isLocked, isActive, statusOrder,
  getBlockSlots, canAssign, getBusy, overlaps, comboCapBest,
  getKitchenLoad,
  applyOpt,
  optimizerActiveFor, syncLiveDurations, applySeatedShift, findFreeSlot, bookingsAfterAction, occupancyEnd, padEnd,
  checkInefficent, findClashes, clashRowId, mergeSpans,
  nowTime,
  lateState, freeingSoon, rankCombosContaining, comboExistsFor,
  undoSnapshots, applyUndo,
  seatedElapsed,
  // v18.0.0 session 7: the length Book Again carries over.
  plannedDuration,
  // v18.0.0 session 7: the seat note's one predicate.
  seatNoteFor,
  // v18.0.0 session 8 (item 3): a booking saved as seated keeps its tables.
  tablesPinned, seatedFitRefusal, pinnedClashParties, pinnedClashRefusal, replacePinnedClashes,
  // v18.0.0 session 8 (C1): and leaving seated puts the booked plan back.
  unseatRestore,
  // v18.0.0 session 8 (C2): and it cannot be seated with no table at all.
  seatRefusal,
  // v18.0.0 session 8 (C3): nor onto a table somebody is still sitting at.
  seatClashParties, completedSeatedPatch,
  // v18.0.0 session 8 (item 5b): the shift, from the booking as it is SAVED.
  seatedShiftFor,
  // v18.0.0 session 8 (C): are the tables it has still usable for this window?
  tablesFreeFor,
  // v18.0.0 session 8 (R5): one rule for "is there a phone here", both callers.
  enteredPhone,
  // v18.0.0 session 8 (R6): does this save change what the kitchen sees?
  kitchenRelevant,
  // v18.0.0 session 8 (C8): what the save toast is allowed to claim.
  savedToast,
  // v18.0.0 session 8 (C7): the last minute a booking may start, and the
  // formatter for it. `toTime` was removed here as a dead import once; it has a
  // caller again.
  lastStartMins, toTime,
  // v18.0.0 phase 6 (CT-WA-01): doSave's write-side half of the predicate
  // `sanitize` already applies on the way IN. See the guard below.
  isReadableTime
} from "./lib/booking-logic";

import { useModalStack, modalMap, topModal, MODAL_Z } from "./hooks/useModalStack";
import { useDismissals } from "./hooks/useDismissals";
import { dirtyDates, reconcile } from "./lib/reconcile";
import { normalizePhone, hasRealPhone, matchesIdentity, stampGuestSeed, resolveGuestId } from "./lib/customers";
import { sameDraft } from "./lib/drafts";
import { READY, DISPATCHED, mayDispatch } from "./lib/submitGuard";
import { hourLabel, spanZoom } from "./lib/time-grid";
// v17.8.0: the waitlist placement pass — pure, extracted from this file so it
// can be unit-tested (tests/waitlist-match.test.js).
import { placeWaitlist } from "./lib/waitlist-match";


// ── Phase B1 (v15-refactor): UI atoms extracted to ./components/atoms.jsx ──
// First component file in the codebase using JSX syntax. App.jsx now also
// uses JSX (Phase C3b) so the original B1 note about RC()-vs-JSX
// compatibility no longer applies — both files share a single style.
import { DateField, Overlay, ModalTitle, mkBtn, mkSolidBtn, Reveal, Presence, ModalPresence, SlideView } from "./components/atoms";
// v17.3.4: the two notification-layout render units (state stays in BookingApp).
import { StatusToasts } from "./components/StatusToasts";
import { appBannerSections } from "./components/AppBanners";
import { NotificationStrip } from "./components/NotificationStrip";


// ── Phase B2 (v15-refactor): secondary modals ─────────────────────────────
// ManualModal (assign/swap UI) and BlockModal (table-level block editor)
// extracted to ./components/. JSX. TableGrid is consumed by both modals
// internally; no longer imported by App.jsx directly (v14.1.13 cleanup).
import { ManualModal } from "./components/ManualModal";
import { BlockModal }  from "./components/BlockModal";

// ── Phase B3 (v15-refactor): Settings modal tree ──────────────────────────
// SettingsContent (modal body), TabBar, GeneralTabContent and CogIcon
// extracted to ./components/Settings.jsx. The Reminders tab body and the
// Shortcuts cheatsheet live in ./components/Reminders.jsx and Shortcuts.jsx
// respectively (each imported transitively by Settings.jsx — App.jsx only
// needs SettingsContent). ReminderEditor (modal at z-index 250)
// gets its own file because it's a top-level modal, mirroring how
// ManualModal and BlockModal were treated in B2.
// v17.1.0 (Tier 3 code-splitting): the Settings modal tree (5 tab bodies +
// the floor-plan editor) is the largest UI subtree that is NOT needed at
// startup — it now loads as a lazy chunk on first open. SETTINGS_TABS (the
// keyboard-nav tab cycle) is imported by useKeyboardShortcuts.js (v17.3.3) —
// App.jsx itself keeps no static dependency on the Settings chrome.

// v17.1.0 /code-review fix #1 — resilient lazy loader. A rejected chunk fetch
// almost always means the deployment changed under an open tab (Vercel serves
// only the CURRENT build's hashed assets, so after a deploy the old URLs 404 —
// and tablets here stay open for days). Without this, the first tap on ⚙/M//"/"
// after a deploy would hit an unhandled rejection with no error boundary and
// blank the whole app mid-service. On failure: reload ONCE to pick up the new
// build (sessionStorage flag prevents a reload loop if the network is really
// down) and render a readable fallback meanwhile. A successful load clears the
// flag so a LATER genuine failure can reload again.
function lazyChunk(load,name){
  return lazy(function(){
    return load().then(function(m){
      try{sessionStorage.removeItem("mgt-chunk-reload");}catch{/* ignore */}
      return m;
    }).catch(function(err){
      console.error("[chunk] failed to load "+name,err);
      try{
        if(!sessionStorage.getItem("mgt-chunk-reload")){
          sessionStorage.setItem("mgt-chunk-reload","1");
          window.location.reload();
        }
      }catch{/* ignore */}
      return {default:function ChunkLoadError(){
        return <div style={{padding:16,fontSize: T.body,fontWeight: FW.semi,color:"var(--danger-text)"}}>Couldn’t load this screen — the app may have been updated. Please reload.</div>;
      }};
    });
  });
}
const SettingsContent = lazyChunk(function(){return import("./components/Settings").then(function(m){return {default:m.SettingsContent};});},"Settings");
// v18.0.0 phase 3: LAZY, and measured. A static import here put the whole
// Admin panel in the STARTUP bundle — 98.74 → 104.13 kB gz — because App
// imports it while `Settings.jsx` only imports it lazily, so the one static
// reference wins and the v17.1.0 lazy-Settings split is defeated for a screen
// almost nobody opens. It resolves to the SAME chunk `Settings.jsx` pulls, so
// by the time the Admin tab can be reached it is already fetched and the
// Suspense fallback never paints.
const RolesModal = lazyChunk(function(){return import("./components/AdminSettings").then(function(m){return {default:m.RolesModal};});},"Capabilities");
// v18.0.0 session 8: the activity log, lazy for the same reason as the panel
// above — it is reachable only from the Admin tab, and a static import here
// would pull it into the startup bundle for a screen almost nobody opens.
// Mapped to `{default: …}` rather than handed the module namespace: `lazyChunk`
// wants a default export and a bare namespace throws "Cannot convert object to
// primitive value" from inside <Lazy>, naming neither the component nor the
// cause (the v18.0.0 phase 5b trap).
const ActivityLogModal = lazyChunk(function(){return import("./components/ActivityLogModal").then(function(m){return {default:m.ActivityLogModal};});},"Activity log");
import { ReminderEditor }          from "./components/ReminderEditor";

// ── Phase B4 (v15-refactor): Timeline + List views ────────────────────────
// TimelineView (the Gantt-style scrollable grid) and ListView (the sorted
// card list) extracted to ./components/. JSX style. App.jsx renders them
// as JSX elements (Phase C3b). CogIcon (originally imported by App.jsx in
// B3) moved to TimelineView's imports because TimelineView is its only
// consumer.
import { TimelineView } from "./components/TimelineView";
import { ListView }     from "./components/ListView";
import { Summary }      from "./components/Summary";
// v17.9.0: CogIcon comes straight from Icons.jsx now, not via SettingsChrome's
// re-export. The re-export exists to keep the LAZY-Settings boundary intact for
// importers that predate the move; App has no reason to go the long way round,
// and Icons.jsx has no imports of its own to drag into the startup chunk.
import { BellIcon, BellRingIcon, ChevronLeftIcon, ChevronRightIcon, ClashIcon, CogIcon, LateIcon, NoShowIcon, OverlapIcon, SearchIcon, VoucherIcon, WaitIcon } from "./components/Icons";
// v17.5.0: Split View — the T/L/P buttons + their long-press/RMB gesture and
// split toolbar (ViewSwitcher), the two-pane container (SplitLayout) and the
// three-step setup popup (SplitMenu).
import { ViewSwitcher }  from "./components/ViewSwitcher";
import { SplitLayout }   from "./components/SplitLayout";
import { SplitMenu }     from "./components/SplitMenu";
const WeekView = lazyChunk(function(){return import("./components/WeekView").then(function(m){return {default:m.WeekView};});},"WeekView"); // v17.1.0: lazy (opened on demand)
import { LateBanner }   from "./components/LateBanner";
import { OverlapBanner } from "./components/OverlapBanner";
import { ClashBanner } from "./components/ClashBanner";
import { ConnectionStatus } from "./components/ConnectionStatus";

// ── Phase B5 (v15-refactor): Final modal & screen extraction ──────────────
// LoginScreen (the unauthenticated entry screen), WalkinForm (the walk-in
// flow), PrefPickerModal (the preferred-tables soft-hint picker), and
// HistoryPopup (the per-booking audit trail) extracted to ./components/.
// JSX style. App.jsx renders them as JSX elements (Phase C3b). The original
// B5 deferral of BookingForm was resolved in Phase E1 (v14.1.12) — see
// BookingFormModal import below.
import { LoginScreen }     from "./components/LoginScreen";
import { WalkinForm }      from "./components/WalkinForm";
import { PrefPickerModal } from "./components/PrefPickerModal";
import { HistoryPopup }    from "./components/HistoryPopup";

// ── Phase E1 (v14.1.12): Booking form modal extracted ─────────────────────
// `<BookingFormModal>` owns the form modal's render tree and all derivations
// that exist only to feed it (formAvail, tablesBtn, kitchenSection, etc.).
// First component-shape extraction since Phase B5 — the deferred-from-B5
// piece. Controlled-component pattern matching WalkinForm: form draft +
// lifecycle handlers stay in BookingApp; the component fires callbacks.
// 14 props total. The "18+ prop API" warning from the B5 deferral note
// turned out conservative — callback-shaped triggers (onOpenPrefPicker
// vs setShowPrefPicker, etc.) compressed the surface meaningfully.
import { BookingFormModal } from "./components/BookingFormModal";


// ── Phase C2 (v15-refactor): custom hooks extracted to ./hooks/ ───────────
// `useWinW` (viewport-width hook used to compute isMobile) moved out of
// App.jsx. One hook per file in src/hooks/, mirroring the components/
// pattern. No barrel index — explicit imports keep dependencies visible.
import { useWinW } from "./hooks/useWinW";

// ── v14.2.0: Dark-mode theming hook ───────────────────────────────────────
// `useThemeMode(explicitPref)` -> isDark, writing <html data-theme>. Ported
// from MGT Scheduling (same cross-app contract). Preference source is
// per-device localStorage (Bookings has no Firebase settings node) — read via
// readThemePref() below and written by the Settings toggle. The no-flash
// script in index.html paints the theme before React mounts.
// See MGT_Bookings_dark-mode_PORT_INSTRUCTIONS.md.
import { useThemeMode } from "./hooks/useThemeMode";

// ── Phase D1 (v14.1.8): Firebase persistence subsystem extracted ──────────
// `usePersistence` owns bookings, tableBlocks, all write-guards, the four
// Firebase listeners, and the auto-extend effect. Returns the values and
// savers BookingApp consumes. Args: {autoOptimizer, nowMins} — both now
// sourced from D3 hooks below; hook signature unchanged.
import { usePersistence } from "./hooks/usePersistence";
import { usePresence } from "./hooks/usePresence";

// ── v14.4.0 / v15.0.0: Operating-hours subsystem (Settings → General) ───────────
// `useOperatingHours(viewDate)` owns the editable PER-WEEKDAY schedule, persisted
// to Firebase (settings/operatingHours — the app's FIRST settings node, shared
// across devices) and applies the ACTIVE view-day's hours to constants.js's live
// OPEN/CLOSE/GRID_CLOSE bindings so the timeline grid + form time limits track the
// viewed day. Returns {weekHours, saveDayHours, saveAllDays}.
import { useOperatingHours } from "./hooks/useOperatingHours";
import { useDayShifts } from "./hooks/useDayShifts";
import { useOptimizerSettings } from "./hooks/useOptimizerSettings";

// ── v16.1.0: Booking-defaults subsystem (Settings → General) ───────────────
// `useBookingDefaults` owns the 5th settings node (settings/bookingDefaults):
// size→duration tiers (feeds getDur via the DUR_TIERS live binding) + the
// running-late thresholds (feed the lateMap derivation below).
import { useBookingDefaults } from "./hooks/useBookingDefaults";
// v17.0.0: `useGeneralSettings` owns the 6th settings node (settings/general):
// restaurant name, currency symbol, phone prefix, Regular threshold, late-
// banner collapse threshold, waitlist match window, undo-toast duration —
// the ex-hard-coded literals from the multi-tenancy configurability pass.
import { useGeneralSettings } from "./hooks/useGeneralSettings";
// v17.6.0: per-user preferences (settings/users/{uid}/prefs) — the first
// settings node that is NOT restaurant-wide. See useUserPrefs.js for what
// syncs, what stays per-device, and why the localStorage mirror stays.
import { useUserPrefs, PREF_SPEC, PREF_NAMES, readPrefValue, prefLocalValue } from "./hooks/useUserPrefs";
import { useLayout } from "./hooks/useLayout";

// ── Phase D2 (v14.1.9): Reminder subsystem extracted ──────────────────────
// `useReminders` owns reminders + reminderFires state, editor + delete-confirm
// state, write-guards, both Firebase listeners, the prune and 30s-tick effects,
// all action handlers, and the banner derivation + JSX. Args:
// {nowMins, setWriteWarning} — nowMins for banner re-evaluation, setWriteWarning
// (from usePersistence) so reminder save-refusals share the same banner.
import { useReminders } from "./hooks/useReminders";

// ── Phase D3 (v14.1.10): Time tick + optimizer thermostat extracted ───────
// `useNowMins` owns the 15s wall-clock tick that drives seated-duration math,
// banner re-evaluation, and downstream hook dep arrays. No args; returns just
// { nowMins }. Setter stays internal — nothing outside the tick effect writes.
import { useNowMins } from "./hooks/useNowMins";
//
// `useAutoOptimizer` owns the optimizer feature flag plus its daily reset:
// auto-off at 15:00 for today's shift, auto-on at new-day-start (before
// 15:00). Args: { nowMins } drives both effects' dep arrays. Returns
// { autoOptimizer, setAutoOptimizer } — both used externally (kbRef + the
// TimelineView legend toggle). Daily-reset refs stay internal.
import { useAutoOptimizer } from "./hooks/useAutoOptimizer";

// ── Phase D4 (v14.1.11): Walk-in subsystem extracted ──────────────────────
// `useWalkin` owns walk-in state (showWalkin / walkinForm / walkinError), the
// today-scoped numbering helper, and the three handlers (openWalkin /
// doSaveWalkin / saveWalkin). Args: {bookings, saveBookings, setViewDate,
// getUser, confirmKitchen, setConfirmKitchen}. confirmKitchen is shared
// state owned by BookingApp because doSave (booking-form save) also raises
// the same modal — identical pattern to D2's setWriteWarning sharing. The
// walk-in modal mount JSX and the shared confirm-kitchen modal stay in
// BookingApp.
import { useWalkin } from "./hooks/useWalkin";

// ── v16.0.0: Waitlist ───────────────────────────────────────────────────────
// useWaitlist owns the Firebase `waitlist` node (6th collection, reminders-
// pattern write-guard); WaitlistPanel is the Overlay listing the viewed day's
// entries. Active matching (does a table currently fit each entry?) is a
// BookingApp effect → `waitAvail` state, derived via trialFits, not persisted.
import { useWaitlist } from "./hooks/useWaitlist";
// v18.0.0: gift vouchers — the 8th persisted collection, `/vouchers/{CODE}`
// keyed by the code itself so uniqueness is a property of the storage. Its
// write path is the /bookings per-child CAS, not the whole-node revGuard one;
// see the hook's header for why the data forces that. `useVoucherDefaults`
// owns the 9th settings node (settings/voucherDefaults): the default validity
// period, edited in the Vouchers tab because a voucher setting belongs where
// vouchers are.
import { useVouchers } from "./hooks/useVouchers";
import { useRoles } from "./hooks/useRoles";
import { capLabel } from "./lib/roles";
import { useVoucherDefaults } from "./hooks/useVoucherDefaults";
// v18.0.0 session 8: the activity log. `useActivityLog` installs the module-level
// sink every writer emits into; `useActivityFeed` is the app's first Firebase
// QUERY, and is attached only while the log is open.
import { useActivityLog, useActivityFeed, redactGuest, pruneActivity } from "./hooks/useActivityLog";
// v18.0.0 session 8 (item 7): `attachRefusal` — Book Again pre-attaches the
// source visit's voucher, and only when the same rule the picker applies allows
// it, so the form never opens holding an attachment Save would refuse.
import { normalizeCode, isRedeemedBy, voucherState, isUnsettled, remainingOf, money, formatCode, attachRefusal, carryTarget } from "./lib/vouchers";
import { hideWarning } from "./lib/modules";
import { VoucherRedeemModal } from "./components/VoucherRedeemModal";
import { SeatNoteModal } from "./components/SeatNoteModal";
import { SeatClashModal } from "./components/SeatClashModal";
import { VoucherCarryModal } from "./components/VoucherCarryModal";
import { UnsettledBanner } from "./components/UnsettledBanner";
import { useRecurring } from "./hooks/useRecurring";
// v17.3.3: the global keyboard shortcuts + the neutral-space List-deselect
// listener (the whole kbRef machinery) live in useKeyboardShortcuts.js now.
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { WaitlistPanel } from "./components/WaitlistPanel";
import { WaitAvailBanner } from "./components/WaitAvailBanner";
const SearchPanel = lazyChunk(function(){return import("./components/SearchPanel").then(function(m){return {default:m.SearchPanel};});},"SearchPanel"); // v17.1.0: lazy (opened on demand)
import { PlanView } from "./components/PlanView"; // v17.0.0: the floor-plan view
import { DaySheet } from "./components/DaySheet";
import { readSwEnabled, setSwEnabled, applyServiceWorker } from "./lib/serviceWorker";
// v18.0.0 session 8 (C7): WEEKDAY_LONG — one list, four ex-copies.
import { todayStr, stepDate, WEEKDAY_LONG, dayRangeMs } from "./lib/day";

// ── WhatsApp Inbox (parallel sandbox, NOT yet a shipped feature) ──────────────
// `useWhatsApp` owns the DEV-Firebase WA data layer (conversations/messages/
// templates) + every inbox handler + the draft→form seam. InboxPanel is the
// inbox overlay. WaSimulator + the wa-sim modules are the SANDBOX-ONLY local
// stand-in for the (deferred) Meta webhook + LLM — every simulator surface is
// gated behind WA_SANDBOX (dev server, or a deployed sandbox build with
// VITE_FB_TARGET=dev) so it can never appear in a real production build.
import { useWhatsApp } from "./hooks/useWhatsApp";
import { useWaSettings } from "./hooks/useWaSettings";
import { InboxPanel } from "./components/whatsapp/InboxPanel";
// v18.0.0 phase 5b — the simulator does not reach production through a STATIC
// import. Measured on the phase-5a build: `WA_SANDBOX` folds to `false` and
// Rollup did strip the WaSimulator COMPONENT (none of its UI strings survive),
// but `lib/wa-sim.js`, `lib/wa-sim-scenarios.js` and `lib/wa-backend.js` shipped
// anyway — `fetch("/api/wa-sim-inbound")`, the `[waSim]` logging and the fixture
// phone numbers were all in `dist/`. So the effect's old comment ("the whole
// effect is dead-code-eliminated in a real prod build") was half true, in the
// half nobody had checked. A dynamic import inside the dead branch is not an
// optimisation here: it is what makes the claim structurally true, because an
// `import()` Rollup can prove unreachable emits no chunk at all.
// `{default: m.WaSimulator}` like the four lazyChunk call sites above it, and NOT
// the bare module: `WaSimulator` is a NAMED export, React.lazy wants a default,
// and handing it a module namespace object throws "Cannot convert object to
// primitive value" from inside <Lazy> — a crash with no mention of the export
// shape anywhere in it. Caught by opening the simulator, not by build or lint.
const WaSimulator = lazyChunk(function(){return import("./components/whatsapp/WaSimulator").then(function(m){return {default:m.WaSimulator};});},"WaSimulator");
import { WA_SANDBOX } from "./lib/waSandbox";


// ── App fingerprint (do not remove) ──────────────────────────────────────────
// Module-level identity record. Survives bundling/minification — the strings
// below remain readable in any deployed bundle. Referenced by the boot banner
// (window assignment + console.log) so the bundler cannot tree-shake it.
// Forensic evidence of origin if this code appears in an unauthorized deployment.
const __APP_SIGNATURE__={
  app:APP_NAME,
  version:"18.0.0",
  author:"Patryk Zychowicz",
  contact:"pz.zychowicz@gmail.com",
  copyright:"© 2026 Patryk Zychowicz. All rights reserved.",
  license:"Proprietary — All rights reserved. See LICENSE.",
};
if(typeof window!=="undefined"){window.__MGT_BUILD__=__APP_SIGNATURE__;}

// v17.3.3: SUMMARY_KEY ("s") and WEEK_KEY ("m") moved into
// hooks/useKeyboardShortcuts.js with the handler that reads them — rebind there
// (+ the Shortcuts rows).

// v17.4.0 /code-review: prev-identity memo for a save transform. The synchronous
// guard checks and the immediate saveBookings dispatch call the transform with
// the SAME `prev` reference, so they share ONE optimizer pass; a retry replay
// arrives with a FRESH prev and correctly recomputes (the v15.7.0
// capture-intent-then-replay contract). Was hand-rolled in four places.
function memoByPrev(fn){
  let mPrev=null,mFin=null;
  return function(prev){if(prev===mPrev) return mFin;const r=fn(prev);mPrev=prev;mFin=r;return r;};
}

// ── v17.9.0: DEV-only theme override ──────────────────────────────────────────
// Since v17.6.0 the theme follows the signed-in ACCOUNT (settings/users/{uid}/
// prefs), and that overrides both localStorage["mgt-theme"] and OS emulation. So
// looking at dark mode meant toggling it in Settings — i.e. WRITING to the real
// user's saved preferences to inspect a colour. v17.8.0's contrast pass avoided
// that by computing ratios against the token values instead, which is sound, and
// is not the same thing as looking at the screen.
//
// `?theme=dark` / `?theme=light` forces the theme for one page load. It is inert
// in production twice over: Vite strips the `import.meta.env.DEV` branch from the
// bundle, and index.html's no-flash script (which has no import.meta.env of its
// own) gates on hostname.
//
// The NON-write is the whole point. While an override is live the prefs-seeding
// effect skips its theme branch and onToggleDark skips saveUserPrefs, so a theme
// check leaves the signed-in user's node exactly as it found it.
function devThemeOverride(){
  if(!import.meta.env.DEV) return undefined;
  try{
    const v=new URLSearchParams(window.location.search).get("theme");
    if(v==="dark") return true;
    if(v==="light") return false;
  }catch{/* ignore */}
  return undefined;
}
// Read once at module load: the override is a property of how the page was
// opened, so it cannot change without a reload.
const DEV_THEME_FORCED=devThemeOverride()!==undefined;

// ── v14.2.0: Dark-mode preference reader ──────────────────────────────────────
// Per-device theme lives in localStorage["mgt-theme"]. Returns the explicit
// preference for useThemeMode: true (dark) | false (light) | undefined (follow
// the OS live — which is also what "auto", v18.0.0's Automatic dark mode, reads as). MUST
// mirror the no-flash inline script in index.html — same key,
// same value convention ("dark"/"light"), and since v17.9.0 the same
// ?theme= override, which wins over the stored key at both sites.
function readThemePref(){
  const forced=devThemeOverride();
  if(forced!==undefined) return forced;
  try{
    const v=localStorage.getItem("mgt-theme");
    if(v==="dark") return true;
    if(v==="light") return false;
  }catch{/* ignore */}
  return undefined;
}

// v17.0.0 correction: per-device max app width (px). localStorage like the
// theme — screen size is a device property, not restaurant config. The 1.08
// hover-scale lift overflowed the viewport at a fixed 1600 on smaller
// monitors, so the width is a Settings→General stepper (900–2400, step 50).
// Round 3: no stored value → default to THIS screen's width minus 150px
// margins each side (rounded to 50), so the app fills the browser out of the
// box without ever overflowing it.
const APP_WIDTH_MIN=900, APP_WIDTH_MAX=2400;

// v17.1.0 /code-review fix #3 — stable empty results for the memoized
// derivations' early-exit paths (non-today / feature-off). A fresh {}/[] per
// compute is a NEW identity every minute tick, which busts the views'
// React.memo for zero visual change; these shared consts keep it stable.
const EMPTY_OBJ=Object.freeze({});
const EMPTY_ARR=Object.freeze([]);
// v17.14.0: the ✕-dismissal Sets emptied on a day change. "clash" is absent on
// purpose — it prunes against its own live pairs, which covers the date change
// too (see useDismissals.js).
const DAY_DISMISS_KEYS=Object.freeze(["late","overlap","wait"]);

// ── The two chrome icon buttons (v17.9.0) ────────────────────────────────────
// Find-a-booking and Settings. v17.0.0 round 8 put them in ONE pair in the
// date-nav row so all three views shared them; v17.9.0 (Patryk) splits them by
// what they act on rather than by what they look like. Settings leads the title
// block — it configures the restaurant those two lines describe (its name, its
// tables, its opening hours). Search joins the action cluster on the right,
// between "+ New" and the connection dot — finding a booking is something you
// DO, like adding one.
//
// The style stays 36×36 on --cog-bg per v17.8.0's "44 is a floor, not a target":
// both are still secondary chrome, now sitting beside 40px primary pills, and
// equal width/height is what keeps --r-pill a true circle rather than an egg.
//
// A module const in App.jsx rather than an atom or a surviving ViewTools.jsx:
// both call sites are in this file, and exporting a style that nothing else
// reads is distance, not sharing (the lib/time-grid.js lesson).
const CHROME_BTN={
  background:"var(--cog-bg)",
  border:"1px solid var(--cog-border)",
  borderRadius:R.pill, width:36, height:36,
  cursor:"pointer",
  display:"flex", alignItems:"center", justifyContent:"center",
  flexShrink:0, padding:0,
  color:S.text,
  boxShadow:"var(--shadow-btn)"
};

// ── How far the date controls sit below the top of their row (v17.9.1) ────────
// The date-nav row's height is set by the Summary card beside the controls: 58px
// collapsed, ~210 open. The controls are 40. So "centred while collapsed" is
// exactly (58 - 40) / 2 = 9px below the top, and "aligned to the header" when
// open is 0 — both measured live, not derived from the card's padding.
//
// It is a translateY rather than the `alignItems` flip v17.9.0 shipped, because
// `align-items` is not an animatable property and the flip resolves against the
// row's height IN THE FRAME IT HAPPENS. On collapse that height is still 210, so
// `center` put the controls at (210-40)/2 = +85 — an 85px jump DOWN — and they
// then rode back up to +9 as the summary's Reveal eased the row shut. That is
// the reported "they jump to the bottom and come back". Opening had the same
// defect at 9px, small enough to read as a snap rather than a bug.
//
// A constant works because it is measured against the COLLAPSED row, which does
// not move; the open row's height is irrelevant to it. Transform is also
// compositor-only, so this eases without reflowing a row whose sibling is the
// timeline. Reduce-motion needs nothing: index.html's data-motion="reduce" block
// zeroes transition-duration with !important, which beats an inline transition.
const DATE_CTRL_DROP=9;
function readAppWidth(){
  try{
    const v=parseInt(localStorage.getItem("mgt-appwidth"),10);
    if(Number.isFinite(v)&&v>=APP_WIDTH_MIN&&v<=APP_WIDTH_MAX) return v;
  }catch{/* ignore */}
  const w=Math.round((window.innerWidth-300)/50)*50;
  return Math.max(APP_WIDTH_MIN,Math.min(APP_WIDTH_MAX,w));
}

// v17.5.0: the persisted Split View, per device. Restored on load so a split
// survives a reload/redeploy — losing your layout on every refresh would make
// the feature not worth setting up.
const SPLIT_KEY="mgt-split";   // also PREF_SPEC.splitEnabled.clears — keep in step
// v17.14.0: read one of the four boolean prefs off this device, per its
// PREF_SPEC convention. The try/catch is the same one the four initializers
// each carried; the default on a throw is the pref's own default, which is
// exactly what an absent key means.
function readPrefLS(name){
  const spec=PREF_SPEC[name];
  try{return readPrefValue(spec.store,localStorage.getItem(spec.ls));}
  catch{return readPrefValue(spec.store,null);}
}
// The canonical view order — drives the slide direction on a view switch AND
// validates a restored split. useKeyboardShortcuts keeps its own VIEW_ORD for
// the same purpose; keep the two identical if a view is ever added.
const VIEW_ORD=["timeline","list","plan"];
// Validate HARD, and return null on anything unexpected: a hand-edited or
// half-written key must never be able to wedge the app in a broken layout, and
// the same view appearing twice would collide on the singleton per-view state
// (timelineZoom / selectedListId / showFinished).
function readSplit(){
  try{
    if(!readPrefLS("splitEnabled")) return null;   // master switch off — v17.14.0: was a
    // second hand-written read of the same key, which is the drift PREF_SPEC exists to stop.
    if(typeof window!=="undefined"&&window.innerWidth<600) return null; // tablet/desktop only
    const s=JSON.parse(localStorage.getItem(SPLIT_KEY)||"null");
    if(!s||typeof s!=="object") return null;
    if(VIEW_ORD.indexOf(s.a)===-1||VIEW_ORD.indexOf(s.b)===-1||s.a===s.b) return null;
    if(s.dir!=="v"&&s.dir!=="h") return null;
    const r=Number(s.ratio);
    return {a:s.a,b:s.b,dir:s.dir,ratio:Number.isFinite(r)&&r>=0.2&&r<=0.8?r:0.5};
  }catch{return null;}
}

// ── v17.11.0: a Timeline needs horizontal room, and a side-by-side split
// halves exactly the dimension it needs most ────────────────────────────────
// The `winW < 600` gate above already says "a view needs room, and a Timeline in
// a ~180px pane is unusable". That reasoning is about the PANE and was only ever
// applied to the WINDOW. Measured live at 1280px in a 50/50 side-by-side split:
// the Timeline's own scroller is **371px against a 2896px grid — 13% of the
// service visible at once**.
//
// Scrolling a timeline is normal; that is not the complaint. The complaint is
// that a half-width Timeline can show you the whole day OR readable blocks and
// never both, and the view exists to do both — "where does the evening stand" is
// the question it answers.
//
// The number is derived, not chosen. Measured on the live DOM, a pane loses
// ~124px to the table-label column (58) and the card's own padding and gutters
// before the grid starts. On the reference 10-hour day a 90-minute booking is
// 15% of the grid, and v17.9.1's own width budget says a block needs 138px
// (NAME_MIN 55 + the assign handle 41 + the size ring 24 + v17.11.0's status
// mark 18) before its guest name renders at all. 138 / 0.15 = 920px of grid,
// + 124 = 1044. Rounded up to the divider-inclusive figure below.
//
// A STACKED split is always fine — it halves the height, and fewer visible table
// rows is what scrolling is for.
const MIN_TL_PANE=1050;
const SPLIT_DIVIDER_PX=10;
// `tlPane` is "a" or "b" — which side the Timeline is on. Pure, so the menu, the
// view-switcher and the repair effect all ask the same question one way.
function tlPaneOk(appW,dir,ratio,tlPane){
  if(dir!=="v") return true;
  const share=tlPane==="a"?ratio:1-ratio;
  return (appW-SPLIT_DIVIDER_PX)*share>=MIN_TL_PANE;
}

// v17.2.0: per-device Timeline zoom/follow settings (theme pattern — key absent
// = default). Four localStorage keys: mgt-tl-followzoom (zoom the Follow button
// jumps to, was hard-coded 4), mgt-tl-defaultzoom (zoom on app open, was 1),
// mgt-tl-followlead (minutes of past shown behind the now-line while Following,
// was 30) and mgt-tl-maxzoom (the + button's ceiling, was 5). Per-device on
// purpose — zoom comfort depends on the device's screen, like App width.
const TL_SETTING_BOUNDS={
  followZoom:{key:"mgt-tl-followzoom",def:4,min:1,max:10,step:0.5},
  defaultZoom:{key:"mgt-tl-defaultzoom",def:1,min:1,max:10,step:0.5},
  followLead:{key:"mgt-tl-followlead",def:30,min:0,max:120,step:15},
  maxZoom:{key:"mgt-tl-maxzoom",def:5,min:2,max:10,step:0.5}
};
function readTlNum(b){
  try{
    const v=parseFloat(localStorage.getItem(b.key));
    if(Number.isFinite(v)&&v>=b.min&&v<=b.max&&Math.round(v/b.step)*b.step===v) return v;
  }catch{/* ignore */}
  return b.def;
}
function readTlSettings(){
  const B=TL_SETTING_BOUNDS;
  const maxZoom=readTlNum(B.maxZoom);
  // followZoom/defaultZoom can never exceed the configured max zoom.
  return {
    maxZoom:maxZoom,
    followZoom:Math.min(maxZoom,readTlNum(B.followZoom)),
    defaultZoom:Math.min(maxZoom,readTlNum(B.defaultZoom)),
    followLead:readTlNum(B.followLead)
  };
}

// ── Console boot banner ──────────────────────────────────────────────────────
// Logs ownership/version when the app loads. Visible to anyone opening DevTools.
console.log(
  "%c"+__APP_SIGNATURE__.app+" — v"+__APP_SIGNATURE__.version,
  "color:#60a5fa;font-size:18px;font-weight:500;font-family:Menlo,Monaco,Consolas,monospace;padding:2px 0;"
);
console.log(
  "%c"+__APP_SIGNATURE__.copyright,
  "color:#9ca3af;font-size:13px;font-family:Menlo,Monaco,Consolas,monospace;"
);
console.log(
  "%cUnauthorized use, copying, redistribution, or modification is prohibited.",
  "color:#9ca3af;font-size:12px;font-family:Menlo,Monaco,Consolas,monospace;"
);

// ── Version history ─────────────────────────────────────────────────────────
// Full detail for each entry below lives in REFACTOR_LOG.md at repo root.
// Pre-D1 entries are one-line summaries; D1 onward are detailed in-place
// because they describe live architectural decisions still relevant to the
// current file's structure.
// v14.1:   Connection-status banner; IP protection layer (header, LICENSE,
//          fingerprint, console banner, visible credit in Settings).
// v14.1.1: File-split refactor complete (Phases B1–B5).
// v14.1.2: Phase C1 helper consolidation — getCapOf/pct/statusOrder/liveDur/
//          nowTime promoted to lib/booking-logic.js; Follow button label fix.
// v14.1.3: Phase C2 — useWinW hook extracted; 31 dead imports cleaned up.
// v14.1.4: Phase C3a — 380 `var` → const/let; 38 useState patterns collapsed.
// v14.1.5: Phase C3b — RC(...) call sites converted to JSX via AST codemod.
// v14.1.6: Phase C3b.1 — dead `const RC=React.createElement;` removed; default
//          React import dropped (automatic JSX runtime per @vitejs/plugin-react v6).
// v14.1.7: Phase C3-tail — comment drift cleanup; prettier pass explicitly
//          declined to preserve the file's compact style.
// v14.1.8: Phase D1 — Firebase persistence subsystem extracted from
// BookingApp into ./hooks/usePersistence.js. Owns `bookings`,
// `tableBlocks`, the four write-guard refs (bookingsLoaded, blocksLoaded,
// firstLoadCount, hasConnectedRef), the connection-status state pair,
// `saveBookings`/`saveBlocks`, all four Firebase real-time listeners,
// and the auto-extend effect (kept inside the hook so the write-guard
// contract never crosses module boundaries). Hook signature:
// `usePersistence({autoOptimizer, nowMins})` — those two values lived
// in BookingApp until D3 (v14.1.10), when useNowMins/useAutoOptimizer
// extracted them; the hook signature is unchanged. `setWriteWarning`
// is exposed because saveReminders also surfaces through the same
// banner; that seam closed when D2 landed. Pure extraction — zero
// behavioural change. Net −103 lines from App.jsx.
// Note: `remindersLoaded` and `reminderFiresLoaded` write-guard refs
// remain in BookingApp; they belong to D2.
// v14.1.9: Phase D2 — Reminder subsystem extracted from BookingApp into
// ./hooks/useReminders.jsx. Owns the four reminder state slots
// (reminders, reminderFires, reminderEditor, confirmReminderDel) plus
// the anonymous reminderTick; both reminder write-guard refs
// (remindersLoaded, reminderFiresLoaded); both Firebase listeners
// (reminders / reminderFires paths); the prune-old-fires effect; the
// 30s tick that keeps banners snooze-accurate; both guarded write
// helpers (saveReminders / saveReminderFires); all 8 action handlers;
// and the banner derivation + JSX (reminderBanners). Handlers
// markReminderDone and snoozeReminderFire stay internal to the hook —
// only the banner JSX calls them, and the JSX moves with them. Hook
// signature: `useReminders({nowMins, setWriteWarning})`. `nowMins` was
// still owned by BookingApp until D3 (v14.1.10); the hook signature is
// unchanged. `setWriteWarning` comes from usePersistence so reminder
// save-refusals surface through the same banner as booking save-refusals.
// What stays in BookingApp: the confirm-delete Overlay and the
// ReminderEditor modal mount (both use App-scope styling). Imports
// dropped from App.jsx: ref/onValue/set from firebase/database (no
// remaining consumers post-D2), db from ./firebase (auth still
// consumed), and reminderAppliesTo, getActiveReminderBanners,
// pruneOldReminderFires from ./lib/reminders. `validateReminderDraft`
// import stays — App.jsx's keyboard handler reads it at the
// Enter-saves-reminder path. Pure extraction — zero behavioural change.
// Net −112 lines from App.jsx (1502 → 1390); new hook +220 lines. The
// misleading `settingsTab` reference in the old reminder-block comment
// is now correctly attributed elsewhere.
// v14.1.10: Phase D3 — Time tick and optimizer thermostat extracted
// from BookingApp into two sibling hooks: ./hooks/useNowMins.js and
// ./hooks/useAutoOptimizer.js. useNowMins owns the 15s clock tick;
// no args; returns just { nowMins } (setter stays internal).
// useAutoOptimizer owns the autoOptimizer feature flag plus its
// daily-reset effects (auto-off at 15:00, auto-on at new-day-start),
// guarded by per-day refs so each transition fires once per ISO date.
// Hook signature: `useAutoOptimizer({ nowMins })`. Returns
// { autoOptimizer, setAutoOptimizer } — both used externally (kbRef +
// TimelineView prop). Both hooks are pure-logic (no JSX) → both use
// `.js` per the D2-onward filename rule. Hook signatures of
// usePersistence and useReminders are UNCHANGED — only the source of
// nowMins/autoOptimizer in BookingApp's body shifts from inline-useState
// to destructure-from-hook. Per the Option-A scope decision, the
// optimizer banner stack (state, derivations, handlers, JSX, confirm
// modal) intentionally stays in BookingApp. Pure extraction — zero
// behavioural change.
// v14.1.11: Phase D4 — Walk-in subsystem extracted from BookingApp
// into ./hooks/useWalkin.js. Owns the three walk-in state slots
// (showWalkin, walkinForm, walkinError), the today-scoped "Walk-in N"
// numbering helper (getNextWalkinNum), and the three handlers
// (openWalkin / doSaveWalkin / saveWalkin). Hook signature:
// `useWalkin({bookings, saveBookings, setViewDate, getUser,
// confirmKitchen, setConfirmKitchen})`. Six args is the largest input
// surface in Phase D so far — walk-in is genuinely more entangled
// than the time tick or reminder list, but each dependency is real.
// `setWalkinError` stays internal (only doSaveWalkin writes it; only
// openWalkin clears it). What stays in BookingApp: the walk-in modal
// mount JSX (it threads ~10 props of which 4 are cross-subsystem —
// moving the JSX would just shift prop-routing), the shared
// confirm-kitchen modal (legitimately cross-subsystem — both
// doSave and saveWalkin raise it), and the Walk-in trigger button.
// confirmKitchen state stays in BookingApp because doSave (booking-
// form save) also raises it — same shared-state pattern as D2's
// setWriteWarning. getUser passes in as a function reference so its
// late-binding contract (reads auth.currentUser at call time) is
// preserved. Pure logic, no JSX → `.js` extension.
// Pure extraction — zero behavioural change.
// v14.1.12: Phase E1 — Booking form modal extracted from BookingApp
// into ./components/BookingFormModal.jsx. First component-shape
// extraction since Phase B5; the deferred-from-B5 piece finally
// landed. Mirrors the controlled-component pattern established by
// WalkinForm: form draft state and lifecycle handlers stay in
// BookingApp, the component is a pure render function that fires
// callbacks. 14 props — 8 reads (form, editId, error, bookings,
// liveBookings, tableBlocks, autoOptimizer, isMobile), 1 mutator
// (setForm), 5 callbacks (onSave, onClose, onClearSwap, onBookAgain,
// onRequestCancel), 3 sub-modal triggers (onOpenPrefPicker,
// onOpenManualAssign, onOpenHistory). What moved: the 53-line
// formModal JSX, formAvail/tablesBtn/kitchenSection IIFEs (~150
// lines), quickStatusBtns/historyBtn/bookAgainBtn/returnOfBanner/
// errorEl/resetDurBtn JSX builders (~50 lines), inp/formCols/auto/
// dur/endTime/kitchenLoad/kitchenStarts/kitchenGuests/kitchenBusy/
// kitchenSugg/renderKitchenTimes derivations (~30 lines). What
// stayed: form state (form/editId/error/swapAffected/etc.), the 7
// form handlers (doSave/save/openNew/openEdit/bookAgain/manualAssign/
// doCancelBooking), the two form effects (formRef mirror,
// auto-clear-error), delModal JSX, manualModal mount (cross-view —
// also opened from timeline/list), prefPickerModal mount (small,
// triggered from form via callback but rendered alongside the form
// in z-stack), historyPopup mount (one-liner), and manualBooking
// IIFE (feeds the stayed-in-parent ManualModal). Pure extraction —
// zero behavioural change. Net −323 lines from App.jsx body.
// v14.1.13: Spot-audit + cleanup — pure cosmetic, zero behavioural change.
// 12 dead imports removed (toTime, sanitize, trialFits, findTimes,
// formatSugg, findKitchenFriendlyTimes, Fld, Section, TBadge, AvailBanner,
// mkInp, TableGrid) — all were consumers of the form-modal code that moved
// in E1; AST audit confirmed zero references in post-E1 App.jsx. Stale
// build:"v14.1.9-deployment" field dropped from __APP_SIGNATURE__ (version
// is already the source of truth). v14.1 through v14.1.7 entries above
// compressed to one-line summaries (full detail preserved in
// REFACTOR_LOG.md). Net −80 lines.


// ── Booking App ───────────────────────────────────────────────────────────────
function BookingApp({uid}){
  // ── Phase D1 (v14.1.8): persistence state lives in ./hooks/usePersistence ──
  // `bookings`, `tableBlocks`, write-guards (bookingsLoaded/blocksLoaded/
  // firstLoadCount/hasConnectedRef), connection-status state, saveBookings/
  // saveBlocks, the four Firebase listeners, and the auto-extend effect all
  // moved into the hook. The hook is called below, after useNowMins and
  // useAutoOptimizer (those provide its inputs).
  // ── Phase D2 (v14.1.9): reminder state lives in ./hooks/useReminders ──
  // remindersLoaded / reminderFiresLoaded write-guards moved into the hook
  // along with all reminder state, effects, savers, handlers, and the banner
  // JSX. The hook is called below, after usePersistence (which provides
  // setWriteWarning).
  // ── Phase D3 (v14.1.10): time tick + optimizer thermostat live in
  // ./hooks/useNowMins and ./hooks/useAutoOptimizer. nowMins (15s tick) and
  // autoOptimizer (with its daily reset effects + per-day refs) all moved
  // into those two hooks. The hooks are called first below — useNowMins
  // has no deps; useAutoOptimizer takes nowMins; usePersistence and
  // useReminders consume both with unchanged signatures. The optimizer
  // banner/derivation/handler stack (reshuffled, dismissedIneff,
  // confirmReshuffle, inefficient, overlapWarnings, flash, forceReshuffle,
  // reassignBooking, and the three banner JSX blocks) intentionally stays
  // in BookingApp — those reach into form/view/persistence concerns that
  // aren't yet extracted, and flash() has 8 call sites.
  // ── Phase D4 (v14.1.11): walk-in subsystem lives in ./hooks/useWalkin.
  // The three walk-in state slots (showWalkin/walkinForm/walkinError), the
  // today-scoped Walk-in-N numbering helper, and the three handlers all
  // moved into the hook. Called below after usePersistence (provides
  // bookings/saveBookings) and after confirmKitchen state is declared
  // (passed in as shared state, mirroring D2's setWriteWarning pattern).
  // getUser flows in as a function reference; hoisting keeps the call
  // legal even though getUser is textually declared further down. The
  // walk-in modal mount JSX and the shared confirm-kitchen modal stay
  // in BookingApp.
  // ── Phase E1 (v14.1.12): the booking form modal lives in
  // ./components/BookingFormModal.jsx. First component-shape extraction
  // since Phase B5. Controlled-component pattern: form state and the
  // 7 form handlers (doSave/save/openNew/openEdit/bookAgain/manualAssign/
  // doCancelBooking) stay in BookingApp; the modal is a pure render
  // function that takes 14 props (8 reads + setForm + 5 callbacks +
  // 3 sub-modal triggers). What moved: formModal JSX itself, all
  // form-internal derivations (formAvail, tablesBtn, kitchenLoad/
  // kitchenSection, quickStatusBtns, historyBtn, bookAgainBtn,
  // returnOfBanner, availBanner, errorEl, resetDurBtn, endTime, inp/
  // formCols/auto/dur). What stayed: form state, form handlers, form
  // effects, delModal/manualModal/prefPickerModal/historyPopup mounts,
  // manualBooking IIFE (feeds the stayed-in-parent ManualModal). Sub-
  // modal triggers (PrefPicker, ManualAssign, History) fire via
  // callback from inside the form component back into BookingApp,
  // which then mounts the relevant sub-modal — same z-stack ordering
  // as pre-E1, no behavioural change.
  // Ensure optimal viewport scaling on all devices
  useEffect(function(){
    let meta=document.querySelector('meta[name="viewport"]');
    if(!meta){meta=document.createElement("meta");meta.name="viewport";document.head.appendChild(meta);}
    meta.content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover";
    document.documentElement.style.cssText="height:100%;overflow:hidden;";
    document.body.style.cssText="height:100%;overflow:auto;margin:0;-webkit-overflow-scrolling:touch;overscroll-behavior:none;";
    return function(){document.documentElement.style.cssText="";document.body.style.cssText="";};
  },[]);

  const [view, setView] = useState("timeline");
  // v15.8.0: main-view slide. `slide.k` keys the SlideView wrapper (a bump remounts
  // it → replays the slide); `slide.dir` picks direction. Set by view-toggle + date
  // nav. The two directional classes are the VIEW toggle's: mgt-view-in-left =
  // enters from left (→ "left to right"), mgt-view-in-right = enters from right
  // (→ "right to left"). Date nav has passed mgt-view-fade since v17.15.0 — see
  // `goToDate` below for why it gave up the horizontal axis (/code-review: this
  // comment still named date nav as a source of the directional classes).
  const [slide, setSlide] = useState({ k: 0, dir: "mgt-view-in-left" });
  function bumpSlide(dir){ setSlide(function(s){ return { k: s.k + 1, dir: dir }; }); }
  // v17.15.0: a DATE change does not slide sideways — it fades, and the only
  // thing that moves is the notification strip's own reveal pushing the grid
  // down or up. A date change is the one navigation that also changes the
  // strip, so it is the one that cannot afford a horizontal component: the two
  // compose into a diagonal, and on the steps where the strip LEAVES the grid
  // rises ~150px while sliding sideways, which reads as it heading for a top
  // corner. See the keyframe's note in index.html for why retiming was not the
  // answer. Every date path goes through here — the ‹ › buttons, the date
  // input, Today, the D and arrow keys, the search jump and the week popover —
  // so this is the whole of it. `bumpSlide` keeps its directional classes for
  // the T/L/P switch, which never moves the strip.
  function goToDate(next){ if(next!==viewDate){ bumpSlide("mgt-view-fade"); } setViewDate(next); }
  // v14.4.0: List-view keyboard focus — the booking the A/E/D/S/C/Delete
  // shortcuts act on. ↑/↓ move it; click a card to set it. Null = nothing focused.
  const [selectedListId, setSelectedListId] = useState(null);
  // v15.1.0: List-view "Completed & cancelled" disclosure. Lives HERE (not in
  // ListView) so listDaySorted can exclude the hidden cards while collapsed —
  // keeps ↑/↓ focus and the per-card shortcuts in lockstep with what's visible.
  const [showFinished, setShowFinished] = useState(false);
  // v17.2.0: initial zoom = the per-device "Default zoom" setting (was 1).
  // v17.11.0: …raised to whatever the viewed day's HOURS SPAN needs, until the
  // user touches the zoom controls. See the effect further down; `zoomTouched`
  // is the "until".
  const [timelineZoom, setTimelineZoom] = useState(() => readTlSettings().defaultZoom);
  const zoomTouchedRef = useRef(false);
  // Every USER-driven zoom goes through this: the +/- buttons, the reset, the
  // Follow button, the keyboard shortcuts. It is the only thing that
  // distinguishes "the app picked this" from "the user picked this", and after
  // the first user pick the app stops choosing — a view that re-zoomed itself
  // on every date change would fight whoever was reading it.
  function setTimelineZoomManual(z){
    zoomTouchedRef.current = true;
    setTimelineZoom(z);
  }
  const timelineScrollRef=useRef(0);
  const [followNow, setFollowNow] = useState(false);
  // ── v17.14.0: the modal stack ───────────────────────────────────────────────
  // ONE ordered stack (src/hooks/useModalStack.js) replacing eighteen
  // independent visibility booleans. The names below are DERIVATIONS off it, so
  // every mount site, payload read and setter call in this file is unchanged —
  // what moved is who knows the SET of open surfaces and their ORDER.
  //
  // That was previously spread across eighteen `useState` calls, a hand-written
  // descending Escape chain, a second hand-written chain for Enter, a
  // hand-written `topLayer` expression and a seventeen-term `anyModal`. Nothing
  // held them in step, and `showWaitlist` was missing from four of the five —
  // the waitlist Overlay could not be closed with Esc, did not suppress the
  // single-letter shortcuts, and did not mark the page behind it `inert`.
  //
  // Adding a modal is now: one id in MODAL_Z, one derived name here, one entry
  // in the Escape table in useKeyboardShortcuts. Leaving any of them out is
  // visible; leaving out an Esc branch used to be invisible.
  const { stack: modalStack, setModal } = useModalStack();
  const modalOpen = useMemo(function(){return modalMap(modalStack);},[modalStack]);
  // /code-review: ONE memo holding all eighteen setters, derived from MODAL_Z —
  // not a factory called from eighteen separate `useMemo`s, which was 36 hook
  // slots per render to produce eighteen stable closures. Building them from the
  // z-order list also makes "every modal id has a setter" structural instead of
  // eighteen hand-written lines a test has to police.
  const setModalFns = useMemo(function(){
    const m={};
    MODAL_Z.forEach(function(id){ m[id]=function(v){ setModal(id,v); }; });
    return m;
  },[setModal]);
  const blockTarget = modalOpen.block || null;
  const setBlockTarget = setModalFns.block;
  const [viewDate, setViewDate] = useState(todayStr());
  const showForm = !!modalOpen.form;
  const setShowForm = setModalFns.form;
  const [form, setForm] = useState(EMPTY_FORM);
  const [editId, setEditId] = useState(null);
  const [error, setError] = useState("");
  // v17.12.0: WHICH field the current error is about, or null for a form-level
  // one (capacity, displacement, "could not assign a table"). It exists so the
  // offending control can carry `aria-invalid` and point at the message with
  // `aria-describedby` — the error copy in this app is already specific
  // ("Customer name is required."), it simply was not attached to anything.
  //
  // A sibling state rather than a reshaped `error`: `error` is read as a string
  // at a dozen sites and passed to two components, and the field is additive
  // information. Set ONLY inside doSave's validation, cleared at its entry — so
  // a form-level error later in the same pass correctly leaves it null. Every
  // reader also gates on `error` being truthy, which makes a stale value
  // unreachable rather than merely unlikely.
  const [errorField, setErrorField] = useState(null);
  const confirmDel = modalOpen.del || null;
  const setConfirmDel = setModalFns.del;
  const confirmReshuffle = !!modalOpen.reshuffle;
  const setConfirmReshuffle = setModalFns.reshuffle;
  const confirmCancel = modalOpen.cancel || null;
  const setConfirmCancel = setModalFns.cancel;
  const [reshuffled, setReshuffled] = useState(false);
  // v18.0.0 session 9: the toast's WORDS, captured when the toast is raised.
  // They used to be derived live from `reshuffled` — which is also the 3s
  // visibility timer — so clearing it at +3000ms rewrote the text of a toast
  // that was still on screen for its exit. See `flash`.
  const [reshuffledMsg, setReshuffledMsg] = useState("");
  // The undo pill's note, handed from `flash` to `armUndo` and consumed once.
  // It cannot be read live from `reshuffled` for the same reason the toast's
  // words cannot: the pill outlives that flag by `undoSecs` (10s default).
  const flashNoteRef = useRef("");
  // v15.6.1: transient banner shown when the post-sync reconciliation resolves
  // a same-table overlap that arrived via an offline multi-device merge.
  const [syncFix, setSyncFix] = useState(false);
  // v17.0.0 correction: drag&drop feedback toast — {text, good} or null.
  const [dragMsg, setDragMsg] = useState(null);
  const dragMsgTimer = useRef(null);
  // v18.0.0 phase 3: the capability refusal. Its own slot rather than a reuse of
  // `dragMsg`, which means one specific thing ("drag&drop feedback") and would
  // have stopped meaning it.
  const [permMsg, setPermMsg] = useState(null);
  const permMsgTimer = useRef(null);
  const manualTarget = modalOpen.manual || null;
  const setManualTarget = setModalFns.manual;
  const [dismissedIneff, setDismissedIneff] = useState(null);
  const formRef=useRef(EMPTY_FORM);
  // ── v17.5.0: unsaved-changes guard ──────────────────────────────────────────
  // `formBaseline` holds the draft the form was OPENED with; `openForm` is the
  // ONE way to seed a fresh draft, so the baseline can never drift out of step
  // with the four open paths (openNew / openEdit / bookAgain /
  // bookFromWaitlist). Every OTHER setForm call is a user edit and must NOT
  // touch the baseline — that is the whole signal.
  // STATE, not a ref (cf. formRef above, which exists precisely so handlers can
  // read a FRESH draft): this one is read during render to derive formDirty, so
  // a ref would be the wrong tool — a ref write wouldn't repaint.
  const [formBaseline, setFormBaseline] = useState(EMPTY_FORM);
  // v17.16.0: the commit-once guard resets HERE, and nowhere else. This is
  // already the one door every open path goes through (it sets the
  // unsaved-changes baseline), so the guard cannot be left armed by a path
  // that forgot it — see src/lib/submitGuard.js, sequencing rule 3.
  const saveGuardRef = useRef(READY);
  function openForm(next){saveGuardRef.current=READY;setFormBaseline(next);setForm(next);}
  // Which surface the discard confirm is asking about: "form" | "walkin" |
  // "manual" | "reminder" | "block" | "settings" | null. One shared modal, six
  // callers as of v17.8.0.
  const confirmDiscard = modalOpen.discard || null;
  const setConfirmDiscard = setModalFns.discard;
  // ManualModal owns its table-pick state internally, so it reports dirtiness
  // up rather than App reaching in (see its onDirty prop). v17.8.0: BlockModal
  // and Settings do the same — their drafts are component-local too.
  const [manualDirty, setManualDirty] = useState(false);
  const [blockDirty, setBlockDirty] = useState(false);
  const [settingsDirty, setSettingsDirty] = useState(false);
  // v17.0.0: status override for the pending flow — set by save("pending"/
  // "confirmed") ("Save pending" / "Save&confirm" buttons) and read by doSave.
  // A ref (not an arg) because the kitchen-confirm modal + its Enter shortcut
  // call doSave() with no args after the modal round-trip.
  const statusOverrideRef=useRef(null);
  const [swapAffected, setSwapAffected] = useState(null);
  const confirmKitchen = modalOpen.kitchen || null;
  const setConfirmKitchen = setModalFns.kitchen;
  // v18.0.0: the redeem prompt, raised BY a completion exactly as the kitchen
  // confirm is raised by a save. Payload: {id, status, from:"status"|"form"}.
  const voucherAsk = modalOpen.voucher || null;
  const setVoucherAsk = setModalFns.voucher;
  // v18.0.0 phase 6: the inverse prompt — a completed booking being walked back
  // to Confirmed/Seated while its voucher carries a redemption for this visit.
  const voucherBack = modalOpen.voucherback || null;
  const setVoucherBack = setModalFns.voucherback;
  // v18.0.0 session 7: the seat note — a SNAPSHOT from seatNoteFor, not an id.
  const seatNote = modalOpen.seatnote || null;
  const setSeatNote = setModalFns.seatnote;
  // v18.0.0 session 8 (C3): the seat-clash question, also a SNAPSHOT — taken
  // when the seat was refused, so the card cannot change under the reader.
  const seatClash = modalOpen.seatclash || null;
  const setSeatClash = setModalFns.seatclash;
  // v18.0.0 session 8 (item 7): the carry offer, a snapshot for the same reason.
  const voucherCarry = modalOpen.vouchercarry || null;
  const setVoucherCarry = setModalFns.vouchercarry;
  // v18.0.0 phase 3: the capability grid, opened from the Admin tab. Its
  // payload is the uid whose row is selected — a non-empty string, so the
  // stack's falsy-closes semantics are safe here.
  const rolesFor = modalOpen.roles || null;
  const setRolesFor = setModalFns.roles;
  // v18.0.0 session 8: the activity log. Its payload is just `true` — there is
  // nothing to carry — and the stack's falsy-closes rule makes `null` the close.
  const activityOpen = modalOpen.activity || null;
  const setActivityOpen = setModalFns.activity;
  // Set only while re-entering the completion the modal interrupted, so the
  // gate below asks its question once rather than forever. Cleared in a
  // `finally`, which is what stops a throw in the re-entered action from
  // leaving every future completion un-askable.
  const redeemAskedRef = useRef(false);
  // v18.0.0 session 8 (C3): the seat-clash question's own "already asked" ref.
  // Deliberately NOT shared with the one above, which covers two prompts that
  // cannot both be pending: this one CAN be pending alongside a redeem prompt,
  // because clearing the party at the table is a completion and a completion is
  // exactly what raises that prompt.
  const seatAskedRef = useRef(false);
  const showHistory = !!modalOpen.history;
  const setShowHistory = setModalFns.history;
  const showPrefPicker = !!modalOpen.prefpicker;
  const setShowPrefPicker = setModalFns.prefpicker;
  // v14 preview 3: Settings / keyboard-shortcuts modal. Toggled by the cog
  // icon in TimelineView's legend row and by the `?` keyboard shortcut.
  const showSettings = !!modalOpen.settings;
  const setShowSettings = setModalFns.settings;
  const showSearch = !!modalOpen.search; // v16.3.0: global booking search panel
  const setShowSearch = setModalFns.search;
  const pendingSelectRef = useRef(null); // v16.3.0: booking id to focus in the List after a search-jump changes the day
  // v17.3.1: scroll-into-view REQUEST counter for the List's focused card. A
  // plain click on a card must NOT scroll the page, so ListView scrolls on this
  // counter changing (bumped only at the PROGRAMMATIC selection sites — the
  // search-jump and the ↑/↓ keyboard nav), never on `selectedListId` alone.
  const [listFocusReq, setListFocusReq] = useState(0);
  function bumpListFocus(){ setListFocusReq(function(n){return n+1;}); }
  // v14.6.0: Summary panel expand/collapse (toggled by click or the g shortcut).
  const [summaryOpen, setSummaryOpen] = useState(false);
  // v14.7.0: Week View popover (opened from the Summary panel's Week button).
  const showWeek = !!modalOpen.week;
  const setShowWeek = setModalFns.week;
  // ── WhatsApp Inbox (sandbox) UI state ──────────────────────────────────────
  // 17.15.0-wa-sandbox: the four VISIBILITY flags are entries in the modal stack
  // like every other surface, so they inherit the Escape order, `inert` and the
  // single-letter-shortcut suppression instead of being OR'd into `anyModal` by
  // hand — the arrangement v17.14.0 retired precisely because the hand-written
  // list is the one nobody keeps in step. The names survive as one-line
  // derivations, so nothing below this changes.
  //
  // What stays plain state is what is NOT a surface: the inbox's own filter and
  // the return key. They must survive the inbox CLOSING (Open booking / Apply
  // changes take you to the form and back), which is the opposite of a modal's
  // lifetime.
  const showInbox = !!modalOpen.inbox;
  const setShowInbox = setModalFns.inbox;
  const confirmArchive = modalOpen.waarchive || null;       // phoneKey pending archive-confirm
  const setConfirmArchive = setModalFns.waarchive;
  const confirmDeleteConv = modalOpen.wadelete || null;     // phoneKey pending delete-confirm
  const setConfirmDeleteConv = setModalFns.wadelete;
  const showSim = !!modalOpen.sim;                          // sandbox-only simulator panel
  const setShowSim = setModalFns.sim;
  const [returnToInboxKey, setReturnToInboxKey] = useState(null);   // reopen the inbox here when an overlay closes
  // Inbox filter state lives here (not in InboxPanel) so it survives the inbox
  // round-trip — Open booking / Apply changes close the inbox to show the form,
  // and returning restores the same Needs-action / search state. Reset only on
  // an explicit inbox close (the X / Esc / scrim → closeInbox).
  const [waQuery, setWaQuery] = useState("");
  const [waNeedsAction, setWaNeedsAction] = useState(false);
  // The inbox's real close: the surface plus the state that outlives it. Named
  // because Escape must take the same door as the ✕ and the scrim — a raw
  // `setShowInbox(false)` from the keyboard would leave the filter and the
  // return key set, and the next open would come up filtered for no visible
  // reason. This is `requestClose*`'s shape without a dirty guard; there is no
  // draft here to lose.
  const closeInbox = useCallback(function(){
    setShowInbox(false); setReturnToInboxKey(null); setWaQuery(""); setWaNeedsAction(false);
  },[setShowInbox]);
  // Settings tab state — which tab is active in the Settings modal.
  // Resets to 'general' on modal close so reopens start fresh. Belongs to
  // the Settings subsystem; lived inside the reminder state block pre-D2
  // for historical reasons (the comment misleadingly grouped it there).
  // v17.10.1: per-device offline shell (see lib/serviceWorker.js). Default ON,
  // so only the non-default "0" is ever stored.
  const [swEnabled, setSwEnabledState] = useState(readSwEnabled);
  const swAppliedRef = useRef(false);
  const [settingsTab, setSettingsTab] = useState("general");
  useEffect(function(){formRef.current=form;},[form]);
  // /code-review (v17.12.0): `form.name` belongs in this list and never was.
  // The dep list is what clears a stale error, and the name field was missing
  // from it — so after "Customer name is required." the banner stayed up while
  // the user typed a perfectly good name. Survivable while it was only a
  // banner; not once v17.12.0 turned it into an ASSERTION about the control,
  // because the field then keeps `aria-invalid="true"` and an
  // `aria-describedby` pointing at that message for the whole time it is being
  // corrected, which is the one field where "required" is the only thing that
  // can be wrong.
  useEffect(function(){if(error){setError("");setErrorField(null);}},[form.name,form.time,form.size,form.date,form.preference,form.customDur]);
  // ── Time tick hook ──────────────────────────────────────────────────────────
  // Real-time clock for seated duration. 15s tick. Drives liveBookings, the
  // overlapWarnings derivation, applySeatedShift inside doSave, updateStatus's
  // current-time read, and the dep arrays of usePersistence + useReminders.
  // Phase D3 (v14.1.10). See ./hooks/useNowMins.js.
  const { nowMins } = useNowMins();
  // v17.16.2: TODAY, once per render, for everything that has to put `nowMins`
  // and a booking on one axis (liveBarDur / occupancyEnd / applySeatedShift /
  // lateMins all take it now). A plain string, so passing it into a React.memo'd
  // view compares by value and cannot churn the memo.
  const today = todayStr();
  // ── Optimizer thermostat hook ───────────────────────────────────────────────
  // Auto-off at 15:00 for today's shift; auto-on at new-day-start (before 15:00).
  // Daily-reset refs (autoFlippedRef / autoOnRef) keyed by today's ISO date so
  // each transition fires exactly once per day. Setter exposed because the
  // keyboard 'o' shortcut (via kbRef) and TimelineView's legend toggle (via
  // direct prop) both write to it. Phase D3 (v14.1.10). See
  // ./hooks/useAutoOptimizer.js.
  // v15.0.0: editable optimizer settings (Firebase settings/optimizer, shared) —
  // the daily cutoff hour + the master auto-switch. Mounted BEFORE useAutoOptimizer
  // so its values feed the thermostat. See ./hooks/useOptimizerSettings.js.
  const { optimizerSettings, saveOptimizerSettings } = useOptimizerSettings();
  // v16.1.0: booking defaults — duration tiers + running-late thresholds.
  const { bookingDefaults, saveBookingDefaults } = useBookingDefaults();
  // v17.6.0: the separation between bookings, as a SCALAR for the memoized
  // views. They could read the TURN_BUFFER live binding directly, but
  // React.memo cannot see a live binding — a settings change would not repaint
  // them (the hoursSig/layoutSig problem). A number prop sidesteps it entirely.
  const turnBuffer=bookingDefaults.turnaroundEnabled===true?(Number(bookingDefaults.turnaroundMin)||0):0;
  // v17.0.0: settings/general (6th settings node) — see the import note.
  const { generalSettings, saveGeneralSettings } = useGeneralSettings();
  // v17.6.0: per-user preferences (8th settings node, keyed by uid). The five
  // synced settings each keep their localStorage initializer below — this only
  // OVERRIDES them once the account's node has loaded, and seeds the node from
  // the device when the user has never saved one.
  const { userPrefs, prefsLoaded, saveUserPrefs } = useUserPrefs(uid);
  // A phone value that is empty, a bare "+", or exactly the untouched prefix
  // seed counts as "no phone" (the prefix is a typing convenience, not data).
  // v18.0.0 session 8 (R5): the rule moved to `enteredPhone` in booking-logic
  // so `diffBooking` can apply the SAME one. This stays as the name the save
  // path has used since v17.0.0, and supplies the setting the pure module
  // cannot read.
  function cleanPhoneOf(p){ return enteredPhone(p,generalSettings.phonePrefix); }
  const { autoOptimizer, setAutoOptimizer } = useAutoOptimizer({ nowMins, cutoffMins: optimizerSettings.cutoff*60, autoSwitch: optimizerSettings.autoSwitch });
  // ── Persistence hook ────────────────────────────────────────────────────────
  // Owns bookings/tableBlocks state, Firebase listeners, savers, and the
  // auto-extend effect. Auto-extend needs autoOptimizer + nowMins which are
  // declared above; the hook receives them so its dep array is correct.
  // Phase D1 (v14.1.8). See ./hooks/usePersistence.js.
  const {
    bookings, tableBlocks,
    saveBookings, saveBlocks,
    isOnline, writeWarning, setWriteWarning,
    parkedWrites, retryParked, discardParked,
    loadBannerShown, reconnectShown, resyncing, bookingsReady,
    loadStalled, readError, hasConnected, forceReconnect,
    firstLoadCount,
  } = usePersistence({ autoOptimizer, nowMins });

  // v18.0.0 phase 5: `useRoles` moved UP to here, from below `useVouchers`. It
  // needs only `setWriteWarning` (the line above), and `hasModule` has to be in
  // scope BEFORE any module-gated hook is called — `useWaSettings` and
  // `useWhatsApp` are both gated on it and both used to sit ~150 lines above the
  // old position. A `const` read above its declaration is a TDZ ReferenceError
  // that blanks the whole app with only "An error occurred in <BookingApp>" in
  // the console, and neither lint nor `npm run build` catches it — this file's
  // Gotchas row, hit twice in v17.11.0 alone. Declaring the gate early is the
  // structural answer; moving each gated hook below it is the local one.
  // ── v18.0.0 phase 3: roles, capabilities and the enforcement flag ───────────
  // `can` is the ONE gate the rest of the app asks — never `role === "admin"`,
  // which is a copy of the role map nothing can see and which cannot honour an
  // extra. It also filters SETTINGS_TABS and, through the same function, the
  // ←/→ tab cycle.
  const {
    can, isAdmin, enforceRoles, setEnforceRoles, rows: roleRows,
    // v18.0.0 phase 4 — the module registry. `hasModule` is the gate every
    // module-owned surface asks, and it is checked BEFORE `can`: a module that
    // is off is hidden from everybody including an admin.
    modules, hasModule, setModuleEnabled,
    setRole, setCapability, removeUser, inviteUser, withdrawInvite, applyInvite,
  } = useRoles({
    uid: uid,
    userEmail: (auth.currentUser && auth.currentUser.email) || "",
    setWriteWarning,
  });
  // ONE derivation, passed down as a SCALAR — the `vouchersOn` reasoning below,
  // and for the same memo reason. Every WhatsApp surface asks THIS, never
  // WA_SANDBOX: the sandbox flag is a build-time constant that says "this build
  // may simulate", and the module switch is restaurant data that says "this
  // restaurant uses WhatsApp". Only the SIMULATOR still asks WA_SANDBOX.
  const whatsappOn = hasModule("whatsapp");
  // v18.0.0 phase 5: settings/whatsapp — the module's own restaurant-wide
  // settings (currently just auto-archive-on-complete). Gated on the MODULE now
  // rather than on WA_SANDBOX, so an admin switching WhatsApp on is what
  // attaches the listener, in production as in DEV.
  const { waSettings, saveWaSettings } = useWaSettings({ enabled: whatsappOn });
  // v17.10.1: install (or tear down) the offline shell.
  //
  // The `bookingsReady` gate is the safety property, not a detail. A worker is
  // only ever registered on a device where the app has demonstrably booted AND
  // received its first Firebase snapshot — so a build that cannot load its data
  // can never persist itself into a cache and serve itself back. That is the
  // precise shape of the v17.4.0 failure ("⟳ Loading bookings…" forever), and
  // it is the one condition under which caching a shell is provably safe.
  //
  // Disabling is NOT gated the same way: turning it off must work immediately,
  // on any device, in any state.
  useEffect(function(){
    if(!swEnabled){ applyServiceWorker(false); swAppliedRef.current=false; return; }
    if(!bookingsReady||swAppliedRef.current) return;
    swAppliedRef.current=true;
    applyServiceWorker(true);
  },[swEnabled,bookingsReady]);
  // v17.3.0: real-time device presence (connection-dot popover). Ephemeral node,
  // exempt from the CAS rule — see ./hooks/usePresence.js.
  const { devices: presenceDevices, myKey: presenceKey, offset: presenceOffset } = usePresence();
  // ── v14.4.0 / v15.0.0: Operating hours (Firebase settings/operatingHours, shared) ──
  // Now PER-WEEKDAY. The hook applies the ACTIVE view-day's hours to constants.js's
  // live OPEN/CLOSE/GRID_CLOSE on each render (keyed to viewDate); `weekHours` drives
  // the re-render that repaints the timeline + form time limits. saveDayHours /
  // saveAllDays are wired to the Settings General-tab 7-day editor below.
  const { weekHours, saveDayHours, saveAllDays } = useOperatingHours(viewDate);
  // ── v14.6.0: Day shifts (Firebase settings/dayShifts, shared) ────────────
  // The Afternoon/Evening split hour for the Summary panel — the app's 2nd
  // Firebase settings node. saveDayShifts is wired to the Settings General tab.
  const { dayShifts, saveDayShifts } = useDayShifts();
  // ── v15.0.0: Restaurant layout (Firebase settings/layout, shared) ──────────
  // Owns the editable table layout (id/capacity/zone) + kitchen limit; pushes it
  // into constants.js's live ALL_TABLES/INDOOR/OUTDOOR/TOTAL_SEATS/ZONE_OF/
  // TABLE_GROUPS bindings on each snapshot. saveLayout is wired to the Settings
  // Layout tab. See ./hooks/useLayout.js.
  const { layout, saveLayout } = useLayout();
  // ── WhatsApp Inbox hook (sandbox) ─────────────────────────────────────────
  // Owns conversations/messages/templates (DEV Firebase) + every inbox handler.
  // Form/view handoff setters flow in (controlled pattern, like useWalkin). The
  // draft→form seam: handleAcceptDraft pre-fills the form + flags draftSourceRef;
  // doSave calls wa.completeDraftAccept(newId) on success to flip the conversation.
  // NB (17.5.0 sync): the hook gets `openForm`, NOT raw `setForm` — all three of
  // its form-opening handlers (accept draft / open linked / apply modify) are
  // OPENERS, so they must seed formBaseline like openNew/openEdit do. Passing
  // setForm would leave the baseline stale and make an untouched WA-prefilled
  // form read as dirty, popping "Discard unsaved changes?" on every Cancel/Esc.
  const wa = useWhatsApp({
    enabled: whatsappOn,
    bookings, setWriteWarning, waSettings,
    openForm, setEditId, setError, setSwapAffected, setViewDate, setShowForm, setConfirmCancel,
    setShowInbox, setConfirmArchive, setConfirmDeleteConv, setReturnToInboxKey,
  });
  // Return-to-inbox: when an overlay opened from the WA module (the booking form
  // or the cancel-confirm) closes by ANY path, reopen the inbox at that
  // conversation. returnToInboxKey is cleared only on explicit inbox close.
  useEffect(function(){
    // The module check is the same one the button and the `I` key carry: this is
    // a third door into the inbox and gating two of three is gating none.
    if(whatsappOn&&returnToInboxKey&&!showForm&&!confirmCancel&&!showInbox){setShowInbox(true);}
  },[whatsappOn,returnToInboxKey,showForm,confirmCancel,showInbox]);
  // Sandbox-only console helpers: window.__waSim.*. The ctx is read through a ref
  // so the helpers always see live savers/conversations without rebinding. The
  // whole effect is dead-code-eliminated in a real prod build (WA_SANDBOX false).
  const waSimCtxRef=useRef(null);
  waSimCtxRef.current={
    conversations:wa.conversations, messagesMap:wa.messagesMap, upsertConversation:wa.upsertConversation,
    appendMessage:wa.appendMessage, saveBookings:saveBookings, clearAllWaData:wa.clearAllWaData,
  };
  useEffect(function(){
    if(!WA_SANDBOX) return;
    let cancelled=false;
    const ctx=function(){return waSimCtxRef.current;};
    const todayIso=function(){return new Date().toISOString().slice(0,10);};
    Promise.all([import("./lib/wa-sim"),import("./lib/wa-sim-scenarios")]).then(function(mods){
    if(cancelled) return;
    const simulateInbound=mods[0].simulateInbound;
    const SCENARIOS_BY_ID=mods[1].SCENARIOS_BY_ID;
    const seedSampleBookings=mods[1].seedSampleBookings;
    const clearWaSimBookings=mods[1].clearWaSimBookings;
    const simulateBurst=mods[1].simulateBurst;
    window.__waSim={
      scenario:function(id){const s=SCENARIOS_BY_ID[id];if(s) return s.run(ctx());console.warn("[waSim] unknown scenario:",id,"— try __waSim.list()");},
      custom:function(p){return simulateInbound(p,ctx());},
      newBooking:function(phone,opts){return simulateInbound(Object.assign({phone:phone,language:"es",text:"(sim) reserva",parse:{intent:"new_booking",size:2,date:todayIso(),time:"20:00",confidence:"high"}},opts||{}),ctx());},
      cancel:function(phone,acceptedBookingId){return simulateInbound({phone:phone,language:"en",text:"(sim) need to cancel",parse:{intent:"cancel",confidence:"high"},acceptedBookingId:acceptedBookingId},ctx());},
      modify:function(phone,acceptedBookingId){return simulateInbound({phone:phone,language:"es",text:"(sim) cambiar reserva",parse:{intent:"modify",confidence:"high"},acceptedBookingId:acceptedBookingId},ctx());},
      question:function(phone){return simulateInbound({phone:phone,language:"es",text:"(sim) ¿una pregunta?",parse:{intent:"question"}},ctx());},
      largeGroup:function(phone){return simulateInbound({phone:phone,language:"es",text:"(sim) somos 12",parse:{intent:"new_booking",size:12,date:todayIso(),time:"20:30",confidence:"high"}},ctx());},
      burst:function(){return simulateBurst(ctx());},
      seedBookings:function(){return seedSampleBookings(ctx());},
      clearBookings:function(){return clearWaSimBookings(ctx());},
      clearConversations:function(){return ctx().clearAllWaData();},
      list:function(){return Object.keys(SCENARIOS_BY_ID);},
    };
    console.log("%c[waSim] console helpers ready","background:#a855f7;color:#fff;padding:2px 6px;border-radius:3px;font-weight:bold;","— __waSim.list(), __waSim.seedBookings(), __waSim.scenario(id)");
    }).catch(function(err){console.error("[waSim] failed to load the simulator modules",err);});
    return function(){cancelled=true;try{delete window.__waSim;}catch{/* ignore */}};
  },[]);
  // ── Reminders hook ──────────────────────────────────────────────────────────
  // Owns all reminder state, savers, listeners, handlers, and the
  // reminderBanners JSX. nowMins drives banner re-evaluation; setWriteWarning
  // (from usePersistence above) lets reminder save-refusals share the same
  // banner as booking save-refusals. Phase D2 (v14.1.9).
  // See ./hooks/useReminders.jsx.
  // v17.14.0: the editor and its delete-confirm are two entries in App's modal
  // stack, so App owns them and passes them in — the `confirmKitchen` /
  // `useWalkin` arrangement. Everything about REMINDERS still lives in the hook.
  const reminderEditor = modalOpen.reminder || null;
  const setReminderEditor = setModalFns.reminder;
  const confirmReminderDel = modalOpen.reminderdel || null;
  const setConfirmReminderDel = setModalFns.reminderdel;
  const {
    reminders,
    reminderDirty,
    saveReminderFromEditor,
    doDeleteReminder,
    openNewReminder, openEditReminder,
    deleteReminder, toggleReminderActive,
    reminderBanners, reminderCount,
  } = useReminders({ nowMins, setWriteWarning, reminderEditor, setReminderEditor, setConfirmReminderDel });
  // ── v16.0.0: Waitlist state ─────────────────────────────────────────────────
  const { waitlist, saveWaitlist, addToWaitlist, removeFromWaitlist } = useWaitlist({ setWriteWarning });
  // ── v18.0.0: Gift vouchers ──────────────────────────────────────────────────
  // The email is read during render, the way ConnectionStatus reads it — it is
  // stamped onto `issuedBy`/`by` at write time, and `BookingApp` is keyed on
  // uid, so an account switch remounts the subtree rather than needing this to
  // be reactive.
  const { vouchers, vouchersByCode, issueVoucher, redeemVoucher, unredeemVoucher, voidVoucher } = useVouchers({
    setWriteWarning,
    userEmail: (auth.currentUser && auth.currentUser.email) || "",
  });
  const { voucherDefaults, saveVoucherDefaults } = useVoucherDefaults();
  // ── v18.0.0 phase 4: what a module is about to hide ─────────────────────────
  // The Admin tab asks this on the way OFF, and only this file can answer it:
  // `lib/modules.js` knows what modules EXIST, not what they hold, and keeping
  // it that way is what stops the registry growing a dependency on every
  // feature it switches.
  //
  // Returns a sentence, or null for "nothing to say" — and null is the ordinary
  // case, which matters: a confirm on every switch is a confirm nobody reads.
  // Vouchers is the only module with an answer today because an OPEN voucher is
  // money the restaurant owes, and hiding it is the one consequence of this
  // switch that is not reversible by simply turning it back on — the guest
  // walks in with a voucher nobody can see. WhatsApp has no such stake:
  // switching it off hides conversations, and a conversation nobody reads costs
  // nothing that was not already lost.
  const moduleWarning = useCallback(function (id) {
    if (id !== "vouchers") return null;
    const now = Date.now();
    const open = vouchers.filter(function (v) { return voucherState(v, now) === "open"; });
    if (!open.length) return null;
    const total = open.reduce(function (sum, v) { return sum + remainingOf(v); }, 0);
    return hideWarning(open.length, money(total, generalSettings.currency), "voucher");
  }, [vouchers, generalSettings.currency]);
  // ONE derivation, passed down as a SCALAR. Every view that reads it is
  // `React.memo`'d and a memo cannot see a live binding or a fresh function —
  // the reason `hoursSig`, `layoutSig` and `turnBuffer` are all scalars too.
  const vouchersOn = hasModule("vouchers");
  // ── v16.3.0: Recurring / standing bookings ──────────────────────────────────
  const { recurring, addRule, updateRule, removeRule, addSkipDate, setEnabled: setRecurringEnabled, setHorizon: setRecurringHorizon } = useRecurring({ setWriteWarning });
  // ── v18.0.0 session 8: the activity log ────────────────────────────────────
  // Installing the sink is the whole of the write side here — every writer in
  // the app already emits into it, and until this runs `emitActivity` is a
  // no-op.
  useActivityLog();
  // The day the log is showing. It lives HERE and not inside the modal because
  // the feed lives here too: the listener must detach when the log closes, and
  // a day held inside the modal would unmount with it and take the range with
  // it. Seeded to today, which is the day anybody opening this is asking about.
  const [activityDay,setActivityDay]=useState(todayStr());
  // Local midnight to local midnight: `at` is a wall-clock stamp and the
  // restaurant thinks in local days. Both are primitives derived from one
  // string, so the feed's dep array is stable across renders.
  //
  // v18.0.0 session 10 (/code-review): a date input can be EMPTIED, and the
  // query is the one place in the app where a `viewDate`-shaped string reaches
  // Firebase instead of `lib/day.js`. `new Date("T00:00:00")` is Invalid Date,
  // `.getTime()` is NaN, and `startAt(NaN)` THROWS rather than returning
  // nothing — inside an effect, which the boundary catches by replacing the
  // whole app. Measured live: clearing "Day to show" gave `startAt failed:
  // value argument contains NaN in property 'activity'` and the error screen,
  // from one keystroke on a shipped surface.
  //
  // The day is kept exactly as typed, so the field stays editable while it is
  // being retyped; it is the QUERY that is withheld until the day is readable.
  // The arithmetic itself is `dayRangeMs` (lib/day.js) rather than inline here,
  // so the one call site that must not get it wrong is not also the only place
  // it can be tested.
  const activityRange=dayRangeMs(activityDay);
  const activityFrom=activityRange?activityRange.from:0;
  const activityTo=activityRange?activityRange.to:0;
  const {rows:activityRows,loading:activityLoading}=useActivityFeed({from:activityFrom,to:activityTo,enabled:!!activityOpen&&!!activityRange});
  // The 12-month retention promise, kept by the app because this plan has no
  // server-side scheduler — and kept HONEST by the rules, which refuse a delete
  // unless the caller is an admin and the entry really is older than a year. It
  // runs when an admin OPENS the log, which is the one moment somebody is
  // already waiting for the node and a few deletes cost nothing.
  //
  // Gated on `isAdmin` client-side as well: a staff account's attempt would be
  // refused anyway, and asking for a refusal on every open is noise in the
  // console for a promise that was never theirs to keep.
  const prunedRef=useRef(false);
  useEffect(function(){
    if(!activityOpen||!isAdmin){ if(!activityOpen) prunedRef.current=false; return; }
    if(prunedRef.current) return;   // once per opening, not once per render
    prunedRef.current=true;
    pruneActivity();
  },[activityOpen,isAdmin]);
  // v17.14.0: joins the stack, which is how it gains Esc, the shortcut
  // suppression and `inert` — all three of which it had silently never had.
  const showWaitlist = !!modalOpen.waitlist;
  const setShowWaitlist = setModalFns.waitlist;
  // v17.14.0: the walk-in form's VISIBILITY is a stack entry; its draft, its
  // baseline and its dirty flag stay in useWalkin, which takes these two.
  const showWalkin = !!modalOpen.walkin;
  const setShowWalkin = setModalFns.walkin;
  // waitAvail: {entryId: {tables, time}} for entries a table CURRENTLY fits
  // (recomputed by an effect below — deliberately state, not a render-time
  // derivation, so the trialFits scans run only when the inputs change, not
  // on every 15s clock re-render).
  const [waitAvail, setWaitAvail] = useState({});
  // Mirror of the last-computed waitAvail (/code-review anti-flap): lets the
  // matching effect carry an entry's previous availability forward when the
  // scan budget cut its pass short, instead of blinking the banner row.
  const waitAvailRef = useRef({});
  const [waitAddedShown, setWaitAddedShown] = useState(false);
  // ── v17.14.0: the four ✕-dismissal Sets, one mechanism ──────────────────────
  // `late` · `overlap` · `wait` · `clash` — see src/hooks/useDismissals.js for
  // the two lifecycles (three are emptied on a day change; `clash` prunes
  // against its live pairs instead, which is not the drift it looks like).
  // Untouched Sets keep their identity, so `[dismissed.late]` is still a stable
  // memo dep when an overlap row is dismissed.
  const { sets: dismissed, dismiss: dismissRow, prune: pruneDismissed, reset: resetDismissed } = useDismissals();
  const waitNotifyDismissed = dismissed.wait; // v16.3.0: session-only ✕-dismissed waitlist-free rows
  const [undoInfo, setUndoInfo] = useState(null);   // v17.4.0: {snapshot, kind:"cancel"|"delete"|"edit", noShow} — general undo (was cancel/no-show-only, v16.3.0)
  const undoTimerRef = useRef(null);                // 10s auto-clear timer for the undo toast
  const pendingWaitlistRef = useRef(null); // entry id being converted via Book
  // Derived: bookings with seated-today durations synced to live time.
  // Used by form/walk-in availability checks so they match what bookingsAfterAction
  // will see on save.
  // v16.3.0 perf: useMemo — this used to be a fresh array EVERY BookingApp render
  // (incl. every form keystroke, since the form draft lives here), which made any
  // downstream memo of the availability scans useless (their `liveBookings` input
  // changed ref each render). Keyed on [bookings, nowMins]: recomputes on a data
  // change or the 15s tick, stays referentially stable across keystrokes/toggles.
  const liveBookings=useMemo(function(){
    const today=todayStr();
    return syncLiveDurations(bookings,today,nowMins);
  },[bookings,nowMins]);
  const winW=useWinW();
  const isMobile=winW<600;
  // ── v14.2.0: Dark-mode theme state ────────────────────────────────────────
  // themePref (localStorage-backed) feeds useThemeMode, which writes
  // <html data-theme> and returns the resolved isDark. The no-flash script in
  // index.html reads the SAME localStorage key on first paint. Toggling writes
  // the key and updates state — per device, no Firebase (no settings node).
  const [themePref,setThemePref]=useState(readThemePref);
  const isDark=useThemeMode(themePref);
  function onToggleDark(){
    // v18.0.0 session 7: locked while Automatic dark mode is on — Patryk's choice. The
    // switch renders disabled; this guard keeps any other caller from quietly
    // replacing Automatic with a fixed look.
    // /code-review: and it SAYS so. The other caller is ⇧D — global, and listed
    // in Shortcuts — and a bare return there read as a dead key for every
    // account that never chose a theme, which reads as Automatic by default.
    if(themePref===undefined){flashRefusal("Dark mode follows this device while Automatic dark mode is on — turn it off in Settings → App.");return;}
    const next=!isDark;
    // v17.6.0: localStorage stays as the PRE-MOUNT cache — index.html's
    // no-flash script reads this key before React mounts and long before
    // Firebase resolves, so dropping it would flash the wrong theme on every
    // load. The per-user node is the source of truth.
    try{localStorage.setItem("mgt-theme",next?"dark":"light");}catch{/* ignore */}
    setThemePref(next);
    // v17.9.0: under a ?theme= override the toggle still works locally, but it
    // must not persist — the override exists so a theme can be inspected without
    // touching the signed-in user's saved settings.
    if(!DEV_THEME_FORCED) saveUserPrefs({theme:next?"dark":"light"});
  }
  // v18.0.0 session 7: the Automatic dark mode switch (Settings → App) — follow this
  // device's light/dark setting, live. Stored on the account as "auto", NEVER as
  // null: null means "never chosen", and the seeding effect below fills a
  // never-chosen account from the next device to sign in with an explicit
  // value, so Automatic picked on the iPad would be overwritten by the tablet.
  // Turning it OFF keeps the look the device is showing right now, as an explicit
  // choice — the least surprising answer, since nothing on screen changes.
  function onToggleAutoTheme(){
    if(themePref===undefined){
      const dark=isDark;
      try{localStorage.setItem("mgt-theme",dark?"dark":"light");}catch{/* ignore */}
      setThemePref(dark);
      if(!DEV_THEME_FORCED) saveUserPrefs({theme:dark?"dark":"light"});
    }else{
      // localStorage holds "auto" rather than dropping the key: the no-flash
      // script already follows the OS for anything that is not "dark"/"light",
      // and an explicit value reads as a choice to whoever looks next.
      try{localStorage.setItem("mgt-theme","auto");}catch{/* ignore */}
      setThemePref(undefined);
      if(!DEV_THEME_FORCED) saveUserPrefs({theme:"auto"});
    }
  }
  // v17.0.0 correction: per-device app width (see readAppWidth above).
  const [appWidth,setAppWidth]=useState(readAppWidth);
  function onSetAppWidth(next){
    const v=Math.max(APP_WIDTH_MIN,Math.min(APP_WIDTH_MAX,next));
    try{localStorage.setItem("mgt-appwidth",String(v));}catch{/* ignore */}
    setAppWidth(v);
  }
  // v17.1.0: per-device "Reduce animations" (Settings → General). Theme
  // pattern: localStorage["mgt-reduce-motion"]="1" + <html data-motion> —
  // the no-flash script in index.html reads the SAME key pre-mount, the CSS
  // kill-switch keys on the attribute, and atoms.jsx's useFlip checks it for
  // WAAPI animations. Keep all three in sync.
  const [reduceMotion,setReduceMotion]=useState(function(){return readPrefLS("reduceMotion");});
  // v17.10.1: per-device offline shell. localStorage ONLY — deliberately not
  // saveUserPrefs'd: clearing site data is the last-resort escape from a bad
  // worker, and a synced flag would come straight back down and re-enable it.
  function onToggleSw(){
    const next=!swEnabled;
    setSwEnabled(next);        // lib/serviceWorker.js owns the localStorage key
    setSwEnabledState(next);   // /code-review: was setSwEnabled_ — one underscore
                               // apart from the writer above, which is a name
                               // that only tells you it is not the other one.
  }
  // ── v17.14.0: the four boolean prefs, driven by PREF_SPEC ───────────────────
  // The localStorage convention (which value is stored, which key is dropped)
  // lives once in useUserPrefs.js; these two functions are the only place that
  // TOUCHES localStorage for them, and they are shared by the initializers, the
  // toggles and the seeding effect below.
  //
  // `theme` stays written out in full above: it is a tri-state string with a
  // `?theme=` override that must skip both branches, and hiding that in a table
  // is how it would get broken.
  function writePref(name,v){
    const spec=PREF_SPEC[name];
    const str=prefLocalValue(spec.store,v);
    try{
      if(str===null) localStorage.removeItem(spec.ls); else localStorage.setItem(spec.ls,str);
      if(spec.clears&&!v) localStorage.removeItem(spec.clears);
    }catch{/* ignore */}
    // The one DOM side effect any of them has: index.html's boot script reads
    // this attribute, and the motion rules key off it.
    if(name==="reduceMotion"){
      if(v) document.documentElement.dataset.motion="reduce";
      else delete document.documentElement.dataset.motion;
    }
  }
  // Flip a pref: write it locally, set the state, sync it to the account.
  // Returns the new value so a caller can hang its own React side effect off it
  // (only splitEnabled has one — see below).
  function togglePref(name,cur,set){
    const next=!cur;
    writePref(name,next);
    set(next);
    saveUserPrefs({[name]:next});   // v17.6.0: follows the account
    return next;
  }
  function onToggleReduceMotion(){togglePref("reduceMotion",reduceMotion,setReduceMotion);}
  // v17.1.2: per-device "Plan zoom & pan" (Settings → General). Theme pattern:
  // localStorage["mgt-plan-gestures"]="0" only when OFF (absent = on, the
  // default) — gates PlanView's wheel/pinch zoom, drag pan and double-tap reset.
  const [planGestures,setPlanGestures]=useState(function(){return readPrefLS("planGestures");});
  function onTogglePlanGestures(){togglePref("planGestures",planGestures,setPlanGestures);}
  // v17.5.0: per-device "Lock navigation" (Settings → General). Theme pattern,
  // but INVERTED vs planGestures because the default is OFF — only the non-
  // default value is ever stored, so localStorage["mgt-nav-lock"]="1" means on
  // and an absent key means off. Drives the `shellFixed` layout below.
  const [navLocked,setNavLocked]=useState(function(){return readPrefLS("navLocked");});
  function onToggleNavLock(){togglePref("navLocked",navLocked,setNavLocked);}
  // v17.5.0: per-device Split View master switch (Settings → General).
  // v17.5.0 correction: default ON (was off), so the RMB / press-and-hold
  // gesture works out of the box. That puts it back on the house convention —
  // key absent = default, only the non-default "0" is stored — same shape as
  // planGestures. (navLocked stays inverted; its default really is off.)
  // While off, the gesture on a view button does nothing at all.
  const [splitEnabled,setSplitEnabled]=useState(function(){return readPrefLS("splitEnabled");});
  function onToggleSplitEnabled(){
    // Only the SWITCH syncs; the saved split LAYOUT (which two views + ratio)
    // stays per-device — PREF_SPEC drops that key, see useUserPrefs.js.
    if(!togglePref("splitEnabled",splitEnabled,setSplitEnabled)) setSplit(null);
    // ^ turning the feature off must also leave any active split. React state,
    //   so it stays here rather than in the table.
  }
  // The active split, or null for a single view. Restored per-device.
  const [split,setSplit]=useState(readSplit);
  // ── v17.6.0: apply the signed-in user's preferences, or seed them ──────────
  // Runs once the account's node has loaded. For each of the five synced
  // settings: a value the user HAS saved overrides this device; a value they
  // have never saved is seeded from whatever this device is currently using and
  // written up, so logging in on a configured device adopts its setup instead
  // of resetting it. localStorage is written alongside, because it is what
  // index.html's no-flash script reads before React mounts.
  //
  // Keyed on `prefsLoaded` alone: it flips false→true exactly once per uid (the
  // hook resets it when the path changes), and re-running on every later
  // snapshot would fight the user's own toggles. Reading the current local
  // values here without depending on them is the point, not an oversight.
  // The current value + setter for each of the four, so the seeding loop below
  // can read "what is this device using" and "how do I change it" by name.
  // Rebuilt per render and read only inside the once-per-uid effect.
  const prefState={
    reduceMotion:{value:reduceMotion,set:setReduceMotion},
    planGestures:{value:planGestures,set:setPlanGestures},
    navLocked:{value:navLocked,set:setNavLocked},
    splitEnabled:{value:splitEnabled,set:setSplitEnabled},
  };
  const seededPrefsRef=useRef(false);
  useEffect(function(){
    if(!prefsLoaded||seededPrefsRef.current) return;
    seededPrefsRef.current=true;
    const seed={};
    // v17.9.0: a ?theme= override skips BOTH branches. Applying the saved theme
    // would defeat the override; seeding from it would write the forced value up
    // as if the user had chosen it. `themePref` currently HOLDS the forced value,
    // so the else-branch is the more dangerous of the two.
    if(DEV_THEME_FORCED){
      /* leave settings/users/{uid}/prefs.theme exactly as found */
    }else if(userPrefs.theme==="dark"||userPrefs.theme==="light"){
      const dark=userPrefs.theme==="dark";
      try{localStorage.setItem("mgt-theme",userPrefs.theme);}catch{/* ignore */}
      setThemePref(dark);
    }else if(userPrefs.theme==="auto"){
      // v18.0.0 session 7: Automatic dark mode, chosen on some device of this account.
      try{localStorage.setItem("mgt-theme","auto");}catch{/* ignore */}
      setThemePref(undefined);
    }else if(themePref!==undefined){
      // Only seed an EXPLICIT device preference. `undefined` means this device
      // follows the OS, which is the absence of a choice — writing it up would
      // freeze the user to whatever the OS happened to say at first login.
      seed.theme=themePref?"dark":"light";
    }
    // v17.14.0: the four booleans, one loop over PREF_SPEC. The TRI-STATE
    // semantics are untouched and are the reason this cannot be simplified
    // further: `null` means "this user has never chosen", and a sanitize that
    // returned `false` for an absent field would reset every configured device
    // on first login. Only a real boolean takes the apply branch.
    PREF_NAMES.forEach(function(name){
      const saved=userPrefs[name];
      const st=prefState[name];
      if(saved===true||saved===false){
        writePref(name,saved);
        st.set(saved);
      }else seed[name]=st.value;
    });
    // The one React side effect the table does not carry, for the same reason
    // the toggle keeps it: leaving an active split is state, not storage.
    if(userPrefs.splitEnabled===false) setSplit(null);
    if(Object.keys(seed).length) saveUserPrefs(seed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[prefsLoaded]);
  const [focusedPane,setFocusedPane]=useState("a");
  const splitMenuFor = modalOpen.splitmenu || null; // which view's SplitMenu is open
  const setSplitMenuFor = setModalFns.splitmenu;
  // Which view the keyboard acts on: the focused pane's in a split, else `view`.
  // Declared HERE, not next to the split handlers further down, because
  // useKeyboardShortcuts' ctx object is built mid-render and a `const` used
  // before its declaration is a TDZ ReferenceError, not a hoist (the split
  // handlers below are function declarations, so those genuinely do hoist).
  const activeView=split?split[focusedPane]:view;
  // One writer for both the state and the key, so they can't drift.
  function applySplit(next){
    setSplit(next);
    try{
      if(next) localStorage.setItem(SPLIT_KEY,JSON.stringify(next));
      else localStorage.removeItem(SPLIT_KEY);
    }catch{/* ignore */}
  }
  // Phones collapse out of a split: the header already wraps to three rows at
  // <600px, and a Timeline in a ~180px pane is unusable. Also covers a desktop
  // window dragged narrow.
  useEffect(function(){
    if(isMobile&&split) applySplit(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[isMobile]);
  // v17.11.0: the width the two panes actually divide — the app is clamped to
  // the per-device App-width setting, so the WINDOW is not what a pane gets.
  const shellW=Math.min(winW,appWidth);
  const tlSide=split?(split.a==="timeline"?"a":split.b==="timeline"?"b":null):null;
  const splitSideBySideOk=tlPaneOk(shellW,"v",0.5,"a");
  // …and the repair: an existing side-by-side split whose Timeline pane has
  // become too narrow — the window was resized, the divider dragged, or the App
  // width setting lowered — turns STACKED rather than being torn down. The
  // phone rule above collapses the split because a phone cannot host one at all;
  // here the split is still perfectly viable, it is only this orientation that
  // is not, so preserving the user's intent is the better repair.
  useEffect(function(){
    if(!split||!tlSide) return;
    if(tlPaneOk(shellW,split.dir,split.ratio,tlSide)) return;
    applySplit(Object.assign({},split,{dir:"h"}));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[shellW,split,tlSide]);
  // ── v17.5.0: the fixed shell ────────────────────────────────────────────────
  // Normally <body> is the scrollport (see the mount effect near the top of
  // BookingApp) and the app is a plain `minHeight:100dvh` block that grows.
  // `shellFixed` flips that: the shell becomes a 100dvh flex COLUMN, the header
  // and date rows become flexShrink:0, and an inner region takes the scroll.
  // That is the ONE mechanism behind "lock navigation" — and Split View widens
  // this flag rather than inventing a second layout.
  // Both contributing settings default off, so the default render path is
  // byte-for-byte what shipped in v17.4.2.
  // Split View joins the SAME flag rather than getting its own layout: two
  // independently-scrolling panes need a definite height, which is exactly what
  // the fixed shell provides. Consequence, stated in CLAUDE.md: entering a
  // split pins the nav whether or not "Lock navigation" is on.
  const shellFixed = navLocked || !!split;
  // Body must stop scrolling in that mode or the page gets a second scrollbar
  // outside the fixed shell. Separate from the mount-once effect above (which
  // establishes the baseline) because that effect is declared long before
  // `navLocked` exists — putting navLocked in ITS dep array would be a TDZ error.
  useEffect(function(){
    document.body.style.overflow=shellFixed?"hidden":"auto";
    return function(){document.body.style.overflow="auto";};
  },[shellFixed]);
  // v17.12.0: `data-kbd` — a two-line stand-in for `:focus-visible`, and ONLY
  // for the floor plan's tables.
  //
  // Those became focusable this version, and two measured facts about SVG made
  // the app's one focus rule unusable there: a browser paints no `outline` on a
  // `<g>`, and `:focus-visible` never matches an SVG element in Chrome at all
  // (two consecutive REAL Tab presses left the focused group matching `:focus`
  // and not `:focus-visible`). Plain `:focus` is not the answer either — a mouse
  // click focuses the group too, so every table tap during service would leave a
  // white ring behind it.
  //
  // So the modality is tracked here and read by ONE rule in index.html. It lives
  // in App rather than in the boot script because that script is pinned by a
  // CSP hash, and adding two lines there would silently break the whole script
  // in production if the hash were not regenerated (tests/csp.test.js exists
  // because that has already happened once).
  //
  // Capture phase, so it records the modality before anything can stop
  // propagation. Deliberately narrow: only the keys that MOVE focus set the
  // flag — typing a letter into a form field is not a request for focus rings.
  useEffect(function(){
    const root=document.documentElement;
    function onKey(e){
      const k=e.key||"";
      if(k==="Tab"||k.indexOf("Arrow")===0) root.dataset.kbd="1";
    }
    function onPointer(){ delete root.dataset.kbd; }
    window.addEventListener("keydown",onKey,true);
    window.addEventListener("pointerdown",onPointer,true);
    return function(){
      window.removeEventListener("keydown",onKey,true);
      window.removeEventListener("pointerdown",onPointer,true);
      delete root.dataset.kbd;
    };
  },[]);
  // v17.2.0: per-device Timeline zoom/follow settings (see readTlSettings above).
  // Stored one value per key; a value equal to its default removes the key.
  // Lowering maxZoom clamps followZoom/defaultZoom (and the live zoom) with it.
  const [tlSettings,setTlSettings]=useState(readTlSettings);
  function persistTl(name,v){
    const b=TL_SETTING_BOUNDS[name];
    try{
      if(v===b.def) localStorage.removeItem(b.key);
      else localStorage.setItem(b.key,String(v));
    }catch{/* ignore */}
  }
  function onSetTlSetting(name,next){
    const b=TL_SETTING_BOUNDS[name];
    if(!b) return;
    let v=Math.max(b.min,Math.min(b.max,Math.round(next/b.step)*b.step));
    const out=Object.assign({},tlSettings);
    if(name==="maxZoom"){
      out.maxZoom=v;
      if(out.followZoom>v){out.followZoom=v;persistTl("followZoom",v);}
      if(out.defaultZoom>v){out.defaultZoom=v;persistTl("defaultZoom",v);}
      setTimelineZoom(function(z){return Math.min(z,v);});
    }else{
      if((name==="followZoom"||name==="defaultZoom")&&v>tlSettings.maxZoom) v=tlSettings.maxZoom;
      out[name]=v;
    }
    persistTl(name,v);
    setTlSettings(out);
  }
  // v14 deployment fix: history entries must attribute to the logged-in user
  // (their email), not the generic "staff" stub used in standalone preview.
  // "staff" remains as a fallback for the rare case where auth.currentUser
  // is unavailable at the moment of the write.
  function getUser(){return (auth.currentUser&&auth.currentUser.email)||"staff";}

  // v17.3.2 perf: memoized like overlapWarnings/lateMap (v17.1.0). This ran
  // checkInefficent (a findBest scan per non-locked booking) on EVERY BookingApp
  // render — i.e. every form keystroke, since the form draft lives here — the one
  // heavy derivation the v17.1.0 useMemo pass missed. Keyed on [bookings,viewDate].
  const inefficient=useMemo(function(){return bookings.length>0&&checkInefficent(bookings,viewDate);},[bookings,viewDate]);

  // v14.4.0: the day's bookings in the SAME order ListView renders them
  // (status group, then time). Drives ↑/↓ keyboard navigation of selectedListId
  // and resolves which booking the List shortcuts act on. Kept identical to
  // ListView's internal sort so the focus ring and the keyboard target match.
  // v15.1.0: completed/cancelled cards are excluded while the "Completed &
  // cancelled" disclosure is collapsed — hidden cards must not be keyboard targets.
  const listDaySorted=useMemo(function(){return bookings
    .filter(function(b){return b.date===viewDate&&(showFinished||(b.status!=="completed"&&b.status!=="cancelled"));})
    .sort(function(a,b){const sa=statusOrder(a.status),sb=statusOrder(b.status);if(sa!==sb) return sa-sb;return a.time.localeCompare(b.time);});},[bookings,viewDate,showFinished]);
  // Clear the List focus when the day changes — the focused booking won't be
  // on the new day. (A status change that drops a booking from view just leaves
  // selectedListId pointing at a missing id → shortcuts no-op until it's re-set.)
  // v15.1.0: also re-collapse the finished disclosure on day change.
  // v16.3.0: also clear the Running-late ✕-dismissed set (declared below) — the
  // dismissals are per-day glances, not permanent mutes. (Referencing the setter
  // here is safe: the effect body runs post-render, after the const initialises.)
  // v16.3.0: a search-jump to another day parks the target booking id in
  // pendingSelectRef; consume it here (after the day changes) instead of clearing
  // the focus, and open the finished fold if the target is completed/cancelled so
  // its card is visible. Otherwise the day change clears the (now off-day) focus.
  useEffect(function(){
    const pend=pendingSelectRef.current;
    if(pend){
      pendingSelectRef.current=null;
      setSelectedListId(pend);
      const b=bookings.find(function(x){return x.id===pend;});
      setShowFinished(!!(b&&(b.status==="completed"||b.status==="cancelled")));
      bumpListFocus(); // v17.3.1: scroll the jumped-to card into view
    }else{
      setSelectedListId(null);setShowFinished(false);
    }
    resetDismissed(DAY_DISMISS_KEYS);   // NOT "clash" — it prunes itself, see useDismissals.js
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[viewDate]);
  // v15.1.0: ListView's disclosure header toggles this. When COLLAPSING while a
  // finished card holds the keyboard focus, drop the focus — the card is about
  // to disappear and the shortcuts must not act on an invisible booking.
  function toggleShowFinished(next){
    if(!next&&selectedListId){
      const sel=bookings.find(function(b){return b.id===selectedListId;});
      if(sel&&(sel.status==="completed"||sel.status==="cancelled")) setSelectedListId(null);
    }
    setShowFinished(next);
  }

  // Overlap warnings: seated bookings whose live end is within 15 min of next booking on same table
  // v17.1.0 perf: useMemo (was a per-render IIFE) — a fresh object every render
  // would defeat the React.memo on the views it feeds.
  const overlapWarnings=useMemo(function(){
    const today=todayStr();
    if(viewDate!==today) return EMPTY_OBJ;
    const warnings={};
    const active=bookings.filter(function(b){return b.date===today&&b.status!=="cancelled"&&b.status!=="completed"&&(b.tables||[]).length>0;});
    const seated=active.filter(function(b){return b.status==="seated";});
    seated.forEach(function(sb){
      const liveEnd=nowMins;
      const sbTables=sb.tables||[];
      let nextOnTable=null;let nextStart=Infinity;
      active.forEach(function(ob){
        if(ob.id===sb.id||ob.status==="seated") return;
        const oTables=ob.tables||[];
        const shared=sbTables.some(function(t){return oTables.includes(t);});
        if(!shared) return;
        const os=toMins(ob.time);
        if(os>=toMins(sb.time)&&os<nextStart){nextStart=os;nextOnTable=ob;}
      });
      if(nextOnTable){
        const gap=nextStart-liveEnd;
        if(gap<=15) warnings[sb.id]={next:nextOnTable.name,nextTime:nextOnTable.time,gap:gap,overdue:gap<=0,nextId:nextOnTable.id};
      }
    });
    return warnings;
  },[bookings,nowMins,viewDate]);

  // v16.1.0 — Running-late map: {id: "warn"|"noshow"} for TODAY'S confirmed
  // bookings past their start time (lateState, booking-logic.js). "warn" =
  // amber highlight (lateWarnMin+); "noshow" additionally offers the one-tap
  // "No show" (lateNoShowMin+). Thresholds + master switch live in
  // settings/bookingDefaults. v17.1.0 perf: useMemo (stable ref for the views'
  // React.memo — cheapness was never the point, identity is).
  const lateMap=useMemo(function(){
    const today=todayStr();
    if(viewDate!==today) return EMPTY_OBJ;
    const map={};
    bookings.forEach(function(b){
      const st=lateState(b,today,nowMins,bookingDefaults);
      if(st) map[b.id]=st;
    });
    return map;
  },[bookings,nowMins,viewDate,bookingDefaults]);
  // v16.3.0: per-row ✕ dismiss on the Running-late banner. Session-only (never
  // persisted); lives HERE (not in LateBanner) because the whole banner's outer
  // Reveal must collapse once the last row is dismissed. lateMap itself stays
  // UNFILTERED — the list/timeline amber highlights keep showing for a dismissed
  // row; only the banner (lateBannerMap) hides it. Reset on day change (below).
  const lateDismissed=dismissed.late;
  const lateBannerMap=useMemo(function(){
    if(lateDismissed.size===0) return lateMap;
    const map={};
    Object.keys(lateMap).forEach(function(id){if(!lateDismissed.has(id)) map[id]=lateMap[id];});
    return map;
  },[lateMap,lateDismissed]);
  function dismissLateRow(id){dismissRow("late",id);}
  // v17.0.0 round 7 — same ✕-dismiss mechanism for the Overlap banner (the
  // Running-late pattern applied app-wide). Session-only; keyed by seated id.
  const overlapDismissed=dismissed.overlap;
  function dismissOverlapRow(id){dismissRow("overlap",id);}
  // v17.11.0 — the same ✕-dismiss mechanism for the double-booking rows. Keyed
  // by the PAIR's row id (clashRowId), not a booking id: the row is about two
  // bookings, and dismissing "Pau vs Rita" must not also silence "Rita vs a
  // third party" if the day is bad enough to have both.
  const clashDismissed=dismissed.clash;
  function dismissClashRow(id){dismissRow("clash",id);}
  // v16.3.0 — Table-turn prediction: today's seated bookings whose scheduled end
  // is within the next freeSoonWindow min (freeingSoon, booking-logic.js). Gated
  // on the settings/bookingDefaults master switch (freeSoonEnabled). Two shapes:
  //   freeingList — [{id,name,tables,inMin}] soonest-first, for the Summary line.
  //   freeingMap  — {bookingId: inMin}, for the timeline countdown pills.
  // Today-only + recomputed per render (nowMins ticks every 15s) — the lateMap
  // pattern; trivially cheap.
  const freeingList=useMemo(function(){
    const today=todayStr();
    if(viewDate!==today||!bookingDefaults.freeSoonEnabled) return EMPTY_ARR;
    return freeingSoon(bookings,today,nowMins,bookingDefaults.freeSoonWindow||15);
  },[bookings,nowMins,viewDate,bookingDefaults]);
  const freeingMap=useMemo(function(){
    if(freeingList.length===0) return EMPTY_OBJ;
    const map={};
    freeingList.forEach(function(f){map[f.id]=f.inMin;});
    return map;
  },[freeingList]);

  // v18.0.0 session 8 (C8): `kind` is what the ACTION did, for the toast to
  // read. `"saved"` means this action suppressed the optimiser, so it must not
  // claim a reshuffle; every other caller passes nothing and is unchanged.
  //
  // v18.0.0 session 9: the message is COMPUTED HERE and stored, rather than
  // derived at render time from `reshuffled`. One state cannot be both the
  // visibility timer and the text selector: `savedToast` returns "Booking
  // saved." only for the exact kind `"saved"` and falls through to "Tables
  // re-optimised." for everything else — `false` included — so the +3000ms
  // clear FLIPPED THE WORDING while the node was still painting its exit.
  // Measured on a future-date seat with a timestamped MutationObserver:
  // "Booking saved." at t=21209, "Tables re-optimised." at t=24190, gone at
  // t=24453 — 263ms of the wrong message, every time, on every date where
  // `optimizerActiveFor` is true.
  //
  // Capturing it here also makes it more truthful, not merely stable: the toast
  // describes what the ACTION did, so it must be fixed at the moment of the
  // action rather than recomputed against a `viewDate` the user may since have
  // navigated away from. Same shape as v17.16.9's carried label.
  function flash(kind){
    const k=kind||true;
    const active=optimizerActiveFor(viewDate,autoOptimizer);
    setReshuffledMsg(savedToast(k,active));
    // Offered to the next `armUndo`, which runs synchronously after every
    // `flash` that arms one. Cleared with the flag so a flash that arms NO undo
    // cannot leave the note lying about for a later pill to pick up — the same
    // 3s bound the old live derivation had, now without the truncation.
    flashNoteRef.current=(k!=="saved"&&active)?"tables re-optimised":"";
    setReshuffled(k);
    setTimeout(function(){setReshuffled(false);flashNoteRef.current="";},3000);
  }
  function flashSyncFix(){setSyncFix(true);setTimeout(function(){setSyncFix(false);},4000);}

  // v15.6.1 — Post-sync conflict reconciliation.
  // v17.14.0: the DECISION moved to `src/lib/reconcile.js` — which dates are
  // dirty (`dirtyDates`) and what to do about each (`reconcile`) — leaving here
  // only what is genuinely React: the gates, the dispatch and the toast. The
  // rule is v17.8.0's, the one that produced `placeWaitlist` and
  // `presenceState`: logic that decides something the restaurant acts on does
  // not live in a useEffect. This one decides which booking gets MOVED TO
  // ANOTHER TABLE after two devices' offline edits merge, and until now only
  // its `dayBookingsSig` compare was reachable by a test — the rest was found
  // to be spinning forever, in v17.10.2, by reading the console.
  //
  // Silent write (auto-effect, no red refusal banner); gated on !resyncing so it
  // waits out the post-sleep stale window and re-runs once fresh data arrives.
  useEffect(function(){
    if(resyncing||firstLoadCount.current===null) return;
    const today=todayStr();
    const dirty=dirtyDates(bookings,today);
    if(!dirty.length) return;
    let changed=false;
    const ok=saveBookings(function(prev){
      const r=reconcile(prev,dirty,tableBlocks,autoOptimizer);
      changed=r.changed;
      return r.next;   // === prev when nothing moved, so React bails out
    },true);
    if(ok&&changed) flashSyncFix();
  },[bookings,tableBlocks,autoOptimizer,resyncing]);

  // ── v16.0.0: Waitlist active matching ───────────────────────────────────────
  // For each waiting entry (date ≥ today, open day) find the FIRST time from
  // "now" (today) / opening (future dates) where the party fits, via the same
  // trialFits the booking form uses — so "Table free" here means a booking
  // would really save. prefTime is tried first; otherwise a 15-min first-fit
  // scan (stops at the first success, so an un-full day exits immediately).
  // Runs as an effect keyed on the data + a 15-min clock bucket — NOT raw
  // nowMins — so the scans don't re-run on every 15s tick. v16.3.0: the result
  // (waitAvail) drives the in-flow WaitAvailBanner directly; the old
  // transition-diff green toast was removed (superseded by the persistent banner).
  const nowQuarter=Math.floor(nowMins/15);
  useEffect(function(){
    // v17.8.0 tech-debt: the ~90 lines of placement logic that used to sit here
    // are `placeWaitlist` in lib/waitlist-match.js — VERBATIM, nothing about the
    // algorithm changed. It decides which table the app offers each waiting
    // party, which makes it the most consequential logic in this version, and
    // inside a useEffect no test could reach it. What is left here is the part
    // that is genuinely React: the 15-min clock bucket this keys on (never the
    // raw nowMins tick, or the scans re-run every 15s), the ref mirror that
    // feeds the anti-flap carry-forward, and the setState.
    const next=placeWaitlist({
      bookings:liveBookings,
      waitlist:waitlist,
      blocks:tableBlocks,
      autoOptimizer:autoOptimizer,
      nowMins:nowMins,
      todayStr:todayStr(),
      matchWin:generalSettings.waitMatchWin,
      prev:waitAvailRef.current
    });
    waitAvailRef.current=next;
    setWaitAvail(next);
    // v16.3.0: the transition-to-available cue is the in-flow WaitAvailBanner
    // (persistent + actionable), not a 6-second toast — so the prev-set diff
    // that fired the old toast is gone. waitAvail alone drives the banner.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[bookings,tableBlocks,waitlist,autoOptimizer,nowQuarter,generalSettings.waitMatchWin]);

  // ── v16.3.0: Recurring-booking generator ────────────────────────────────────
  // For each ACTIVE rule, materialise its occurrences across the rolling horizon
  // [today … today + horizonWeeks·7] as normal /bookings children, stamped with
  // recurringId + recurringDate. IDEMPOTENT + cross-device-safe:
  //   • existence is checked by (recurringId, recurringDate) — immutable stamps —
  //     so a moved/cancelled occurrence is never re-created;
  //   • the occurrence id is DETERMINISTIC ("r"+ruleId+"_"+date, path-safe), so
  //     two devices generating concurrently converge — the second create is
  //     rejected by the per-$id updatedAt CAS (baseUpdatedAt 0 vs stored) and
  //     reconciles via the echo;
  //   • skipDates (a deleted occurrence's date) are skipped;
  //   • closed days / out-of-hours times are skipped.
  // Self-stabilising (created rows populate `existing` next pass → no-op) and
  // silent (auto-effect). Gated on !resyncing + loaded, like the reconciliation
  // effect. Keyed on nowQuarter too so a day-rollover extends the horizon without
  // needing a booking edit (the empty-toCreate early-out keeps it cheap).
  useEffect(function(){
    if(resyncing||firstLoadCount.current===null) return;
    if(!recurring.enabled||!recurring.rules.length) return;
    const today=todayStr();
    const horizonDays=recurring.horizonWeeks*7;
    const existing={};
    bookings.forEach(function(b){ if(b.recurringId&&b.recurringDate) existing[b.recurringId+"|"+b.recurringDate]=true; });
    const toCreate=[];
    recurring.rules.forEach(function(rule){
      if(!rule.active) return;
      const skip=rule.skipDates||[];
      for(let i=0;i<=horizonDays;i++){
        const d=new Date(today+"T00:00:00Z");
        d.setUTCDate(d.getUTCDate()+i);
        if(d.getUTCDay()!==rule.weekday) continue;
        const ds=d.toISOString().slice(0,10);
        if(skip.indexOf(ds)!==-1) continue;
        const h=hoursFor(ds);
        if(h.closed) continue;
        const sm=toMins(rule.time);
        if(sm<h.open*60||sm>h.close*60) continue;
        if(existing[rule.id+"|"+ds]) continue;
        toCreate.push({rule:rule,date:ds});
      }
    });
    if(!toCreate.length) return;
    saveBookings(function(prev){
      let next=prev;
      const byDate={};
      toCreate.forEach(function(oc){ (byDate[oc.date]=byDate[oc.date]||[]).push(oc); });
      Object.keys(byDate).forEach(function(ds){
        byDate[ds].forEach(function(oc){
          const rule=oc.rule;
          const dur=getDur(rule.size);
          const nb={id:"r"+rule.id+"_"+ds,name:rule.name,phone:rule.phone,date:ds,time:rule.time,scheduledTime:rule.time,size:rule.size,duration:dur,originalDuration:dur,preference:rule.preference,notes:rule.notes,status:"confirmed",tables:[],customDur:null,deposit:0,voucherCode:"",_manual:false,_locked:false,_conflict:false,preferredTables:[],returnOf:null,recurringId:rule.id,recurringDate:ds,history:[histEntry("auto-created from weekly rule","auto")]};
          if(next.some(function(b){return b.id===nb.id||(b.recurringId===rule.id&&b.recurringDate===ds);})) return;
          next=next.concat([nb]);
        });
        next=bookingsAfterAction(next,ds,tableBlocks,null,false,autoOptimizer);
      });
      return next;
    },true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[bookings,recurring,tableBlocks,autoOptimizer,resyncing,nowQuarter]);

  // Book a waitlist entry: pre-fill a fresh new-booking form from it (the
  // returnOf pattern) and remember the entry id — doSave's new-booking path
  // removes it once the booking is dispatched.
  function bookFromWaitlist(w){if(refused("waitlistManage"))return;
    const avail=waitAvail[w.id];
    openForm(Object.assign({},EMPTY_FORM,{
      name:w.name||"",
      phone:w.phone||generalSettings.phonePrefix,
      date:w.date,
      time:(avail&&avail.time)||w.prefTime||"",
      size:w.size||2,
      notes:w.notes||""
    }));
    setEditId(null);setError("");setSwapAffected(null);
    pendingWaitlistRef.current=w.id;
    setShowWaitlist(false);
    setShowForm(true);
  }
  // "Add to waitlist" from the booking form's no-tables banner: capture the
  // draft's fields as a waiting entry, close the form, flash the toast.
  function addFormToWaitlist(){
    if(refused("waitlistManage"))return;
    const f=formRef.current;
    addToWaitlist({
      name:f.name||"",
      phone:cleanPhoneOf(f.phone),
      size:Number(f.size)||2,
      date:f.date||viewDate,
      prefTime:f.time||null,
      notes:f.notes||""
    });
    setShowForm(false);
    setWaitAddedShown(true);
    setTimeout(function(){setWaitAddedShown(false);},3000);
  }
  // Same from the walk-in form (today, current draft time).
  function addWalkinToWaitlist(){
    if(refused("waitlistManage"))return;
    const wf=walkinForm||{};
    addToWaitlist({
      name:wf.name||"",
      phone:cleanPhoneOf(wf.phone),
      size:Number(wf.size)||2,
      date:todayStr(),
      prefTime:wf.time||null,
      notes:wf.notes||""
    });
    setShowWalkin(false);
    setWaitAddedShown(true);
    setTimeout(function(){setWaitAddedShown(false);},3000);
  }

  // v16.0.0: delete a customer = delete EVERY booking carrying their phone
  // (customers are DERIVED from bookings — no separate collection) + their
  // waitlist entries. Permanent (no backups on the Firebase free plan); the
  // Customers tab arms an explicit confirm before calling this. Known edge:
  // if the customer's bookings are the ENTIRE database, the empty-array
  // write-guard refuses the delete — safety wins (document, don't bypass).
  // v16.3.0: download a JSON backup of every collection + all settings to the
  // device. Read-only (no write-guard concerns). The Firebase free plan has NO
  // automatic backups, so this is one-tap insurance; restore stays manual.
  function doBackup(){
    // The widest data-protection action in the app — every booking, every
    // customer name and every phone number in one file — and the ONE gated
    // capability with no rule behind it: the file is built client-side out of
    // reads, and `.read` is `auth != null` at the root. `CAPABILITIES` says so
    // rather than letting the enforced badge imply otherwise.
    if(refused("dataExport")) return;
    const payload={
      exportedAt:new Date().toISOString(),
      appVersion:__APP_SIGNATURE__.version,
      // /code-review: reminderFires (the transient per-device fire log) is
      // DELIBERATELY omitted — restoring reminders without it can only re-show
      // an already-seen banner once, which pruneOldReminderFires then re-prunes.
      // Recorded in the file itself so a future restore knows it wasn't lost.
      omitted:["reminderFires (transient reminder fire-log — intentionally not backed up)"],
      bookings:bookings,
      tableBlocks:tableBlocks,
      waitlist:waitlist,
      reminders:reminders,
      recurring:recurring,
      settings:{
        operatingHours:weekHours,
        dayShifts:dayShifts,
        optimizer:optimizerSettings,
        layout:layout,
        bookingDefaults:bookingDefaults
      }
    };
    try{
      const blob=new Blob([JSON.stringify(payload,null,2)],{type:"application/json"});
      const url=URL.createObjectURL(blob);
      const a=document.createElement("a");
      a.href=url;
      a.download="mgt-backup-"+todayStr()+".json";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function(){URL.revokeObjectURL(url);},1000);
    }catch{setWriteWarning("Couldn't create the backup file on this device.");}
  }
  // v17.0.0: "Delete customer" now ANONYMIZES instead of deleting — the
  // bookings remain for statistics (covers, day/range stats, phone-less
  // no-show tile) as name "Data removed" with phone/notes/history wiped and
  // the noShow flag KEPT (Patryk-confirmed scope). The `anonymized` flag
  // excludes them from every name-search/autocomplete path (customers.js).
  // Waitlist entries are still fully deleted (personal data, not statistics).
  // Side benefit: the old whole-DB edge (filter → empty array refused by the
  // write-guard) is gone — a map never changes the booking count.
  // v17.10.0: takes an IDENTITY ({phone, guestId}), not a phone string — the
  // Customers tab now lists joined phone-less guests too, and "delete this
  // customer" has to reach their bookings as well. The membership test is
  // customers.js's own `matchesIdentity`, never a second copy of the union rule.
  // `guestId` is cleared alongside the personal fields: it is the only thing
  // still binding the anonymized bookings into a customer, so leaving it would
  // leave the deleted guest sitting in the list under "Data removed".
  function deleteCustomer(ident){if(refused("customerDelete")) return;
    const o=(ident&&typeof ident==="object")?ident:{phone:ident};
    const key=normalizePhone(o.phone);
    if(!key&&!o.guestId&&!(o.guestIds&&o.guestIds.length)) return;
    saveBookings(function(prev){return prev.map(function(b){
      if(!matchesIdentity(b,o)) return b;
      return Object.assign({},b,{name:"Data removed",phone:"",notes:"",history:[],guestId:null,anonymized:true});
    });});
    if(key) saveWaitlist(function(prev){return prev.filter(function(w){return normalizePhone(w.phone)!==key;});},true);
    // v18.0.0 session 8: and the activity log's own copy of the name. Almost all
    // of the log erases itself — its text holds {b:<id>} tokens resolved against
    // the live bookings, so the anonymisation above rewrites what it displays —
    // but an entry for a DELETED booking has no row left to resolve against and
    // carries `subject.name`. That is the one field to reach.
    //
    // The key list is derived EXACTLY as matchesIdentity derives it, so the keys
    // erased can never be narrower than the bookings anonymised: a customer can
    // have absorbed several guest groups, and erasing under one key would leave
    // the others behind with nothing on screen to say so.
    redactGuest([key].concat(Array.isArray(o.guestIds)?o.guestIds:(o.guestId?[o.guestId]:[])));
  }

  // v17.16.11 (/code-review): the seed is the viewed date only when that is a
  // CANONICAL "YYYY-MM-DD", else today. `viewDate` is not always app-controlled
  // — SearchPanel's onPick puts a booking's stored date into it verbatim, and
  // that path is deliberately preserved so a malformed booking stays reachable
  // for repair — and this version's rules pin refuses a malformed `date` on a
  // CREATE, where the grandfather clause cannot apply. Without this the form
  // showed a BLANK date field (an <input type=date> cannot render "31/08/2026")
  // while the draft held the string, `doSave`'s `!f.date` guard passed it
  // because it is truthy, and the save was rejected by the server and parked.
  // It also flows on: `addFormToWaitlist` takes `f.date || viewDate`.
  //
  // `stepDate(d,0) === d` is the canonical test rather than a fourth date
  // predicate: a zero-day step returns a well-formed date or today, so it is
  // an IDENTITY exactly for the dates `<input type=date>` can render. A merely
  // steppable one like "2026-8-3" normalises to a DIFFERENT day, so comparing
  // rather than assigning is what stops the form inventing a date nobody chose.
  function openNew(){if(refused("bookingCreate"))return;pendingWaitlistRef.current=null;const seedDate=stepDate(viewDate,0)===viewDate?viewDate:todayStr();openForm(Object.assign({},EMPTY_FORM,{date:seedDate,phone:generalSettings.phonePrefix,size:generalSettings.defaultBookingSize}));setEditId(null);setError("");setSwapAffected(null);setShowForm(true);}
  function openEdit(b){if(refused("bookingEdit"))return;pendingWaitlistRef.current=null;openForm({name:b.name,phone:b.phone||generalSettings.phonePrefix,date:b.date,time:b.time,size:b.size,preference:b.preference,notes:b.notes||"",status:b.status,customDur:(b.originalDuration||b.duration)!==getDur(b.size)?(b.originalDuration||b.duration):null,deposit:b.deposit?String(b.deposit):"",voucherCode:b.voucherCode||"",manualTables:[],preferredTables:Array.isArray(b.preferredTables)?b.preferredTables.slice():[],returnOf:null,guestId:b.guestId||null,guestSeed:null});setEditId(b.id);setError("");setSwapAffected(null);setShowHistory(false);setShowForm(true);}
  // v14: Book Again — opens a fresh new-booking form pre-filled from an existing
  // booking. Date starts blank so staff must pick it; time carries over. The
  // `returnOf` field links back to the source booking so we can write history
  // on BOTH the new booking (when created) and the original (on successful save).
  // v14 p1 (Issue 3): reads sourceBooking.scheduledTime — NOT sourceBooking.time —
  // so the pre-filled time reflects the confirmed plan (e.g. 20:30), not the
  // seated-shifted time (e.g. 20:15). Fallback to .time for legacy bookings
  // without scheduledTime (sanitize also backfills it on load).
  function bookAgain(sourceBooking){
    if(!sourceBooking) return;
    pendingWaitlistRef.current=null;
    const schedTime=sourceBooking.scheduledTime||sourceBooking.time||"13:00";
    // v18.0.0 session 7: the source's PLANNED length rides along — Patryk's
    // choice over the actual stay, and the same reason this function reads
    // scheduledTime above: Book Again copies the plan. `plannedDuration`
    // recovers it through the seated shift, which rewrites `duration` AND
    // `originalDuration`. It is a custom duration only when it differs from the
    // size default — openEdit's rule — so a default-length booking still
    // re-derives when the guest count changes. Clamped to the form stepper's own
    // 15–480 bounds (BookingFormModal), so a corrupt legacy length cannot ride
    // into a new booking. This was `customDur:null`, which opened every Book
    // Again at the size default and silently dropped a long booking's length.
    const againSize=sourceBooking.size||2;
    const planned=plannedDuration(sourceBooking);
    const againDur=planned?Math.max(15,Math.min(480,planned)):null;
    // ── v18.0.0 session 8 (item 7): the guest's voucher comes with them ───────
    // Patryk: a voucher that was not fully redeemed must follow the guest into
    // the next booking. From a COMPLETED visit only — Patryk's call for the
    // seated case, and the one-live-booking rule is why: a seated visit is
    // still live and still holds its voucher, so copying the code here would
    // create exactly the conflict `attachRefusal` exists to refuse. That guest
    // is offered the carry at COMPLETION instead.
    //
    // Gated on the same predicate the picker uses, so the form never opens
    // holding an attachment that Save would reject: a voided, spent or expired
    // voucher, or one already on somebody's live booking, simply does not ride
    // along. `bookingId` is null because the booking does not exist yet.
    const againCode=(function(){
      if(!vouchersOn||sourceBooking.status!=="completed") return "";
      const c=normalizeCode(sourceBooking.voucherCode);
      if(!c) return "";
      const v=vouchersByCode[c];
      if(!v) return "";
      return attachRefusal(v,c,bookings,null,Date.now())?"":c;
    })();
    openForm(Object.assign({},EMPTY_FORM,{
      name:sourceBooking.name||"",
      phone:sourceBooking.phone||generalSettings.phonePrefix,
      date:"",
      time:schedTime,
      size:againSize,
      preference:sourceBooking.preference||"auto",
      preferredTables:Array.isArray(sourceBooking.preferredTables)?sourceBooking.preferredTables.slice():[],
      notes:"",
      customDur:againDur&&againDur!==getDur(againSize)?againDur:null,
      manualTables:[],
      voucherCode:againCode,
      status:"confirmed",
      returnOf:sourceBooking.id,
      // v17.10.0: Book Again on a PHONE-LESS guest is the same assertion as
      // picking them from the name dropdown — you are looking at their booking
      // and saying "them again" — so it joins them too. An existing guestId is
      // adopted; otherwise one is minted from the source and `guestSeed` asks
      // doSave to write it back. A source WITH a phone needs neither: the phone
      // copied above already is the identity.
      guestId:hasRealPhone(sourceBooking.phone)?null:(sourceBooking.guestId||("g"+sourceBooking.id)),
      guestSeed:(hasRealPhone(sourceBooking.phone)||sourceBooking.guestId)?null:sourceBooking.id
    }));
    setEditId(null);
    setError("");
    setSwapAffected(null);
    setShowHistory(false);
    setShowForm(true);
  }

  // ── Walk-in hook ────────────────────────────────────────────────────────────
  // Walk-in state (showWalkin / walkinForm / walkinError), today-scoped
  // numbering helper (getNextWalkinNum), and the three save handlers
  // (openWalkin / doSaveWalkin / saveWalkin). confirmKitchen is shared state
  // owned by BookingApp because doSave (booking-form save) also raises the
  // same modal — passed in as args so the hook can branch on it and raise
  // it. getUser is a function reference (late-bound to auth.currentUser at
  // call time); hoisting keeps the textual order valid. Phase D4 (v14.1.11).
  // See ./hooks/useWalkin.js.
  const {
    walkinForm, setWalkinForm,
    walkinError, walkinDirty,
    getNextWalkinNum,
    openWalkin: openWalkinRaw, saveWalkin, doSaveWalkin,
  } = useWalkin({
    bookings, saveBookings,
    setViewDate, getUser,
    confirmKitchen, setConfirmKitchen,
    showWalkin, setShowWalkin,   // v17.14.0: an entry in App's modal stack
    defaultWalkinSize: generalSettings.defaultWalkinSize,
  });
  // v18.0.0 phase 3: ONE gated wrapper, because `openWalkin` is reached from
  // four places — the header button, the floor plan's per-table action, the
  // keyboard ctx and `viewActionsRef` — and a guard per call site is the
  // hand-copied-list shape this repo keeps paying for.
  function openWalkin(t){if(refused("bookingCreate"))return;openWalkinRaw(t);}

  // ── v17.5.0: unsaved-changes guard — dirtiness + the guarded close paths ────
  // Origin: nothing in the app warned before losing a draft. On the tablets a
  // mis-tap on the modal scrim discarded a half-typed booking silently, and a
  // stray ⌘R did the same. Three surfaces hold real drafts; each diffs its live
  // state against the snapshot taken when it opened (see lib/drafts.js).
  //
  // Each `requestClose*` is the GUARDED door: clean → close immediately (an
  // untouched form must never nag, or staff learn to tap through the confirm);
  // dirty → raise the shared discard modal instead. The RAW setters stay in
  // place for the deliberate closes (a successful save, add-to-waitlist, the
  // cancel-booking confirm) — those already represent a decision.
  const formDirty=showForm&&!sameDraft(form,formBaseline);
  function requestCloseForm(){if(formDirty) setConfirmDiscard("form");else setShowForm(false);}
  function requestCloseWalkin(){if(walkinDirty) setConfirmDiscard("walkin");else setShowWalkin(false);}
  function requestCloseManual(){if(manualDirty) setConfirmDiscard("manual");else setManualTarget(null);}
  // v17.8.0: the remaining three drafting surfaces (ROADMAP "Ideas"). Settings
  // keeps its tab reset on BOTH paths — the clean close here and the discard
  // below — because that was part of the close behaviour before the guard, not
  // part of the guard.
  function closeSettings(){setShowSettings(false);setSettingsTab("general");}
  function requestCloseReminderEditor(){if(reminderDirty) setConfirmDiscard("reminder");else setReminderEditor(null);}
  function requestCloseBlock(){if(blockDirty) setConfirmDiscard("block");else setBlockTarget(null);}
  function requestCloseSettings(){if(settingsDirty) setConfirmDiscard("settings");else closeSettings();}
  // Commit the discard: shut the surface the modal was asked about.
  function doDiscard(){
    const which=confirmDiscard;
    setConfirmDiscard(null);
    if(which==="form") setShowForm(false);
    else if(which==="walkin") setShowWalkin(false);
    else if(which==="manual") setManualTarget(null);
    else if(which==="reminder") setReminderEditor(null);
    else if(which==="block") setBlockTarget(null);
    else if(which==="settings") closeSettings();
  }

  // Tab/window close + reload. Registered ONLY while something is dirty, so the
  // browser never nags on a clean page. Custom text is not possible — every
  // modern browser shows its own generic wording and ignores the string.
  const anyDirty=formDirty||walkinDirty||manualDirty||reminderDirty||blockDirty||settingsDirty;
  useEffect(function(){
    if(!anyDirty) return undefined;
    function onBeforeUnload(e){e.preventDefault();e.returnValue="";}
    window.addEventListener("beforeunload",onBeforeUnload);
    return function(){window.removeEventListener("beforeunload",onBeforeUnload);};
  },[anyDirty]);

  // ── v17.3.5: doSave split (de-monolith #3) ────────────────────────────────────────
  // The 199-line doSave was split for maintainability (the tech-debt plan's
  // final "Later" item): doSave() keeps the shared preamble (status-override
  // clone + all synchronous validations + the manual-table availability guard)
  // and dispatches to ONE of the two path helpers below — bodies moved
  // VERBATIM, still inside BookingApp so every closure read (bookings,
  // liveBookings, editId, swapAffected, tableBlocks, autoOptimizer, nowMins,
  // saveBookings…) is unchanged. `v` carries the preamble-derived values.
  // Early setError(...)+return exits inside a helper end the save exactly as
  // before (doSave has nothing after the dispatch); helper throws are caught
  // by doSave's try/catch. The v15.7.0 capture-intent-then-replay contract and
  // the prev-identity buildNextMemo are untouched.

  // v17.10.0: the guest-identity back-stamp is `stampGuestSeed` in
  // lib/customers.js — pure, tested, and called inside buildNext/applyBase so
  // the source booking and the new one ride ONE saveBookings call.
  function doSaveEdit(f,v){
    const size=v.size,cleanPhone=v.cleanPhone,mt=v.mt;
        const orig=bookings.find(function(b){return b.id===editId;});
        const origPt=(orig&&Array.isArray(orig.preferredTables))?orig.preferredTables.slice().sort().join(","):"";
        const newPt=Array.isArray(f.preferredTables)?f.preferredTables.slice().sort().join(","):"";
        const prefTablesChanged=origPt!==newPt;
        // v14: detect confirmed→seated transition here. Only auto-shift time if
        // staff did NOT manually edit time/date in the form (otherwise their
        // explicit edit wins). Compute BEFORE needsR so we can suppress reshuffle.
        // v18.0.0 session 8 (item 5b): the plan numbers are computed ABOVE the
        // seated shift now, because the shift needs them. They sat below it,
        // and that ordering IS the ROADMAP entry this commit deletes — the
        // shift pinned the scheduled end from the STORED duration and then
        // overwrote every length the form had just set.
        const formPlan=f.customDur||getDur(size);
        const origPlan=orig?(orig.originalDuration||orig.duration||90):formPlan;
        const planChanged=formPlan!==origPlan;
        const seatingNow=orig&&orig.status!=="seated"&&f.status==="seated";
        const timeUntouched=orig&&f.time===orig.time&&f.date===orig.date;
        let seatedShift=null;
        if(seatingNow&&timeUntouched){
          // Use live-synced bookings so overstaying seated guests' tables are
          // correctly treated as occupied when the overlap guard runs. The
          // length handed in is the one being SAVED — see seatedShiftFor.
          seatedShift=seatedShiftFor(orig,nowMins,liveBookings,today,planChanged?formPlan:0);
        }
        const needsR=!orig||size!==orig.size||f.time!==orig.time||f.date!==orig.date||f.preference!==orig.preference||f._clearManual||prefTablesChanged;
        // v18.0.0 session 8 (C4): `prefOnly` is gone. It existed only to EXEMPT
        // a preference-or-preferred-tables change from the displacement guard,
        // and a preference change moves tables like any other — it can leave
        // somebody else with none. The exemption is the finding.
        let saveDur=planChanged?formPlan:(orig?(orig.duration||90):formPlan);
        const saveOrigDur=planChanged?formPlan:origPlan;
        let saveCustDur=planChanged?(f.customDur||null):(orig?(orig.customDur||null):(f.customDur||null));
        // v16.2.0: truncate to the actual span ONLY when the booking was SEATED
        // before this save. A direct Confirmed → Completed edit keeps the form's
        // scheduled duration (mirrors the updateStatus quick-action gate).
        // v17.16.2 (CT-2B-02): was `nowMinsLocal - toMins(f.time)`, which mixes
        // an axis measured from TODAY's midnight with one measured from the
        // BOOKING's — so completing a booking dated anything but today clamped to
        // the 15-minute floor. seatedElapsed projects and caps at that day's
        // close, so this agrees with what auto-complete would have written.
        if(f.status==="completed"&&orig&&orig.status==="seated"&&!f.customDur){const now=new Date();const actualDur=Math.max(15,seatedElapsed({date:f.date,time:f.time},todayStr(now),now.getHours()*60+now.getMinutes()));saveDur=actualDur;saveCustDur=actualDur;}
        // v17.6.0: record how long they ACTUALLY stayed, so the List card can
        // show it after the visit (booking-logic's stayedMins). Computed for
        // EVERY seated→completed save, including the `f.customDur` case the
        // truncation above skips — how long the party sat is a fact about the
        // visit, independent of the duration the user chose to store. 0 leaves
        // the existing value alone (never overwrite a real stay with a blank).
        let saveStayed=orig?(Number(orig.stayedMin)||0):0;
        if(f.status==="completed"&&orig&&orig.status==="seated"){
          const nowD=new Date();
          // Same axis fix as the truncation above — the register's "completing
          // records stayedMin = 15".
          saveStayed=Math.max(15,seatedElapsed({date:f.date,time:f.time},todayStr(nowD),nowD.getHours()*60+nowD.getMinutes()));
        }
        // Apply seated shift (if any) to the values we'll write. Overrides plan
        // numbers above — the shift always wins over default-duration logic.
        let saveTime=f.time;
        if(seatedShift){
          saveTime=seatedShift.newTime;
          saveDur=seatedShift.newDuration;
          saveCustDur=seatedShift.newDuration;
        }
        // v18.0.0 session 8 (C1): the seated shift's inverse. Walking a booking
        // out of seated to Confirmed or Pending puts the booked start and the
        // booked length back — `applySeatedShift` had rewritten both and nothing
        // undid it, so the booking kept the time the party arrived as the time
        // it was booked for. Not for completed or cancelled: a finished visit's
        // times are the record of what happened, and completion truncates the
        // duration deliberately (v16.2.0).
        //
        // Gated on `timeUntouched` for the same reason the shift is — an
        // explicit edit in this save wins over the automatic value — and the
        // LENGTH half additionally on `!planChanged`, so a length typed in the
        // same save survives. The start still moves back in that case: a start
        // and a length are two decisions, and only one of them was made here.
        const unseating=orig&&orig.status==="seated"&&(f.status==="confirmed"||f.status==="pending")&&timeUntouched;
        const unseat=unseating?unseatRestore(orig,size):null;
        if(unseat){
          saveTime=unseat.time;
          if(!planChanged){saveDur=unseat.duration;saveCustDur=unseat.customDur;}
        }
        // Built here, where both halves of what was actually written are known.
        const unseatHist=unseat?histEntry("un-seated: time restored "+orig.time+" → "+saveTime+(planChanged?"":", length "+(orig.duration||0)+" → "+saveDur+" min"),getUser()):null;
        const clearM=!!f._clearManual;
        const wasSeatedLocked=orig&&isLocked(orig)&&!mt.length;
        // ── v17.15.5: a FINISHED booking's tables are a historical record ────
        // Completed and cancelled bookings are the two `applyOpt` refuses to
        // place — it copies them straight through. `doSaveEdit` did not agree
        // with it, and the disagreement produced two different bugs depending
        // on one flag nothing in the form shows you:
        //
        //   • LOCKED (every walk-in, every drag-drop, every manual assign) —
        //     `unlockForOpt` rewrites the status to "confirmed" BEFORE
        //     `bookingsAfterAction`, precisely so the optimiser will consider a
        //     booking it would otherwise skip. That makes `applyOpt`'s
        //     completed guard miss it, the optimiser reassigns it, and the
        //     restore below puts "completed" back on top of the NEW tables.
        //     Measured live: changing a completed party from 4 to 5 moved it
        //     from table 7 to tables 1A + 1B — i.e. the app rewrote where a
        //     party that has already left had sat.
        //   • NOT LOCKED — `tables: []` is written, `applyOpt` will not refill
        //     a completed booking, and the capacity guard below rejects the
        //     save with "No tables available at this time". Measured live: a
        //     completed booking's party size cannot be changed at all, and the
        //     error blames the restaurant being full.
        //
        // Both directions are the same disagreement, so one flag settles it:
        // while the booking is being SAVED as finished, its tables are carried
        // through verbatim and it is never handed to the optimiser. An explicit
        // manual assignment (`mt`) or an explicit clear (`clearM`) still wins —
        // those are the user saying so, which is different from the optimiser
        // deciding on its own.
        //
        // It keys on `f.status`, not `orig.status`: walking a completed booking
        // back to confirmed in the same save SHOULD return it to normal
        // placement, and seating→completing one in the same save should pin the
        // table it was actually sat at.
        const editFinished=f.status==="completed"||f.status==="cancelled";
        // v18.0.0 session 8 (item 3): the same rule, one status wider — a
        // booking being saved as SEATED keeps its tables too, because the party
        // is sitting at them. `tablesPinned` is the one predicate; see its note
        // in booking-logic.js for what was measured. `editFinished` survives for
        // exactly one guard below, where the two questions genuinely differ.
        const pinned=tablesPinned(f.status,mt.length>0,clearM);
        // Hoisted out of buildNext: this exact expression was written twice —
        // once to unlock and once to restore — and two copies of a condition
        // that must agree is how they stop agreeing.
        const unlockForOpt=needsR&&wasSeatedLocked&&!mt.length&&!clearM&&!pinned;
        // ── v18.0.0 session 8 (C): two questions, not one ────────────────────
        // `needsR` was answering both "must the placement be re-checked?" and
        // "must the tables be re-chosen?", and a length change and a revival
        // are in NEITHER of its terms — so those saves went straight to
        // `bookingsAfterAction`, whose optimiser-OFF branch keeps every
        // booking's tables, including one somebody else now holds.
        //
        // Measured live 2026-09-11: R3 — a 17:00 booking extended 90 → 120 was
        // saved ON TOP of another party's 18:30 booking on 5A, and the
        // reconciliation effect moved it to 1B 400ms later under "Resolved a
        // table conflict after syncing"; R4 — a cancelled booking walked back
        // to Confirmed kept a table that had since been given away, and went
        // the same way. Neither had synced anything.
        //
        // So: re-CHECK on a window change of any kind; re-CHOOSE only when the
        // tables it has no longer work for that window. A check-only save that
        // is still free keeps exactly the tables it had.
        const revived=!!orig&&(orig.status==="cancelled"||orig.status==="completed")&&f.status!=="cancelled"&&f.status!=="completed";
        const recheck=needsR||planChanged||revived||!!unseat;
        const winStart=toMins(saveTime);
        const keepsWindowTables=(recheck&&!needsR&&!mt.length&&!pinned)
          ? tablesFreeFor(bookings,f.date,editId,(orig&&orig.tables)||[],winStart,winStart+saveDur,tableBlocks)
          : false;
        const forceReassign=!mt.length&&!pinned&&(needsR||(recheck&&!keepsWindowTables));
        // v17.4.0: the diff string is computed ONCE — it feeds the history entry
        // AND the undo gate below. diffBooking returns the sentinel "saved (no
        // field changes)" when nothing moved, which is exactly when undo must
        // NOT be armed (saveBookings still returns true for an empty patch —
        // persist() skips the write but reports dispatched — so `ok` alone
        // would offer an Undo for a save that changed nothing).
        const editDiff=orig?diffBooking(orig,f,size,generalSettings.phonePrefix):"";
        const editChanged=!!orig&&editDiff!=="saved (no field changes)";
        const editHist=orig?histEntry("edited: "+editDiff,getUser()):histEntry("edited",getUser());
        // v14 p1: scheduledTime resolution.
        // - If user manually changed time in the form (f.time !== orig.time), that
        //   is an explicit reschedule → scheduledTime follows the new time.
        // - If the ONLY time change is the seated-shift (auto), scheduledTime stays
        //   pinned to the original — this is what "Book Again" reads from later.
        // - For pre-v14 bookings without scheduledTime, sanitize already backfilled it.
        const userChangedTime=orig&&f.time!==orig.time;
        const saveScheduledTime=userChangedTime?f.time:(orig&&orig.scheduledTime?orig.scheduledTime:f.time);
        // v14 p1 (Issue 2 fix #2): when a seated-shift happens, originalDuration
        // must also move to the new duration so the ghost bar anchors at the true
        // scheduled end (e.g. 20:15 + 105 = 22:00), not at the stale 21:45.
        const saveOrigDurFinal=seatedShift?seatedShift.newDuration:((unseat&&!planChanged)?unseat.originalDuration:saveOrigDur);
        // v14: when seating, force no-reshuffle of other bookings (same rule as
        // updateStatus). The seated-shift must not trigger cascading table moves.
        const optStateForSave=seatingNow?false:autoOptimizer;
        // v15.7.0: build the next state as a PURE transform of `prev` (the live
        // in-memory snapshot at write time) rather than a precomputed array. This
        // opts the edit save into the function-form path in saveBookings, so a
        // stale-gate hold now shows the change optimistically + auto-retries on
        // fresh data (parity with quick actions), instead of bouncing the form back
        // with "tap Save again". The captured edit fields (computed once from `orig`)
        // are applied to whichever version of the booking is in fresh `prev`, so a
        // concurrent edit to OTHER bookings (which live in `prev`) is preserved.
        function buildNext(prev){
          const upd=stampGuestSeed(prev,f).map(function(b){
            if(b.id===editId){
              let h=(b.history||[]).concat([editHist]);
              if(seatedShift) h=h.concat([histEntry("seated "+seatedShift.direction+": time adjusted "+seatedShift.oldTime+" → "+seatedShift.newTime,getUser())]);
              if(unseatHist) h=h.concat([unseatHist]);
              return Object.assign({},b,{name:f.name,phone:cleanPhone,date:f.date,time:saveTime,scheduledTime:saveScheduledTime,size:size,duration:saveDur,originalDuration:saveOrigDurFinal,preference:f.preference,notes:f.notes,deposit:Math.max(0,Number(f.deposit)||0),voucherCode:normalizeCode(f.voucherCode),status:unlockForOpt?"confirmed":f.status,tables:mt.length?mt:(clearM?[]:((!needsR||pinned)?b.tables:[])),customDur:saveCustDur,stayedMin:saveStayed,guestId:f.guestId||b.guestId||null,_manual:mt.length>0?true:(clearM?false:b._manual),_locked:mt.length>0?true:(clearM?false:(unlockForOpt?false:b._locked)),preferredTables:Array.isArray(f.preferredTables)?f.preferredTables:[],history:h});
            }
            if(swapAffected){const match=swapAffected.find(function(ab){return ab.id===b.id;});if(match){const remaining=(b.tables||[]).filter(function(t){return !match.tables.includes(t);});return Object.assign({},b,{tables:remaining,_locked:false,_manual:false});}}
            return b;
          });
          let out=bookingsAfterAction(upd,f.date,tableBlocks,editId,forceReassign,optStateForSave);
          // v18.0.0 session 8 (C1): the flags go back to what they WERE, not to
          // "does it have tables now". `wasSeatedLocked` is `isLocked(orig)`,
          // which is true for any seated booking — so walking an ordinary one
          // back to Confirmed with a time change stamped it `_locked` +
          // `_manual` and quietly turned it into a manual arrangement the
          // optimiser would never touch again. A walk-in, which really was
          // locked before the seat, still comes back locked.
          if(unlockForOpt){out=out.map(function(b){if(b.id===editId) return Object.assign({},b,{status:f.status,_locked:!!(orig&&orig._locked),_manual:!!(orig&&orig._manual)});return b;});}
          // v18.0.0 session 8: with the tables pinned, the optimiser-OFF path
          // keeps EVERY booking's tables — including anyone the new window now
          // overlaps. Re-place them here, before Save, rather than saving the
          // clash and leaving the reconciliation effect to move somebody 400ms
          // later under a toast that blames syncing (R3/R4's own mechanism).
          // With the optimiser ON this has already happened inside `applyOpt`,
          // which places everyone around a locked booking, so the call is a
          // no-op there and returns its input.
          if(pinned&&needsR) out=replacePinnedClashes(out,f.date,editId,tableBlocks,optStateForSave);
          return out;
        }
        // /code-review perf: buildNext runs a full optimiser pass (expensive on
        // a loaded day). Memoised by `prev` IDENTITY so the synchronous guard
        // check below and the immediate dispatch (updater called with the same
        // `bookings` reference — 2×, 3× under dev StrictMode) share ONE pass. A
        // retry replay gets a FRESH prev ref → recomputes, exactly as the
        // v15.7.0 capture-intent contract requires.
        const buildNextMemo=memoByPrev(buildNext);
        const fin=buildNextMemo(bookings);
        // v18.0.0 session 8 (item 3) — the pinned save's own refusals, in the
        // order the party at the table makes necessary. Each leaves the form
        // open with its message, like every other refusal here. The
        // displacement guard below is deliberately the one after: a booking
        // `replacePinnedClashes` could NOT re-place arrives there with no
        // tables, which is exactly the input that guard was written for.
        if(pinned&&f.status==="seated"){
          const seatB=fin.find(function(b){return b.id===editId;});
          // C2, at the form's door. Gated on `seatingNow` for the reason the
          // predicate's own note gives: the app refuses to CREATE a seated
          // booking with no table, and does not hold an unrelated edit of one
          // that already exists hostage to it.
          if(seatingNow){const noTable=seatRefusal(seatB);if(noTable){setError(noTable);return;}}
          if(orig&&f.date!==orig.date){setErrorField("date");setError("A seated booking can't be moved to another date — change the status first.");return;}
          const fitRefusal=seatedFitRefusal(size,seatB?seatB.tables:[]);
          if(fitRefusal){setError(fitRefusal);return;}
          const lockedClash=pinnedClashParties(fin,f.date,editId).locked;
          if(lockedClash.length){setError(pinnedClashRefusal(lockedClash[0]));return;}
        }
        if(!mt.length&&recheck){
          const prevAssigned=bookings.filter(function(b){return b.date===f.date&&isActive(b)&&b.tables&&b.tables.length>0&&b.id!==editId;});
          const displaced=fin.filter(function(b){return b.id!==editId&&b.date===f.date&&isActive(b)&&(!b.tables||!b.tables.length||b._conflict);});
          const kicked=displaced.filter(function(d){return prevAssigned.some(function(p){return p.id===d.id;});});
          if(kicked.length>0){setError("Not enough capacity — this change would displace "+kicked.length+" existing booking"+(kicked.length>1?"s":"")+": "+kicked.map(function(k){return k.name;}).join(", ")+".");return;}
        }
        // v17.15.5 (/code-review): `!editFinished`. This guard means "the
        // optimiser could not place the booking", and a finished booking is
        // never offered to the optimiser at all — its tables are carried
        // through. Without the exclusion the fix above is only half applied:
        // a booking whose tables are ALREADY empty carries `[]` through, the
        // guard reads that as a placement failure, and the save is rejected
        // with a message about the restaurant being full. Reachable by ordinary
        // use — a booking the app could not place shows "No table assigned"
        // and carries `_conflict` with `tables: []`; cancel it, then correct
        // its party size, and the edit is refused for a table it never had.
        if(!mt.length&&recheck&&!editFinished){
          const editedInFin=fin.find(function(b){return b.id===editId;});
          if(editedInFin&&(!editedInFin.tables||!editedInFin.tables.length)){setError("No tables available at this time — see suggestions below.");return;}
        }
        // v15.7.0: dispatch the function form. ok===true → saved now; ok===false →
        // held by the stale gate but shown optimistically + queued for auto-retry on
        // fresh data (the resyncing banner informs the user). Either way the form's
        // job is done, so close it. Flash only on a real save (never claim "saved"
        // for a not-yet-persisted write — matches quick-action honesty).
        const ok=saveBookings(buildNextMemo);
        // WhatsApp sandbox: if this edit came from a modify request's "Apply
        // changes", auto-mark that request handled — but only on a real save.
        wa.completeModifyApply(editId, ok);
        // C8: a save that seats passes `optStateForSave: false`, so no table was
        // re-optimised and the toast must not say one was.
        if((needsR||swapAffected||f.status==="completed"||seatingNow)&&ok) flash(seatingNow?"saved":null);
        // v17.4.0: form edits are undoable — the pre-edit `orig` is the snapshot
        // (undo swaps it back in wholesale, incl. tables/status/duration).
        if(ok&&editChanged) armUndo(undoDelta(bookings,fin),editId,"edit",false);
        // v17.16.0: armed only HERE — after the write is dispatched, on the
        // line that closes the form. Every early return above leaves the form
        // open with an error and the guard READY, so Save still works.
        saveGuardRef.current=DISPATCHED;
        setShowForm(false);setViewDate(f.date);
        // v18.0.0 session 7: the seat note, at the form's door — here, after the
        // dispatch and the close, and never earlier: every early return above
        // leaves the form open with an error, and none of those is a seat. The
        // snapshot is the EDITED booking, so a note typed in this save is shown.
        const seatSnap=seatNoteFor(orig&&orig.status,f.status,fin.find(function(b){return b.id===editId;}));
        if(seatSnap) setSeatNote(seatSnap);
  }
  function doSaveNew(f,v){
    const size=v.size,dur=v.dur,cleanPhone=v.cleanPhone,mt=v.mt;
        const newId=genId();
        // v14: Book Again flow. When f.returnOf is set, the new booking links
        // back to its source, gets a distinctive "created via Book Again" entry
        // in its own history, and the ORIGINAL booking gets a matching entry
        // indicating the customer re-booked.
        // v14 p1: history references source.scheduledTime (the confirmed time)
        // rather than source.time, so "created via Book Again (from X on YYYY-MM-DD
        // at 20:30)" stays accurate even if the source was seated-shifted to 20:15.
        const returnOfId=f.returnOf||null;
        const source=returnOfId?bookings.find(function(b){return b.id===returnOfId;}):null;
        const sourceSchedTime=source?(source.scheduledTime||source.time):"";
        const createHist=source?histEntry("created via Book Again (from "+source.name+" on "+source.date+" at "+sourceSchedTime+")",getUser()):histEntry("created",getUser());
        // v16.3.0: "Repeat weekly" — create a standing-booking rule from these
        // fields (weekday from the booking date, UTC) and stamp THIS first
        // occurrence with the rule's id + date so the generator dedupes it. Done
        // once here (outside buildNext) so a retry replay never makes a 2nd rule.
        let recStampId=null;
        if(f.repeatWeekly&&f.name&&f.name.trim()&&f.date&&f.time){
          const rule=addRule({name:f.name,phone:cleanPhone,size:size,weekday:new Date(f.date).getUTCDay(),time:f.time,preference:f.preference,notes:f.notes});
          recStampId=rule.id;
        }
        // v14 p1: scheduledTime=f.time on creation. v17.0.0: new bookings start
        // confirmed, OR pending via the "Save pending" button (status override).
        const nb={id:newId,name:f.name,phone:cleanPhone,date:f.date,time:f.time,scheduledTime:f.time,size:size,duration:dur,originalDuration:dur,preference:f.preference,notes:f.notes,deposit:Math.max(0,Number(f.deposit)||0),voucherCode:normalizeCode(f.voucherCode),status:(f.status==="pending"?"pending":"confirmed"),tables:mt.length?mt:[],customDur:f.customDur||null,_manual:mt.length>0,_locked:mt.length>0,preferredTables:Array.isArray(f.preferredTables)?f.preferredTables:[],returnOf:returnOfId,recurringId:recStampId,recurringDate:recStampId?f.date:null,guestId:f.guestId||null,history:[createHist]};
        // v15.7.0: build the next state as a PURE transform of `prev` (see the edit
        // path above) so the new-booking save joins the optimistic-show + auto-retry
        // path. `newId`/`nb` are computed once (stable id) → a held/rejected write
        // replayed on fresh data can never duplicate the booking (the defensive
        // filter below also drops any stray match before re-adding it).
        function applyBase(prev){
          let base=stampGuestSeed(prev,f).filter(function(b){return b.id!==newId;});
          if(swapAffected){base=base.map(function(b){const match=swapAffected.find(function(ab){return ab.id===b.id;});if(match){const remaining=(b.tables||[]).filter(function(t){return !match.tables.includes(t);});return Object.assign({},b,{tables:remaining,_locked:false,_manual:false});}return b;});}
          // If this is a Book Again creation, append a back-reference entry to the
          // source booking's history (purely informational — no status/table change).
          if(source){
            base=base.map(function(b){
              if(b.id!==returnOfId) return b;
              return Object.assign({},b,{history:(b.history||[]).concat([histEntry("Book Again → new booking on "+f.date+" at "+f.time,getUser())])});
            });
          }
          return base;
        }
        // v17.16.6 (CT-2B-08): the guest id is resolved against `prev` HERE rather
        // than baked into `nb` above, because `nb` is built once at Save time while
        // this runs again on every replay. The draft's id was minted when the name
        // was picked; if the seed has been joined since — by another device, through
        // a different booking of the same guest — adopting the seed's id is what
        // keeps the two in one group. See `resolveGuestId` for why the seed wins.
        // `newId` is untouched, so the stable-id property the comment above relies
        // on is unaffected.
        function buildNext(prev){return bookingsAfterAction(applyBase(prev).concat([Object.assign({},nb,{guestId:resolveGuestId(prev,f)})]),f.date,tableBlocks,newId,!mt.length,autoOptimizer);}
        // /code-review perf: prev-identity memo — one optimiser pass shared by
        // the guard check + the immediate dispatch (see the edit path above).
        const buildNextMemo=memoByPrev(buildNext);
        const base=applyBase(bookings);
        const fin=buildNextMemo(bookings);
        if(!mt.length){
          const ne=fin.find(function(b){return b.id===newId;});
          if(!ne||(ne.tables||[]).length===0){setError("Could not assign a table — try manual assignment.");return;}
          const displaced=fin.filter(function(b){return b.id!==newId&&b.date===f.date&&isActive(b)&&(!b.tables||!b.tables.length||b._conflict);});
          const prevAssigned=base.filter(function(b){return b.date===f.date&&isActive(b)&&b.tables&&b.tables.length>0;});
          const kicked=displaced.filter(function(d){return prevAssigned.some(function(p){return p.id===d.id;});});
          if(kicked.length>0){setError("Not enough capacity — adding this booking would displace "+kicked.length+" existing booking"+(kicked.length>1?"s":"")+": "+kicked.map(function(k){return k.name;}).join(", ")+".");return;}
        }
        // v15.7.0: dispatch the function form (see the edit path). Held → optimistic
        // show + auto-retry; flash only on a real save.
        const ok=saveBookings(buildNextMemo);
        // WhatsApp sandbox: if this save came from accepting a draft, flip the
        // source conversation to "accepted" + link the new booking id (no-op
        // otherwise — draftSourceRef is only set by handleAcceptDraft).
        wa.completeDraftAccept(newId);
        // …and if this NEW booking's phone matches a WhatsApp conversation that
        // isn't linked yet (booking typed manually, not via Accept & open),
        // link it so the conversation shows the LinkedBookingCard.
        wa.linkBookingByPhone(newId, f.phone);
        if(ok) flash();
        // v16.0.0: this new booking converted a waitlist entry (Book from the
        // panel) — remove the entry now the booking is dispatched (a held write
        // shows optimistically + auto-retries, so the intent stands either way).
        if(pendingWaitlistRef.current){removeFromWaitlist(pendingWaitlistRef.current);pendingWaitlistRef.current=null;}
        // v17.16.0: armed only HERE — after the write is dispatched, on the
        // line that closes the form. Every early return above leaves the form
        // open with an error and the guard READY, so Save still works.
        saveGuardRef.current=DISPATCHED;
        setShowForm(false);setViewDate(f.date);
  }
  function doSave(){
    // v17.16.0: has this open of the form already dispatched a save? The form is
    // still mounted and clickable for EXIT_MS while it fades out, so a second tap
    // lands on a live Save button — see src/lib/submitGuard.js. Checked before
    // validation: a refused save must not depend on the draft being valid.
    if(!mayDispatch(saveGuardRef.current)) return;
    // v17.0.0: apply the pending/confirm status override to a CLONE of the form
    // so every downstream read (status write, diffBooking history, completed-
    // duration gate, flash condition) sees the effective status uniformly.
    const so=statusOverrideRef.current;
    const f=so?Object.assign({},formRef.current,{status:so}):formRef.current;
    // v17.12.0: cleared here, set only by the field-specific branches below, so
    // the form-level errors further down leave it null without having to say so.
    setErrorField(null);
    try{
      if(!f.name||!f.name.trim()){setErrorField("name");setError("Customer name is required.");return;}
      // v14 p1 (Issue 3): date is required. Applies to both new bookings (including
      // Book Again) and edits. Walk-ins use today automatically so they are unaffected.
      if(!f.date){setErrorField("date");setError("Please set a date.");return;}
      if(!f.time){setErrorField("time");setError("Please set a time.");return;}
      // v18.0.0 phase 6 (CT-WA-01). "Is there a time" and "is there a time this
      // app can use" are different questions, and only the first was asked.
      // `toMins` on an unreadable string yields NaN, and BOTH range comparisons
      // below are false against NaN — so the range gate, the one thing standing
      // between a garbage time and the database, passed everything. The security
      // rules pin `date` and deliberately do NOT pin `time` (see
      // database.rules.json), so nothing server-side refuses it either; the
      // booking lands, and `sanitize` then shows it to every device as 13:00.
      //
      // Measured live on 2026-09-10: a WhatsApp draft carrying
      // `time: "8 in the evening"` saved, stored verbatim, and displayed as a
      // 13:00 booking. Nothing the form can produce moves — an <input type=time>
      // yields "" (already caught above) or HH:MM — which is the same test
      // v17.16.5 applied when it added this predicate for `sanitize`.
      if(!isReadableTime(f.time)){setErrorField("time");setError("That time could not be read — please set it again.");return;}
      const sm=toMins(f.time);
      // v15.0.0: per-weekday hours — validate against THIS booking's date, not the
      // viewed day, and block a closed day outright.
      const fh=hoursFor(f.date);
      if(fh.closed){const wd=WEEKDAY_LONG[new Date(f.date).getUTCDay()]||"that day";setErrorField("date");setError("Closed on "+wd+"s — pick another date, or open that day in Settings.");return;}
      if(sm<fh.open*60||sm>fh.close*60){setErrorField("time");setError("Bookings on this day are accepted between "+String(fh.open).padStart(2,"0")+":00 and "+String(fh.close%24).padStart(2,"0")+":00.");return;}
      // v18.0.0 session 8 (C7): a start exactly AT closing passed the test above
      // (`sm > close*60`), and `findTimes` has never offered one — it stops at
      // close − 15. A 22:00 booking on a day that closes at 22:00 is a party
      // arriving as the door is locked, and the close-time auto-complete flips
      // it to completed on the next 15s tick, so it reads as a visit that
      // already happened. The message names the last start rather than the
      // close, because that is the number somebody needs to type.
      if(sm>=fh.close*60){const wd=WEEKDAY_LONG[new Date(f.date).getUTCDay()]||"that day";setErrorField("time");setError("The last start on "+wd+"s is "+toTime(lastStartMins(fh.close))+".");return;}
      const size=Number(f.size)||2;
      const dur=f.customDur||getDur(size);
      const cleanPhone=cleanPhoneOf(f.phone);
      const mt=Array.isArray(f.manualTables)&&f.manualTables.length>0?f.manualTables:[];
      // v16.0.0 follow-up: completed bookings excluded from the busy set — a
      // completed visit is over, its table is free (mirrors ManualModal +
      // WalkinForm; the optimizer already ignores completed via isActive).
      if(mt.length&&!swapAffected){let ex=liveBookings.filter(function(b){return b.date===f.date&&b.status!=="cancelled"&&b.status!=="completed"&&b.id!==editId;}).map(function(b){return {tables:b.tables||[],s:toMins(b.time),e:occupancyEnd(b,nowMins,today)};});ex=ex.concat(getBlockSlots(tableBlocks,f.date));if(!canAssign(mt,ex,sm,padEnd(sm+dur))){setError("Selected tables are not available at this time.");return;}}
      // v18.0.0: the second hook point. AFTER validation and immediately before
      // the dispatch, so a form that is about to be refused for a missing name
      // never asks a money question first. Both entries to `doSave` pass
      // through here — the button's `save()` and the kitchen confirm's direct
      // re-entry — which is why the gate is here and not in `save()`.
      if(editId&&!redeemAskedRef.current&&voucherToAsk(editId,f.status)){
        setVoucherAsk({id:editId,status:f.status,from:"form"});
        return;
      }
      // The walk-back question, at the same point and behind the same ref. The
      // form is the ONLY way a booking leaves `completed` for Confirmed/Seated/
      // Pending — `updateStatus` covers the popup and the List buttons, and gets
      // the same gate below.
      if(editId&&!redeemAskedRef.current&&voucherToRestore(editId,f.status)){
        setVoucherBack({id:editId,status:f.status,from:"form"});
        return;
      }
      // v18.0.0 session 8 (C3): the form's door to the same question, at the
      // same point as the voucher gates — after validation, immediately before
      // the dispatch, so a save about to be refused for a missing name never
      // asks about somebody else's table first.
      if(editId&&!seatAskedRef.current&&f.status==="seated"){
        const seatOrig=bookings.find(function(x){return x.id===editId;});
        if(seatOrig&&seatOrig.status!=="seated"){
          const parties=seatClashParties(mt.length?mt:(seatOrig.tables||[]),f.date,editId,bookings);
          if(parties.length){setSeatClash({id:editId,status:"seated",from:"form",others:seatClashSnap(parties)});return;}
        }
      }
      if(editId) doSaveEdit(f,{size:size,dur:dur,cleanPhone:cleanPhone,mt:mt});
      else doSaveNew(f,{size:size,dur:dur,cleanPhone:cleanPhone,mt:mt});
    }catch(err){setError("Error: "+err.message);}
  }
  function save(statusOverride){
    // v17.16.0: the guard is checked HERE as well as in doSave, because this is
    // the button's handler and it can return before doSave is ever reached. On a
    // double-tap the first tap's booking is already in `bookings`, so the kitchen
    // load below is one higher — enough to cross KITCHEN_TABLE_LIMIT and raise
    // "Kitchen busy" for a booking that has already been written, over a form
    // that has already closed. doSave would then refuse the duplicate correctly,
    // but the stray dialog would have been produced by the very tap this fix
    // exists to make inert. The kitchen round-trip is unaffected: its Confirm
    // button re-enters doSave() directly, with the guard still READY.
    if(!mayDispatch(saveGuardRef.current)) return;
    // v17.0.0: record the override FIRST — the kitchen-confirm path re-enters
    // doSave() without args, so the intent must survive the modal round-trip.
    statusOverrideRef.current=statusOverride||null;
    const f=formRef.current;
    if(!f.time) return doSave();
    const size=Number(f.size)||2;const d=f.customDur||getDur(size);
    // v18.0.0 session 8 (R6): ask only about a save the kitchen would notice.
    // A notes-only edit in a busy slot raised this confirm, which trains people
    // to tap past the dialog that means something on the save after it.
    const kitchenOrig=editId?bookings.find(function(b){return b.id===editId;}):null;
    const load=getKitchenLoad(bookings,f.date,f.time,d,editId);
    if(kitchenRelevant(kitchenOrig,f,size)&&load.starts+1>=KITCHEN_TABLE_LIMIT&&!confirmKitchen){
      setConfirmKitchen("form");return;
    }
    setConfirmKitchen(null);doSave();
  }

  function forceReshuffle(){if(saveBookings(function(b){return applyOpt(b,viewDate,tableBlocks);})) flash();}
  // Reassign a single booking to a different set of tables without touching any
  // other booking. Used by the overlap warning's Reassign button when Optimizer
  // is OFF and staff need a quick escape hatch for a booking about to be crowded
  // out by an overstaying guest. Skips locked bookings (manual intent preserved).
  // v14: feeds liveBookings into findFreeSlot so already-overstaying seated
  // guests' tables are correctly treated as occupied.
  // v14 p1 (Issue 1 fix): ALSO transiently extends the duration of any seated
  // booking that is about to overstay onto the target's window (identified via
  // overlapWarnings). Without this, a seated booking ending in e.g. 9 min is
  // not yet "overstaying" per syncLiveDurations — its tables would falsely read
  // as free at target.time, and findFreeSlot would return the same tables the
  // target already has. We only extend for this one lookup; state is unchanged.
  function reassignBooking(id){
    const target=bookings.find(function(b){return b.id===id;});
    if(!target){setError("Booking not found.");return;}
    if(isLocked(target)){setError("Booking is manually locked. Edit manually to change tables.");return;}
    const targetStart=toMins(target.time);
    const targetEnd=targetStart+(target.duration||90);
    // Build a search-view where any seated booking currently flagged as blocking
    // THIS target (or any seated booking sharing tables whose scheduled end is
    // before target.time) is stretched to at least targetStart+1 minute. That
    // guarantees findFreeSlot treats their tables as busy at target's start.
    const searchView=liveBookings.map(function(b){
      if(b.id===target.id) return b;
      if(b.status!=="seated") return b;
      if(b.date!==target.date) return b;
      const tables=b.tables||[];
      const sharesTable=tables.some(function(t){return (target.tables||[]).includes(t);});
      if(!sharesTable) return b;
      const bs=toMins(b.time);
      const be=bs+(b.duration||90);
      // Only extend if the seated booking ends before target's END (i.e., it could
      // plausibly overlap or free up within target's window). If it already runs
      // past target end, syncLiveDurations handled it.
      if(be>=targetEnd) return b;
      // Extend to cover target fully so findFreeSlot never considers these tables.
      const extendedDur=targetEnd-bs;
      return Object.assign({},b,{duration:extendedDur});
    });
    const tables=findFreeSlot(searchView,target.date,target.time,target.size||2,target.preference||"auto",target.duration||90,tableBlocks,id,target.preferredTables);
    if(!tables||!tables.length){setError("No alternative tables available for "+target.name+" at "+target.time+".");return;}
    // Sanity: if findFreeSlot returned the same tables (possible if the algorithm
    // found a valid-but-unchanged assignment), surface it as a no-op rather than
    // silently "succeeding" with nothing changed.
    const curKey=(target.tables||[]).slice().sort().join("|");
    const newKey=tables.slice().sort().join("|");
    if(curKey===newKey){setError("No alternative tables available for "+target.name+" at "+target.time+".");return;}
    const prevTables=(target.tables||[]).join("+")||"none";
    const user=getUser();
    const ok=saveBookings(function(prev){return prev.map(function(b){
      if(b.id!==id) return b;
      return Object.assign({},b,{tables:tables,_manual:false,_conflict:false,history:(b.history||[]).concat([histEntry("reassigned "+prevTables+" → "+tables.join("+"),user)])});
    });});
    setError("");
    if(ok) flash();
  }
  // ── v17.0.0 correction: Timeline drag & drop (move / swap / displace) ─────
  // Drop a dragged block on another table row. Round 3 semantics (Patryk):
  //   1. pick the table SET the party takes at the target — the single table
  //      if it seats them, else the smallest VALID_COMBO containing the target
  //      that does (skipping combos with a blocked member or a seated party);
  //   2. set free → plain move onto it;
  //   3. exactly one overlapping booking → try the round-1 full-set SWAP first
  //      (capacity both ways + canAssign);
  //   4. else DISPLACE: strip the desired tables from the occupants, unlock
  //      them, give the dragged booking the set, re-optimize (the manualAssign
  //      Swap-busy recipe) — but commit ONLY if a trial pass re-seats every
  //      displaced booking (no stranding; refusal toast otherwise).
  // The dragged booking becomes _manual+_locked so the optimizer never undoes
  // a hand-placed drag. Refusals surface via the dragMsg floating toast;
  // success messages are gated on the saveBookings `ok` boolean (v15.4.0).
  // ── v18.0.0 phase 3: the capability gate, at the ACTION ─────────────────────
  // Returns TRUE when the action must not proceed, and says so on screen. It
  // guards the action rather than each control, so the button, the keyboard
  // shortcut, the quick-status popup and a drag are covered by one line — which
  // is the four-surfaces lesson this file already records for `seated`.
  //
  // EVERY capability in `GATED_CAPS` is worth guarding, and that list is now
  // all eighteen. It used to be the complement of the staff floor — `staff` was
  // a floor and extras only ADDED, so every account held the staff set by
  // construction and a gate on `bookingStatus` could never fire. **Denies
  // removed the floor**, so it can; the gate is twenty lines below.
  //
  // It REFUSES rather than doing nothing. A control that silently no-ops reads
  // as broken, which is the v17.16.12 lesson about `seated` after close.
  // /code-review (session 7): the refusal toast on its own — `refused` is one
  // caller, and ⇧D under Automatic dark mode (onToggleDark) is the other.
  function flashRefusal(text){
    setPermMsg(text);
    clearTimeout(permMsgTimer.current);
    permMsgTimer.current=setTimeout(function(){setPermMsg(null);},3500);
  }
  function refused(cap){
    if(can(cap)) return false;
    flashRefusal("You don't have permission to "+capLabel(cap)+".");
    return true;
  }
  function flashDragMsg(text,good){setDragMsg({text:text,good:!!good});clearTimeout(dragMsgTimer.current);dragMsgTimer.current=setTimeout(function(){setDragMsg(null);},3500);}
  function dropOnTable(id,targetId){if(refused("bookingAssign"))return;
    const src=liveBookings.find(function(b){return b.id===id;});
    if(!src||src.date!==viewDate||!isActive(src)) return;
    const cur=src.tables||[];
    if(cur.length===1&&cur[0]===targetId) return; // dropped back on its own row
    const size=src.size||2;
    const s=toMins(src.time);
    const e=Math.max(occupancyEnd(src,nowMins,today),s+1);
    const blockSlots=getBlockSlots(tableBlocks,src.date);
    const busyBlocked=getBusy(blockSlots,s,e);
    if(busyBlocked.has(targetId)){flashDragMsg("Table "+targetId+" is blocked then.");return;}
    // Day's other active bookings (completed = free, the v16.0.0 rule) + the
    // tables held by SEATED parties over the span — those are immovable.
    const dayActive=liveBookings.filter(function(b){return b.date===src.date&&b.id!==id&&isActive(b)&&b.status!=="completed";});
    const isOver=function(b){return overlaps(s,e,toMins(b.time),occupancyEnd(b,nowMins,today));};
    const seatedOn=new Set();
    dayActive.forEach(function(b){if(b.status==="seated"&&isOver(b))(b.tables||[]).forEach(function(t){seatedOn.add(t);});});
    // 1. Candidate table sets at the target, in PURE optimizer order (round 4,
    //    Patryk-confirmed): the single table if it seats the party, else every
    //    VALID_COMBO containing the target that does — ranked exactly like
    //    findBest ranks combos (rankCombosContaining), NOT by raw capacity.
    const cap1=(ALL_TABLES.find(function(t){return t.id===targetId;})||{}).capacity||0;
    // v17.0.0 review fix #1: cap the candidate walk. Step 4 runs a full
    // bookingsAfterAction TRIAL per candidate (optimise can be 70–500ms when a
    // day has unplaceable bookings); an unbounded ~20-combo walk on a busy day
    // could freeze the UI for seconds before the refusal toast. The top few
    // ranked combos are the only realistic placements; deeper ones would strand
    // more parties anyway.
    const MAX_CAND=8;
    const ranked=cap1>=size?[]:rankCombosContaining(targetId,size);
    const candSets=cap1>=size
      ?[[targetId]]
      :ranked
        .filter(function(c){return !c.ids.some(function(t){return busyBlocked.has(t)||seatedOn.has(t);});})
        .map(function(c){return c.ids.slice();})
        .slice(0,MAX_CAND);
    // /code-review #2: name the ACTUAL reason (only reachable when cap1<size —
    // a fitting single table always yields a candidate). "Won't fit" was a lie
    // when a big-enough combo exists but the drag's waste/avoid rules excluded
    // it: that's a "use Manual assign", not a dead end.
    if(candSets.length===0){
      flashDragMsg(ranked.length>0
        ? "The tables needed to join with "+targetId+" are busy or blocked then."
        : comboExistsFor(targetId,size)
          ? "Party of "+size+" would need too many tables joined at "+targetId+" — use Manual assign."
          : "Party of "+size+" won't fit at "+targetId+", even with joined tables.");
      return;
    }
    const occOf=function(set){return dayActive.filter(function(b){return isOver(b)&&(b.tables||[]).some(function(t){return set.includes(t);});});};
    const desired=candSets[0];
    const occ=occOf(desired);
    const user=getUser();
    // 2. Free set → plain move.
    if(occ.length===0){
      const ok=saveBookings(function(prev){return prev.map(function(b){
        if(b.id!==id) return b;
        return Object.assign({},b,{tables:desired,_manual:true,_locked:true,_conflict:false,history:(b.history||[]).concat([histEntry("moved to "+desired.join("+")+" (drag)",user)])});
      });});
      if(ok) flashDragMsg(src.name+" moved to "+desired.join("+")+".",true);
      return;
    }
    // 3. Exactly one occupant → try the straight full-set swap first.
    if(occ.length===1&&cur.length>0&&occ[0].status!=="seated"){
      const other=occ[0];
      const newSrc=(other.tables||[]).slice(),newOther=cur.slice();
      const otherSize=other.size||2;
      if(comboCapBest(newSrc)>=size&&comboCapBest(newOther)>=otherSize){
        const os=toMins(other.time),oe=Math.max(occupancyEnd(other,nowMins,today),os+1);
        const slots=dayActive.filter(function(b){return b.id!==other.id&&(b.tables||[]).length>0;}).map(function(b){return {tables:b.tables,s:toMins(b.time),e:occupancyEnd(b,nowMins,today)};}).concat(blockSlots);
        if(canAssign(newSrc,slots,s,e)&&canAssign(newOther,slots.concat([{tables:newSrc,s:s,e:e}]),os,oe)){
          // v17.10.0: ONLY THE BOOKING YOU DRAGGED GETS LOCKED. This branch used
          // to write `_manual:true,_locked:true` to BOTH sides, which pinned a
          // party nobody asked to pin — the optimizer could then never tidy the
          // displaced booking again, and every swap quietly grew the set of
          // hand-placed bookings. The other two paths that move an occupant out
          // of the way (step 4's displacement below, and manualAssign's
          // `affected` branch) have always unlocked them; this one was the odd
          // one out.
          //
          // The exception is real and is the reason these two flags are read off
          // the CAPTURED `other` rather than being written false outright: a
          // walk-in is `_manual+_locked` BY DEFINITION and immune to the
          // optimizer (CLAUDE.md's Gotchas table), so force-unlocking one here
          // would let a reshuffle move a party that is physically sitting down.
          // An already-locked booking therefore keeps its lock on its NEW tables;
          // an ordinary confirmed booking comes out unlocked, which is the ask.
          const otherLocked=!!other._locked,otherManual=!!other._manual;
          const ok=saveBookings(function(prev){return prev.map(function(b){
            if(b.id===id) return Object.assign({},b,{tables:newSrc,_manual:true,_locked:true,_conflict:false,history:(b.history||[]).concat([histEntry("swapped tables with "+other.name+" ("+(cur.join("+")||"none")+" → "+newSrc.join("+")+")",user)])});
            if(b.id===other.id) return Object.assign({},b,{tables:newOther,_manual:otherManual,_locked:otherLocked,_conflict:false,history:(b.history||[]).concat([histEntry("swapped tables with "+src.name+" ("+(other.tables||[]).join("+")+" → "+newOther.join("+")+")",user)])});
            return b;
          });});
          if(ok) flashDragMsg(src.name+" and "+other.name+" — tables swapped.",true);
          return;
        }
      }
    }
    // 4. Displacement — the manualAssign Swap-busy recipe, with a trial gate.
    //    Round 4: walk the optimizer-ranked candidates in order and commit the
    //    FIRST whose trial re-seats every displaced booking conflict-free —
    //    a stranding top pick falls through to the next set, not to a refusal.
    const mkTransform=function(dSet,dOcc){
      const occIds=new Set(dOcc.map(function(b){return b.id;}));
      return function(list){
        const updated=list.map(function(b){
          if(b.id===id) return Object.assign({},b,{tables:dSet,_manual:true,_locked:true,_conflict:false,history:(b.history||[]).concat([histEntry("moved to "+dSet.join("+")+" (drag)",user)])});
          if(occIds.has(b.id)){
            const remaining=(b.tables||[]).filter(function(t){return !dSet.includes(t);});
            return Object.assign({},b,{tables:remaining,_locked:false,_manual:false});
          }
          return b;
        });
        return bookingsAfterAction(updated,viewDate,tableBlocks,null,false,autoOptimizer);
      };
    };
    for(let ci=0;ci<candSets.length;ci++){
      const dSet=candSets[ci];
      const dOcc=ci===0?occ:occOf(dSet);
      if(dOcc.some(function(b){return b.status==="seated";})) continue; // seated = immovable (only reachable via the single-table set)
      if(dOcc.length===0){
        // a lower-ranked but FREE set (only reachable past a failed higher pick)
        const ok=saveBookings(function(prev){return prev.map(function(b){
          if(b.id!==id) return b;
          return Object.assign({},b,{tables:dSet,_manual:true,_locked:true,_conflict:false,history:(b.history||[]).concat([histEntry("moved to "+dSet.join("+")+" (drag)",user)])});
        });});
        if(ok) flashDragMsg(src.name+" moved to "+dSet.join("+")+".",true);
        return;
      }
      const transform=mkTransform(dSet,dOcc);
      // v17.0.0 review note #2: the trial runs against the CURRENT `bookings`,
      // while the committed write re-applies `transform` to whatever fresh
      // `prev` saveBookings hands it. `transform` itself re-runs
      // bookingsAfterAction (the optimizer) on that fresh data, so the COMMIT is
      // always internally consistent; a concurrent remote echo can at worst
      // leave a displaced booking table-less (visible in the unassigned row) or
      // overlapping (the v15.6.1 reconciliation effect then self-heals). No
      // silent data loss — acceptable for a rare cross-device race.
      const trial=transform(bookings);
      const stranded=dOcc.find(function(o){const t=trial.find(function(x){return x.id===o.id;});return !t||(t.tables||[]).length===0||t._conflict;});
      if(stranded) continue;
      const ok=saveBookings(transform);
      if(ok) flashDragMsg(src.name+" moved to "+dSet.join("+")+" — "+dOcc.map(function(o){return o.name;}).join(", ")+" reassigned.",true);
      return;
    }
    const seatedOcc=occ.find(function(b){return b.status==="seated";});
    if(seatedOcc){flashDragMsg(seatedOcc.name+" is seated on "+targetId+"'s tables — can't move them.");return;}
    flashDragMsg("Can't re-seat the parties there without stranding one — use Manual assign.");
  }
  // The confirm dialog's ONE door. `delBooking` below is the guarantee; this is
  // so a staff member is refused at the point of intent rather than after
  // reading a "this cannot be undone" dialog and tapping Delete.
  function requestDelete(id){if(refused("bookingDelete")) return;setConfirmDel(id);}
  function delBooking(id){if(refused("bookingDelete")) return false;
    // v18.0.0 session 8 (C6): the money question, before the record goes.
    // Deleting a booking that had redeemed against a voucher asked NOTHING and
    // left the ledger entry behind — pointing at a booking that no longer
    // exists, which Settings → Vouchers renders as the literal text
    // "booking <id>" because there is no name left to resolve. The balance
    // stayed spent, so a guest's remaining money quietly belonged to a visit
    // nobody can look up.
    //
    // The same prompt as the walk-back, with `from: "delete"`: the question is
    // identical (restore the balance, or leave it spent?) and a second dialog
    // asking it differently is a second thing to keep in step. Escape abandons
    // the delete entirely, which is the safe direction — the booking is still
    // there to try again.
    if(!redeemAskedRef.current&&voucherHeldBy(id)){
      setConfirmDel(null);
      setVoucherBack({id:id,from:"delete"});
      return false;
    }
    const target=bookings.find(function(x){return x.id===id;});
    // v16.3.0: deleting a recurring OCCURRENCE parks its date on the rule's
    // skipDates so the generator never resurrects it. Done BEFORE the booking
    // delete and UNGATED by the delete's `ok` — if the delete is held/auto-
    // retried, the skipDate must still land so the generator doesn't re-create
    // the occurrence during the hold (addSkipDate is idempotent). Silent write.
    // /code-review: if the skipDate itself is REFUSED (recurring node not loaded
    // yet — a tiny post-load window), ABORT the delete: deleting anyway would
    // let the generator resurrect the occurrence moments later. Non-silent
    // warning so the tap isn't a mystery no-op.
    if(target&&target.recurringId&&target.recurringDate){
      const okSkip=addSkipDate(target.recurringId,target.recurringDate,true);
      if(!okSkip){setWriteWarning("Still syncing standing bookings — try deleting again in a moment.");setConfirmDel(null);return false;}
    }
    function delTransform(b){const t=b.find(function(x){return x.id===id;});const d=t?t.date:viewDate;return bookingsAfterAction(b.filter(function(x){return x.id!==id;}),d,tableBlocks,null,false,autoOptimizer);}
    // v17.4.0: prev-identity memo so the undo delta and the write share ONE pass.
    const delMemo=memoByPrev(delTransform);
    const postDel=delMemo(bookings);
    const ok=saveBookings(delMemo);setConfirmDel(null);
    // v17.10.0: Delete is now reachable from INSIDE the edit form, so the form
    // has to go with the booking — otherwise you are left editing a record that
    // no longer exists. Deliberately the raw setter, not requestCloseForm: the
    // unsaved-changes guard exists to stop you losing edits by accident, and
    // confirming a delete is not an accident. It also covers the pre-existing
    // edge where the LIST's Delete removes the booking the form happens to be
    // open on. Gated on the id so deleting a different booking leaves the form
    // alone. formDirty is `showForm && …`, so this disarms beforeunload too.
    if(editId===id) setShowForm(false);
    // v17.4.0: deletes are undoable too (general undo). The recurring skipDate
    // added above deliberately STAYS on undo — the restored occurrence keeps
    // its deterministic id, so the generator never duplicates it, and the
    // skipDate just stops a REGENERATION it no longer needs to do.
    if(ok){flash();armUndo(undoDelta(bookings,postDel),id,"delete",false);}
    // v18.0.0 session 8 (C6): returned so `settleVoucherBack` can keep
    // `settleVoucher`'s ordering — the booking write first, the money only if
    // it landed.
    return ok;}

  // ── v17.12.0: is ANY modal open? ───────────────────────────────────────────
  // One derivation, in the component that owns all seventeen pieces of state.
  // It existed before as a 17-term expression written out TWICE inside
  // useKeyboardShortcuts, and `inert` would have made a third copy — three
  // hand-maintained lists that a new modal has to be added to, with nothing to
  // catch the omission except the bug it causes.
  //
  // Deliberately coerced to a real boolean: half these states hold an object or
  // an id, and `inert` is a boolean DOM attribute — React renders `inert={0}`
  // and `inert={null}` differently from `inert={false}`.
  //
  // v17.12.0 brought this derivation forward from the modal-stack work rather
  // than adding an eighteenth term to an expression written out twice.
  // **v17.14.0 finishes it**: the seventeen-term expression is
  // `modalStack.length > 0`, and every reader was already pointed here.
  //
  // The term it had been missing all along is `showWaitlist`, which is exactly
  // the point — a hand-written list of every open surface is a list that will
  // be one short, and nothing about being one short is visible.
  //
  // `topModalId` is the other half: the visually topmost open surface, from the
  // declared z-order rather than from a hand-ordered chain. It replaces the
  // `topLayer` expression that used to gate the form's letter shortcuts (a
  // ten-term list that omitted the discard confirm, so A/P/B/H fired behind it).
  //
  // MUST stay above the useKeyboardShortcuts call below: the ctx object is
  // built mid-render, and a `const` read before its declaration is a TDZ
  // ReferenceError that blanks the whole app with a generic message. That has
  // happened twice in this codebase (v17.5.0's `activeView`, v17.11.0's
  // `isViewToday`), and neither lint nor `npm run build` catches it.
  const anyModal=modalStack.length>0;
  const topModalId=topModal(modalStack);

  // v17.3.3: the global keyboard shortcuts (precedence rules, every key) and
  // the v17.3.1 neutral-space List-deselect mousedown listener were extracted
  // VERBATIM into hooks/useKeyboardShortcuts.js. This object is the hook's
  // latest-values context, refreshed every render (the original kbRef pattern —
  // the hook mounts its window listeners once and reads this through a ref).
  // Adding a shortcut = add the state/handler HERE and use it in the hook.
  useKeyboardShortcuts({
    anyModal:anyModal,
    // v17.14.0: the modal stack. `modalOpen` is {id: payload} for what is open;
    // `topModalId` is the visually topmost, from the declared z-order. Escape
    // acts on `topModalId` and Enter walks MODAL_ENTER_ORDER — both used to be
    // hand-written chains here, kept in step with the mount sites by nothing.
    modalOpen:modalOpen,
    topModalId:topModalId,
    // v17.5.0: in a split, every view-sensitive shortcut (S/C status, ↑/↓ list
    // nav, the neutral-space and Esc list-deselect, the zoom keys) must act on
    // the FOCUSED pane, not on the stale single-view `view`. Passing activeView
    // here means the whole hook is split-aware without touching each branch.
    view:activeView,setView:setView,goView:pickView,
    viewDate:viewDate,setViewDate:setViewDate,
    timelineZoom:timelineZoom,setTimelineZoom:setTimelineZoomManual,tlFollowZoom:tlSettings.followZoom,tlMaxZoom:tlSettings.maxZoom,
    followNow:followNow,setFollowNow:setFollowNow,
    autoOptimizer:autoOptimizer,setAutoOptimizer:setAutoOptimizer,
    showForm:showForm,setShowForm:setShowForm,editId:editId,form:form,setForm:setForm,setSwapAffected:setSwapAffected,
    showWalkin:showWalkin,setShowWalkin:setShowWalkin,
    showHistory:showHistory,setShowHistory:setShowHistory,
    showSettings:showSettings,setShowSettings:setShowSettings,
    showSearch:showSearch,setShowSearch:setShowSearch, // v16.3.0: "/" opens global search
    // v14 p7: settingsTab for ←/→ tab-cycle shortcut inside Settings modal.
    settingsTab:settingsTab,setSettingsTab:setSettingsTab,
    // v18.0.0 phase 3: the ←/→ cycle runs over visibleTabs(can), not the raw
    // list — a cycle over the unfiltered one would step onto the Admin tab the
    // render side refuses to show. `setRolesFor` is escapeAction's target for
    // the capability grid.
    can:can,hasModule:hasModule,setRolesFor:setRolesFor,setActivityOpen:setActivityOpen,requestDelete:requestDelete,
    // v14 p7: reminder editor state for Esc/Enter handling.
    reminderEditor:reminderEditor,setReminderEditor:setReminderEditor,
    saveReminderFromEditor:saveReminderFromEditor,
    // v14 p7 fix: reminder-delete confirm state.
    confirmReminderDel:confirmReminderDel,setConfirmReminderDel:setConfirmReminderDel,
    doDeleteReminder:doDeleteReminder,
    manualTarget:manualTarget,setManualTarget:setManualTarget,
    showPrefPicker:showPrefPicker,setShowPrefPicker:setShowPrefPicker,
    confirmDel:confirmDel,setConfirmDel:setConfirmDel,
    confirmReshuffle:confirmReshuffle,setConfirmReshuffle:setConfirmReshuffle,
    confirmCancel:confirmCancel,setConfirmCancel:setConfirmCancel,
    confirmKitchen:confirmKitchen,setConfirmKitchen:setConfirmKitchen,
    setVoucherAsk:setVoucherAsk,
    setVoucherBack:setVoucherBack,
    setSeatNote:setSeatNote,
    setSeatClash:setSeatClash,
    setVoucherCarry:setVoucherCarry,
    blockTarget:blockTarget,setBlockTarget:setBlockTarget,
    bookings:bookings,
    // v14.4.0: List-view selection + the handlers its A/E/S/C/Delete shortcuts call.
    listDay:listDaySorted,selectedListId:selectedListId,setSelectedListId:setSelectedListId,
    // v17.16.12: the S shortcut is the fourth surface that offers `seated`, so
    // it needs the same two values the other three read seatingClosed with.
    today:today,nowMins:nowMins,
    bumpListFocus:bumpListFocus, // v17.3.1: ↑/↓ scrolls the focused card into view
    openEdit:openEdit,updateStatus:updateStatus,
    // v14.4.0: N → new reminder while the Settings Reminders tab is open.
    openNewReminder:openNewReminder,
    openNew:openNew,openWalkin:openWalkin,
    // v14.6.0: Summary panel toggle (the g shortcut).
    setSummaryOpen:setSummaryOpen,
    showWeek:showWeek,setShowWeek:setShowWeek,
    // WhatsApp sandbox: the I shortcut's opener, and the four setters
    // `escapeAction` names. `showInbox` is still read directly — the I key must
    // not re-open a panel that is already up.
    showInbox:showInbox,setShowInbox:setShowInbox,closeInbox:closeInbox,
    setConfirmArchive:setConfirmArchive,setConfirmDeleteConv:setConfirmDeleteConv,
    showSim:showSim,setShowSim:setShowSim,
    // v17.14.0 (/code-review): the waitlist panel's Escape close. It is here and
    // not merely in `escapeAction` because the OLD chain had no waitlist branch,
    // so this setter had never been needed in the ctx — adding the `case` without
    // adding the key made Esc on that panel throw `K.setShowWaitlist is not a
    // function`, i.e. shipped the exact defect the stack was written to remove.
    // A `case` in escapeAction is only half a wiring; the other half is here.
    setShowWaitlist:setShowWaitlist,
    save:save,doSave:doSave,saveWalkin:saveWalkin,doSaveWalkin:doSaveWalkin,
    forceReshuffle:forceReshuffle,delBooking:delBooking,bookAgain:bookAgain,
    // v15.8.0 cont.4: keyboard nav routes through the same slide path as the buttons.
    goToDate:goToDate,bumpSlide:bumpSlide,
    // v16.2.0: Shift+D theme toggle.
    onToggleDark:onToggleDark,
    // v17.1.0: Shift +/− app-width nudge (global, like Shift+D).
    onSetAppWidth:onSetAppWidth,appWidth:appWidth,
    // v17.5.0: the unsaved-changes guard. Esc must route the three drafting
    // surfaces through requestClose* (it calls the setters directly, so it
    // would otherwise be a silent back door past the guard), and the discard
    // confirm needs its own Esc (dismiss) / Enter (discard) branches.
    // v17.5.0 correction: Esc closes the split-setup popup (it has no Cancel).
    splitMenuFor:splitMenuFor,setSplitMenuFor:setSplitMenuFor,
    confirmDiscard:confirmDiscard,setConfirmDiscard:setConfirmDiscard,doDiscard:doDiscard,
    requestCloseForm:requestCloseForm,requestCloseWalkin:requestCloseWalkin,requestCloseManual:requestCloseManual,
    // v17.8.0: the three surfaces added to the guard — same reason as above.
    requestCloseReminderEditor:requestCloseReminderEditor,requestCloseBlock:requestCloseBlock,requestCloseSettings:requestCloseSettings
  });

  // v18.0.0: does completing this booking need the voucher question asked
  // first? Returns the voucher, or null. Three ways to answer "no", and each is
  // a real case rather than defensive padding: the booking carries no voucher;
  // the number is not in the list (recorded on another device, or the node has
  // not loaded — never block a completion on that); or this booking has ALREADY
  // been settled against it, which is what makes the re-entry after a held or
  // retried write idempotent.
  function voucherToAsk(id,status){
    // v18.0.0 phase 4: the module gate, at the funnel both raise sites already
    // share — the form's save and `updateStatus` (which is itself the one door
    // for the popup, the List buttons and the S/C shortcuts). With vouchers off
    // a completion must never stop to ask about one.
    if(!vouchersOn) return null;
    if(status!=="completed") return null;
    const b=bookings.find(function(x){return x.id===id;});
    const code=b?normalizeCode(b.voucherCode):"";
    if(!code) return null;
    const v=vouchersByCode[code];
    if(!v) return null;
    if(isRedeemedBy(v,id)) return null;
    // A voided, spent or expired voucher has nothing to redeem, so there is
    // nothing to ask. It stays attached as a record of what was intended.
    if(voucherState(v,Date.now())!=="open") return null;
    return v;
  }
  // voucherToRestore(id,status) — the INVERSE of voucherToAsk (v18.0.0 phase 6).
  // A completed booking can be walked back to Confirmed, Seated or Pending in the
  // edit form, and it can be cancelled; if that visit redeemed a voucher, the
  // ledger entry and the spent balance stayed with no control anywhere to undo
  // them. Patryk's call: ASK, symmetric with the completion that asked whether to
  // redeem in the first place — so money never moves as a silent side-effect of a
  // status tap, in either direction.
  //
  // The gate is "is this booking LEAVING completed", not a list of target
  // statuses: every status other than completed is a visit that did not finish
  // the way the ledger says it did, and enumerating them is how the next one
  // added gets missed.
  // v18.0.0 session 8 (C6): "does this booking hold money on a voucher", with
  // no opinion about status. `voucherToRestore` asked the same question wrapped
  // in a walk-back gate, and a DELETE has no target status to test — so the
  // question is separated from the occasion for asking it.
  //
  // Status-free on purpose rather than by omission: answering "keep it
  // redeemed" to a walk-back leaves a redemption on a booking that is no longer
  // completed, so a ledger entry can outlive the status that created it.
  function voucherHeldBy(id){
    if(!vouchersOn) return null;
    const b=bookings.find(function(x){return x.id===id;});
    if(!b) return null;
    const code=normalizeCode(b.voucherCode);
    if(!code) return null;
    const v=vouchersByCode[code];
    if(!v) return null;
    // Nothing was taken for THIS visit, so there is nothing to give back. A
    // voucher redeemed by a DIFFERENT booking is not this booking's to restore.
    if(!isRedeemedBy(v,id)) return null;
    return v;
  }
  function voucherToRestore(id,status){
    if(status==="completed") return null;
    const b=bookings.find(function(x){return x.id===id;});
    if(!b||b.status!=="completed") return null;   // only a walk-back, never a first pass
    return voucherHeldBy(id);
  }
  // Re-enter the action the modal interrupted, with the question marked asked.
  // ONE ref covers both prompts, deliberately: a status change is either INTO
  // `completed` or OUT of it, so the two can never both be pending, and a second
  // ref would be a second thing to keep in step.
  function withRedeemAsked(fn){
    redeemAskedRef.current=true;
    try{ return fn(); } finally { redeemAskedRef.current=false; }
  }
  // ── v18.0.0 session 8 (C3): the seat-clash prompt ───────────────────────────
  // Same three moves as the voucher prompts: a snapshot goes into the modal, a
  // ref marks the question asked, and the interrupted action is re-entered by
  // the answer rather than duplicated inside it.
  function seatClashSnap(parties){
    return parties.map(function(e){return {id:e.booking.id,name:e.booking.name||"",time:e.booking.time||"",tables:e.tables};});
  }
  function withSeatAsked(fn){
    seatAskedRef.current=true;
    try{ return fn(); } finally { seatAskedRef.current=false; }
  }
  // `doSave` returns nothing, so "did the save land" is read off `saveGuardRef`
  // — the v18.0.0 /code-review finding, and the same reading `settleVoucher`
  // makes two functions up.
  function resumeSeat(ask){
    return withSeatAsked(function(){
      if(ask.from!=="form") return updateStatus(ask.id,ask.status);
      doSave();
      return !mayDispatch(saveGuardRef.current);
    });
  }
  function seatAnyway(){
    const ask=seatClash;
    if(!ask) return;
    setSeatClash(null);
    resumeSeat(ask);
  }
  function seatAfterClearing(){
    const ask=seatClash;
    if(!ask) return;
    setSeatClash(null);                        // dismissed before the permission test, per settleVoucher
    if(refused("bookingStatus")) return;
    const ids=(ask.others||[]).map(function(o){return o.id;});
    const user=getUser();
    const nowM=nowMins;
    // One write for the parties leaving, then the seat. Both are function-form,
    // and `saveBookings` computes from the `bookingsRef` mirror it updates as it
    // dispatches, so the second sees the first — they compose without waiting
    // for a render. `completedSeatedPatch` is the same arithmetic `updateStatus`
    // applies, from one place, so the two cannot disagree about how long a
    // visit lasted.
    //
    // A cleared party carrying a voucher lands UNSETTLED rather than raising the
    // redeem prompt in the middle of somebody else being seated. That is a state
    // the app defines, detects and shows in the strip — the close-time
    // auto-complete produces it for the same reason — and it is the honest
    // trade: the question gets asked, later, by the section that exists for it.
    saveBookings(function(prev){
      return prev.map(function(b){
        if(ids.indexOf(b.id)<0||b.status!=="seated") return b;
        return Object.assign({},b,completedSeatedPatch(b,today,nowM),
          {history:(b.history||[]).concat([histEntry("status → completed (table cleared to seat another party)",user)])});
      });
    });
    resumeSeat(ask);
  }
  function updateStatus(id,status){if(refused("bookingStatus"))return;
    if(status==="cancelled"){setConfirmCancel(id);return;}
    // v18.0.0: stop and ask before the status lands. `updateStatus` is the one
    // funnel for the popup, the List buttons and the S/C shortcuts, so gating
    // here covers all three — the same property that made it one of the two
    // hook points rather than four.
    if(!redeemAskedRef.current&&voucherToAsk(id,status)){
      setVoucherAsk({id:id,status:status,from:"status"});
      return false;
    }
    if(!redeemAskedRef.current&&voucherToRestore(id,status)){
      setVoucherBack({id:id,status:status,from:"status"});
      return false;
    }
    // v18.0.0 session 7: the seat note, at this door. Taken from the booking as
    // it stands BEFORE the write (a seat moves no tables) and raised after it —
    // past both voucher gates above, so it can never open beside a money prompt,
    // only after one has been answered. Not gated on `ok`: a write held by the
    // stale gate still shows the seat, and the party is sitting down either way.
    const seatCur=bookings.find(function(x){return x.id===id;});
    // v18.0.0 session 8 (C2): this door covers the quick-status popup, the List
    // card's button and the S key — all three call here — so one check answers
    // for all of them. A refusal TOAST rather than a disabled button or a
    // silent return: the fix is one tap away in Assign, and a button that does
    // nothing is the worst of the three answers.
    if(status==="seated"&&seatCur&&seatCur.status!=="seated"){
      const noTable=seatRefusal(seatCur);
      if(noTable){flashRefusal(noTable);return false;}
      // C3, at the same door. After the refusal above, because "there is no
      // table" and "somebody is at the table" are different sentences and the
      // first has no question in it.
      if(!seatAskedRef.current){
        const parties=seatClashParties(seatCur.tables,seatCur.date,id,bookings);
        if(parties.length){setSeatClash({id:id,status:status,from:"status",others:seatClashSnap(parties)});return false;}
      }
    }
    const seatSnap=seatNoteFor(seatCur&&seatCur.status,status,seatCur);
    const user=getUser();
    const nowM=nowMins;
    const ok=saveBookings(function(b){
      const target=b.find(function(x){return x.id===id;});
      const d=target?target.date:viewDate;
      // v14: detect confirmed → seated transition (for any prior non-seated status).
      // If the transition triggers a seated-shift, force no-reshuffle by passing
      // autoOptimizerState=false to bookingsAfterAction, so other bookings never
      // move as a side-effect of someone sitting down early/late.
      const updated=b.map(function(x){
        if(x.id!==id) return x;
        const histEntries=[histEntry("status → "+status,user)];
        const extra={status:status};
        // v16.2.0: only a real SEATED visit gets its duration truncated to the
        // actual span (now − start). A direct Confirmed → Completed keeps the
        // scheduled duration unchanged — otherwise the block balloons to hours
        // on the timeline (e.g. completing a 13:00 booking at 21:00 → 8h block).
        if(status==="completed"&&x.status==="seated"){
          // v17.16.2 (CT-2B-02): `nowM - toMins(x.time)` mixed axes. A party
          // seated before midnight and completed after it recorded 15 minutes.
          const actualDur=Math.max(15,seatedElapsed(x,today,nowM));
          extra.duration=actualDur;
          extra.customDur=actualDur;
          // v17.6.0: stamp the real stay so the List card can show it after the
          // visit (booking-logic's stayedMins). Only a genuine seated→completed
          // transition reaches here, which is exactly the gate the tag needs.
          extra.stayedMin=actualDur;
        }
        // v18.0.0 session 8 (C1): the other door out of seated. Same restore as
        // the form's — one helper, so the popup, the List card and the S key
        // cannot disagree with Save about what a booking goes back to.
        if((status==="confirmed"||status==="pending")&&x.status==="seated"){
          const back=unseatRestore(x,x.size);
          if(back){
            extra.time=back.time;
            extra.duration=back.duration;
            extra.originalDuration=back.originalDuration;
            extra.customDur=back.customDur;
            histEntries.push(histEntry("un-seated: time restored "+x.time+" → "+back.time+", length "+(x.duration||0)+" → "+back.duration+" min",user));
          }
        }
        if(status==="seated"&&x.status!=="seated"){
          const shift=applySeatedShift(x,nowM,b,today);
          if(shift){
            extra.time=shift.newTime;
            extra.duration=shift.newDuration;
            extra.originalDuration=shift.newDuration;
            extra.customDur=shift.newDuration;
            // scheduledTime is intentionally NOT updated here — it stays pinned to
            // the confirmed time so Book Again and history reads show the true plan.
            histEntries.push(histEntry("seated "+shift.direction+": time adjusted "+shift.oldTime+" → "+shift.newTime,user));
          }
        }
        extra.history=(x.history||[]).concat(histEntries);
        return Object.assign({},x,extra);
      });
      // Seated transitions never reshuffle others — even when optimizer is ON.
      const optState=(status==="seated")?false:autoOptimizer;
      return bookingsAfterAction(updated,d,tableBlocks,null,false,optState);
    });
    // C8: same at this door — `optState` is false for a seat (see below).
    if(ok&&(status==="completed"||status==="seated")) flash(status==="seated"?"saved":null);
    if(seatSnap) setSeatNote(seatSnap);
    // v18.0.0: returned so the redeem path can gate the voucher write on the
    // BOOKING write having actually dispatched — see `settleVoucher`.
    return ok;
  }
  // v18.0.0: the modal's two answers, and the ORDER is the design.
  //
  // The booking is completed FIRST and the voucher is redeemed only if that
  // write actually dispatched. Both fail states were considered and they are
  // not symmetric:
  //
  //   * booking first — if the voucher write is then refused, the result is a
  //     completed booking carrying a `voucherCode` with no ledger entry. That
  //     is the UNSETTLED state, which this app already defines, already
  //     detects and already surfaces in the notification strip, because the
  //     close-time auto-complete produces it too. Somebody is told.
  //   * voucher first — if the booking write is then refused, the result is a
  //     ledger entry against a booking that is not completed. Nothing in the
  //     app looks for that, so nobody is told.
  //
  // So the order is chosen by which failure lands in a state the app can
  // report, not by which is tidier.
  function settleVoucher(amount){
    const ask=voucherAsk;
    if(!ask) return;
    // /code-review v18.0.0 phase 6: the dialog is dismissed BEFORE the
    // permission test, not after. `refused()` returning first left an account
    // without `voucherRedeem` looking at a prompt whose BOTH buttons only
    // flashed a toast — the gates that raise it (`voucherToAsk` /
    // `voucherToRestore`) carry no permission check, so it opens for anyone.
    // Escape was the only exit and it abandoned the status change silently.
    setVoucherAsk(null);
    if(refused("voucherRedeem")) return;
    const ok=withRedeemAsked(function(){
      if(ask.from!=="form") return updateStatus(ask.id,ask.status);
      // /code-review v18.0.0: this was `(doSave(),true)`, and `doSave` returns
      // NOTHING — so the form path redeemed the voucher whether or not the
      // booking saved, which is precisely the voucher-first failure the comment
      // above says the ordering exists to prevent. `doSave` re-runs validation
      // on re-entry, and validation is not frozen while the modal is open: the
      // 15s tick grows a seated booking's live duration, so a manual-table save
      // that was valid when the prompt appeared can fail when it is answered.
      //
      // The app already has the answer and it needed reading rather than
      // building: `saveGuardRef` is set to DISPATCHED on the exact two lines
      // that dispatch a save, so the guard IS "did this save land". Reading it
      // leaves `doSave` — the most dangerous function in the app — untouched.
      // An already-DISPATCHED guard also reads true, which is correct: that is
      // the double-tap case, where the booking DID complete, and
      // `redeemVoucher` is idempotent by booking id.
      doSave();
      return !mayDispatch(saveGuardRef.current);
    });
    if(!ok) return;
    const b=bookings.find(function(x){return x.id===ask.id;});
    const code=b?normalizeCode(b.voucherCode):"";
    if(code&&amount) redeemVoucher(code,ask.id,amount);
    // v18.0.0 session 8 (item 7): and THEN ask whether the rest should follow
    // the guest. After the booking write and after the money, so the offer is
    // made about a visit that is actually finished — and on BOTH answers, since
    // "Complete without using it" leaves the whole balance behind, which is the
    // case where carrying it matters most. `!ok` still returns above: a refused
    // completion has nothing to carry from.
    if(code&&b) offerVoucherCarry(b,code,amount);
  }
  // The offer, and the one number it has to get right. `vouchersByCode` here is
  // still the version from BEFORE the redemption dispatched a moment ago, so the
  // balance is computed by subtracting what was just taken rather than read back
  // — reading it back would offer the guest money that has already been spent.
  function offerVoucherCarry(b,code,justRedeemed){
    const v=vouchersByCode[code];
    if(!v) return;
    const left=Math.max(0,remainingOf(v)-(Number(justRedeemed)||0));
    if(left<=0) return;
    if(!hasRealPhone(b.phone)&&!b.guestId) return;   // no identity, nothing to follow
    const ident={phone:b.phone,guestId:b.guestId};
    const mine=bookings.filter(function(x){return matchesIdentity(x,ident);});
    const to=carryTarget(mine,code,vouchersByCode,bookings,Date.now(),b);
    if(!to) return;
    setVoucherCarry({code:code,amount:left,to:to.id,name:to.name||"",date:to.date,time:to.scheduledTime||to.time,from:b.date});
  }
  // Move — a function-form save, so it takes the retry path like every other
  // user write. The re-check inside the updater is not ceremony: the prompt can
  // sit on screen while another device attaches something to that booking, and
  // overwriting a voucher somebody else chose is the one outcome this must not
  // produce.
  function doVoucherCarry(){
    const c=voucherCarry;
    if(!c) return;
    setVoucherCarry(null);
    if(refused("bookingEdit")) return;
    const user=getUser();
    const fromLabel=/^\d{4}-\d{2}-\d{2}$/.test(c.from||"")?c.from.slice(8,10)+"/"+c.from.slice(5,7):(c.from||"");
    const ok=saveBookings(function(prev){
      return prev.map(function(b){
        if(b.id!==c.to||normalizeCode(b.voucherCode)) return b;
        return Object.assign({},b,{
          voucherCode:c.code,
          history:(b.history||[]).concat([histEntry("voucher "+formatCode(c.code)+" attached (carried from the "+fromLabel+" visit)",user)])
        });
      });
    });
    if(ok) flash("saved");
  }
  // settleVoucherBack(restore) — the mirror of settleVoucher, and it keeps that
  // function's hard-won ORDERING: the booking write goes first and the money
  // moves only if it landed. `saveGuardRef` is what answers "did this save
  // land" (the v18.0.0 /code-review finding — `doSave` returns nothing), and
  // `unredeemVoucher` is idempotent by booking id, so an already-DISPATCHED
  // guard reading true is correct rather than merely tolerable.
  function settleVoucherBack(restore){
    const ask=voucherBack;
    if(!ask) return;
    setVoucherBack(null);                      // see settleVoucher on the order
    if(refused("voucherRedeem")) return;
    // v18.0.0 session 8 (C6): the code is read BEFORE the write, not after.
    // The ordering contract is untouched — the booking write still goes first
    // and the money moves only if it landed — but the DELETE funnel removes the
    // booking, and a lookup afterwards would find nothing and silently skip the
    // restore. (It happens to survive today, because this render's `bookings`
    // closure is not the state the write replaces; that is a property of React
    // rather than of this function, and too quiet to depend on.)
    const held=bookings.find(function(x){return x.id===ask.id;});
    const code=held?normalizeCode(held.voucherCode):"";
    const ok=withRedeemAsked(function(){
      // FOUR funnels now. `doCancelBooking` is its own door because
      // `updateStatus` hands "cancelled" straight to the confirm and never
      // reaches its own gate; `delBooking` is its own for the same shape — the
      // delete confirm is a door the status gates never see. Each returns the
      // save's `ok` for this caller.
      if(ask.from==="delete") return delBooking(ask.id);
      if(ask.from==="cancel") return doCancelBooking(ask.id,ask.noShow);
      if(ask.from!=="form") return updateStatus(ask.id,ask.status);
      doSave();
      return !mayDispatch(saveGuardRef.current);
    });
    if(!ok||!restore) return;
    if(code) unredeemVoucher(code,ask.id);
  }
  function doCancelBooking(id,noShow){
    // /code-review v18.0.0 phase 6: THE CANCEL FUNNEL. `updateStatus` returns
    // early for "cancelled" into `setConfirmCancel`, so neither of that
    // function's gates nor `doSave`'s ever sees this path — cancelling a
    // completed booking from the popup or the List card kept its redemption
    // silently, while the identical change made in the edit form asked. One
    // action, two routes, two behaviours.
    //
    // The cancel confirm is dismissed first so only ONE dialog is on screen;
    // `voucherback` outranks `cancel` in MODAL_Z either way, but two stacked
    // confirms about the same tap is not a thing to show anybody.
    if(!redeemAskedRef.current&&voucherToRestore(id,"cancelled")){
      setConfirmCancel(null);
      setVoucherBack({id:id,status:"cancelled",noShow:!!noShow,from:"cancel"});
      return false;
    }
    const user=getUser();
    // v16.3.0: snapshot the pre-cancel booking so the undo toast can restore it
    // (status/noShow/notes/tables — the whole object). Single pending slot; a
    // newer cancel replaces it.
    function cancelTransform(b){const target=b.find(function(x){return x.id===id;});const d=target?target.date:viewDate;const updated=b.map(function(x){if(x.id!==id) return x;const extra={status:"cancelled",history:(x.history||[]).concat([histEntry(noShow?"no show":"cancelled",user)])};if(noShow){extra.noShow=true;extra.notes=(x.notes?x.notes+"\n":"")+"No show";}return Object.assign({},x,extra);});return bookingsAfterAction(updated,d,tableBlocks,null,false,autoOptimizer);}
    // v17.4.0: prev-identity memo (the doSave pattern) so the delta computed for
    // undo and the dispatched write share ONE optimizer pass.
    const cancelMemo=memoByPrev(cancelTransform);
    const post=cancelMemo(bookings);
    const ok=saveBookings(cancelMemo);
    wa.autoHandleCancelIntent(id); // a pending WA cancel-intent banner on this booking's conversation auto-handles
    setConfirmCancel(null);
    if(ok){
      flash();
      armUndo(undoDelta(bookings,post),id,"cancel",!!noShow);
    }
    // Returned for `settleVoucherBack`, which must not move money for a write
    // that was held — the ordering `settleVoucher` established. No other caller
    // reads it, so this is additive.
    return ok;
  }
  // v17.4.0 — GENERAL undo: the v16.3.0 cancel/no-show snapshot+toast pattern
  // now also covers DELETE and form EDIT. armUndo parks one pending snapshot
  // ({snapshot, kind:"cancel"|"delete"|"edit", noShow}) — single slot, a newer
  // action replaces it — and the shared undoLastAction restores it: the
  // exists?map:concat shape naturally covers all three kinds (delete → the
  // booking is gone from prev → concat re-adds it; cancel/edit → map swaps the
  // snapshot back in), then bookingsAfterAction re-places tables (if a table
  // was taken meanwhile, the optimizer/reconciliation resolves or flags it —
  // accepted, same as v16.3.0). Gated on the save `ok`.
  //
  // SCOPE (deliberate, v17.4.0): undo restores THE SNAPSHOTTED BOOKING ONLY.
  // If the original action's bookingsAfterAction pass also moved OTHER
  // bookings (a reshuffle), those moves are NOT reversed — with the optimizer
  // ON the re-run usually re-places them, with it OFF they keep their new
  // tables. Undo is "put this booking back", not a transactional rollback of
  // the whole floor. The undo pill's `undoNote` says "tables re-optimised"
  // when a reshuffle happened, so staff know the floor moved.
  // v17.4.0 /code-review: compare like with like. bookingsAfterAction runs
  // syncLiveDurations, which rewrites `duration`/`customDur` for a SEATED
  // overstayer on today — both are in UNDO_FIELDS, so an overstayer the action
  // never touched would otherwise read as "changed", be swept into the delta,
  // and have its stale (shorter) duration written back on undo. Syncing the
  // PREV side removes that false positive and keeps the delta bounded to what
  // the action actually moved.
  function undoDelta(prev,post){
    const today=todayStr();
    return undoSnapshots(syncLiveDurations(prev,today,nowMins),post);
  }
  function armUndo(snapshots,primaryId,kind,noShow){
    if(!snapshots||!snapshots.length) return;
    if(undoTimerRef.current) clearTimeout(undoTimerRef.current);
    // v18.0.0 session 9: the note belongs to THIS pill, so it is taken once and
    // cleared. Measured before the fix, on a future-date delete: the pill read
    // "Booking deleted · tables re-optimised · Undo" for ~4s and then
    // "Booking deleted · Undo" for the remaining ~8s, because the note was read
    // live from `reshuffled` — a 3s timer — while the pill runs for `undoSecs`.
    // The edit path is why this is consume-once rather than a shared value: its
    // `flash` is conditional and its `armUndo` is not, so an edit that arms an
    // undo WITHOUT flashing must show no note rather than the previous one's.
    const note=flashNoteRef.current;
    flashNoteRef.current="";
    setUndoInfo({snapshots:snapshots,primaryId:primaryId,kind:kind,noShow:!!noShow,note:note});
    undoTimerRef.current=setTimeout(function(){setUndoInfo(null);undoTimerRef.current=null;},(generalSettings.undoSecs||10)*1000);
  }
  function undoLastAction(){
    const info=undoInfo;
    if(!info||!info.snapshots||!info.snapshots.length) return;
    const user=getUser();
    const note=info.kind==="delete"?"deletion undone":info.kind==="edit"?"edit undone":"cancellation undone";
    const primary=info.snapshots.find(function(s2){return s2.id===info.primaryId;})||info.snapshots[0];
    const ok=saveBookings(function(b){
      // Only the booking the user acted on gets a history entry — the others
      // were moved by the optimizer, not by a user action, and the original
      // reshuffle didn't write history for them either (symmetry).
      const snaps=info.snapshots.map(function(s2){
        return s2.id===info.primaryId
          ?Object.assign({},s2,{history:(s2.history||[]).concat([histEntry(note,user)])})
          :s2;
      });
      // Restore VERBATIM — deliberately NOT through bookingsAfterAction. Its
      // optimizer branch is taken whenever optimizerActiveFor() is true (which
      // it ALWAYS is for a future date, regardless of the toggle), and a
      // reshuffle here would immediately re-apply the very moves undo just
      // reversed. syncLiveDurations still runs so a seated booking's live
      // duration stays correct. If a booking created since the action now
      // collides, the v15.6.1 reconciliation effect resolves it — the same
      // path that handles offline merges.
      const today=todayStr();
      return syncLiveDurations(applyUndo(b,snaps),today,nowMins);
    });
    if(ok){
      if(undoTimerRef.current){clearTimeout(undoTimerRef.current);undoTimerRef.current=null;}
      setUndoInfo(null);
      setViewDate(primary.date);
    }
  }
  function manualAssign(bookingId,tables,locked,affected){
    const user=getUser();
    const ok=saveBookings(function(b){
      const updated=b.map(function(x){
        if(x.id===bookingId) return Object.assign({},x,{tables:tables,_conflict:false,_manual:true,_locked:locked===true,history:(x.history||[]).concat([histEntry("tables manually assigned: "+tables.join(", "),user)])});
        // If swapping, strip taken tables from affected bookings and unlock them for re-optimization
        if(affected&&affected.length>0){
          const match=affected.find(function(ab){return ab.id===x.id;});
          if(match){
            const remaining=(x.tables||[]).filter(function(t){return !match.tables.includes(t);});
            return Object.assign({},x,{tables:remaining,_locked:false,_manual:false});
          }
        }
        return x;
      });
      // Re-optimize to reassign affected bookings to new tables (when optimizer active)
      if(affected&&affected.length>0) return bookingsAfterAction(updated,viewDate,tableBlocks,null,false,autoOptimizer);
      return updated;
    });
    setManualTarget(null);
    if(ok&&affected&&affected.length>0) flash();
  }

  function addBlock(block){if(refused("tableBlock"))return;
    // v17.15.3: through sanitizeBlock, so the id is minted at the SAME one site
    // the read path uses. A locally-added block therefore has a stable identity
    // before the Firebase echo lands, rather than acquiring one on the way back.
    const next=tableBlocks.concat([sanitizeBlock(block)]);
    saveBlocks(next);
    const ok=saveBookings(function(b){return bookingsAfterAction(b,block.date,next,null,false,autoOptimizer);});
    if(ok) flash();
    setBlockTarget(null);
  }
  function removeBlock(block){if(refused("tableBlock"))return;
    // v17.15.3: matches on IDENTITY. This used to filter on the field set
    // (tableId+date+allDay+from+to), which two duplicate blocks share exactly —
    // so unblocking either one dropped BOTH. See sanitizeBlock in booking-logic.
    const next=tableBlocks.filter(function(bl){return bl.id!==block.id;});
    saveBlocks(next);
    const ok=saveBookings(function(b){return bookingsAfterAction(b,block.date,next,null,false,autoOptimizer);});
    if(ok) flash();
    if(next.filter(function(bl){return bl.tableId===block.tableId&&bl.date===block.date;}).length===0) setBlockTarget(null);
  }

  const manualBooking=(function(){
    if(!manualTarget) return null;
    if(manualTarget==="__new__"){return {id:"__new__",name:form.name||"New booking",size:Number(form.size)||2,time:form.time||"13:00",duration:form.customDur||getDur(Number(form.size)||2),tables:Array.isArray(form.manualTables)?form.manualTables:[],date:form.date,status:"confirmed",_locked:true};}
    let found=bookings.find(function(b){return b.id===manualTarget;})||null;
    if(found&&manualTarget===editId){found=Object.assign({},found,{size:Number(form.size)||2,time:form.time||found.time,duration:form.customDur||getDur(Number(form.size)||2),date:form.date||found.date,preference:form.preference||found.preference});}
    return found;
  })();

  // v15.8.0: every modal is wrapped in <ModalPresence> so Overlay animates its
  // close (not just its open) — see atoms.jsx. The inner `cond?<X/>:null` guard
  // stays so ModalPresence renders cached children while leaving.
  const prefPickerModal=<ModalPresence show={showPrefPicker}>{showPrefPicker?<PrefPickerModal
    selected={form.preferredTables||[]}
    partySize={form.size}
    onChange={function(next){setForm(function(f){return Object.assign({},f,{preferredTables:next});});}}
    onClose={function(){setShowPrefPicker(false);}} />:null}</ModalPresence>;

  const historyPopup=<ModalPresence show={!!(showHistory&&editId)}>{(showHistory&&editId)?(function(){const cur=bookings.find(function(b){return b.id===editId;});return cur?<HistoryPopup booking={cur} onClose={function(){setShowHistory(false);}} />:null;})():null}</ModalPresence>;


  // reminderBanners is returned by useReminders (Phase D2) and rendered
  // alongside the other top banners further down. Derivation + JSX live
  // in ./hooks/useReminders.jsx.

  // ── Notification banners (v15.8.0) ──────────────────────────────────────────
  // Two families so the grid stops "jumping" when a banner appears/disappears:
  //  • TRANSIENT status toasts → the floating StatusToasts component (v17.3.4,
  //    extracted verbatim; mounted in the relative wrapper around mainView).
  //  • PERSISTENT/actionable banners stay in flow: the three simple ones
  //    (offline / write-error / inefficiency) render via AppBanners (v17.3.4),
  //    the row banners (Overlap / Late / WaitAvail / reminders) were already
  //    components. All STATE stays here (the Phase D3 locked decision — only
  //    rendering moved). See CLAUDE.md "Notification layout".
  const ineffShow=!reshuffled&&inefficient&&dismissedIneff!==viewDate&&optimizerActiveFor(viewDate,autoOptimizer)&&bookingDefaults.reshuffleSuggestEnabled;
  // Overlap warnings banner — shows when one or more seated guests are overstaying
  // into the start time of a booking on the same table (one-tap Reassign per row).
  // v17.0.0 round 7: converted to the Running-late (LateBanner) pattern —
  // OverlapBanner.jsx (collapsible count header + per-row ✕ dismiss) — gated on
  // the Settings master switch. The map is dismiss-filtered HERE (lateBannerMap
  // pattern) so the outer Reveal collapses when the last row is dismissed.
  const overlapBannerMap=useMemo(function(){
    if(!bookingDefaults.overlapWarnEnabled) return EMPTY_OBJ;
    if(overlapDismissed.size===0) return overlapWarnings;
    const map={};
    Object.keys(overlapWarnings).forEach(function(id){if(!overlapDismissed.has(id)) map[id]=overlapWarnings[id];});
    return map;
  },[bookingDefaults,overlapWarnings,overlapDismissed]);
  const hasOverlap=Object.keys(overlapBannerMap).length>0;

  // v16.1.0 — Running-late banner (sibling of the overlap banner): amber rows
  // for today's late confirmed bookings. At the "noshow" stage each row gains
  // a one-tap "No show" → doCancelBooking(id, true) (the existing no-show
  // path: cancels + sets the noShow flag + history/notes). Flash is handled
  // inside doCancelBooking (gated on the save boolean).
  // v16.1.1: row rendering + the per-row ease-in/out lifecycle moved to the
  // LateBanner component (rendered in the banner stack below); `hasLate` drives
  // the outer Reveal for the whole-banner open/close.
  // v16.3.0: reads the ✕-dismiss-filtered lateBannerMap, so dismissing the last
  // row collapses the whole banner (list/timeline still read the raw lateMap).
  const hasLate=Object.keys(lateBannerMap).length>0;

  // ── v16.0.0: viewed day's waitlist (badge button + panel) ───────────────────
  // First-come-first-served order; dayWaitAvail turns the badge orange when a
  // table currently fits at least one waiting party.
  const dayWaiting=useMemo(function(){return waitlist.filter(function(w){return w&&w.status==="waiting"&&w.date===viewDate;}).slice().sort(function(a,b){return (a.createdAt||0)-(b.createdAt||0);});},[waitlist,viewDate]);
  const dayWaitAvail=dayWaiting.some(function(w){return !!waitAvail[w.id];});
  // v16.3.0 — WaitAvailBanner rows: TODAY'S waiting parties for whom a table
  // currently fits (waitAvail) AND not ✕-dismissed this session. Today-only —
  // a future-date fit isn't operationally urgent (it stays in the panel + badge).
  const waitBannerEntries=useMemo(function(){
    const todayStr2=todayStr();
    return (viewDate===todayStr2?dayWaiting:waitlist.filter(function(w){return w&&w.status==="waiting"&&w.date===todayStr2;}).slice().sort(function(a,b){return (a.createdAt||0)-(b.createdAt||0);}))
      .filter(function(w){return !!waitAvail[w.id]&&!waitNotifyDismissed.has(w.id);});
  },[dayWaiting,waitlist,viewDate,waitAvail,waitNotifyDismissed]);
  function dismissWaitRow(id){dismissRow("wait",id);}
  const hasWaitBanner=waitBannerEntries.length>0;

  // ── v17.11.0: double-bookings on the viewed day ────────────────────────────
  // `findConflicts` has existed since v15.6.1 and was wired to exactly one
  // consumer: the silent reconciliation effect, which relocates the newest
  // NON-LOCKED booking and then gives up on the rest. So the clashes it cannot
  // fix — the all-locked ones, which is every walk-in and every drag-drop —
  // were detected, deliberately left alone, and never shown to anyone.
  //
  // Scoped to the VIEWED date rather than today, unlike late/overlap/waitlist.
  // This is the one section whose rows correspond 1:1 to markers drawn on the
  // view you are looking at, and whose action (assign tables) operates on that
  // day. A clash section about today, sitting under a date navigator showing
  // next Tuesday, next to blocks that carry no marker, would be three different
  // days in one glance.
  const clashPairs=useMemo(function(){return findClashes(bookings,viewDate);},[bookings,viewDate]);
  const clashBannerPairs=useMemo(function(){
    if(!clashPairs.length) return EMPTY_ARR;
    if(clashDismissed.size===0) return clashPairs;
    return clashPairs.filter(function(c){return !clashDismissed.has(clashRowId(c));});
  },[clashPairs,clashDismissed]);
  // /code-review fix: a dismissed clash must RE-ARM once it stops being true.
  // The other two dismissal Sets get away with never pruning because their
  // conditions are monotonic within a day — a late booking stays late, an
  // overstay stays an overstay. A double-booking is the opposite: it is the one
  // notification whose whole point is that you go and FIX it, so it clears, and
  // it can then recur on the same pair (drag a booking back onto the table —
  // every drag-drop sets `_locked`, so the reconciler will not undo it).
  //
  // Without this the strip row — the only surface carrying the Assign action —
  // never came back for that pair, for the rest of the session, while the block
  // markers said the clash was live. Dropping ids that are no longer clashing is
  // what makes "dismiss" mean "I have seen THIS one" instead of "never mention
  // these two again".
  //
  // Keyed on the live pair ids and set only when the set actually shrinks, so it
  // cannot re-enter (the v17.10.2 lesson about effects that write derived state).
  useEffect(function(){
    if(clashDismissed.size===0) return;
    pruneDismissed("clash",new Set(clashPairs.map(clashRowId)));
  },[clashPairs,clashDismissed,pruneDismissed]);
  const hasClash=clashBannerPairs.length>0;
  // The timeline's view of the same pairs: per booking, who it clashes with and
  // where. Built from `clashPairs` and NOT from the dismiss-filtered list —
  // dismissing a strip row quiets the row, it does not make the double-booking
  // stop being true, and the block marker is the permanent record of it.
  const clashMap=useMemo(function(){
    if(!clashPairs.length) return EMPTY_OBJ;
    const byId={};bookings.forEach(function(b){byId[b.id]=b;});
    const map={};
    function add(id,other,c){
      if(!map[id]) map[id]={names:[],tables:[]};
      if(other&&map[id].names.indexOf(other.name)<0) map[id].names.push(other.name);
      c.tables.forEach(function(t){if(map[id].tables.indexOf(t)<0) map[id].tables.push(t);});
    }
    clashPairs.forEach(function(c){
      const A=byId[c.a],B=byId[c.b];
      if(!A||!B) return;
      add(c.a,B,c);add(c.b,A,c);
    });
    return map;
  },[clashPairs,bookings]);

  // The same pairs seen per ROW: which minutes of which table are claimed
  // twice. `findClashes` reports the shared window, so the band is drawn from
  // the data rather than re-derived from two blocks' geometry.
  //
  // A pair whose `tables` is empty (the join-cluster case — see findClashes)
  // contributes no band, because there is no single row it belongs on. The
  // marker and the strip row still carry it; only the geometry has nowhere to
  // go, which is the honest outcome rather than a band drawn on a guess.
  const clashSpans=useMemo(function(){
    if(!clashPairs.length) return EMPTY_OBJ;
    const map={};
    clashPairs.forEach(function(c){
      c.tables.forEach(function(t){
        if(!map[t]) map[t]=[];
        map[t].push({from:c.from,to:c.to});
      });
    });
    // v17.14.0 (/code-review follow-up): one band per distinct SPAN, not per
    // pair. Three bookings all clashing on one table produced three coincident
    // bands on the same pixels — three times the paint for one fact, and a
    // three-way clash would have rendered differently from a two-way one the
    // moment the band grew any transparency.
    Object.keys(map).forEach(function(t){map[t]=mergeSpans(map[t]);});
    return map;
  },[clashPairs]);

  // ── v17.11.0: the opening zoom follows the hours span ──────────────────────
  // A block's width is a fraction of the grid and the grid spans the day, so
  // widening the day narrows every block. Measured in the review: at the real
  // 13:00–22:00 the average block is 192px and 8 of 13 carry a start-time chip;
  // at 06:00–01:00 it is 96px, 10 of 13 names truncate and NO block shows a
  // time. Settings permits open 6 through close 25, so that is reachable by an
  // ordinary choice, and the view degrades to colour-and-position exactly when a
  // long day means more bookings to tell apart. `spanZoom` (time-grid.js, with
  // the arithmetic tested) returns the zoom that restores the reference density.
  //
  // An EFFECT, not the initial state, for two reasons. The hours arrive from the
  // server after mount, so a lazy initializer would compute against the seed
  // and never correct itself; and hours are PER WEEKDAY, so a Saturday that
  // closes at 01:00 needs a different answer from the Tuesday beside it.
  //
  // It stops the moment the user touches the controls (`zoomTouchedRef`). The
  // app choosing a sensible starting zoom is help; the app re-choosing it under
  // someone who has already zoomed is a fight, and they would lose it on every
  // date change.
  //
  // `defaultZoom` is a FLOOR, never a ceiling: a device set to open at 3× still
  // opens at 3× on a short day, and at max(3, span) on a long one. The setting
  // says how close in you like to start; this says how much the day owes you.
  // v17.14.0 (/code-review follow-up): ONE value, four names. `hoursFor(viewDate)`
  // was evaluated four times per App render — here, inside the notifSections
  // memo, again for the three views, and again in the header line — each one
  // re-deriving the same weekday lookup. `dayClosed` is declared here rather
  // than beside its first reader for the reason the comment down at the view
  // elements already gives: a `const` used above its declaration in a render
  // body is a TDZ ReferenceError that blanks the whole app, and this file has
  // hit that twice.
  const viewHours=hoursFor(viewDate);
  const dayClosed=viewHours.closed;
  // v17.14.0 (/code-review follow-up): ONE answer to "is this day empty",
  // shared by all three views the way `dayClosed` and `emptyWalkin` already are.
  // It used to be each view's own `day.length === 0`, and List's `day` includes
  // cancelled bookings while Timeline's and Plan's exclude them — so a day whose
  // bookings had all been cancelled showed the prompt in two views and a nearly
  // blank card list in the third. A cancelled booking is not a booked table.
  const isEmptyDay=useMemo(function(){
    return !bookings.some(function(b){return b&&b.date===viewDate&&b.status!=="cancelled";});
  },[bookings,viewDate]);
  const viewGridMins=(viewHours.gridClose-viewHours.open)*60;
  useEffect(function(){
    if(zoomTouchedRef.current) return;
    const want=Math.max(tlSettings.defaultZoom,spanZoom(viewGridMins,tlSettings.maxZoom));
    // Return the SAME value when it already matches, so this cannot re-enter —
    // the v17.10.2 lesson about effects that write derived state.
    setTimelineZoom(function(cur){return cur===want?cur:want;});
  },[viewGridMins,tlSettings.defaultZoom,tlSettings.maxZoom]);

  // v17.11.0: "is the day on screen today?" — read by the strip's date
  // qualifier below AND by the three views' empty-day prompt further down, so it
  // is declared once, ABOVE the first of them. (A `const` read above its own
  // declaration in a render body is a TDZ ReferenceError that blanks the app
  // while build and lint both pass — CLAUDE.md's gotcha, and this is the second
  // time in this one version that moving a line has been the fix.)
  const isViewToday=viewDate===todayStr();

  // ── v17.11.0: naming the day, for the two sections that cross dates ────────
  // The strip sits DIRECTLY under the date navigator, so a bare time in it reads
  // as belonging to the day on screen. Measured in the review: viewing
  // 15.09.2026 it advertised "Sofía Herrera · 2 pax — table free · 20:00", which
  // is today's waitlist and today's 20:00.
  //
  // Date-scoping the strip was the other option and is the wrong one: it would
  // hide a live problem behind an unrelated navigation. Someone browsing next
  // Tuesday to take a booking still needs to know a reminder just fired. So the
  // sections keep their scope and say what it is.
  //
  // EXACTLY TWO sections can be on screen while showing another day's business,
  // and the first draft of this applied the suffix to four. `lateMap` and
  // `overlapWarnings` both `return EMPTY_OBJ` when `viewDate !== today`, so
  // their sections cannot render off-today at all and a qualifier there is dead
  // code that tells the next reader they can. The two that genuinely cross are
  // `waitBannerEntries`, which explicitly falls back to TODAY's waitlist when
  // you navigate away, and the reminder banners, whose hook says outright they
  // are "operational, not tied to the day being viewed".
  //
  // On the TITLE rather than on each row: one place per section, it covers rows
  // carrying no time at all, and it survives collapse — where the lid shows the
  // top section's own title.
  //
  // `Double-booked` takes no suffix because it IS scoped to the viewed date (see
  // clashPairs), which is the day its markers are drawn on. AppBanners takes
  // none either: offline / write-failed / load-failed are not about a day, and
  // `Closed this day` and the inefficiency notice are already about the viewed
  // one.
  const notifToday=isViewToday?"":" · today";

  // ── v17.8.0: the ONE notification strip ────────────────────────────────────
  // Six banners could stack at once and, on a busy evening — exactly when
  // several fire together — they pushed the timeline off the bottom of the
  // tablet. NotificationStrip collapses all of them into a single pane with a
  // one-row collapsed height, so the vertical cost stops scaling with how bad
  // the evening is.
  //
  // ORDER IS SEVERITY, and it lives here rather than in the strip because it
  // is a judgement about THIS app's operations, next to the flags that produce
  // it: a failed write can lose a booking; offline is degraded but safe;
  // a double-booking means two parties are ALREADY on one table and one of them
  // will be turned away; overlap is the softer version of the same sentence —
  // a seated party predicted to run into the next booking; late is a guest
  // problem;
  // reminders are scheduled prompts; the waitlist is an opportunity, not a
  // problem, so it sits last and stays green. The strip shows the first entry
  // as its collapsed summary, which makes "worst thing first" load-bearing.
  // v18.0.0: bookings on the VIEWED day that completed carrying a voucher no
  // ledger entry was ever written for. Scoped to the viewed date rather than to
  // today, unlike late/waitlist/overlap: the whole point of the state is that
  // staff settle it NEXT service, which means seeing it on a day that is no
  // longer today. ClashBanner is scoped the same way.
  // v18.0.0 phase 4: gated HERE rather than at the strip section, because this
  // one memo feeds both the section and `notifAnnounce` — gating the render
  // site alone would leave a screen reader told about a voucher the module has
  // hidden. It also skips the scan entirely when the module is off.
  const unsettledBookings=useMemo(function(){
    if(!vouchersOn) return EMPTY_ARR;
    return bookings.filter(function(b){return b.date===viewDate&&isUnsettled(b,vouchersByCode);});
  },[bookings,viewDate,vouchersByCode,vouchersOn]);
  const notifSections=[].concat(
    appBannerSections({
      isOnline:isOnline,
      writeWarning:writeWarning,
      onDismissWarning:function(){setWriteWarning(null);},
      // v17.16.9 (CT-2A-07): a write whose automatic retries ran out is PARKED
      // rather than dropped, and the "Couldn't save" section grows the two
      // controls that resolve it. It stays in that section rather than becoming
      // its own: the strip's collapsed tally is one icon+count per SECTION, so a
      // second section would have to wear a second mark, and "a write that could
      // not be saved" is not a different category from "couldn't save".
      parkedWrites:parkedWrites,
      onRetryParked:retryParked,
      onDiscardParked:discardParked,
      ineffShow:ineffShow,
      onDismissIneff:function(){setDismissedIneff(viewDate);},
      onReshuffle:function(){setConfirmReshuffle(true);},
      // v17.8.0 strip audit: two notices that were living elsewhere. The load
      // failure was a floating toast (persistent + unrecoverable, so the wrong
      // layer); the closed-day notice was drawn twice, inside TimelineView and
      // PlanView, and not at all in List.
      loadFailed:!bookingsReady&&loadStalled,
      readError:readError,
      hasConnected:hasConnected,
      dayClosed:dayClosed
    }),
    hasClash?[{id:"clash",tone:"var(--danger-text)",tint:"var(--danger-bg)",icon:ClashIcon,
      title:clashBannerPairs.length===1?"Double-booked":"Double-bookings",count:clashBannerPairs.length,
      node:<ClashBanner pairs={clashBannerPairs} bookings={bookings} onAssign={setManualTarget} onDismiss={dismissClashRow} swapKey={viewDate} />}]:[],
    hasOverlap?[{id:"overlap",tone:"var(--warn-text)",tint:"var(--app-overlap-bg)",icon:OverlapIcon,
      title:"Overlap warnings",count:Object.keys(overlapBannerMap).length,
      node:<OverlapBanner warnings={overlapBannerMap} bookings={bookings} onReassign={reassignBooking} onDismiss={dismissOverlapRow} />}]:[],
    hasLate?[{id:"late",tone:"var(--warn-text)",tint:"var(--app-overlap-bg)",icon:LateIcon,
      title:"Running late",count:Object.keys(lateBannerMap).length,
      node:<LateBanner lateMap={lateBannerMap} bookings={bookings} nowMins={nowMins} today={today} onNoShow={function(id){doCancelBooking(id,true);}} onDismiss={dismissLateRow} />}]:[],
    reminderCount?[{id:"reminders",tone:"var(--warn-text)",tint:"var(--app-overlap-bg)",icon:BellRingIcon,
      title:(reminderCount===1?"Reminder":"Reminders")+notifToday,count:reminderCount,node:reminderBanners}]:[],
    hasWaitBanner?[{id:"wait",tone:"var(--success-text)",tint:"var(--suggest-bg-soft)",icon:WaitIcon,
      title:"Waitlist — table free"+notifToday,count:waitBannerEntries.length,
      node:<WaitAvailBanner entries={waitBannerEntries} availability={waitAvail} onBook={bookFromWaitlist} onDismiss={dismissWaitRow} />}]:[],
    unsettledBookings.length?[{id:"unsettled",tone:"var(--warn-text)",tint:"var(--app-overlap-bg)",icon:VoucherIcon,
      title:"Voucher not recorded",count:unsettledBookings.length,
      node:<UnsettledBanner bookings={unsettledBookings} vouchersByCode={vouchersByCode} currency={generalSettings.currency} onOpen={function(id){const b=bookings.find(function(x){return x.id===id;});if(b) openEdit(b);}} swapKey={viewDate} />}]:[]
  );
  // v17.12.0: what a screen reader is TOLD when the strip changes.
  //
  // Three things forced this shape, and each of them rules out the obvious
  // alternative:
  //
  //  1. It cannot live inside NotificationStrip. A live region has to already
  //     BE in the DOM when its content changes, or the insertion goes
  //     unannounced — and the strip is mounted only while `notifSections`
  //     is non-empty, i.e. it arrives WITH its first message every time. This
  //     region is always mounted, so the strip appearing is a content change
  //     inside a region that was already there. (StatusToasts gets this for
  //     free: its container has been always-mounted since v15.8.0.)
  //
  //  2. It cannot be the lid. Every mark in the strip is `aria-hidden` — which
  //     is correct, they are decorative — so the collapsed tally reads as bare
  //     numbers: "Notifications 2 1". And with several sections the lid's title
  //     is the generic word, so going from one section to two would announce
  //     "Notifications", which is less than it knew before.
  //
  //  3. The pane must not itself be live, or dismissing one row re-reads all of
  //     them. Persistent content is a region; the CHANGE is the message.
  //
  // The string is derived from the same titles and counts the strip renders, so
  // the two cannot drift, and it only changes when the notification set does —
  // which is exactly when an announcement is wanted.
  // ── v17.14.0: the day announcer ─────────────────────────────────────────────
  // Changing the viewed date was announced by nothing. The strip and the toasts
  // have spoken since v17.12.0; the VIEW itself still did not, so ←/→ moved a
  // screen-reader user through the week in silence — and the date input is a
  // control whose own value change says only the date, not what is on it.
  //
  // A SUMMARY, deliberately not a live region over the grid: thirteen bookings
  // re-read on every status change would be unusable, and this needs to say the
  // one thing navigation actually changed.
  //
  // On the DATE only. Not on view switches (T/L/P already announce on
  // activation, so it would repeat what the button just said) and not on status
  // changes, which arrive from other devices too — on a busy evening that region
  // would never stop talking.
  //
  // Computed in an effect keyed on `viewDate` ALONE, reading a ref mirror of the
  // bookings. That is what makes "date change only" literal rather than
  // approximate: a `useMemo` over `bookings` would recompute on every write, and
  // a write that changes the COUNT — cancelling a booking, taking a walk-in —
  // would re-announce the whole day summary at a moment nobody navigated.
  //
  // **It says nothing on the first pass, and that is the fix for two things at
  // once** (/code-review). `bookings` starts as `[]` and the hours start at
  // their seed, so a mount-time announcement said "Nothing booked" on a day with
  // twelve, and "open" on a day the loaded schedule closes — then never
  // corrected, because `viewDate` had not changed. And it was wrong in principle
  // anyway: nothing had CHANGED, which is the only thing this region is for.
  // `announcedDateRef` is SEEDED with the mount date, so the date the app opens
  // on is recorded without being spoken for; the first real navigation is the
  // first utterance, by which time the snapshot has landed.
  //
  // Seeded with the date rather than with `null` and a first-run flag, because
  // that flag is wrong under StrictMode: React re-invokes the effect on the
  // simulated remount while REFS SURVIVE, so the flag was already consumed and
  // the second run announced. Measured in DEV — the region held
  // "Friday 21 August. Nothing booked." at mount with the flag version.
  // Comparing the ref to `viewDate` is idempotent under any number of re-runs,
  // which is the property actually wanted: announce when the DATE changed, not
  // when the effect ran.
  const [dayAnnounce,setDayAnnounce]=useState("");
  const bookingsForAnnounceRef=useRef(bookings);
  const announcedDateRef=useRef(viewDate);
  // The mirror is refreshed in a DEP-LESS effect, not during render — the
  // convention `useKeyboardShortcuts` adopted in v17.3.3 for its own ctx ref,
  // for the reason recorded there (a render can be discarded or replayed, so a
  // ref written mid-render can hold a value from a commit that never happened).
  // Declared ABOVE the announce effect so it has already run when that fires.
  useEffect(function(){bookingsForAnnounceRef.current=bookings;});
  useEffect(function(){
    if(announcedDateRef.current===viewDate) return;   // mounting is not navigating
    announcedDateRef.current=viewDate;
    const d=new Date(viewDate+"T00:00:00Z");
    // en-GB + UTC, matching the app's date convention throughout — a local
    // getDay against a UTC date string shifts a day in UTC+ zones (the v14.7.0
    // Week-view lesson, recorded at `weekdayOf`).
    const label=Number.isFinite(d.getTime())
      ? d.toLocaleDateString("en-GB",{weekday:"long",day:"numeric",month:"long",timeZone:"UTC"})
      : viewDate;
    // `hoursFor(viewDate)`, not the `dayClosed` const above, and not by accident
    // (/code-review — commit 9/n of this version collapsed four such calls into
    // one). Two reasons it is right HERE: the value must be for the date being
    // announced, read at effect time; and `dayClosed` in the dep array would
    // re-announce the whole day every time someone saves Opening hours.
    if(hoursFor(viewDate).closed){setDayAnnounce(label+". Closed.");return;}
    const n=bookingsForAnnounceRef.current.reduce(function(acc,b){
      return acc+((b&&b.date===viewDate&&b.status!=="cancelled")?1:0);
    },0);
    setDayAnnounce(label+". "+(n===0?"Nothing booked":n+(n===1?" booking":" bookings"))+".");
  },[viewDate]);
  const notifAnnounce=notifSections.length===0?"":
    (notifSections.length===1?"Notification: ":notifSections.length+" notifications: ")+
    notifSections.map(function(s){return s.title+(s.count>1?", "+s.count:"");}).join("; ")+".";
  // ── v17.8.0: waitlist ghost blocks for the Timeline ─────────────────────────
  // waitAvail already knows, per waiting party, the exact tables + time that
  // would fit them — but that only ever surfaced as a banner row and the ⏳
  // badge, so staff could not see WHERE the party would go and had to guess
  // whether taking them was a good idea. This projects each match onto the
  // viewed day's timeline as a dimmed, pending-coloured block.
  //
  // Scoped to the VIEWED date (waitAvail spans every date ≥ today, the timeline
  // draws one day) and memoised — TimelineView is React.memo'd, so an inline
  // array literal here would defeat the memo on every BookingApp render.
  const waitGhosts=useMemo(function(){
    const out=[];
    waitlist.forEach(function(w){
      if(!w||w.status!=="waiting"||w.date!==viewDate) return;
      const a=waitAvail[w.id];
      if(!a||!a.tables||!a.tables.length||!a.time) return;
      const size=Number(w.size)||2;
      out.push({id:w.id,name:w.name||"Waiting",size:size,time:a.time,dur:getDur(size),tables:a.tables,resh:!!a.resh});
    });
    return out;
  },[waitlist,viewDate,waitAvail]);
  const waitlistModal=<ModalPresence show={showWaitlist}>{showWaitlist?<WaitlistPanel
    entries={dayWaiting}
    availability={waitAvail}
    date={viewDate}
    onBook={bookFromWaitlist}
    onRemove={function(w){if(refused("waitlistManage"))return;removeFromWaitlist(w);}}
    onClose={function(){setShowWaitlist(false);}} />:null}</ModalPresence>;

  // ── v17.1.0 perf: stable view-callback identities (the kbRef pattern) ──────
  // The three main views (+ Summary / DaySheet) are React.memo'd, so any inline
  // closure prop would mint a new identity every BookingApp render and defeat
  // the memo — while a custom comparator that IGNORES function props would
  // freeze stale closures (the trap CLAUDE.md forbids). Instead: the real
  // per-render handlers live on a ref (refreshed every render, so they always
  // close over fresh state), and the props are ONE-TIME wrapper functions that
  // read the ref at event time — stable identity, always-fresh behavior.
  const viewActionsRef=useRef({});
  viewActionsRef.current={openNew,openEdit,updateStatus,doCancelBooking,dropOnTable,openWalkin,toggleShowFinished,setManualTarget,setBlockTarget,setConfirmDel,requestDelete,setConfirmReshuffle,setSummaryOpen,setShowWeek,setSelectedListId,waitlist,bookFromWaitlist,setTimelineZoomManual};
  const [VA]=useState(function(){
    const R=viewActionsRef;
    return {
      onEdit:function(b){R.current.openEdit(b);},
      onStatus:function(id,s){R.current.updateStatus(id,s);},
      onNoShow:function(id){R.current.doCancelBooking(id,true);},
      onDropOnTable:function(id,targetId){return R.current.dropOnTable(id,targetId);},
      onWalkin:function(tableId){R.current.openWalkin(tableId);},
      onManual:function(id){R.current.setManualTarget(id);},
      onBlock:function(id){R.current.setBlockTarget(id);},
      onDelete:function(id){R.current.requestDelete(id);},
      onReshuffle:function(){R.current.setConfirmReshuffle(true);},
      onNew:function(){R.current.openNew();},
      onToggleFinished:function(next){R.current.toggleShowFinished(next);},
      onSelect:function(id){R.current.setSelectedListId(id);},
      onSummaryToggle:function(){R.current.setSummaryOpen(function(o){return !o;});},
      onOpenWeek:function(){R.current.setShowWeek(true);},
      // v17.8.0: tapping a waitlist ghost on the Timeline. The ghost only
      // carries the entry id, so resolve it here against the live waitlist and
      // hand the whole entry to the existing bookFromWaitlist (which prefills
      // the booking form from it + its waitAvail time).
      onBookWait:function(id){const A=R.current;const w=(A.waitlist||[]).find(function(x){return x&&x.id===id;});if(w) A.bookFromWaitlist(w);},
      // /code-review fix: the zoom setter has to come through VA like every
      // other function prop on the memoized views. It replaced `setTimelineZoom`
      // — a React state setter, which is stable across renders forever — with a
      // plain function declared in BookingApp's body, i.e. a NEW identity every
      // render, which busts TimelineView's React.memo unconditionally. The
      // booking-form draft lives in BookingApp, so that re-ran the timeline's
      // whole block layout on every keystroke: the exact failure CLAUDE.md
      // records for `liveBookings`.
      onSetZoom:function(z){R.current.setTimelineZoomManual(z);},
      onPrint:function(){window.print();}
    };
  });

  // v17.0.0: the Plan (floor) view — reads settings/layout.floorPlan via the
  // `layout` state; quick-status + edit + walk-in ride the existing handlers.
  // v17.11.0: the empty-day prompt's three inputs, computed ONCE so the three
  // views cannot disagree about when a day is empty or what you may do with it.
  // The walk-in rule is List's, generalised: a walk-in is a party standing at
  // the door now, so offering it on any day but today opens a form for the wrong
  // date.
  //
  // Declared ABOVE the three view elements, not next to the first one that
  // reads them: `planView` is built first, and a `const` used above its
  // declaration in a render body is a TDZ ReferenceError that blanks the whole
  // app — which neither `npm run build` nor lint sees. Hit here exactly as
  // CLAUDE.md's gotcha describes, and caught by loading the page.
  const emptyWalkin=isViewToday?VA.onWalkin:null;

  const planView=<PlanView
    bookings={bookings}
    date={viewDate}
    layout={layout}
    blocks={tableBlocks}
    nowMins={nowMins}
    late={lateMap}
    freeing={freeingMap}
    onEdit={VA.onEdit}
    onStatus={VA.onStatus}
    onNoShow={VA.onNoShow}
    onWalkin={VA.onWalkin}
    gesturesEnabled={planGestures}
    turnBuffer={turnBuffer}
    onNew={VA.onNew}
    emptyWalkin={emptyWalkin}
    isEmpty={isEmptyDay}
    dayClosed={dayClosed}
    hoursSig={weekHours} />;
  // v17.1.0 perf note: hoursSig / layoutSig are identity-only props — the views
  // read OPEN/GRID_CLOSE/QUARTER_HOURS/TIMELINE_TABLES/TOTAL_SEATS as LIVE
  // module bindings, which React.memo cannot see. Passing the weekHours/layout
  // state objects makes an hours or layout edit bust the memo so the views
  // repaint with the new bindings.
  // v17.5.0: all three views are now built unconditionally and indexed, because
  // Split View renders TWO of them. Constructing an element is just
  // createElement — nothing renders until it's mounted — and `planView` above
  // has always been built this way, so this costs nothing.
  const timelineEl=<TimelineView
    bookings={bookings}
    date={viewDate}
    today={today}
    onEdit={VA.onEdit}
    onManual={VA.onManual}
    onStatus={VA.onStatus}
    onDropOnTable={VA.onDropOnTable}
    blocks={tableBlocks}
    onBlock={VA.onBlock}
    nowMins={nowMins}
    warnings={overlapWarnings}
    clashes={clashMap}
    clashSpans={clashSpans}
    late={lateMap}
    freeing={freeingMap}
    onNoShow={VA.onNoShow}
    zoom={timelineZoom}
    setZoom={VA.onSetZoom}
    followZoom={tlSettings.followZoom}
    followLeadMins={tlSettings.followLead}
    maxZoom={tlSettings.maxZoom}
    scrollPosRef={timelineScrollRef}
    followNow={followNow}
    setFollowNow={setFollowNow}
    autoOptimizer={autoOptimizer}
    setAutoOptimizer={setAutoOptimizer}
    onReshuffle={VA.onReshuffle}
    turnBuffer={turnBuffer}
    waitGhosts={waitGhosts}
    onBookWait={VA.onBookWait}
    hoursSig={weekHours}
    layoutSig={layout}
    onNew={VA.onNew}
    emptyWalkin={emptyWalkin}
    isEmpty={isEmptyDay}
    dayClosed={dayClosed}
    currency={generalSettings.currency} />;
  // v17.15.5: `clashes` is the SAME memo TimelineView takes. The List card drew
  // nothing at all for a double-booking, which is the one fault where this app
  // asserted something FALSE rather than merely omitting it — the argument that
  // put ClashBanner and the block's marker in v17.11.0, applied to the third
  // surface. It is built from `clashPairs` and not the dismiss-filtered list:
  // dismissing a strip row quiets the row, it does not make the double-booking
  // stop being true.
  const listEl=<ListView
    vouchersByCode={vouchersByCode}
    vouchersOn={vouchersOn}
    bookings={bookings}
    date={viewDate}
    today={today}
    onEdit={VA.onEdit}
    onStatus={VA.onStatus}
    onDelete={VA.onDelete}
    onManual={VA.onManual}
    nowMins={nowMins}
    warnings={overlapWarnings}
    late={lateMap}
    clashes={clashMap}
    onNoShow={VA.onNoShow}
    selectedId={selectedListId}
    focusReq={listFocusReq}
    onSelect={VA.onSelect}
    showFinished={showFinished}
    onToggleFinished={VA.onToggleFinished}
    onNew={VA.onNew}
    emptyWalkin={emptyWalkin}
    isEmpty={isEmptyDay}
    dayClosed={dayClosed}
    currency={generalSettings.currency} />;
  const viewEl={timeline:timelineEl,list:listEl,plan:planView};
  const mainView=viewEl[view];

  // ── v17.5.0: Split View handlers ────────────────────────────────────────────
  // A plain tap on a view button REPLACES the focused pane; if that view is
  // already in the other pane the two swap instead, so the same view can never
  // occupy both (which would collide on the singleton timelineZoom /
  // selectedListId / showFinished state). Outside a split it's the original
  // behaviour, slide direction included.
  function pickView(v){
    if(split){
      const other=focusedPane==="a"?"b":"a";
      // Tapping the view that is already in the OTHER pane swaps the two.
      // v17.14.0 (/code-review follow-up): the swap now INVERTS THE RATIO, like
      // `swapSides` beside it, so each view keeps its own size across the swap
      // instead of inheriting the size of the pane it moved into. That was the
      // only difference between these two lines and `swapSides`' — one of them
      // was simply missing it.
      if(split[other]===v){applySplit(fitTimeline(Object.assign({},split,{a:split.b,b:split.a,ratio:1-split.ratio})));setFocusedPane(other);return;}
      if(split[focusedPane]===v) return;
      // v17.11.0: tapping "Timeline" while a side-by-side pane is too narrow for
      // one would drop it into exactly the layout the menu refuses to build. The
      // split TURNS to stacked instead of refusing the tap: the user asked for
      // the timeline, and the orientation is the part that does not fit.
      applySplit(fitTimeline(Object.assign({},split,{[focusedPane]:v})));
      return;
    }
    if(v!==view) bumpSlide(VIEW_ORD.indexOf(v)>VIEW_ORD.indexOf(view)?"mgt-view-in-right":"mgt-view-in-left");
    setView(v);
  }
  // v17.14.0: turn a split stacked when the pane holding the Timeline is too
  // narrow for one. Shared by BOTH branches of pickView above — the swap branch
  // used to skip this check entirely and lean on the repair effect to reorient
  // the layout a render later, which the user sees as the split visibly
  // flipping after a plain view tap. Asks where the timeline actually ENDS UP,
  // rather than assuming it is the view that was tapped: a swap moves both.
  function fitTimeline(next){
    const tlPane=next.a==="timeline"?"a":next.b==="timeline"?"b":null;
    if(!tlPane) return next;
    if(tlPaneOk(shellW,next.dir,next.ratio,tlPane)) return next;
    return Object.assign({},next,{dir:"h"});
  }
  function confirmSplit(next){
    setSplitMenuFor(null);
    applySplit(next);
    setFocusedPane("a");
    // Keep the single-view state coherent for anything still reading `view`
    // (the search-jump, the keyboard fallback) — pane A is the one it invoked on.
    setView(next.a);
  }
  function swapSides(){
    if(!split) return;
    applySplit(Object.assign({},split,{a:split.b,b:split.a,ratio:1-split.ratio}));
    setFocusedPane(focusedPane==="a"?"b":"a");
  }
  function toggleSplitDir(){ if(split) applySplit(Object.assign({},split,{dir:split.dir==="v"?"h":"v"})); }
  function exitSplit(){ if(split){ setView(split[focusedPane]); applySplit(null); } }
  function setSplitRatio(r){ if(split) applySplit(Object.assign({},split,{ratio:r})); }



  const summaryPanel=<Summary
    bookings={bookings}
    date={viewDate}
    splitHour={dayShifts.split}
    shiftsEnabled={dayShifts.enabled}
    isToday={viewDate===todayStr()}
    open={summaryOpen}
    freeing={freeingList}
    hoursSig={weekHours}
    layoutSig={layout}
    onToggle={VA.onSummaryToggle}
    onOpenWeek={VA.onOpenWeek}
    onPrint={VA.onPrint} />;
  // v17.9.1: the vertical position of the two date-nav control groups — see
  // DATE_CTRL_DROP. Applied to BOTH groups so the arrows/date field and the
  // Today/waitlist pills stay on one line as they move.
  //
  // Guarded on !isMobile: below 600px the Summary's flexBasis is "100%", so it
  // wraps onto its own flex line and the controls' line is exactly control
  // height. There is nothing to centre in there, and an unguarded offset would
  // push them down into the row gap instead. At >=600 the Summary is
  // flexShrink:1 with minWidth:0, so it shrinks rather than wrapping and the
  // single-line assumption this offset depends on holds.
  const dateCtrlShift=(isMobile||summaryOpen)?"none":"translateY("+DATE_CTRL_DROP+"px)";
  // v16.3.0: print-only day sheet (portalled to body; hidden on screen). Mounted
  // permanently — cheap (display:none) — so window.print() always has fresh content.
  const daySheet=<DaySheet bookings={bookings} date={viewDate} splitHour={dayShifts.split} waitlist={waitlist} blocks={tableBlocks} restaurantName={generalSettings.restaurantName} currency={generalSettings.currency} vouchersOn={vouchersOn} />;

  const delModal=<ModalPresence show={!!confirmDel}>{confirmDel?<Overlay /* @static-height one fixed sentence and two buttons */ onClose={function(){setConfirmDel(null);}} footer={<div style={{display:"flex",justifyContent:"flex-end",gap:8}}><button
        className="mgt-hover-scale"
        style={mkBtn({minHeight:44,padding:"10px 18px",background:"var(--app-btn-slate)"})}
        onClick={function(){setConfirmDel(null);}}>Back</button><button
        onClick={function(){delBooking(confirmDel);}}
        className="mgt-hover-scale"
        style={mkSolidBtn("var(--app-danger-solid)")}>Delete</button></div>}><h2 style={{fontSize: T.title,fontWeight: FW.bold,margin:0,marginBottom:8,color:S.text}}>Delete booking?</h2><div style={{fontSize: T.lead,color:S.text,marginBottom:18}}>This can't be undone. Tables will be re-optimised afterwards.</div></Overlay>:null}</ModalPresence>;

  // v17.5.0: the ONE discard confirm, shared by the booking form, the walk-in
  // form and ManualModal (requestClose* raise it; doDiscard commits).
  // Wrapped in a relative z-260 div rather than relying on DOM order: it must
  // paint above the three z-200 Overlays it guards, and `position:fixed` still
  // anchors to the viewport inside a plain relative/z-index ancestor (only
  // transform/filter/perspective would break that). Order-proof by construction.
  //
  // "Keep editing" uses --app-btn-slate, NOT BTN.cancel: in this app's
  // vocabulary "cancel" means cancel the BOOKING, so --btn-cancel is RED. The
  // delModal footer this is otherwise modelled on can afford that (its safe
  // option is literally called Cancel); here the safe option sitting next to a
  // red Discard would read as two danger buttons — the exact mis-tap this
  // guard exists to prevent. Slate is the house token for a neutral dialog
  // secondary (see confirmKitchen's "Back").
  const DISCARD_BODY={
    form:"The booking you're editing hasn't been saved yet.",
    walkin:"This walk-in hasn't been saved yet.",
    manual:"Your table selection hasn't been applied yet.",
    reminder:"This reminder hasn't been saved yet.",
    block:"This table block hasn't been applied yet.",
    settings:"A setting you were editing hasn't been saved yet."
  };
  const discardModal=<div style={{position:"relative",zIndex:260}}><ModalPresence show={!!confirmDiscard}>{confirmDiscard?<Overlay /* @static-height one sentence out of DISCARD_BODY, fixed for the life of one open */ onClose={function(){setConfirmDiscard(null);}} footer={<div style={{display:"flex",justifyContent:"flex-end",gap:8}}><button
        className="mgt-hover-scale"
        style={mkBtn({minHeight:44,padding:"10px 18px",background:"var(--app-btn-slate)"})}
        onClick={function(){setConfirmDiscard(null);}}>Keep editing</button><button
        onClick={doDiscard}
        className="mgt-hover-scale"
        style={mkSolidBtn("var(--app-danger-solid)")}>Discard</button></div>}><h2 style={{fontSize: T.title,fontWeight: FW.bold,margin:0,marginBottom:8,color:S.text}}>Discard unsaved changes?</h2><div style={{fontSize: T.lead,color:S.text,marginBottom:18}}>{DISCARD_BODY[confirmDiscard]||"Your changes haven't been saved yet."}</div></Overlay>:null}</ModalPresence></div>;

  const manualModal=<ModalPresence show={!!manualBooking}>{manualBooking?<ManualModal
    booking={manualBooking}
    bookings={manualTarget==="__new__"?bookings.filter(function(b){return b.date===form.date;}):bookings}
    blocks={tableBlocks}
    onSave={function(tables,locked,affected){if(manualTarget==="__new__"){setForm(function(f){return Object.assign({},f,{manualTables:tables});});setSwapAffected(affected||null);setManualTarget(null);}else{if(refused("bookingAssign"))return;manualAssign(manualBooking.id,tables,locked,affected);}}}
    onDirty={setManualDirty}
    onClose={requestCloseManual} />:null}</ModalPresence>;

  const walkinModal=<ModalPresence show={showWalkin}>{showWalkin?<WalkinForm
    today={today}
    draft={walkinForm}
    setDraft={setWalkinForm}
    error={walkinError}
    liveBookings={liveBookings}
    bookings={bookings}
    tableBlocks={tableBlocks}
    autoOptimizer={autoOptimizer}
    walkinNum={getNextWalkinNum()}
    isMobile={isMobile}
    nowMins={nowMins}
    onSave={saveWalkin}
    onClose={requestCloseWalkin}
    onAddToWaitlist={addWalkinToWaitlist} />:null}</ModalPresence>;

  // v17.1.0: Suspense INSIDE the ModalPresence (fallback null) so the open/close
  // animation contract is untouched — on first open the lazy chunk pops in a
  // frame or two later; every later open is instant (module cached).
  const weekModal=<ModalPresence show={showWeek}>{showWeek?<Suspense fallback={null}><WeekView
    bookings={bookings}
    viewDate={viewDate}
    onPick={function(d){setViewDate(d);setShowWeek(false);}}
    onClose={function(){setShowWeek(false);}} /></Suspense>:null}</ModalPresence>;

  return (
    <div
      style={Object.assign({background:"var(--bg-app)",padding:isMobile?"12px 12px calc(12px + env(safe-area-inset-bottom))":"16px",fontFamily:"var(--font-app)",color:S.text,boxSizing:"border-box"},
        /* v17.5.0: shellFixed → a 100dvh flex column whose inner region scrolls,
           so the header + date rows stay put. Off = the original growing block.
           v17.5.0 correction: NO overflow:hidden here. It clipped the List
           cards' .mgt-hover-scale lift (scale 1.08 = 4% of card width per side,
           ~32px on a full-width card) at the shell edge — visible mid-screen,
           whereas normally that lift just bleeds to the window edge. It was
           only ever belt-and-braces: html+body are already overflow:hidden in
           this mode (see the body effect above), so nothing can scroll here. */
        shellFixed?{height:"100dvh",display:"flex",flexDirection:"column"}:{minHeight:"100dvh"})}><div style={Object.assign({maxWidth:appWidth,margin:"0 auto"},shellFixed?{flex:1,minHeight:0,width:"100%",display:"flex",flexDirection:"column"}:null)}>{/* v17.0.0 correction: adjustable per-device width (Settings→General; was fixed 1000, then 1600) */}
          {/* v17.14.0: the skip link. v17.12.0 added the landmarks, which are the
              programmatic bypass and cost nothing visually; this is the one for
              sighted keyboard users, in an app that is explicitly keyboard-driven
              — the header is a cog, a title block, three view buttons, two
              primary actions, a search and a connection dot before you reach a
              booking, and on every date change you land back at the top of it.

              FIRST in the DOM, because a bypass that is not the first thing you
              reach is not a bypass. It is hidden by being translated off the top
              rather than by `display:none`, which would make it unfocusable and
              so unreachable — the whole rule is in index.html (`.mgt-skip`), and
              it is in CRITICAL_SELECTORS because losing it fails silently in
              both directions: the link either never appears or never hides.

              `<main>` carries `tabIndex={-1}`: following a fragment link moves
              focus to the target only if the target can hold it, and without
              that the browser scrolls but the next Tab starts from the header
              again — which looks like the link working and is exactly the bug
              this is meant to remove. It is NOT in the tab order (-1, not 0).

              It is deliberately outside <header>, so `inert` while a modal is
              open does not reach it — a skip link inside an inert subtree is
              silently unfocusable, the same trap as a live region in one. */}
          <a className="mgt-skip" href="#mgt-main">Skip to bookings</a><header
          /* v17.12.0: `inert` while a modal is open — see the <main> note below. */
          inert={anyModal}
          style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12,flexWrap:"wrap",gap:8,flexShrink:0}}>{/* v17.9.0 (Patryk): the cog leads the title block. The two lines
              beside it ARE the restaurant's configuration read back — its name,
              its table counts, its opening hours — and the control that edits
              all three now sits against them instead of across the row in a
              toolbar. minWidth:0 so the title, not the cog, absorbs a squeeze. */}<div style={{display:"flex",alignItems:"center",gap:10,minWidth:0}}><button
              onClick={function(){setShowSettings(true);}}
              title="Settings & keyboard shortcuts"
              aria-label="Settings & keyboard shortcuts"
              className="mgt-hover-scale"
              style={CHROME_BTN}><CogIcon size={IC.chrome} /></button><div style={{minWidth:0}}><h1 style={{fontSize:isMobile?T.title:T.display,fontWeight: FW.bold,margin:0}}>{generalSettings.restaurantName}</h1><div style={{fontSize: T.body,color:S.text,fontWeight: FW.medium}}>{INDOOR.length+" indoor  "+OUTDOOR.length+" outdoor  "+(dayClosed?"Closed":hourLabel(OPEN)+" - "+hourLabel(CLOSE))}</div></div></div><div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center"}}><ViewSwitcher
              view={view}
              split={split}
              focusedPane={focusedPane}
              splitEnabled={splitEnabled}
              isMobile={isMobile}
              onPickView={pickView}
              onOpenSplitMenu={setSplitMenuFor}
              onSwapSides={swapSides}
              onToggleDir={toggleSplitDir}
              onExitSplit={exitSplit} /><button
              onClick={openWalkin}
              className="mgt-hover-scale"
              style={mkSolidBtn("var(--app-walkin)",{padding:"8px 14px",fontSize: T.body,minHeight:H.control})}>Walk-in</button><button
              onClick={openNew}
              className="mgt-hover-scale"
              style={mkSolidBtn("var(--app-new)",{padding:"8px 14px",fontSize: T.body,minHeight:H.control})}>+ New</button>{/* v18.0.0 phase 5: the WA entry point is gated on the MODULE, not on
              WA_SANDBOX. Same guarantee — the module ships off, so a build on PROD
              Firebase (including a main-project Vercel preview of this branch) reads
              `settings/admin.modules`, finds WhatsApp disabled and shows no WA UI —
              but now an admin can turn it on, which is the point of the release. */}
            {whatsappOn?<button
              onClick={function(){setShowInbox(true);}}
              className="mgt-hover-scale"
              title="WhatsApp inbox (I)"
              style={mkSolidBtn("var(--wa-green)",{position:"relative",padding:"8px 14px",fontSize: T.body,minHeight:H.control})}>WhatsApp{wa.unreadCount>0?<span style={{position:"absolute",top:-6,right:-6,minWidth:18,height:18,padding:"0 5px",borderRadius:R.pill,background:"var(--wa-unread-dot)",color:"var(--text-on-accent)",fontSize: T.small,fontWeight: FW.bold,display:"flex",alignItems:"center",justifyContent:"center",boxShadow:"var(--shadow-flat)",boxSizing:"border-box"}}>{wa.unreadCount}</span>:null}</button>:null}{/* v17.9.0 (Patryk): Find-a-booking moved here from the date-nav
              toolbar, between "+ New" and the dot. Searching is an ACTION, and
              this is the row of them — it reads as the counterpart to adding a
              booking rather than as view chrome. */}<button
              onClick={function(){setShowSearch(true);}}
              title="Find a booking"
              aria-label="Find a booking"
              className="mgt-hover-scale"
              style={CHROME_BTN}><SearchIcon size={IC.chrome} /></button>{/* v17.8.0: the Log-out button used to sit here, left of the dot.
              It now lives INSIDE this popover, on the status row — see
              ConnectionStatus. That also drops one item from a header that
              wrapped to a third row on a phone. */}<ConnectionStatus connected={isOnline} hasConnected={hasConnected} userEmail={auth.currentUser&&auth.currentUser.email} devices={presenceDevices} myKey={presenceKey} offset={presenceOffset} onReconnect={forceReconnect} onLogout={function(){signOut(auth);}} /></div></header><div
          /* v17.9.0 (Patryk): the date controls are 40px and the collapsed
             Summary card beside them is 58, so `flex-start` left them sitting
             flush against the top of the row with 18px of dead space beneath —
             measured, not eyeballed. Centring fixes that.

             But the alignment has to FLIP when the summary expands: the summary
             is what drives this row's height, and at ~210px open, centred date
             controls float into the vertical middle of a tall panel, visually
             detached from the header above them. Open ⇒ back to the top, which
             is where a control that is not the tall thing belongs.

             v17.9.1: the intent above is unchanged; the MECHANISM is. The row is
             pinned to flex-start and the controls carry the offset themselves as
             a transitioned transform (DATE_CTRL_DROP), because flipping
             `alignItems` re-resolved the position against whatever height the
             row happened to have in that one frame — which, on collapse, was
             still the open height. See DATE_CTRL_DROP for the numbers. */
          inert={anyModal}
          style={{display:"flex",alignItems:"flex-start",gap:8,marginBottom:12,flexWrap:"wrap",flexShrink:0}}><nav aria-label="Date" style={{display:"flex",gap:4,alignItems:"center",transform:dateCtrlShift,transition:"transform "+M.shift}}><button
              onClick={function(){goToDate(stepDate(viewDate,-1));}}
              className="mgt-hover-scale"
              style={mkBtn({minHeight:40,minWidth:40,padding:"6px 10px",fontSize: T.title,background:BTN.nav})}
              aria-label="Previous day"
              title="Previous day (←)"
              ><ChevronLeftIcon size={IC.chrome} /></button><button
              onClick={function(){goToDate(stepDate(viewDate,1));}}
              className="mgt-hover-scale"
              style={mkBtn({minHeight:40,minWidth:40,padding:"6px 10px",fontSize: T.title,background:BTN.nav})}
              aria-label="Next day"
              title="Next day (→)"
              ><ChevronRightIcon size={IC.chrome} /></button><DateField
              /* v18.0.0 session 7: the weekday inside the pill ("Fri
                 11/09/2026"). The pill's look moved onto DateField's wrapper
                 unchanged; the input's own name rides in inputProps. */
              inputProps={{"aria-label":"Viewed date"}}
              value={viewDate}
              onChange={function(e){goToDate(e.target.value);}}
              style={{fontSize: T.lead,padding:"8px 10px",borderRadius:R.pill,border:"1px solid var(--app-date-border)",background:"var(--app-date-bg)",color:S.text,fontWeight: FW.semi,minWidth:130,minHeight:40,boxSizing:"border-box",boxShadow:"var(--shadow-input)"}} /></nav><div style={{display:"flex",gap:6,alignItems:"center",transform:dateCtrlShift,transition:"transform "+M.shift}}><Presence show={viewDate!==todayStr()} inClass="mgt-slide-in" outClass="mgt-slide-out" tag="span"><button
              onClick={function(){goToDate(todayStr());}}
              className="mgt-hover-scale"
              style={mkBtn({minHeight:40,padding:"6px 14px",background:BTN.today})}>Today</button></Presence>{/* v16.0.0: waitlist badge — lives in the Today slot (to Today's right when
              Today is visible); the flex:1 Summary sibling absorbs the width change.
              Orange = a table currently fits someone waiting; slate = just waiting. */}
            <Presence show={dayWaiting.length>0} inClass="mgt-slide-in" outClass="mgt-slide-out" tag="span"><button
              onClick={function(){setShowWaitlist(true);}}
              aria-label={"Waitlist — "+dayWaiting.length+" waiting"+(dayWaitAvail?", a table is free now":"")}
              title={"Waitlist — "+dayWaiting.length+" waiting"+(dayWaitAvail?", a table is free now":"")}
              className="mgt-hover-scale"
              /* v17.10.0: the waitlist wears the PENDING amber, not the burnt
                 orange it shared with No show / Reassign / Reshuffle / the swap
                 family — a party on the waitlist is a pending thing, and that
                 amber is the app's colour for pending things. See the contrast
                 note at tests/contrast.test.js's EXEMPT_FLOOR: this fill under
                 white text is a recorded exemption, extended to this chrome by
                 Patryk after seeing all three candidate treatments side by side
                 in both themes. */
              style={mkBtn({minHeight:40,padding:"6px 14px",background:dayWaitAvail?BLOCK_BG.pending:BTN.nav,display:"inline-flex",alignItems:"center",gap:6})}><WaitIcon size={IC.control} />{dayWaiting.length}</button></Presence></div><div style={{flexGrow:1,flexShrink:1,flexBasis:isMobile?"100%":360,minWidth:0,transition:"flex-basis "+M.shift}}>{summaryPanel}</div>{/* v17.9.0: the 🔍/⚙ pair that lived here since v17.0.0 round 8 is
              gone — both buttons moved up into the header row above, each to the
              thing it acts on (see CHROME_BTN). The pair was created to give all
              three views ONE copy of these controls, and that still holds: the
              header is no less shared than the date-nav row was. */}</div>{/* v17.5.0: in the fixed shell everything from here down lives in ONE
            scroll region, so the two rows above stay pinned. The banners scroll
            away with the content — they're the pinning scope Patryk chose, and
            several open at once (a 3+ row late banner) would eat the viewport.
            When shellFixed is off this div is a plain, style-less wrapper and
            the page scrolls exactly as it always did. */}
            <main id="mgt-main" tabIndex={-1} style={shellFixed?Object.assign({flex:1,minHeight:0,display:"flex",flexDirection:"column"},
              /* With a split the panes own the scrolling, so this region must
                 NOT scroll — a flex:1 child of an overflowY:auto parent resolves
                 to CONTENT height, which would collapse a top/bottom split. The
                 banners therefore pin here (they scroll away in nav-lock-only
                 mode); they're collapsible and dismissible, so that's affordable. */
              /* v17.5.0 correction — the hover-lift gutter. A scroll container
                 clips at its PADDING box, and CSS can't pair overflow-y:auto
                 with overflow-x:visible (the spec forces the other axis to
                 clip), so the only way to keep the List cards' 1.08 lift intact
                 is to make the scrollport wider than its content. Negative
                 margin + equal padding does exactly that, and in PERCENT it is
                 self-scaling: the lift needs 4% of the card width per side, the
                 card is the content box, so 4% padding is precisely enough at
                 any width. The negative margin puts the content back where it
                 was, so card width and position are unchanged from before. */
              split?{overflow:"hidden"}:{overflowY:"auto",overflowX:"hidden",WebkitOverflowScrolling:"touch",marginInline:"-4%",paddingInline:"4%",paddingBlock:12}):undefined}>{/* v17.12.0 (review fix): `inert` sits on the two CONTENT
                  children rather than on <main> itself. It was on <main>, and
                  <main> also contains StatusToasts — the app's live region for
                  transient status. `inert` removes a subtree from the
                  ACCESSIBILITY TREE as well as the tab order, so every toast
                  went silent for as long as any modal was open, and the Undo
                  pill inside it stopped being clickable. Both are wrong for
                  the same reason: a floating status layer pinned ABOVE the
                  dialog is not "the page behind the dialog", which is the only
                  thing `inert` is meant to describe. This is the same finding
                  as notifAnnounce living outside <main>, one level down. */}<div inert={anyModal}><Reveal speed="move" show={notifSections.length>0}>{/* null, not an empty strip: Reveal caches its last truthy
                  children, so the pane fades out fully drawn instead of blanking a
                  frame and then collapsing an empty box. */}{notifSections.length?<NotificationStrip sections={notifSections} collapseMax={generalSettings.lateCollapseMax} lidIcon={BellIcon} swapKey={viewDate} />:null}</Reveal></div><div style={shellFixed?{position:"relative",flex:1,minHeight:0,display:"flex",flexDirection:"column"}:{position:"relative"}}><StatusToasts
                bookingsReady={bookingsReady}
                loadStalled={loadStalled}
                resyncing={resyncing}
                reconnectShown={reconnectShown}
                syncFix={syncFix}
                waitAddedShown={waitAddedShown}
                undoInfo={undoInfo}
                onUndo={undoLastAction}
                undoNote={undoInfo&&undoInfo.note?undoInfo.note:""}
                permMsg={permMsg}
                dragMsg={dragMsg}
                reshuffled={reshuffled}
                reshuffledMsg={reshuffledMsg}
                loadShown={loadBannerShown}
                loadMsg={"Connected to the server — "+(firstLoadCount.current||0)+" booking"+(firstLoadCount.current===1?"":"s")+" loaded."} /><div
                /* v17.12.0 (review fix): the view — the actual "page behind the
                   dialog" — is what goes inert, not <main>. See the note on the
                   strip wrapper above for why the toast layer above this div
                   must stay live.
                   In the shellFixed layout this wrapper is load-bearing rather
                   than decorative: SlideView takes `fill` and resolves its own
                   flex:1/minHeight:0 against its PARENT, so an intervening plain
                   block would collapse the chain and the panes would size to
                   content. It therefore carries the same three properties. */
                inert={anyModal}
                style={shellFixed?{flex:1,minHeight:0,display:"flex",flexDirection:"column"}:undefined}><SlideView key={slide.k} dir={slide.dir} fill={shellFixed}>{split?<SplitLayout
                dir={split.dir}
                ratio={split.ratio}
                onRatio={setSplitRatio}
                focused={focusedPane}
                onFocus={setFocusedPane}
                paneA={viewEl[split.a]}
                paneB={viewEl[split.b]} />:mainView}</SlideView></div></div></main>{/* v17.12.0: the notification announcer sits OUTSIDE <main>, and that
        is not tidiness. `inert` removes a subtree from the accessibility tree as
        well as from the tab order, so a live region inside an inert region goes
        SILENT — and the things this announces (a failed write, the connection
        dropping, a double-booking appearing) are exactly the ones a modal must
        not suppress. Always mounted; see notifAnnounce. */}<div className="mgt-sr-only" role="status" aria-live="polite">{notifAnnounce}</div>{/* v17.14.0: the DAY announcer, a second region rather than a share of the
        one above. They answer different questions and can change in the same
        commit — a date change that also brings a clash into view would have one
        overwrite the other inside a single region, and whichever won would be
        arbitrary. Same placement rules: always mounted, outside <main>. */}<div className="mgt-sr-only" role="status" aria-live="polite">{dayAnnounce}</div>{splitMenuFor?<SplitMenu
              view={splitMenuFor}
              onConfirm={confirmSplit}
              sideBySideOk={splitSideBySideOk}
              onClose={function(){setSplitMenuFor(null);}} />:null}<ModalPresence show={showForm}>{showForm?<BookingFormModal
              form={form}
              setForm={setForm}
              editId={editId}
              error={error}
              errorField={errorField}
              bookings={bookings}
              liveBookings={liveBookings}
              tableBlocks={tableBlocks}
              autoOptimizer={autoOptimizer}
              isMobile={isMobile}
              currency={generalSettings.currency}
              vouchers={vouchers}
              vouchersByCode={vouchersByCode}
              vouchersOn={vouchersOn}
              regularMin={generalSettings.regularMin}
              today={today}
              nowMins={nowMins}
              onSave={function(){save();}}
              onSavePending={function(){save("pending");}}
              onSaveConfirm={function(){save("confirmed");}}
              onClose={requestCloseForm}
              onClearSwap={function(){setSwapAffected(null);}}
              onBookAgain={bookAgain}
              onOpenPrefPicker={function(){setShowPrefPicker(true);}}
              onOpenManualAssign={function(target){setManualTarget(target);}}
              onOpenHistory={function(){setShowHistory(true);}}
              onRequestCancel={function(id){setConfirmCancel(id);}}
              onRequestDelete={function(id){requestDelete(id);}}
              onAddToWaitlist={addFormToWaitlist}
              standingEnabled={recurring.enabled!==false} />:null}</ModalPresence>{delModal}{manualModal}{walkinModal}{discardModal}{weekModal}{prefPickerModal}{waitlistModal}{daySheet}<ModalPresence show={showSearch}>{showSearch?<Suspense fallback={null}><SearchPanel bookings={bookings} todayStr={todayStr()} onPick={function(b){setShowSearch(false);setView("list");if(b.date===viewDate){setSelectedListId(b.id);const fin=b.status==="completed"||b.status==="cancelled";setShowFinished(fin);bumpListFocus();}else{pendingSelectRef.current=b.id;goToDate(b.date);}}} onClose={function(){setShowSearch(false);}} /></Suspense>:null}</ModalPresence><ModalPresence show={!!blockTarget}>{blockTarget?<BlockModal
          tableId={blockTarget}
          date={viewDate}
          blocks={tableBlocks}
          onSave={addBlock}
          onRemove={removeBlock}
          onDirty={setBlockDirty}
          onClose={requestCloseBlock} />:null}</ModalPresence><ModalPresence show={!!confirmCancel}>{confirmCancel?<Overlay /* @static-height one fixed sentence and three buttons */ onClose={function(){setConfirmCancel(null);}} footer={<div style={{display:"flex",justifyContent:"flex-end",gap:8,flexWrap:"wrap"}}><button
              className="mgt-hover-scale"
              style={mkBtn({minHeight:44,padding:"10px 18px",background:"var(--app-btn-slate)"})}
              onClick={function(){setConfirmCancel(null);}}>Back</button><button
              onClick={function(){doCancelBooking(confirmCancel,true);setShowForm(false);}}
              className="mgt-hover-scale"
              style={mkSolidBtn(BTN.orange,{display:"inline-flex",alignItems:"center",gap:6})}><NoShowIcon size={IC.control} />No show</button><button
              onClick={function(){doCancelBooking(confirmCancel,false);setShowForm(false);}}
              className="mgt-hover-scale"
              style={mkSolidBtn(BLOCK_BG.cancelled)}>Cancel booking</button></div>}><h2 style={{fontSize: T.title,fontWeight: FW.bold,margin:0,marginBottom:8,color:S.text}}>Cancel booking?</h2><div style={{fontSize: T.lead,color:S.text,marginBottom:18}}>The booking stays on the day, marked cancelled. Tables will be re-optimised afterwards.</div></Overlay>:null}</ModalPresence><ModalPresence show={!!confirmKitchen}>{confirmKitchen?<Overlay /* @static-height one sentence, computed when it opens and not after */ onClose={function(){setConfirmKitchen(null);}} footer={<div style={{display:"flex",justifyContent:"flex-end",gap:8,flexWrap:"wrap"}}><button
              className="mgt-hover-scale"
              style={mkBtn({minHeight:44,padding:"10px 18px",background:"var(--app-btn-slate)"})}
              onClick={function(){setConfirmKitchen(null);}}>Back</button><button
              onClick={function(){const isW=confirmKitchen==="walkin";setConfirmKitchen(null);if(isW) doSaveWalkin();else doSave();}}
              className="mgt-hover-scale"
              style={mkSolidBtn("var(--app-warn-solid)")}>Confirm</button></div>}><h2 style={{fontSize: T.title,fontWeight: FW.bold,margin:0,marginBottom:8,color:"var(--warn-text)"}}>Kitchen may be busy</h2><div style={{fontSize: T.lead,color:S.text,marginBottom:12}}>{"There are already "+(confirmKitchen==="walkin"?(function(){const wf=walkinForm;const t=wf.time||nowTime();const d=wf.customDur||getDur(Number(wf.size)||2);const l=getKitchenLoad(bookings,todayStr(),t,d,null);return l.starts+" booking"+(l.starts!==1?"s":"")+" with "+l.guests+" guest"+(l.guests!==1?"s":"");})():(function(){const f=formRef.current;const d=f.customDur||getDur(Number(f.size)||2);const l=getKitchenLoad(bookings,f.date,f.time,d,editId);return l.starts+" booking"+(l.starts!==1?"s":"")+" with "+l.guests+" guest"+(l.guests!==1?"s":"");})())+" starting at this time. Check the suggested alternatives below, or confirm to proceed anyway."}</div></Overlay>:null}</ModalPresence><ModalPresence show={!!voucherAsk}>{voucherAsk&&vouchersByCode[normalizeCode((bookings.find(function(x){return x.id===voucherAsk.id;})||{}).voucherCode)]?<VoucherRedeemModal
              voucher={vouchersByCode[normalizeCode((bookings.find(function(x){return x.id===voucherAsk.id;})||{}).voucherCode)]}
              booking={bookings.find(function(x){return x.id===voucherAsk.id;})}
              currency={generalSettings.currency}
              onRedeem={function(amount){settleVoucher(amount);}}
              onSkip={function(){settleVoucher(0);}}
              onClose={function(){setVoucherAsk(null);}} />:null}</ModalPresence><ModalPresence show={!!voucherBack}>{voucherBack&&vouchersByCode[normalizeCode((bookings.find(function(x){return x.id===voucherBack.id;})||{}).voucherCode)]?<Overlay /* @static-height two fixed sentences and two buttons */ onClose={function(){setVoucherBack(null);}} footer={<div style={{display:"flex",justifyContent:"flex-end",gap:8,flexWrap:"wrap"}}><button
              className="mgt-hover-scale"
              style={mkBtn({minHeight:44,padding:"10px 18px",background:"var(--app-btn-slate)"})}
              onClick={function(){settleVoucherBack(false);}}>Keep redeemed</button><button
              onClick={function(){settleVoucherBack(true);}}
              className="mgt-hover-scale"
              style={mkSolidBtn(S.accent)}>Restore to voucher</button></div>}><h2 style={{fontSize: T.title,fontWeight: FW.bold,margin:0,marginBottom:8,color:S.text}}>Restore the voucher?</h2><div style={{fontSize: T.lead,color:S.text,marginBottom:12}}>{(function(){
              const b=bookings.find(function(x){return x.id===voucherBack.id;})||{};
              const v=vouchersByCode[normalizeCode(b.voucherCode)];
              const amt=v&&v.redemptions&&v.redemptions[voucherBack.id]?v.redemptions[voucherBack.id].amount:0;
              const why=voucherBack.from==="delete"?"You are deleting this booking":"You are moving it back out of Completed";
              return "This visit redeemed "+money(amt,generalSettings.currency)+" of voucher "+formatCode(v?v.code:"")+". "+why+" — restore that amount to the voucher, or keep it redeemed?";
            })()}</div><div style={{fontSize: T.small,color:S.sub}}>{voucherBack.from==="delete"?"Restoring puts the balance back. Keeping it redeemed leaves the amount spent against a booking that will no longer exist. The booking is deleted either way.":"Restoring puts the balance back and removes this visit from the voucher’s history. Keeping it redeemed leaves the record as it is."}</div></Overlay>:null}</ModalPresence><ModalPresence show={!!seatNote}>{seatNote?<SeatNoteModal note={seatNote} onClose={function(){setSeatNote(null);}} />:null}</ModalPresence><ModalPresence show={!!seatClash}>{seatClash?<SeatClashModal clash={seatClash} onComplete={seatAfterClearing} onAnyway={seatAnyway} onBack={function(){setSeatClash(null);}} />:null}</ModalPresence><ModalPresence show={!!voucherCarry}>{voucherCarry?<VoucherCarryModal carry={voucherCarry} currency={generalSettings.currency} onMove={doVoucherCarry} onNotNow={function(){setVoucherCarry(null);}} />:null}</ModalPresence><ModalPresence show={confirmReshuffle}>{confirmReshuffle?<Overlay /* @static-height one fixed sentence and two buttons */ onClose={function(){setConfirmReshuffle(false);}} footer={<div style={{display:"flex",justifyContent:"flex-end",gap:8,flexWrap:"wrap"}}><button
              className="mgt-hover-scale"
              style={mkBtn({minHeight:44,padding:"10px 18px",background:"var(--app-btn-slate)"})}
              onClick={function(){setConfirmReshuffle(false);}}>Back</button><button
              onClick={function(){setConfirmReshuffle(false);forceReshuffle();}}
              className="mgt-hover-scale"
              style={mkSolidBtn(BTN.orange)}>Reshuffle</button></div>}><h2 style={{fontSize: T.title,fontWeight: FW.bold,margin:0,marginBottom:8,color:"var(--warn-text)"}}>Reshuffle all bookings?</h2><div style={{fontSize: T.lead,color:S.text,marginBottom:18}}>Confirmed bookings may be moved to different tables to improve efficiency. Seated bookings will not be moved.</div></Overlay>:null}</ModalPresence><ModalPresence show={showSettings}>{// v14 preview 3: Settings modal. Opened by the cog icon in TimelineView's
        // legend row or by pressing `?` anywhere no modal is open.
        // v14 preview 7: now tabbed (General / Reminders / Shortcuts). Tab state
        // resets to 'general' on close so reopens feel fresh.
        showSettings?<Overlay /* @static-height the tab body eases inside SettingsContent's own AutoHeight watch={cur} */ onClose={requestCloseSettings} footer={<div style={{display:"flex",justifyContent:"flex-end"}}><button
              className="mgt-hover-scale"
              style={mkBtn({minHeight:40,padding:"8px 18px",background:"var(--app-btn-slate)"})}
              onClick={requestCloseSettings}>Close</button></div>}><ModalTitle background="var(--app-btn-grey-strong)">Settings</ModalTitle><Suspense fallback={null}><SettingsContent
            appVersion={__APP_SIGNATURE__.version}
            onDirty={setSettingsDirty}
            isDark={isDark}
            onToggleDark={onToggleDark}
            autoTheme={themePref===undefined}
            onToggleAutoTheme={onToggleAutoTheme}
            appWidth={appWidth}
            onSetAppWidth={onSetAppWidth}
            reduceMotion={reduceMotion}
            onToggleReduceMotion={onToggleReduceMotion}
            swEnabled={swEnabled}
            onToggleSw={onToggleSw}
            navLocked={navLocked}
            onToggleNavLock={onToggleNavLock}
            splitEnabled={splitEnabled}
            onToggleSplitEnabled={onToggleSplitEnabled}
            planGestures={planGestures}
            onTogglePlanGestures={onTogglePlanGestures}
            tlSettings={tlSettings}
            onSetTlSetting={onSetTlSetting}
            weekHours={weekHours}
            onSaveDayHours={function(i,p){if(refused("hoursEdit"))return;saveDayHours(i,p);}}
            onSaveAllDays={function(d){if(refused("hoursEdit"))return;saveAllDays(d);}}
            weekRange={weekRange()}
            splitHour={dayShifts.split}
            shiftsEnabled={dayShifts.enabled}
            onSaveShifts={function(p){if(refused("hoursEdit"))return;saveDayShifts(p);}}
            optimizerCutoff={optimizerSettings.cutoff}
            optimizerAutoSwitch={optimizerSettings.autoSwitch}
            onSaveOptimizer={saveOptimizerSettings}
            bookingDefaults={bookingDefaults}
            onSaveBookingDefaults={saveBookingDefaults}
            generalSettings={generalSettings}
            onSaveGeneralSettings={saveGeneralSettings}
            onBackup={doBackup}
            recurring={recurring}
            onSetRecurringEnabled={function(on){if(refused("recurringManage"))return;setRecurringEnabled(on);}}
            onSetRecurringHorizon={function(w){if(refused("recurringManage"))return;setRecurringHorizon(w);}}
            onUpdateRule={function(id,f){if(refused("recurringManage"))return;updateRule(id,f);}}
            onRemoveRule={function(id){if(refused("recurringManage"))return;removeRule(id);}}
            layout={layout}
            onSaveLayout={saveLayout}
            bookings={bookings}
            waitlist={waitlist}
            onDeleteCustomer={deleteCustomer}
            vouchers={vouchers}
            voucherDefaults={voucherDefaults}
            onIssueVoucher={function(a){return refused("voucherIssue")?{ok:false,error:"You don't have permission to issue vouchers."}:issueVoucher(a);}}
            onVoidVoucher={function(c,on){return refused("voucherVoid")?false:voidVoucher(c,on);}}
            onSaveVoucherDefaults={saveVoucherDefaults}
            tab={settingsTab}
            setTab={setSettingsTab}
            can={can}
            isAdmin={isAdmin}
            myUid={uid}
            roleRows={roleRows}
            enforceRoles={enforceRoles}
            onSetEnforceRoles={setEnforceRoles}
            modules={modules}
            hasModule={hasModule}
            onSetModule={setModuleEnabled}
            moduleWarning={moduleWarning}
            onSetRole={setRole}
            onRemoveUser={removeUser}
            onInvite={inviteUser}
            onWithdrawInvite={withdrawInvite}
            onApplyInvite={applyInvite}
            onOpenCapabilities={setRolesFor}
            onOpenActivity={function(){setActivityOpen(true);}}
            reminders={reminders}
            onAddReminder={openNewReminder}
            onEditReminder={openEditReminder}
            onDeleteReminder={deleteReminder}
            onToggleReminder={toggleReminderActive}
            waSettings={waSettings}
            onSaveWaSettings={saveWaSettings} /></Suspense></Overlay>:null}</ModalPresence><ModalPresence show={!!confirmReminderDel}>{// v14 p7 fix: in-app reminder-delete confirmation (replaces broken
        // window.confirm which is blocked in sandboxed preview environments).
        // Renders on top of Settings in DOM order so it visually covers the list.
        confirmReminderDel?<Overlay /* @static-height one fixed sentence and two buttons */ onClose={function(){setConfirmReminderDel(null);}} footer={<div style={{display:"flex",justifyContent:"flex-end",gap:8,flexWrap:"wrap"}}><button
              className="mgt-hover-scale"
              style={mkBtn({minHeight:44,padding:"10px 18px",background:"var(--app-btn-slate)"})}
              onClick={function(){setConfirmReminderDel(null);}}>Back</button><button
              onClick={function(){doDeleteReminder(confirmReminderDel);}}
              className="mgt-hover-scale"
              style={mkSolidBtn(BTN.del)}>Delete</button></div>}><h2 style={{fontSize: T.title,fontWeight: FW.bold,margin:0,marginBottom:8,color:S.text}}>Delete reminder?</h2><div style={{fontSize: T.lead,color:S.text,marginBottom:18}}>This reminder will be permanently removed.</div></Overlay>:null}</ModalPresence><ModalPresence show={!!reminderEditor}>{// v14 p7: Reminder editor modal — sits on top of Settings (z=250 vs 200).
        reminderEditor?<ReminderEditor
          draft={reminderEditor.draft}
          setDraft={function(d){setReminderEditor(function(prev){return prev?Object.assign({},prev,{draft:d}):null;});}}
          onSave={saveReminderFromEditor}
          onCancel={requestCloseReminderEditor}
          isNew={reminderEditor.id==="new"} />:null}</ModalPresence>{/* v18.0.0 phase 5 review: `whatsappOn &&`, not `showInbox`
          alone. Gating only the ENTRY POINTS left an inbox that was already open
          when an admin switched the module off still mounted — reachable,
          because `?` opens Settings above the `anyModal` guard, so Admin is one
          keystroke away with the inbox up. Its listeners are detached by then,
          so it would render the last-loaded conversations, with live Send and
          Delete controls, for a module the restaurant has turned off. */}<ModalPresence show={whatsappOn&&showInbox}>{whatsappOn&&showInbox?<InboxPanel
          conversations={wa.conversations}
          messages={wa.messagesMap}
          templates={wa.templates}
          bookings={bookings}
          initialActiveKey={returnToInboxKey}
          regularMin={generalSettings.regularMin}
          query={waQuery} setQuery={setWaQuery} needsAction={waNeedsAction} setNeedsAction={setWaNeedsAction}
          onClose={closeInbox}
          onSend={wa.handleSendReply}
          onAccept={wa.handleAcceptDraft}
          onDismiss={wa.handleDismissDraft}
          onSaveTemplates={wa.saveTemplates}
          onMarkRead={wa.handleMarkRead}
          onArchive={wa.handleArchive}
          onUnarchive={wa.handleUnarchive}
          onDelete={wa.handleDeleteConversation}
          onBulkArchive={wa.bulkArchive}
          onBulkUnarchive={wa.bulkUnarchive}
          onBulkDelete={wa.bulkDeleteConversations}
          onCancelLinkedBooking={wa.handleCancelLinkedBooking}
          onOpenLinkedBooking={wa.handleOpenLinkedBooking}
          onDismissAcceptedBadge={wa.handleDismissAcceptedBadge}
          onMarkIntentHandled={wa.handleMarkIntentHandled}
          onResend={wa.handleResend}
          onApplyModify={wa.handleApplyModify}
          onRecheck={wa.recheckConversation}
          onOpenSim={WA_SANDBOX?function(){setShowSim(true);}:null} />:null}</ModalPresence>{confirmArchive?(function(){
          const conv=wa.conversations.find(function(c){return c.phoneKey===confirmArchive;});
          const bk=conv&&conv.acceptedBookingId?bookings.find(function(b){return b.id===conv.acceptedBookingId;}):null;
          return <Overlay /* @static-height one sentence, chosen from the linked booking when it opens and not after */ onClose={function(){setConfirmArchive(null);}} footer={<div style={{display:"flex",justifyContent:"flex-end",gap:8,flexWrap:"wrap"}}><button
              className="mgt-hover-scale"
              style={mkBtn({minHeight:44,padding:"10px 18px",background:"var(--app-btn-slate)"})}
              onClick={function(){setConfirmArchive(null);}}>Back</button><button
              onClick={function(){wa.doArchive(confirmArchive);setConfirmArchive(null);}}
              className="mgt-hover-scale"
              style={mkSolidBtn(BTN.orange,{minHeight:H.touch})}>Archive anyway</button></div>}><div style={{fontSize: T.title,fontWeight: FW.bold,marginBottom:8,color:S.text}}>Archive conversation?</div><div style={{fontSize: T.lead,color:S.text,marginBottom:18}}>{bk?("This conversation is linked to a booking on "+bk.date+" at "+bk.time+". Archiving won't cancel the booking."):"Archive this conversation?"}</div></Overlay>;
        })():null}{confirmDeleteConv?<Overlay /* @static-height one fixed sentence and two buttons */ onClose={function(){setConfirmDeleteConv(null);}} footer={<div style={{display:"flex",justifyContent:"flex-end",gap:8,flexWrap:"wrap"}}><button
              className="mgt-hover-scale"
              style={mkBtn({minHeight:44,padding:"10px 18px",background:"var(--app-btn-slate)"})}
              onClick={function(){setConfirmDeleteConv(null);}}>Back</button><button
              onClick={function(){wa.doDeleteConversation(confirmDeleteConv);}}
              className="mgt-hover-scale"
              style={mkSolidBtn(BTN.del,{minHeight:H.touch})}>Delete</button></div>}><div style={{fontSize: T.title,fontWeight: FW.bold,marginBottom:8,color:S.text}}>Delete conversation?</div><div style={{fontSize: T.lead,color:S.text,marginBottom:18}}>This permanently removes the conversation and its messages. This cannot be undone.</div></Overlay>:null}{WA_SANDBOX?(showSim?<Suspense fallback={null}><WaSimulator
          ctx={{conversations:wa.conversations,messagesMap:wa.messagesMap,upsertConversation:wa.upsertConversation,patchConversation:wa.patchConversation,appendMessage:wa.appendMessage,saveBookings:saveBookings,clearAllWaData:wa.clearAllWaData,simFailNextSend:wa.simFailNextSend}}
          onClose={function(){setShowSim(false);}} /></Suspense>:null):null}<ModalPresence show={!!rolesFor}>{// v18.0.0 phase 3: the capability grid — opened from the Admin tab, so it
        // must sit above the Settings overlay. Same idiom as ReminderEditor:
        // `position` + `z-index` makes a stacking context and the subtree
        // stacks there whatever its fixed children declare, so `Overlay` is
        // reused untouched rather than a second hand-written scrim being
        // invented (tests/a11y.test.js allows --scrim in exactly one file).
        rolesFor?<div style={{position:"relative",zIndex:255}}><Suspense fallback={null}><RolesModal
          rows={roleRows}
          selectedUid={rolesFor}
          myUid={uid}
          onSelect={setRolesFor}
          onToggleCap={setCapability}
          onClose={function(){setRolesFor(null);}} /></Suspense></div>:null}</ModalPresence><ModalPresence show={!!activityOpen}>{// v18.0.0 session 8: the activity log — opened from the Admin tab, so it
        // sits above the Settings overlay on the same idiom as the capability
        // grid beside it: a positioned wrapper makes the stacking context and
        // `Overlay` is reused untouched.
        activityOpen?<div style={{position:"relative",zIndex:255}}><Suspense fallback={null}><ActivityLogModal
          day={activityDay}
          onSetDay={setActivityDay}
          rows={activityRows}
          loading={activityLoading}
          bookings={bookings}
          onOpenBooking={function(id){const b=bookings.find(function(x){return x.id===id;});if(!b) return;setActivityOpen(null);closeSettings();openEdit(b);}}
          onClose={function(){setActivityOpen(null);}} /></Suspense></div>:null}</ModalPresence>{historyPopup}</div></div>
  );
}


// ── Auth Wrapper ──────────────────────────────────────────────────────────────
export default function App(){
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(true);
  useEffect(function(){
    const unsub=onAuthStateChanged(auth,function(u){setUser(u);setChecking(false);});
    return unsub;
  },[]);
  if(checking) return (
    <div
      style={{background:"var(--bg-app)",minHeight:"100dvh",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"var(--font-app)",color:S.text,fontSize: T.lead}}>Loading...</div>
  );
  if(!user) return <LoginScreen />;
  // v17.6.0: `key={user.uid}` remounts BookingApp on an account switch, so a
  // previous user's per-device state can't survive into the next session; the
  // uid also feeds useUserPrefs' per-account node.
  return <BookingApp uid={user.uid} key={user.uid} />;
}
