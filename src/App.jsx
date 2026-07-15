/**
 * Me Gustas Tú — Booking System
 * Version 14.1
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
import { useState, useRef, useEffect, useMemo } from "react";
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
  OPEN, CLOSE, KITCHEN_TABLE_LIMIT, BLOCK_BG, S, BTN, EMPTY_FORM, hoursFor, weekRange, INDOOR, OUTDOOR, ALL_TABLES
} from "./lib/constants";

import {
  getDur, toMins, genId,
  histEntry, diffBooking,
  isLocked, isActive, statusOrder,
  getBlockSlots, canAssign, getBusy, overlaps, comboCapBest,
  getKitchenLoad,
  applyOpt,
  optimizerActiveFor, syncLiveDurations, applySeatedShift, findFreeSlot, bookingsAfterAction, occupancyEnd,
  checkInefficent, verifyClean, findConflicts,
  nowTime,
  trialFits, toTime, lateState, freeingSoon, rankCombosContaining
} from "./lib/booking-logic";

import { validateReminderDraft } from "./lib/reminders";
import { normalizePhone } from "./lib/customers";


// ── Phase B1 (v15-refactor): UI atoms extracted to ./components/atoms.jsx ──
// First component file in the codebase using JSX syntax. App.jsx now also
// uses JSX (Phase C3b) so the original B1 note about RC()-vs-JSX
// compatibility no longer applies — both files share a single style.
import { Overlay, mkBtn, Reveal, Toast, Presence, ModalPresence, SlideView } from "./components/atoms";


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
import { SettingsContent, SETTINGS_TABS } from "./components/Settings";
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
import { ViewTools }    from "./components/ViewTools";
import { WeekView }     from "./components/WeekView";
import { LateBanner }   from "./components/LateBanner";
import { OverlapBanner } from "./components/OverlapBanner";
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
import { useRecurring } from "./hooks/useRecurring";
import { WaitlistPanel } from "./components/WaitlistPanel";
import { WaitAvailBanner } from "./components/WaitAvailBanner";
import { SearchPanel } from "./components/SearchPanel";
import { PlanView } from "./components/PlanView"; // v17.0.0: the floor-plan view
import { DaySheet } from "./components/DaySheet";


// ── App fingerprint (do not remove) ──────────────────────────────────────────
// Module-level identity record. Survives bundling/minification — the strings
// below remain readable in any deployed bundle. Referenced by the boot banner
// (window assignment + console.log) so the bundler cannot tree-shake it.
// Forensic evidence of origin if this code appears in an unauthorized deployment.
const __APP_SIGNATURE__={
  app:"Me Gustas Tú Booking System",
  version:"17.0.0",
  author:"Patryk Zychowicz",
  contact:"pz.zychowicz@gmail.com",
  copyright:"© 2026 Patryk Zychowicz. All rights reserved.",
  license:"Proprietary — All rights reserved. See LICENSE.",
};
if(typeof window!=="undefined"){window.__MGT_BUILD__=__APP_SIGNATURE__;}

// v14.6.0: keyboard shortcut for the Summary panel toggle — "S" for Summary.
// NB: in List view with a booking focused, S marks it Seated (that check runs
// first); everywhere else S toggles the Summary. Rebind here + the Shortcuts row.
const SUMMARY_KEY="s";
// v14.7.0: shortcut to open the at-a-glance popover (now Week / Month — see
// WeekView). v14.9.0: rebound "K" → "M" to match the renamed "More" button.
// In-popover nav (W/M switch view, ←/→ period, ↑/↓ day, T this-period, Enter
// open) lives in WeekView. Change here + the Shortcuts "M" row to rebind.
const WEEK_KEY="m";

// ── v14.2.0: Dark-mode preference reader ──────────────────────────────────
// Per-device theme lives in localStorage["mgt-theme"]. Returns the explicit
// preference for useThemeMode: true (dark) | false (light) | undefined (follow
// the OS live). MUST mirror the no-flash inline script in index.html — same
// key, same value convention ("dark"/"light").
function readThemePref(){
  try{
    const v=localStorage.getItem("mgt-theme");
    if(v==="dark") return true;
    if(v==="light") return false;
  }catch(e){}
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
function readAppWidth(){
  try{
    const v=parseInt(localStorage.getItem("mgt-appwidth"),10);
    if(Number.isFinite(v)&&v>=APP_WIDTH_MIN&&v<=APP_WIDTH_MAX) return v;
  }catch(e){}
  const w=Math.round((window.innerWidth-300)/50)*50;
  return Math.max(APP_WIDTH_MIN,Math.min(APP_WIDTH_MAX,w));
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
function BookingApp(){
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
  // nav (‹/›/date-input/Today). mgt-view-in-left = enters from left (→ "left to
  // right"); mgt-view-in-right = enters from right (→ "right to left").
  const [slide, setSlide] = useState({ k: 0, dir: "mgt-view-in-left" });
  function bumpSlide(dir){ setSlide(function(s){ return { k: s.k + 1, dir: dir }; }); }
  // Navigate to a date with a slide whose direction matches forward/back.
  function goToDate(next){ if(next!==viewDate){ bumpSlide(next > viewDate ? "mgt-view-in-left" : "mgt-view-in-right"); } setViewDate(next); }
  // v14.4.0: List-view keyboard focus — the booking the A/E/D/S/C/Delete
  // shortcuts act on. ↑/↓ move it; click a card to set it. Null = nothing focused.
  const [selectedListId, setSelectedListId] = useState(null);
  // v15.1.0: List-view "Completed & cancelled" disclosure. Lives HERE (not in
  // ListView) so listDaySorted can exclude the hidden cards while collapsed —
  // keeps ↑/↓ focus and the per-card shortcuts in lockstep with what's visible.
  const [showFinished, setShowFinished] = useState(false);
  const [timelineZoom, setTimelineZoom] = useState(1);
  const timelineScrollRef=useRef(0);
  const [followNow, setFollowNow] = useState(false);
  const [blockTarget, setBlockTarget] = useState(null);
  const [viewDate, setViewDate] = useState(new Date().toISOString().slice(0,10));
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editId, setEditId] = useState(null);
  const [error, setError] = useState("");
  const [confirmDel, setConfirmDel] = useState(null);
  const [confirmReshuffle, setConfirmReshuffle] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(null);
  const [reshuffled, setReshuffled] = useState(false);
  // v15.6.1: transient banner shown when the post-sync reconciliation resolves
  // a same-table overlap that arrived via an offline multi-device merge.
  const [syncFix, setSyncFix] = useState(false);
  // v17.0.0 correction: drag&drop feedback toast — {text, good} or null.
  const [dragMsg, setDragMsg] = useState(null);
  const dragMsgTimer = useRef(null);
  const [manualTarget, setManualTarget] = useState(null);
  const [dismissedIneff, setDismissedIneff] = useState(null);
  const formRef=useRef(EMPTY_FORM);
  // v17.0.0: status override for the pending flow — set by save("pending"/
  // "confirmed") ("Save pending" / "Save&confirm" buttons) and read by doSave.
  // A ref (not an arg) because the kitchen-confirm modal + its Enter shortcut
  // call doSave() with no args after the modal round-trip.
  const statusOverrideRef=useRef(null);
  const [swapAffected, setSwapAffected] = useState(null);
  const [confirmKitchen, setConfirmKitchen] = useState(null);
  const [showHistory, setShowHistory] = useState(false);
  const [showPrefPicker, setShowPrefPicker] = useState(false);
  // v14 preview 3: Settings / keyboard-shortcuts modal. Toggled by the cog
  // icon in TimelineView's legend row and by the `?` keyboard shortcut.
  const [showSettings, setShowSettings] = useState(false);
  const [showSearch, setShowSearch] = useState(false); // v16.3.0: global booking search panel
  const pendingSelectRef = useRef(null); // v16.3.0: booking id to focus in the List after a search-jump changes the day
  // v14.6.0: Summary panel expand/collapse (toggled by click or the g shortcut).
  const [summaryOpen, setSummaryOpen] = useState(false);
  // v14.7.0: Week View popover (opened from the Summary panel's Week button).
  const [showWeek, setShowWeek] = useState(false);
  // Settings tab state — which tab is active in the Settings modal.
  // Resets to 'general' on modal close so reopens start fresh. Belongs to
  // the Settings subsystem; lived inside the reminder state block pre-D2
  // for historical reasons (the comment misleadingly grouped it there).
  const [settingsTab, setSettingsTab] = useState("general");
  useEffect(function(){formRef.current=form;},[form]);
  useEffect(function(){if(error) setError("");},[form.time,form.size,form.date,form.preference,form.customDur]);
  // ── Time tick hook ──────────────────────────────────────────────────────────
  // Real-time clock for seated duration. 15s tick. Drives liveBookings, the
  // overlapWarnings derivation, applySeatedShift inside doSave, updateStatus's
  // current-time read, and the dep arrays of usePersistence + useReminders.
  // Phase D3 (v14.1.10). See ./hooks/useNowMins.js.
  const { nowMins } = useNowMins();
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
  // v17.0.0: settings/general (6th settings node) — see the import note.
  const { generalSettings, saveGeneralSettings } = useGeneralSettings();
  // A phone value that is empty, a bare "+", or exactly the untouched prefix
  // seed counts as "no phone" (the prefix is a typing convenience, not data).
  function cleanPhoneOf(p){
    const t=p==null?"":String(p).trim();
    return (t===""||t==="+"||t===generalSettings.phonePrefix)?"":t;
  }
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
    loadBannerShown, reconnectShown, resyncing,
    firstLoadCount,
  } = usePersistence({ autoOptimizer, nowMins });
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
  // ── Reminders hook ──────────────────────────────────────────────────────────
  // Owns all reminder state, savers, listeners, handlers, and the
  // reminderBanners JSX. nowMins drives banner re-evaluation; setWriteWarning
  // (from usePersistence above) lets reminder save-refusals share the same
  // banner as booking save-refusals. Phase D2 (v14.1.9).
  // See ./hooks/useReminders.jsx.
  const {
    reminders,
    reminderEditor, setReminderEditor,
    confirmReminderDel, setConfirmReminderDel,
    saveReminderFromEditor,
    doDeleteReminder,
    openNewReminder, openEditReminder,
    deleteReminder, toggleReminderActive,
    reminderBanners,
  } = useReminders({ nowMins, setWriteWarning });
  // ── v16.0.0: Waitlist state ─────────────────────────────────────────────────
  const { waitlist, saveWaitlist, addToWaitlist, removeFromWaitlist } = useWaitlist({ setWriteWarning });
  // ── v16.3.0: Recurring / standing bookings ──────────────────────────────────
  const { recurring, addRule, updateRule, removeRule, addSkipDate, setEnabled: setRecurringEnabled, setHorizon: setRecurringHorizon } = useRecurring({ setWriteWarning });
  const [showWaitlist, setShowWaitlist] = useState(false);
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
  const [waitNotifyDismissed, setWaitNotifyDismissed] = useState(function(){return new Set();}); // v16.3.0: session-only ✕-dismissed waitlist-free rows
  const [undoInfo, setUndoInfo] = useState(null);   // v16.3.0: {snapshot, noShow} pending undo after a cancel/no-show
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
    const today=new Date().toISOString().slice(0,10);
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
    const next=!isDark;
    try{localStorage.setItem("mgt-theme",next?"dark":"light");}catch(e){}
    setThemePref(next);
  }
  // v17.0.0 correction: per-device app width (see readAppWidth above).
  const [appWidth,setAppWidth]=useState(readAppWidth);
  function onSetAppWidth(next){
    const v=Math.max(APP_WIDTH_MIN,Math.min(APP_WIDTH_MAX,next));
    try{localStorage.setItem("mgt-appwidth",String(v));}catch(e){}
    setAppWidth(v);
  }
  // v14 deployment fix: history entries must attribute to the logged-in user
  // (their email), not the generic "staff" stub used in standalone preview.
  // "staff" remains as a fallback for the rare case where auth.currentUser
  // is unavailable at the moment of the write.
  function getUser(){return (auth.currentUser&&auth.currentUser.email)||"staff";}

  const inefficient=bookings.length>0&&checkInefficent(bookings,viewDate);

  // v14.4.0: the day's bookings in the SAME order ListView renders them
  // (status group, then time). Drives ↑/↓ keyboard navigation of selectedListId
  // and resolves which booking the List shortcuts act on. Kept identical to
  // ListView's internal sort so the focus ring and the keyboard target match.
  // v15.1.0: completed/cancelled cards are excluded while the "Completed &
  // cancelled" disclosure is collapsed — hidden cards must not be keyboard targets.
  const listDaySorted=bookings
    .filter(function(b){return b.date===viewDate&&(showFinished||(b.status!=="completed"&&b.status!=="cancelled"));})
    .sort(function(a,b){const sa=statusOrder(a.status),sb=statusOrder(b.status);if(sa!==sb) return sa-sb;return a.time.localeCompare(b.time);});
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
    }else{
      setSelectedListId(null);setShowFinished(false);
    }
    setLateDismissed(function(prev){return prev.size?new Set():prev;});setOverlapDismissed(function(prev){return prev.size?new Set():prev;});setWaitNotifyDismissed(function(prev){return prev.size?new Set():prev;});
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
  const overlapWarnings=(function(){
    const today=new Date().toISOString().slice(0,10);
    if(viewDate!==today) return {};
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
  })();

  // v16.1.0 — Running-late map: {id: "warn"|"noshow"} for TODAY'S confirmed
  // bookings past their start time (lateState, booking-logic.js). "warn" =
  // amber highlight (lateWarnMin+); "noshow" additionally offers the one-tap
  // "No show" (lateNoShowMin+). Thresholds + master switch live in
  // settings/bookingDefaults. Recomputed per render (nowMins ticks every 15s);
  // trivially cheap, so no memo — matches the overlapWarnings IIFE above.
  const lateMap=(function(){
    const today=new Date().toISOString().slice(0,10);
    if(viewDate!==today) return {};
    const map={};
    bookings.forEach(function(b){
      const st=lateState(b,today,nowMins,bookingDefaults);
      if(st) map[b.id]=st;
    });
    return map;
  })();
  // v16.3.0: per-row ✕ dismiss on the Running-late banner. Session-only (never
  // persisted); lives HERE (not in LateBanner) because the whole banner's outer
  // Reveal must collapse once the last row is dismissed. lateMap itself stays
  // UNFILTERED — the list/timeline amber highlights keep showing for a dismissed
  // row; only the banner (lateBannerMap) hides it. Reset on day change (below).
  const [lateDismissed,setLateDismissed]=useState(function(){return new Set();});
  const lateBannerMap=(function(){
    if(lateDismissed.size===0) return lateMap;
    const map={};
    Object.keys(lateMap).forEach(function(id){if(!lateDismissed.has(id)) map[id]=lateMap[id];});
    return map;
  })();
  function dismissLateRow(id){
    setLateDismissed(function(prev){const next=new Set(prev);next.add(id);return next;});
  }
  // v17.0.0 round 7 — same ✕-dismiss mechanism for the Overlap banner (the
  // Running-late pattern applied app-wide). Session-only; keyed by seated id.
  const [overlapDismissed,setOverlapDismissed]=useState(function(){return new Set();});
  function dismissOverlapRow(id){
    setOverlapDismissed(function(prev){const next=new Set(prev);next.add(id);return next;});
  }
  // v16.3.0 — Table-turn prediction: today's seated bookings whose scheduled end
  // is within the next freeSoonWindow min (freeingSoon, booking-logic.js). Gated
  // on the settings/bookingDefaults master switch (freeSoonEnabled). Two shapes:
  //   freeingList — [{id,name,tables,inMin}] soonest-first, for the Summary line.
  //   freeingMap  — {bookingId: inMin}, for the timeline countdown pills.
  // Today-only + recomputed per render (nowMins ticks every 15s) — the lateMap
  // pattern; trivially cheap.
  const freeingList=(function(){
    const today=new Date().toISOString().slice(0,10);
    if(viewDate!==today||!bookingDefaults.freeSoonEnabled) return [];
    return freeingSoon(bookings,today,nowMins,bookingDefaults.freeSoonWindow||15);
  })();
  const freeingMap=(function(){
    const map={};
    freeingList.forEach(function(f){map[f.id]=f.inMin;});
    return map;
  })();

  function flash(){setReshuffled(true);setTimeout(function(){setReshuffled(false);},3000);}
  function flashSyncFix(){setSyncFix(true);setTimeout(function(){setSyncFix(false);},4000);}

  // v15.6.1 — Post-sync conflict reconciliation.
  // Two devices adding bookings OFFLINE to a table that was free at creation
  // time merge (v15.5.0 per-node) into BOTH bookings on the same table — but
  // neither device's optimiser saw the other, so they overlap once synced. The
  // sync path (onValue/resync) stores merged data verbatim with no optimiser
  // pass, so the overlap persisted until a later edit happened to re-run it.
  // Here we react to settled snapshots: detect overlapping dates via verifyClean
  // and resolve only those. When the optimiser is active for the date → full
  // reshuffle; when OFF (manual mode) → relocate ONLY the newest non-locked
  // conflicting booking (forceReassign), leaving manual arrangements intact.
  // Self-stabilising: optimiser/relocate output is clean → next pass is a no-op
  // (also breaks any Firebase echo loop). Cross-device double-writes settle via
  // the v15.5.0 per-$id updatedAt CAS; the "newest" pick is deterministic
  // (updatedAt desc, id tiebreaker) so every device chooses the same booking.
  // Silent write (auto-effect, no red refusal banner); gated on !resyncing so it
  // waits out the post-sleep stale window and re-runs once fresh data arrives.
  useEffect(function(){
    if(resyncing||firstLoadCount.current===null) return;
    const today=new Date().toISOString().slice(0,10);
    const dates=Array.from(new Set(bookings.filter(function(b){return b.date>=today&&(b.tables||[]).length>0;}).map(function(b){return b.date;})));
    const dirty=dates.filter(function(d){return !verifyClean(bookings,d);});
    if(!dirty.length) return;
    let changed=false;
    const ok=saveBookings(function(prev){
      let next=prev;
      dirty.forEach(function(d){
        if(optimizerActiveFor(d,autoOptimizer)){
          next=bookingsAfterAction(next,d,tableBlocks,null,false,autoOptimizer);changed=true;
        }else{
          let guard=0;
          while(!verifyClean(next,d)&&guard++<20){
            const ids=findConflicts(next,d);
            const movable=next.filter(function(b){return ids.indexOf(b.id)>=0&&!isLocked(b);}).sort(function(a,b){return (b.updatedAt||0)-(a.updatedAt||0)||(a.id<b.id?1:-1);});
            if(!movable.length) break; // only locked overlaps — leave as-is
            next=bookingsAfterAction(next,d,tableBlocks,movable[0].id,true,autoOptimizer);changed=true;
          }
        }
      });
      return next;
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
    const todayStr=new Date().toISOString().slice(0,10);
    const next={};
    // v16.3.0 perf phase 2: whole-pass time budget for the expensive trials
    // (shared across entries — see tryFit below).
    const WAIT_SCAN_BUDGET_MS=300;
    const scanT0=Date.now();
    waitlist.forEach(function(w){
      if(!w||w.status!=="waiting"||!w.date||w.date<todayStr) return;
      const h=hoursFor(w.date);
      if(h.closed) return;
      const size=Number(w.size)||2;
      const dur=getDur(size);
      const noResh=!optimizerActiveFor(w.date,autoOptimizer);
      const fromM=w.date===todayStr?Math.max(nowMins,h.open*60):h.open*60;
      // With a wanted time, only offers within ±90 min of it count as "free"
      // (a 13:45 slot is no use to a party waiting for ~20:30); without one,
      // any remaining time that day counts. The wanted time itself is tried
      // first so the chip shows it exactly when it fits.
      let scanLo=Math.ceil(fromM/15)*15;
      let scanHi=h.close*60-dur;
      // v16.3.0 perf: cheap-first (the findTimes pattern) — a plainly free table
      // means the slot fits WITHOUT reshuffling anyone; only slots failing the
      // cheap check pay for the full trial optimisation (expensive on a day
      // with unplaceable bookings — this scan runs on every data change).
      // Perf phase 2: a hard per-effect time budget — on an extreme day a
      // single full trial can cost 100ms+; past the budget we skip further
      // expensive trials this pass. /code-review anti-flap: a budget-skip is
      // recorded (budgetHit) so an entry that was available LAST pass keeps its
      // sticky result below instead of blinking out of the banner — a future
      // pass (next data change / 15-min bucket) re-verifies for real, and the
      // Book path re-validates via the form's own scan + doSave guards anyway.
      let budgetHit=false;
      const tryFit=function(timeStr){
        if(!noResh){const cheap=findFreeSlot(liveBookings,w.date,timeStr,size,"auto",dur,tableBlocks,null,null);if(cheap) return cheap;}
        if(Date.now()-scanT0>WAIT_SCAN_BUDGET_MS){budgetHit=true;return null;}
        return trialFits(liveBookings,w.date,timeStr,size,"auto",dur,tableBlocks,null,null,noResh);
      };
      if(w.prefTime){
        const sm=toMins(w.prefTime);
        if(sm>=fromM&&sm+dur<=h.close*60){
          const t=tryFit(w.prefTime);
          if(t){next[w.id]={tables:t,time:w.prefTime};return;}
        }
        // v17.0.0: the ± window is editable (settings/general waitMatchWin).
        const win=generalSettings.waitMatchWin||90;
        scanLo=Math.max(scanLo,Math.ceil((sm-win)/15)*15);
        scanHi=Math.min(scanHi,sm+win);
      }
      for(let m=scanLo;m<=scanHi&&m<24*60;m+=15){
        const t=tryFit(toTime(m));
        if(t){next[w.id]={tables:t,time:toTime(m)};break;}
      }
      // Anti-flap carry-forward: no match found AND the budget cut this entry's
      // scan short → keep the previous pass's availability (if any) rather than
      // dropping the row. A genuine "no longer fits" (budget NOT hit) still
      // clears immediately.
      if(!next[w.id]&&budgetHit&&waitAvailRef.current[w.id]) next[w.id]=waitAvailRef.current[w.id];
    });
    waitAvailRef.current=next;
    setWaitAvail(next);
    // v16.3.0: the transition-to-available cue is now the in-flow WaitAvailBanner
    // (persistent + actionable), not a 6-second toast — so the prev-set diff that
    // fired the old toast is gone. waitAvail alone drives the banner.
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
    const today=new Date().toISOString().slice(0,10);
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
          const nb={id:"r"+rule.id+"_"+ds,name:rule.name,phone:rule.phone,date:ds,time:rule.time,scheduledTime:rule.time,size:rule.size,duration:dur,originalDuration:dur,preference:rule.preference,notes:rule.notes,status:"confirmed",tables:[],customDur:null,deposit:0,_manual:false,_locked:false,_conflict:false,preferredTables:[],returnOf:null,recurringId:rule.id,recurringDate:ds,history:[histEntry("auto-created from weekly rule","auto")]};
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
  function bookFromWaitlist(w){
    const avail=waitAvail[w.id];
    setForm(Object.assign({},EMPTY_FORM,{
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
    const wf=walkinForm||{};
    addToWaitlist({
      name:wf.name||"",
      phone:cleanPhoneOf(wf.phone),
      size:Number(wf.size)||2,
      date:new Date().toISOString().slice(0,10),
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
      a.download="mgt-backup-"+new Date().toISOString().slice(0,10)+".json";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function(){URL.revokeObjectURL(url);},1000);
    }catch(e){setWriteWarning("Couldn't create the backup file on this device.");}
  }
  // v17.0.0: "Delete customer" now ANONYMIZES instead of deleting — the
  // bookings remain for statistics (covers, day/range stats, phone-less
  // no-show tile) as name "Data removed" with phone/notes/history wiped and
  // the noShow flag KEPT (Patryk-confirmed scope). The `anonymized` flag
  // excludes them from every name-search/autocomplete path (customers.js).
  // Waitlist entries are still fully deleted (personal data, not statistics).
  // Side benefit: the old whole-DB edge (filter → empty array refused by the
  // write-guard) is gone — a map never changes the booking count.
  function deleteCustomer(phoneKey){
    const key=normalizePhone(phoneKey);
    if(!key) return;
    saveBookings(function(prev){return prev.map(function(b){
      if(normalizePhone(b.phone)!==key) return b;
      return Object.assign({},b,{name:"Data removed",phone:"",notes:"",history:[],anonymized:true});
    });});
    saveWaitlist(function(prev){return prev.filter(function(w){return normalizePhone(w.phone)!==key;});},true);
  }

  function openNew(){pendingWaitlistRef.current=null;setForm(Object.assign({},EMPTY_FORM,{date:viewDate,phone:generalSettings.phonePrefix}));setEditId(null);setError("");setSwapAffected(null);setShowForm(true);}
  function openEdit(b){pendingWaitlistRef.current=null;setForm({name:b.name,phone:b.phone||generalSettings.phonePrefix,date:b.date,time:b.time,size:b.size,preference:b.preference,notes:b.notes||"",status:b.status,customDur:(b.originalDuration||b.duration)!==getDur(b.size)?(b.originalDuration||b.duration):null,deposit:b.deposit?String(b.deposit):"",manualTables:[],preferredTables:Array.isArray(b.preferredTables)?b.preferredTables.slice():[],returnOf:null});setEditId(b.id);setError("");setSwapAffected(null);setShowHistory(false);setShowForm(true);}
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
    setForm(Object.assign({},EMPTY_FORM,{
      name:sourceBooking.name||"",
      phone:sourceBooking.phone||generalSettings.phonePrefix,
      date:"",
      time:schedTime,
      size:sourceBooking.size||2,
      preference:sourceBooking.preference||"auto",
      preferredTables:Array.isArray(sourceBooking.preferredTables)?sourceBooking.preferredTables.slice():[],
      notes:"",
      customDur:null,
      manualTables:[],
      status:"confirmed",
      returnOf:sourceBooking.id
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
    showWalkin, setShowWalkin,
    walkinForm, setWalkinForm,
    walkinError,
    getNextWalkinNum,
    openWalkin, saveWalkin, doSaveWalkin,
  } = useWalkin({
    bookings, saveBookings,
    setViewDate, getUser,
    confirmKitchen, setConfirmKitchen,
  });

  function doSave(){
    // v17.0.0: apply the pending/confirm status override to a CLONE of the form
    // so every downstream read (status write, diffBooking history, completed-
    // duration gate, flash condition) sees the effective status uniformly.
    const so=statusOverrideRef.current;
    const f=so?Object.assign({},formRef.current,{status:so}):formRef.current;
    try{
      if(!f.name||!f.name.trim()){setError("Customer name is required.");return;}
      // v14 p1 (Issue 3): date is required. Applies to both new bookings (including
      // Book Again) and edits. Walk-ins use today automatically so they are unaffected.
      if(!f.date){setError("Please set a date.");return;}
      if(!f.time){setError("Please set a time.");return;}
      const sm=toMins(f.time);
      // v15.0.0: per-weekday hours — validate against THIS booking's date, not the
      // viewed day, and block a closed day outright.
      const fh=hoursFor(f.date);
      if(fh.closed){const wd=["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"][new Date(f.date).getUTCDay()]||"that day";setError("Closed on "+wd+"s — pick another date, or open that day in Settings.");return;}
      if(sm<fh.open*60||sm>fh.close*60){setError("Bookings on this day are accepted between "+String(fh.open).padStart(2,"0")+":00 and "+String(fh.close%24).padStart(2,"0")+":00.");return;}
      const size=Number(f.size)||2;
      const dur=f.customDur||getDur(size);
      const cleanPhone=cleanPhoneOf(f.phone);
      const mt=Array.isArray(f.manualTables)&&f.manualTables.length>0?f.manualTables:[];
      // v16.0.0 follow-up: completed bookings excluded from the busy set — a
      // completed visit is over, its table is free (mirrors ManualModal +
      // WalkinForm; the optimizer already ignores completed via isActive).
      if(mt.length&&!swapAffected){let ex=liveBookings.filter(function(b){return b.date===f.date&&b.status!=="cancelled"&&b.status!=="completed"&&b.id!==editId;}).map(function(b){return {tables:b.tables||[],s:toMins(b.time),e:occupancyEnd(b,nowMins)};});ex=ex.concat(getBlockSlots(tableBlocks,f.date));if(!canAssign(mt,ex,sm,sm+dur)){setError("Selected tables are not available at this time.");return;}}
      if(editId){
        const orig=bookings.find(function(b){return b.id===editId;});
        const origPt=(orig&&Array.isArray(orig.preferredTables))?orig.preferredTables.slice().sort().join(","):"";
        const newPt=Array.isArray(f.preferredTables)?f.preferredTables.slice().sort().join(","):"";
        const prefTablesChanged=origPt!==newPt;
        // v14: detect confirmed→seated transition here. Only auto-shift time if
        // staff did NOT manually edit time/date in the form (otherwise their
        // explicit edit wins). Compute BEFORE needsR so we can suppress reshuffle.
        const seatingNow=orig&&orig.status!=="seated"&&f.status==="seated";
        const timeUntouched=orig&&f.time===orig.time&&f.date===orig.date;
        let seatedShift=null;
        if(seatingNow&&timeUntouched){
          // Use live-synced bookings so overstaying seated guests' tables are
          // correctly treated as occupied when the overlap guard runs.
          seatedShift=applySeatedShift(orig,nowMins,liveBookings);
        }
        const needsR=!orig||size!==orig.size||f.time!==orig.time||f.date!==orig.date||f.preference!==orig.preference||f._clearManual||prefTablesChanged;
        const prefOnly=orig&&size===orig.size&&f.time===orig.time&&f.date===orig.date&&!f._clearManual;
        const formPlan=f.customDur||getDur(size);
        const origPlan=orig?(orig.originalDuration||orig.duration||90):formPlan;
        const planChanged=formPlan!==origPlan;
        let saveDur=planChanged?formPlan:(orig?(orig.duration||90):formPlan);
        const saveOrigDur=planChanged?formPlan:origPlan;
        let saveCustDur=planChanged?(f.customDur||null):(orig?(orig.customDur||null):(f.customDur||null));
        // v16.2.0: truncate to the actual span ONLY when the booking was SEATED
        // before this save. A direct Confirmed → Completed edit keeps the form's
        // scheduled duration (mirrors the updateStatus quick-action gate).
        if(f.status==="completed"&&orig&&orig.status==="seated"&&!f.customDur){const now=new Date();const nowMinsLocal=now.getHours()*60+now.getMinutes();const startMins=toMins(f.time);const actualDur=Math.max(15,nowMinsLocal-startMins);saveDur=actualDur;saveCustDur=actualDur;}
        // Apply seated shift (if any) to the values we'll write. Overrides plan
        // numbers above — the shift always wins over default-duration logic.
        let saveTime=f.time;
        if(seatedShift){
          saveTime=seatedShift.newTime;
          saveDur=seatedShift.newDuration;
          saveCustDur=seatedShift.newDuration;
        }
        const clearM=!!f._clearManual;
        const wasSeatedLocked=orig&&isLocked(orig)&&!mt.length;
        const editHist=orig?histEntry("edited: "+diffBooking(orig,f,size),getUser()):histEntry("edited",getUser());
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
        const saveOrigDurFinal=seatedShift?seatedShift.newDuration:saveOrigDur;
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
          const upd=prev.map(function(b){
            if(b.id===editId){
              let h=(b.history||[]).concat([editHist]);
              if(seatedShift) h=h.concat([histEntry("seated "+seatedShift.direction+": time adjusted "+seatedShift.oldTime+" → "+seatedShift.newTime,getUser())]);
              const unlockForOpt=needsR&&wasSeatedLocked&&!mt.length&&!clearM;
              return Object.assign({},b,{name:f.name,phone:cleanPhone,date:f.date,time:saveTime,scheduledTime:saveScheduledTime,size:size,duration:saveDur,originalDuration:saveOrigDurFinal,preference:f.preference,notes:f.notes,deposit:Math.max(0,Number(f.deposit)||0),status:unlockForOpt?"confirmed":f.status,tables:mt.length?mt:(clearM?[]:(!needsR?b.tables:[])),customDur:saveCustDur,_manual:mt.length>0?true:(clearM?false:b._manual),_locked:mt.length>0?true:(clearM?false:(unlockForOpt?false:b._locked)),preferredTables:Array.isArray(f.preferredTables)?f.preferredTables:[],history:h});
            }
            if(swapAffected){const match=swapAffected.find(function(ab){return ab.id===b.id;});if(match){const remaining=(b.tables||[]).filter(function(t){return !match.tables.includes(t);});return Object.assign({},b,{tables:remaining,_locked:false,_manual:false});}}
            return b;
          });
          let out=bookingsAfterAction(upd,f.date,tableBlocks,editId,needsR&&!mt.length,optStateForSave);
          if(wasSeatedLocked&&needsR&&!mt.length&&!clearM){out=out.map(function(b){if(b.id===editId) return Object.assign({},b,{status:f.status,_locked:b.tables&&b.tables.length>0,_manual:b.tables&&b.tables.length>0});return b;});}
          return out;
        }
        // /code-review perf: buildNext runs a full optimiser pass (expensive on
        // a loaded day). Memoised by `prev` IDENTITY so the synchronous guard
        // check below and the immediate dispatch (updater called with the same
        // `bookings` reference — 2×, 3× under dev StrictMode) share ONE pass. A
        // retry replay gets a FRESH prev ref → recomputes, exactly as the
        // v15.7.0 capture-intent contract requires.
        let bnPrev=null,bnFin=null;
        function buildNextMemo(prev){if(prev===bnPrev) return bnFin;const r=buildNext(prev);bnPrev=prev;bnFin=r;return r;}
        const fin=buildNextMemo(bookings);
        if(!mt.length&&needsR&&!prefOnly){
          const prevAssigned=bookings.filter(function(b){return b.date===f.date&&isActive(b)&&b.tables&&b.tables.length>0&&b.id!==editId;});
          const displaced=fin.filter(function(b){return b.id!==editId&&b.date===f.date&&isActive(b)&&(!b.tables||!b.tables.length||b._conflict);});
          const kicked=displaced.filter(function(d){return prevAssigned.some(function(p){return p.id===d.id;});});
          if(kicked.length>0){setError("Not enough capacity — this change would displace "+kicked.length+" existing booking"+(kicked.length>1?"s":"")+": "+kicked.map(function(k){return k.name;}).join(", ")+".");return;}
        }
        if(!mt.length&&needsR){
          const editedInFin=fin.find(function(b){return b.id===editId;});
          if(editedInFin&&(!editedInFin.tables||!editedInFin.tables.length)){setError("No tables available at this time — see suggestions below.");return;}
        }
        // v15.7.0: dispatch the function form. ok===true → saved now; ok===false →
        // held by the stale gate but shown optimistically + queued for auto-retry on
        // fresh data (the resyncing banner informs the user). Either way the form's
        // job is done, so close it. Flash only on a real save (never claim "saved"
        // for a not-yet-persisted write — matches quick-action honesty).
        const ok=saveBookings(buildNextMemo);
        if((needsR||swapAffected||f.status==="completed"||seatingNow)&&ok) flash();
        setShowForm(false);setViewDate(f.date);
      } else {
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
        const nb={id:newId,name:f.name,phone:cleanPhone,date:f.date,time:f.time,scheduledTime:f.time,size:size,duration:dur,originalDuration:dur,preference:f.preference,notes:f.notes,deposit:Math.max(0,Number(f.deposit)||0),status:(f.status==="pending"?"pending":"confirmed"),tables:mt.length?mt:[],customDur:f.customDur||null,_manual:mt.length>0,_locked:mt.length>0,preferredTables:Array.isArray(f.preferredTables)?f.preferredTables:[],returnOf:returnOfId,recurringId:recStampId,recurringDate:recStampId?f.date:null,history:[createHist]};
        // v15.7.0: build the next state as a PURE transform of `prev` (see the edit
        // path above) so the new-booking save joins the optimistic-show + auto-retry
        // path. `newId`/`nb` are computed once (stable id) → a held/rejected write
        // replayed on fresh data can never duplicate the booking (the defensive
        // filter below also drops any stray match before re-adding it).
        function applyBase(prev){
          let base=prev.filter(function(b){return b.id!==newId;});
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
        function buildNext(prev){return bookingsAfterAction(applyBase(prev).concat([nb]),f.date,tableBlocks,newId,!mt.length,autoOptimizer);}
        // /code-review perf: prev-identity memo — one optimiser pass shared by
        // the guard check + the immediate dispatch (see the edit path above).
        let bnPrev=null,bnFin=null;
        function buildNextMemo(prev){if(prev===bnPrev) return bnFin;const r=buildNext(prev);bnPrev=prev;bnFin=r;return r;}
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
        if(ok) flash();
        // v16.0.0: this new booking converted a waitlist entry (Book from the
        // panel) — remove the entry now the booking is dispatched (a held write
        // shows optimistically + auto-retries, so the intent stands either way).
        if(pendingWaitlistRef.current){removeFromWaitlist(pendingWaitlistRef.current);pendingWaitlistRef.current=null;}
        setShowForm(false);setViewDate(f.date);
      }
    }catch(err){setError("Error: "+err.message);}
  }
  function save(statusOverride){
    // v17.0.0: record the override FIRST — the kitchen-confirm path re-enters
    // doSave() without args, so the intent must survive the modal round-trip.
    statusOverrideRef.current=statusOverride||null;
    const f=formRef.current;
    if(!f.time) return doSave();
    const size=Number(f.size)||2;const d=f.customDur||getDur(size);
    const load=getKitchenLoad(bookings,f.date,f.time,d,editId);
    if(load.starts+1>=KITCHEN_TABLE_LIMIT&&!confirmKitchen){
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
  function flashDragMsg(text,good){setDragMsg({text:text,good:!!good});clearTimeout(dragMsgTimer.current);dragMsgTimer.current=setTimeout(function(){setDragMsg(null);},3500);}
  function dropOnTable(id,targetId){
    const src=liveBookings.find(function(b){return b.id===id;});
    if(!src||src.date!==viewDate||!isActive(src)) return;
    const cur=src.tables||[];
    if(cur.length===1&&cur[0]===targetId) return; // dropped back on its own row
    const size=src.size||2;
    const s=toMins(src.time);
    const e=Math.max(occupancyEnd(src,nowMins),s+1);
    const blockSlots=getBlockSlots(tableBlocks,src.date);
    const busyBlocked=getBusy(blockSlots,s,e);
    if(busyBlocked.has(targetId)){flashDragMsg("Table "+targetId+" is blocked then.");return;}
    // Day's other active bookings (completed = free, the v16.0.0 rule) + the
    // tables held by SEATED parties over the span — those are immovable.
    const dayActive=liveBookings.filter(function(b){return b.date===src.date&&b.id!==id&&isActive(b)&&b.status!=="completed";});
    const isOver=function(b){return overlaps(s,e,toMins(b.time),occupancyEnd(b,nowMins));};
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
    const candSets=cap1>=size
      ?[[targetId]]
      :rankCombosContaining(targetId,size)
        .filter(function(c){return !c.ids.some(function(t){return busyBlocked.has(t)||seatedOn.has(t);});})
        .map(function(c){return c.ids.slice();})
        .slice(0,MAX_CAND);
    if(candSets.length===0){flashDragMsg("Party of "+size+" won't fit at "+targetId+", even with joined tables.");return;}
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
        const os=toMins(other.time),oe=Math.max(occupancyEnd(other,nowMins),os+1);
        const slots=dayActive.filter(function(b){return b.id!==other.id&&(b.tables||[]).length>0;}).map(function(b){return {tables:b.tables,s:toMins(b.time),e:occupancyEnd(b,nowMins)};}).concat(blockSlots);
        if(canAssign(newSrc,slots,s,e)&&canAssign(newOther,slots.concat([{tables:newSrc,s:s,e:e}]),os,oe)){
          const ok=saveBookings(function(prev){return prev.map(function(b){
            if(b.id===id) return Object.assign({},b,{tables:newSrc,_manual:true,_locked:true,_conflict:false,history:(b.history||[]).concat([histEntry("swapped tables with "+other.name+" ("+(cur.join("+")||"none")+" → "+newSrc.join("+")+")",user)])});
            if(b.id===other.id) return Object.assign({},b,{tables:newOther,_manual:true,_locked:true,_conflict:false,history:(b.history||[]).concat([histEntry("swapped tables with "+src.name+" ("+(other.tables||[]).join("+")+" → "+newOther.join("+")+")",user)])});
            return b;
          });});
          if(ok) flashDragMsg(src.name+" ⇄ "+other.name+" — tables swapped.",true);
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
  function delBooking(id){const target=bookings.find(function(x){return x.id===id;});
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
      if(!okSkip){setWriteWarning("Still syncing standing bookings — try deleting again in a moment.");setConfirmDel(null);return;}
    }
    const ok=saveBookings(function(b){const t=b.find(function(x){return x.id===id;});const d=t?t.date:viewDate;return bookingsAfterAction(b.filter(function(x){return x.id!==id;}),d,tableBlocks,null,false,autoOptimizer);});setConfirmDel(null);if(ok) flash();}

  // v14 preview 3: Global keyboard shortcuts. Uses a ref to capture the latest
  // state and action callbacks on every render so the window-level keydown
  // listener (mounted once) always sees fresh values without re-subscribing.
  //
  // Precedence rules:
  //   1. Modifier keys (Ctrl / Meta / Alt) — always pass through so browser/OS
  //      shortcuts (Cmd+F, Ctrl+R, etc.) keep working.
  //   2. Escape — closes the topmost open modal (matches visual z-order).
  //   3. Enter — triggers the primary action of the topmost modal. In a
  //      <textarea> Enter still inserts a newline. The Manual Table Assignment
  //      modal handles its own Enter internally; globally we skip it.
  //   4. Letter / symbol / arrow shortcuts — suppressed when focus is on an
  //      input / textarea / select / contenteditable so typing is never hijacked.
  //      Suppressed as well while any modal is open, except for A/P/B/H which
  //      fire only when the Edit Booking modal is the top layer.
  const kbRef=useRef({});
  kbRef.current={
    view:view,setView:setView,viewDate:viewDate,setViewDate:setViewDate,
    timelineZoom:timelineZoom,setTimelineZoom:setTimelineZoom,
    followNow:followNow,setFollowNow:setFollowNow,
    autoOptimizer:autoOptimizer,setAutoOptimizer:setAutoOptimizer,
    showForm:showForm,setShowForm:setShowForm,editId:editId,form:form,setForm:setForm,setSwapAffected:setSwapAffected,
    showWalkin:showWalkin,setShowWalkin:setShowWalkin,
    showHistory:showHistory,setShowHistory:setShowHistory,
    showSettings:showSettings,setShowSettings:setShowSettings,
    showSearch:showSearch,setShowSearch:setShowSearch, // v16.3.0: "/" opens global search
    // v14 p7: settingsTab for ←/→ tab-cycle shortcut inside Settings modal.
    settingsTab:settingsTab,setSettingsTab:setSettingsTab,
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
    blockTarget:blockTarget,setBlockTarget:setBlockTarget,
    bookings:bookings,
    // v14.4.0: List-view selection + the handlers its A/E/S/C/Delete shortcuts call.
    listDay:listDaySorted,selectedListId:selectedListId,setSelectedListId:setSelectedListId,
    openEdit:openEdit,updateStatus:updateStatus,
    // v14.4.0: N → new reminder while the Settings Reminders tab is open.
    openNewReminder:openNewReminder,
    openNew:openNew,openWalkin:openWalkin,
    // v14.6.0: Summary panel toggle (the g shortcut).
    setSummaryOpen:setSummaryOpen,
    showWeek:showWeek,setShowWeek:setShowWeek,
    save:save,doSave:doSave,saveWalkin:saveWalkin,doSaveWalkin:doSaveWalkin,
    forceReshuffle:forceReshuffle,delBooking:delBooking,bookAgain:bookAgain,
    // v15.8.0 cont.4: keyboard nav routes through the same slide path as the buttons.
    goToDate:goToDate,bumpSlide:bumpSlide,
    // v16.2.0: Shift+D theme toggle.
    onToggleDark:onToggleDark
  };
  useEffect(function(){
    function isTyping(el){if(!el) return false;const t=el.tagName;return t==="INPUT"||t==="TEXTAREA"||t==="SELECT"||el.isContentEditable;}
    function handler(e){
      if(e.ctrlKey||e.metaKey||e.altKey) return;
      const K=kbRef.current;const k=e.key;const typing=isTyping(e.target);
      // ── Escape: close topmost modal (checked in visual z-order) ──
      if(k==="Escape"){
        // v14 p7: reminderEditor sits above Settings (z=250). Close it first.
        if(K.reminderEditor){e.preventDefault();K.setReminderEditor(null);return;}
        // v14 p7 fix: delete-confirm renders above Settings in DOM order.
        if(K.confirmReminderDel){e.preventDefault();K.setConfirmReminderDel(null);return;}
        // v14 p7 fix: reset tab to 'general' on Esc close — matches the
        // Close button and backdrop-click onClose behavior.
        if(K.showSettings){e.preventDefault();K.setShowSettings(false);K.setSettingsTab("general");return;}
        if(K.showHistory){e.preventDefault();K.setShowHistory(false);return;}
        if(K.confirmKitchen){e.preventDefault();K.setConfirmKitchen(null);return;}
        if(K.confirmReshuffle){e.preventDefault();K.setConfirmReshuffle(false);return;}
        if(K.confirmCancel){e.preventDefault();K.setConfirmCancel(null);return;}
        if(K.confirmDel){e.preventDefault();K.setConfirmDel(null);return;}
        if(K.showPrefPicker){e.preventDefault();K.setShowPrefPicker(false);return;}
        // v16.3.0 correction: Esc dismisses the search panel (its "Done" button).
        if(K.showSearch){e.preventDefault();K.setShowSearch(false);return;}
        if(K.blockTarget){e.preventDefault();K.setBlockTarget(null);return;}
        if(K.manualTarget){e.preventDefault();K.setManualTarget(null);return;}
        if(K.showWalkin){e.preventDefault();K.setShowWalkin(false);return;}
        if(K.showWeek){e.preventDefault();K.setShowWeek(false);return;}
        if(K.showForm){e.preventDefault();K.setShowForm(false);return;}
        return;
      }
      // ── Enter: primary action of topmost modal ──
      if(k==="Enter"){
        // In a textarea Enter always inserts a newline — never save.
        if(typing&&e.target.tagName==="TEXTAREA") return;
        // v14 p7: reminderEditor is topmost when open — save if draft is valid.
        if(K.reminderEditor){
          if(!validateReminderDraft(K.reminderEditor.draft)){
            e.preventDefault();K.saveReminderFromEditor();
          }
          return;
        }
        // v14 p7 fix: delete-confirm Enter → confirm deletion.
        if(K.confirmReminderDel){e.preventDefault();K.doDeleteReminder(K.confirmReminderDel);return;}
        // Manual Modal handles its own Enter. Quick-status popup is ambiguous.
        if(K.manualTarget) return;
        if(K.confirmKitchen){
          const isW=K.confirmKitchen==="walkin";
          e.preventDefault();
          K.setConfirmKitchen(null);
          if(isW) K.doSaveWalkin(); else K.doSave();
          return;
        }
        if(K.confirmReshuffle){e.preventDefault();K.setConfirmReshuffle(false);K.forceReshuffle();return;}
        if(K.confirmDel){e.preventDefault();K.delBooking(K.confirmDel);return;}
        if(K.showPrefPicker){e.preventDefault();K.setShowPrefPicker(false);return;}
        if(K.showWalkin){e.preventDefault();K.saveWalkin();return;}
        if(K.showForm){
          // Save button is disabled when date is empty → mirror that here.
          if(K.form&&K.form.date){e.preventDefault();K.save();}
          return;
        }
        return;
      }
      // ── Letter / symbol / arrow shortcuts: never hijack typing ──
      if(typing) return;
      // v16.4.0 (Patryk): Shift+D (dark toggle) and ? (Settings/shortcuts help)
      // are GLOBAL — they fire even while a modal is open and NEVER close it.
      // Placed here (above the settings-arrow / prefPicker / form-letter blocks
      // and the anyModal guard) so they always win; no form/pref shortcut uses D
      // or ?, so nothing is shadowed. The `typing` guard above still lets you
      // type "D"/"?" into a field. `?` opens Settings ON TOP of any open modal.
      if((k==="d"||k==="D")&&e.shiftKey){e.preventDefault();K.onToggleDark();return;}
      if(k==="?"){e.preventDefault();K.setShowSettings(true);return;}
      // ── v14 p7: Settings tab-cycle with ←/→ ──
      // Active only when Settings is the top layer (reminderEditor and
      // confirmReminderDel are sub-modals on top of Settings — when they're
      // open, arrows should flow to their default behavior or be no-ops).
      // Takes priority over the global ←/→ day-nav shortcut below.
      if(K.showSettings&&!K.reminderEditor&&!K.confirmReminderDel){
        if(k==="ArrowLeft"||k==="ArrowRight"){
          e.preventDefault();
          // v16.0.0 follow-up: derived from SETTINGS_TABS (Settings.jsx — the ONE
          // tab list) so a newly added tab can never be skipped here again. Do
          // NOT inline a literal id list (that's how Customers got skipped).
          const TABS=SETTINGS_TABS.map(function(t){return t.id;});
          let curIdx=TABS.indexOf(K.settingsTab);if(curIdx<0) curIdx=0;
          const newIdx=k==="ArrowLeft"?(curIdx-1+TABS.length)%TABS.length:(curIdx+1)%TABS.length;
          K.setSettingsTab(TABS[newIdx]);
          return;
        }
        // v14.4.0: N → new reminder when the Reminders tab is active.
        if((k==="n"||k==="N")&&K.settingsTab==="reminders"){e.preventDefault();K.openNewReminder();return;}
      }
      // ── Edit Booking modal shortcuts ──
      // Only fire when Edit is the TOP layer (no popup on top of it).
      // ── Preferred-table picker: captures C (= Clear). Sits ABOVE the
      //    form-modal block so A/P/B/H don't fire while the picker is open
      //    (which matches the user-intuitive "only the top modal responds"
      //    precedence).
      if(K.showPrefPicker){
        if(k==="c"||k==="C"){
          const prefs=Array.isArray(K.form&&K.form.preferredTables)?K.form.preferredTables:[];
          if(prefs.length>0){
            e.preventDefault();
            K.setForm(function(f){return Object.assign({},f,{preferredTables:[]});});
          }
        }
        return; // no other letter shortcuts propagate while picker is up
      }
      // ── Edit & New Booking form shortcuts ──
      //   A / P work in BOTH new and edit (request 1). In new mode, A opens
      //   Manual with target "__new__" to match the "= Assign" button.
      //   B / H remain edit-only (new bookings have no history or source).
      //   C clears the tables assignment — logic mirrors the form's 3 Clear
      //   buttons: if the user has set manualTables, clear those; else in
      //   edit mode, if the stored booking has a manual assignment not yet
      //   marked cleared, set _clearManual:true; else no-op.
      const topLayer=K.showSettings||K.showHistory||K.confirmKitchen||K.confirmReshuffle||K.confirmCancel||K.confirmDel||K.blockTarget||K.manualTarget||K.reminderEditor||K.confirmReminderDel;
      if(K.showForm&&!topLayer){
        if(k==="a"||k==="A"){e.preventDefault();K.setManualTarget(K.editId||"__new__");return;}
        if(k==="p"||k==="P"){e.preventDefault();K.setShowPrefPicker(true);return;}
        if(k==="c"||k==="C"){
          const mtLen=Array.isArray(K.form&&K.form.manualTables)?K.form.manualTables.length:0;
          if(mtLen>0){
            e.preventDefault();
            K.setForm(function(f){return Object.assign({},f,{manualTables:[]});});
            K.setSwapAffected(null);
          } else if(K.editId){
            const cur3=K.bookings.find(function(b){return b.id===K.editId;});
            const isManual3=cur3&&(cur3._manual||cur3._locked)&&cur3.tables&&cur3.tables.length>0;
            const alreadyCleared=!!(K.form&&K.form._clearManual);
            if(isManual3&&!alreadyCleared){
              e.preventDefault();
              K.setForm(function(f){return Object.assign({},f,{manualTables:[],_clearManual:true});});
              K.setSwapAffected(null);
            }
          }
          return;
        }
        if(K.editId){
          if(k==="b"||k==="B"){
            const cur=K.bookings.find(function(b){return b.id===K.editId;});
            if(cur&&(cur.status==="seated"||cur.status==="completed")){e.preventDefault();K.bookAgain(cur);}
            return;
          }
          if(k==="h"||k==="H"){
            const c2=K.bookings.find(function(b){return b.id===K.editId;});
            if(c2&&c2.history&&c2.history.length>0){e.preventDefault();K.setShowHistory(true);}
            return;
          }
        }
      }
      // ── Global shortcuts: suppressed while any modal is open ──
      const anyModal=K.showForm||K.showWalkin||K.showWeek||K.showHistory||K.confirmDel||K.confirmReshuffle||K.confirmCancel||K.confirmKitchen||K.manualTarget||K.blockTarget||K.showPrefPicker||K.showSettings||K.showSearch||K.reminderEditor||K.confirmReminderDel;
      if(anyModal) return;
      // v16.3.0: "/" opens the global booking search (typing guard above keeps it
      // out of form fields; anyModal guard keeps it from re-firing while open).
      if(k==="/"){e.preventDefault();K.setShowSearch(true);return;}
      // ── v14.4.0: List-view per-card shortcuts (act on the focused booking) ──
      // ↑/↓ move the focus ring; A/E/S/C/Shift+C/Delete act on it. Placed before
      // the global letter shortcuts so Delete wins over "jump to today" ONLY while
      // a card is focused — with nothing focused, D still jumps to today. ←/→
      // fall through to the global day-nav below.
      if(K.view==="list"){
        const list=K.listDay||[];
        if(k==="ArrowDown"||k==="ArrowUp"){
          e.preventDefault();
          if(!list.length) return;
          const idx=list.findIndex(function(b){return b.id===K.selectedListId;});
          const ni=idx<0?(k==="ArrowDown"?0:list.length-1):(k==="ArrowDown"?Math.min(list.length-1,idx+1):Math.max(0,idx-1));
          K.setSelectedListId(list[ni].id);
          return;
        }
        const sel=K.selectedListId?list.find(function(b){return b.id===K.selectedListId;}):null;
        if(sel){
          if(k==="a"||k==="A"){e.preventDefault();K.setManualTarget(sel.id);return;}
          if(k==="e"||k==="E"){e.preventDefault();K.openEdit(sel);return;}
          // v17.0.0: a PENDING card can only be confirmed (or cancelled) — S/C
          // are no-ops on it, matching the List/RMB button gating.
          if(k==="s"||k==="S"){e.preventDefault();if(sel.status!=="pending") K.updateStatus(sel.id,"seated");return;}
          if((k==="c"||k==="C")&&e.shiftKey){e.preventDefault();K.updateStatus(sel.id,"cancelled");return;}
          if(k==="c"||k==="C"){e.preventDefault();if(sel.status!=="pending") K.updateStatus(sel.id,"completed");return;}
          if(k==="d"||k==="D"){e.preventDefault();K.setConfirmDel(sel.id);return;}
        }
      }
      // v17.0.0: three views — slide direction follows the view order (T·L·P).
      const VIEW_ORD=["timeline","list","plan"];
      const goView=function(v){if(K.view!==v){K.bumpSlide(VIEW_ORD.indexOf(v)>VIEW_ORD.indexOf(K.view)?"mgt-view-in-right":"mgt-view-in-left");}K.setView(v);};
      if(k==="t"||k==="T"){e.preventDefault();goView("timeline");return;}
      if(k==="l"||k==="L"){e.preventDefault();goView("list");return;}
      if(k==="p"||k==="P"){e.preventDefault();goView("plan");return;}
      if(k==="d"||k==="D"){e.preventDefault();K.goToDate(new Date().toISOString().slice(0,10));return;}
      if(k==="n"||k==="N"){e.preventDefault();K.openNew();return;}
      if(k==="w"||k==="W"){e.preventDefault();K.openWalkin();return;}
      // v14.6.0: toggle the Summary panel (provisional key — see SUMMARY_KEY).
      if(k===SUMMARY_KEY||k===SUMMARY_KEY.toUpperCase()){e.preventDefault();K.setSummaryOpen(function(o){return !o;});return;}
      if(k===WEEK_KEY||k===WEEK_KEY.toUpperCase()){e.preventDefault();K.setShowWeek(true);return;}
      if(k==="ArrowLeft"){e.preventDefault();const d1=new Date(K.viewDate);d1.setDate(d1.getDate()-1);K.goToDate(d1.toISOString().slice(0,10));return;}
      if(k==="ArrowRight"){e.preventDefault();const d2=new Date(K.viewDate);d2.setDate(d2.getDate()+1);K.goToDate(d2.toISOString().slice(0,10));return;}
      // ── Timeline-only shortcuts ──
      if(K.view==="timeline"){
        const today=new Date().toISOString().slice(0,10);
        const isToday=K.viewDate===today;
        if(k==="f"||k==="F"){
          if(isToday){
            e.preventDefault();
            if(!K.followNow){K.setFollowNow(true);if(K.timelineZoom<4) K.setTimelineZoom(4);}
            else{K.setFollowNow(false);}
          }
          return;
        }
        if(k==="+"||k==="="){e.preventDefault();K.setTimelineZoom(function(z){return Math.min(5,z+0.5);});return;}
        if(k==="-"){e.preventDefault();K.setTimelineZoom(function(z){return Math.max(1,z-0.5);});return;}
        if(k==="0"){e.preventDefault();K.setTimelineZoom(1);K.setFollowNow(false);return;}
        if(k==="o"||k==="O"){
          if(isToday){e.preventDefault();K.setAutoOptimizer(function(p){return !p;});}
          return;
        }
        if(k==="r"||k==="R"){
          if(isToday&&!K.autoOptimizer){e.preventDefault();K.setConfirmReshuffle(true);}
          return;
        }
      }
    }
    window.addEventListener("keydown",handler);
    return function(){window.removeEventListener("keydown",handler);};
  },[]);

  function updateStatus(id,status){
    if(status==="cancelled"){setConfirmCancel(id);return;}
    const user=getUser();
    const nowM=nowMins;
    const ok=saveBookings(function(b){
      const target=b.find(function(x){return x.id===id;});
      const d=target?target.date:viewDate;
      // v14: detect confirmed → seated transition (for any prior non-seated status).
      // If the transition triggers a seated-shift, force no-reshuffle by passing
      // autoOptimizerState=false to bookingsAfterAction, so other bookings never
      // move as a side-effect of someone sitting down early/late.
      let seatedShiftHappened=false;
      const updated=b.map(function(x){
        if(x.id!==id) return x;
        const histEntries=[histEntry("status → "+status,user)];
        const extra={status:status};
        // v16.2.0: only a real SEATED visit gets its duration truncated to the
        // actual span (now − start). A direct Confirmed → Completed keeps the
        // scheduled duration unchanged — otherwise the block balloons to hours
        // on the timeline (e.g. completing a 13:00 booking at 21:00 → 8h block).
        if(status==="completed"&&x.status==="seated"){
          const startMins=toMins(x.time);
          const actualDur=Math.max(15,nowM-startMins);
          extra.duration=actualDur;
          extra.customDur=actualDur;
        }
        if(status==="seated"&&x.status!=="seated"){
          const shift=applySeatedShift(x,nowM,b);
          if(shift){
            extra.time=shift.newTime;
            extra.duration=shift.newDuration;
            extra.originalDuration=shift.newDuration;
            extra.customDur=shift.newDuration;
            // scheduledTime is intentionally NOT updated here — it stays pinned to
            // the confirmed time so Book Again and history reads show the true plan.
            histEntries.push(histEntry("seated "+shift.direction+": time adjusted "+shift.oldTime+" → "+shift.newTime,user));
            seatedShiftHappened=true;
          }
        }
        extra.history=(x.history||[]).concat(histEntries);
        return Object.assign({},x,extra);
      });
      // Seated transitions never reshuffle others — even when optimizer is ON.
      const optState=(status==="seated")?false:autoOptimizer;
      return bookingsAfterAction(updated,d,tableBlocks,null,false,optState);
    });
    if(ok&&(status==="completed"||status==="seated")) flash();
  }
  function doCancelBooking(id,noShow){
    const user=getUser();
    // v16.3.0: snapshot the pre-cancel booking so the undo toast can restore it
    // (status/noShow/notes/tables — the whole object). Single pending slot; a
    // newer cancel replaces it.
    const snapshot=bookings.find(function(x){return x.id===id;});
    const ok=saveBookings(function(b){const target=b.find(function(x){return x.id===id;});const d=target?target.date:viewDate;const updated=b.map(function(x){if(x.id!==id) return x;const extra={status:"cancelled",history:(x.history||[]).concat([histEntry(noShow?"no show":"cancelled",user)])};if(noShow){extra.noShow=true;extra.notes=(x.notes?x.notes+"\n":"")+"No show";}return Object.assign({},x,extra);});return bookingsAfterAction(updated,d,tableBlocks,null,false,autoOptimizer);});
    setConfirmCancel(null);
    if(ok){
      flash();
      if(snapshot){
        if(undoTimerRef.current) clearTimeout(undoTimerRef.current);
        setUndoInfo({snapshot:snapshot,noShow:!!noShow});
        undoTimerRef.current=setTimeout(function(){setUndoInfo(null);undoTimerRef.current=null;},(generalSettings.undoSecs||10)*1000);
      }
    }
  }
  // v16.3.0: restore the last-cancelled booking from its snapshot. Re-applies the
  // pre-cancel object (status/tables/notes/noShow) + a history note, then runs
  // bookingsAfterAction so the table re-places (if it was taken meanwhile, the
  // optimizer/reconciliation resolves or flags it — accepted). Gated on `ok`.
  function undoCancel(){
    const info=undoInfo;
    if(!info||!info.snapshot) return;
    const user=getUser();
    const snap=info.snapshot;
    const ok=saveBookings(function(b){
      const exists=b.some(function(x){return x.id===snap.id;});
      const restored=Object.assign({},snap,{history:(snap.history||[]).concat([histEntry("cancellation undone",user)])});
      const updated=exists?b.map(function(x){return x.id===snap.id?restored:x;}):b.concat([restored]);
      return bookingsAfterAction(updated,snap.date,tableBlocks,snap.id,false,autoOptimizer);
    });
    if(ok){
      if(undoTimerRef.current){clearTimeout(undoTimerRef.current);undoTimerRef.current=null;}
      setUndoInfo(null);
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

  function addBlock(block){
    const next=tableBlocks.concat([block]);
    saveBlocks(next);
    const ok=saveBookings(function(b){return bookingsAfterAction(b,block.date,next,null,false,autoOptimizer);});
    if(ok) flash();
    setBlockTarget(null);
  }
  function removeBlock(block){
    const next=tableBlocks.filter(function(bl){return !(bl.tableId===block.tableId&&bl.date===block.date&&bl.allDay===block.allDay&&bl.from===block.from&&bl.to===block.to);});
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
  //  • TRANSIENT status toasts (reconnect / syncing / loaded / reshuffled /
  //    sync-fix) float in a fixed bottom layer (floatingToasts, below) — they
  //    never reflow the grid. Slide-up+fade via .mgt-toast; they auto-hide via
  //    their own state, and a floating toast vanishing moves nothing.
  //  • PERSISTENT/actionable banners (offline / write-error / inefficiency /
  //    overlap / reminders) stay in flow but ease open/closed via the Reveal
  //    atom (graceful height animation). See CLAUDE.md "Notification layout".
  const toastShadow="0 6px 20px rgba(0,0,0,0.18)";
  // v15.8.0: the 5 status toasts share ONE slot — only the highest-priority
  // active one is shown (order below), so they never stack vertically. When the
  // top one changes, the old floats out as the new floats in; they overlap in
  // the same grid cell (gridArea 1/1) so the swap is a crossfade in place.
  const statusToasts=[
    {key:"resync",on:resyncing,node:<div
      style={{background:"linear-gradient(var(--app-offline-bg),var(--app-offline-bg)),var(--bg-ac-menu)",border:"2px solid var(--app-offline-border)",borderRadius:14,padding:"10px 14px",fontSize:13,fontWeight:700,color:"var(--app-offline-text)",boxShadow:toastShadow}}>⟳ Syncing the latest data — this device may have been asleep. Your changes are saved and will finish syncing in a moment.</div>},
    {key:"reconnect",on:reconnectShown,node:<div
      style={{background:"linear-gradient(var(--app-reconnect-bg),var(--app-reconnect-bg)),var(--bg-ac-menu)",border:"2px solid var(--app-reconnect-border)",borderRadius:14,padding:"10px 14px",fontSize:13,fontWeight:600,color:"var(--app-reconnect-text)",boxShadow:toastShadow}}>✓ Reconnected — changes synced.</div>},
    {key:"syncfix",on:syncFix,node:<div
      style={{background:"linear-gradient(var(--app-saved-bg),var(--app-saved-bg)),var(--bg-ac-menu)",border:"2px solid var(--app-saved-border)",borderRadius:14,padding:"10px 14px",fontSize:13,fontWeight:600,color:"var(--app-saved-text)",boxShadow:toastShadow}}>Resolved a table conflict after syncing.</div>},
    {key:"waitadded",on:waitAddedShown,node:<div
      style={{background:"linear-gradient(var(--suggest-bg),var(--suggest-bg)),var(--bg-ac-menu)",border:"2px solid var(--suggest-border)",borderRadius:14,padding:"10px 14px",fontSize:13,fontWeight:600,color:"var(--success-text)",boxShadow:toastShadow}}>Added to the waitlist.</div>},
    {key:"undo",on:!!undoInfo,node:<div
      style={{background:"linear-gradient(var(--bg-sheet),var(--bg-sheet)),var(--bg-ac-menu)",border:"2px solid var(--border-sheet)",borderRadius:14,padding:"8px 10px 8px 14px",fontSize:13,fontWeight:600,color:"var(--text-primary)",boxShadow:toastShadow,display:"flex",alignItems:"center",gap:10,pointerEvents:"auto"}}><span>{undoInfo&&undoInfo.noShow?"Marked no-show":"Booking cancelled"}</span><button
        onClick={function(e){e.stopPropagation();undoCancel();}}
        className="mgt-hover-scale mgt-press"
        style={mkBtn({fontSize:12,minHeight:30,padding:"4px 12px",background:BTN.nav})}>Undo</button></div>},
    {key:"dragmsg",on:!!dragMsg,node:<div
      style={dragMsg&&dragMsg.good
        ?{background:"linear-gradient(var(--suggest-bg),var(--suggest-bg)),var(--bg-ac-menu)",border:"2px solid var(--suggest-border)",borderRadius:14,padding:"10px 14px",fontSize:13,fontWeight:600,color:"var(--success-text)",boxShadow:toastShadow}
        :{background:"linear-gradient(var(--warn-bg),var(--warn-bg)),var(--bg-ac-menu)",border:"2px solid var(--warn-border)",borderRadius:14,padding:"10px 14px",fontSize:13,fontWeight:600,color:"var(--warn-text)",boxShadow:toastShadow}}>{dragMsg?dragMsg.text:""}</div>},
    {key:"reshuffled",on:reshuffled,node:<div
      style={{background:"linear-gradient(var(--app-saved-bg),var(--app-saved-bg)),var(--bg-ac-menu)",border:"2px solid var(--app-saved-border)",borderRadius:14,padding:"10px 14px",fontSize:13,fontWeight:600,color:"var(--app-saved-text)",boxShadow:toastShadow}}>{optimizerActiveFor(viewDate,autoOptimizer)?"Tables re-optimised.":"Booking saved."}</div>},
    {key:"load",on:loadBannerShown,node:<div
      style={{background:"linear-gradient(var(--suggest-bg),var(--suggest-bg)),var(--bg-ac-menu)",border:"2px solid var(--suggest-border)",borderRadius:14,padding:"10px 14px",fontSize:13,fontWeight:600,color:"var(--success-text)",boxShadow:toastShadow}}>{"Firebase connected — "+(firstLoadCount.current||0)+" booking"+(firstLoadCount.current===1?"":"s")+" loaded."}</div>},
  ];
  const topToastKey=(statusToasts.find(function(t){return t.on;})||{}).key;
  // Floating layer — absolutely positioned over the TOP-CENTRE of mainView so the
  // toast lands in the empty gap of the timeline toolbar (between the
  // Optimizer/Reshuffle group on the left and the Follow/zoom group on the right)
  // — more at-a-glance, and it tracks mainView's position. Anchored to a relative
  // wrapper around mainView at the render site; works in both views. ALWAYS
  // mounted (each Toast self-manages its in/out lifecycle, so the container must
  // outlive a toast's out-animation) — empty + pointerEvents:none when idle, so it
  // never blocks the toolbar/grid taps. z<modal (1000) / <quick-status popup (300).
  // Inner = a 1-cell grid so leaving+entering toasts overlap (crossfade in place).
  const floatingToasts=<div
    style={{position:"absolute",top:0,left:0,right:0,zIndex:60,display:"flex",justifyContent:"center",alignItems:"flex-start",padding:"7px 12px 0",pointerEvents:"none"}}><div
    style={{width:"100%",maxWidth:360,display:"grid",justifyItems:"center",textAlign:"center"}}>{statusToasts.map(function(t){return <Toast key={t.key} show={t.key===topToastKey} style={{gridArea:"1 / 1",width:"100%"}}>{t.node}</Toast>;})}</div></div>;

  // In-flow persistent banners (wrapped in <Reveal> at the render site).
  const offlineBanner=!isOnline?<div
    style={{background:"var(--app-offline-bg)",border:"2px solid var(--app-offline-border)",borderRadius:14,padding:"10px 14px",marginBottom:10,fontSize:13,fontWeight:700,color:"var(--app-offline-text)",boxShadow:"0 1px 4px rgba(0,0,0,0.04)"}}>⚠ Working offline — your changes are saved locally and will sync when the connection returns. Keep this tab open.</div>:null;
  const writeWarningBanner=writeWarning?<div
    style={{background:"var(--danger-bg)",border:"2px solid var(--danger-border)",borderRadius:14,padding:"10px 14px",marginBottom:10,fontSize:13,fontWeight:700,color:"var(--danger-text)",display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,boxShadow:"0 1px 4px rgba(0,0,0,0.04)"}}><span>{"⚠ "+writeWarning}</span><button
            className="mgt-hover-scale"
            style={mkBtn({fontSize:12,background:"var(--app-btn-slate-dim)",minHeight:32,padding:"4px 12px"})}
            onClick={function(){setWriteWarning(null);}}>Dismiss</button></div>:null;
  const ineffShow=!reshuffled&&inefficient&&dismissedIneff!==viewDate&&optimizerActiveFor(viewDate,autoOptimizer)&&bookingDefaults.reshuffleSuggestEnabled;
  const ineffBanner=ineffShow?<div
    style={{background:"var(--warn-bg)",border:"2px solid var(--warn-border)",borderRadius:14,padding:"10px 14px",marginBottom:10,fontSize:13,fontWeight:600,color:"var(--warn-text)",display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,flexWrap:"wrap",boxShadow:"0 1px 4px rgba(0,0,0,0.04)"}}><span>Tables could be reshuffled for better efficiency.</span><div style={{display:"flex",gap:6}}><button
        onClick={function(){setDismissedIneff(viewDate);}}
        className="mgt-hover-scale"
        style={mkBtn({fontSize:13,minHeight:36,padding:"6px 14px",background:BTN.dismiss})}>Dismiss</button><button
        onClick={function(){setConfirmReshuffle(true);}}
        className="mgt-hover-scale"
        style={{background:BTN.orange,color:"var(--text-on-accent)",border:"1px solid rgba(255,255,255,0.2)",borderRadius:12,padding:"6px 14px",cursor:"pointer",fontSize:13,fontWeight:600,minHeight:36,boxShadow:"0 1px 4px rgba(0,0,0,0.1), inset 0 1px 1px rgba(255,255,255,0.15)"}}>Reshuffle</button></div></div>:null;

  // Overlap warnings banner — shows when one or more seated guests are overstaying
  // into the start time of a booking on the same table (one-tap Reassign per row).
  // v17.0.0 round 7: converted to the Running-late (LateBanner) pattern —
  // OverlapBanner.jsx (collapsible count header + per-row ✕ dismiss) — gated on
  // the Settings master switch. The map is dismiss-filtered HERE (lateBannerMap
  // pattern) so the outer Reveal collapses when the last row is dismissed.
  const overlapBannerMap=(function(){
    if(!bookingDefaults.overlapWarnEnabled) return {};
    if(overlapDismissed.size===0) return overlapWarnings;
    const map={};
    Object.keys(overlapWarnings).forEach(function(id){if(!overlapDismissed.has(id)) map[id]=overlapWarnings[id];});
    return map;
  })();
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
  const dayWaiting=waitlist.filter(function(w){return w&&w.status==="waiting"&&w.date===viewDate;}).slice().sort(function(a,b){return (a.createdAt||0)-(b.createdAt||0);});
  const dayWaitAvail=dayWaiting.some(function(w){return !!waitAvail[w.id];});
  // v16.3.0 — WaitAvailBanner rows: TODAY'S waiting parties for whom a table
  // currently fits (waitAvail) AND not ✕-dismissed this session. Today-only —
  // a future-date fit isn't operationally urgent (it stays in the panel + badge).
  const todayStr2=new Date().toISOString().slice(0,10);
  const waitBannerEntries=(viewDate===todayStr2?dayWaiting:waitlist.filter(function(w){return w&&w.status==="waiting"&&w.date===todayStr2;}).slice().sort(function(a,b){return (a.createdAt||0)-(b.createdAt||0);}))
    .filter(function(w){return !!waitAvail[w.id]&&!waitNotifyDismissed.has(w.id);});
  function dismissWaitRow(id){setWaitNotifyDismissed(function(prev){const next=new Set(prev);next.add(id);return next;});}
  const hasWaitBanner=waitBannerEntries.length>0;
  const waitlistModal=<ModalPresence show={showWaitlist}>{showWaitlist?<WaitlistPanel
    entries={dayWaiting}
    availability={waitAvail}
    date={viewDate}
    onBook={bookFromWaitlist}
    onRemove={removeFromWaitlist}
    onClose={function(){setShowWaitlist(false);}} />:null}</ModalPresence>;

  // v17.0.0: the Plan (floor) view — reads settings/layout.floorPlan via the
  // `layout` state; quick-status + edit + walk-in ride the existing handlers.
  const planView=<PlanView
    bookings={bookings}
    date={viewDate}
    layout={layout}
    blocks={tableBlocks}
    nowMins={nowMins}
    late={lateMap}
    freeing={freeingMap}
    onEdit={openEdit}
    onStatus={updateStatus}
    onNoShow={function(id){doCancelBooking(id,true);}}
    onWalkin={function(tableId){openWalkin(tableId);}} />;
  const mainView=view==="plan"?planView:view==="timeline"
    ?<TimelineView
    bookings={bookings}
    date={viewDate}
    onEdit={openEdit}
    onManual={function(id){setManualTarget(id);}}
    onStatus={updateStatus}
    onDropOnTable={dropOnTable}
    blocks={tableBlocks}
    onBlock={function(id){setBlockTarget(id);}}
    nowMins={nowMins}
    warnings={overlapWarnings}
    late={lateMap}
    freeing={freeingMap}
    onNoShow={function(id){doCancelBooking(id,true);}}
    zoom={timelineZoom}
    setZoom={setTimelineZoom}
    scrollPosRef={timelineScrollRef}
    followNow={followNow}
    setFollowNow={setFollowNow}
    autoOptimizer={autoOptimizer}
    setAutoOptimizer={setAutoOptimizer}
    onReshuffle={function(){setConfirmReshuffle(true);}}
    currency={generalSettings.currency} />
    :<ListView
    bookings={bookings}
    date={viewDate}
    onEdit={openEdit}
    onStatus={updateStatus}
    onDelete={function(id){setConfirmDel(id);}}
    onManual={function(id){setManualTarget(id);}}
    nowMins={nowMins}
    warnings={overlapWarnings}
    late={lateMap}
    onNoShow={function(id){doCancelBooking(id,true);}}
    selectedId={selectedListId}
    onSelect={setSelectedListId}
    showFinished={showFinished}
    onToggleFinished={toggleShowFinished}
    currency={generalSettings.currency} />;



  const summaryPanel=<Summary
    bookings={bookings}
    date={viewDate}
    splitHour={dayShifts.split}
    shiftsEnabled={dayShifts.enabled}
    isToday={viewDate===new Date().toISOString().slice(0,10)}
    open={summaryOpen}
    freeing={freeingList}
    onToggle={function(){setSummaryOpen(function(o){return !o;});}}
    onOpenWeek={function(){setShowWeek(true);}}
    onPrint={function(){window.print();}} />;
  // v16.3.0: print-only day sheet (portalled to body; hidden on screen). Mounted
  // permanently — cheap (display:none) — so window.print() always has fresh content.
  const daySheet=<DaySheet bookings={bookings} date={viewDate} splitHour={dayShifts.split} waitlist={waitlist} blocks={tableBlocks} restaurantName={generalSettings.restaurantName} currency={generalSettings.currency} />;

  const delModal=<ModalPresence show={!!confirmDel}>{confirmDel?<Overlay onClose={function(){setConfirmDel(null);}} footer={<div style={{display:"flex",justifyContent:"flex-end",gap:8}}><button
        className="mgt-hover-scale"
        style={mkBtn({minHeight:44,padding:"10px 18px",background:BTN.cancel})}
        onClick={function(){setConfirmDel(null);}}>Cancel</button><button
        onClick={function(){delBooking(confirmDel);}}
        className="mgt-hover-scale"
        style={{background:"var(--app-danger-solid)",border:"1px solid rgba(255,255,255,0.2)",borderRadius:14,padding:"10px 18px",cursor:"pointer",fontSize:14,fontWeight:600,color:"var(--text-on-accent)",minHeight:44,boxShadow:"0 2px 6px rgba(0,0,0,0.12), inset 0 1px 1px rgba(255,255,255,0.15)"}}>Delete</button></div>}><div style={{fontSize:17,fontWeight:700,marginBottom:8,color:S.text}}>Delete booking?</div><div style={{fontSize:14,color:S.text,marginBottom:18}}>Tables will be re-optimised after deletion.</div></Overlay>:null}</ModalPresence>;

  const manualModal=<ModalPresence show={!!manualBooking}>{manualBooking?<ManualModal
    booking={manualBooking}
    bookings={manualTarget==="__new__"?bookings.filter(function(b){return b.date===form.date;}):bookings}
    blocks={tableBlocks}
    onSave={function(tables,locked,affected){if(manualTarget==="__new__"){setForm(function(f){return Object.assign({},f,{manualTables:tables});});setSwapAffected(affected||null);setManualTarget(null);}else{manualAssign(manualBooking.id,tables,locked,affected);}}}
    onClose={function(){setManualTarget(null);}} />:null}</ModalPresence>;

  const walkinModal=<ModalPresence show={showWalkin}>{showWalkin?<WalkinForm
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
    onClose={function(){setShowWalkin(false);}}
    onAddToWaitlist={addWalkinToWaitlist} />:null}</ModalPresence>;

  const weekModal=<ModalPresence show={showWeek}>{showWeek?<WeekView
    bookings={bookings}
    viewDate={viewDate}
    onPick={function(d){setViewDate(d);setShowWeek(false);}}
    onClose={function(){setShowWeek(false);}} />:null}</ModalPresence>;

  return (
    <div
      style={{background:"var(--bg-app)",minHeight:"100dvh",padding:isMobile?"12px 12px calc(12px + env(safe-area-inset-bottom))":"16px",fontFamily:"var(--font-app)",color:S.text,boxSizing:"border-box"}}><div style={{maxWidth:appWidth,margin:"0 auto"}}>{/* v17.0.0 correction: adjustable per-device width (Settings→General; was fixed 1000, then 1600) */}<div
          style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12,flexWrap:"wrap",gap:8}}><div><div style={{fontSize:isMobile?18:22,fontWeight:700}}>{generalSettings.restaurantName}</div><div style={{fontSize:12,color:S.text,fontWeight:500}}>{INDOOR.length+" indoor  "+OUTDOOR.length+" outdoor  "+(hoursFor(viewDate).closed?"Closed":String(OPEN).padStart(2,"0")+":00 - "+String(CLOSE%24).padStart(2,"0")+":00")}</div></div><div style={{display:"flex",gap:6,flexWrap:"wrap"}}>{["timeline","list","plan"].map(function(v){return (
              <button
                key={v}
                className="mgt-hover-scale"
                onClick={function(){if(v!==view){const ORD=["timeline","list","plan"];bumpSlide(ORD.indexOf(v)>ORD.indexOf(view)?"mgt-view-in-right":"mgt-view-in-left");}setView(v);}}
                style={mkBtn({background:view===v?S.accent:"var(--app-btn-grey)",textTransform:"capitalize",minHeight:40})}>{v}</button>
            );})}<button
              onClick={openWalkin}
              className="mgt-hover-scale"
              style={{background:"var(--app-walkin)",border:"1px solid rgba(255,255,255,0.2)",borderRadius:12,padding:"8px 14px",fontSize:13,cursor:"pointer",fontWeight:600,color:"var(--text-on-accent)",minHeight:40,boxShadow:"0 1px 4px rgba(0,0,0,0.1), inset 0 1px 1px rgba(255,255,255,0.15)"}}>Walk-in</button><button
              onClick={openNew}
              className="mgt-hover-scale"
              style={{background:"var(--app-new)",border:"1px solid rgba(255,255,255,0.2)",borderRadius:12,padding:"8px 14px",fontSize:13,cursor:"pointer",fontWeight:600,color:"var(--text-on-accent)",minHeight:40,boxShadow:"0 1px 4px rgba(0,0,0,0.1), inset 0 1px 1px rgba(255,255,255,0.15)"}}>+ New</button><button
              onClick={function(){signOut(auth);}}
              className="mgt-hover-scale"
              style={mkBtn({fontSize:12,minHeight:40,padding:"8px 14px",background:BTN.nav})}>Log out</button><ConnectionStatus connected={isOnline} userEmail={auth.currentUser&&auth.currentUser.email} /></div></div><div
          style={{display:"flex",alignItems:"flex-start",gap:8,marginBottom:12,flexWrap:"wrap"}}><div style={{display:"flex",gap:4,alignItems:"center"}}><button
              onClick={function(){const d=new Date(viewDate);d.setDate(d.getDate()-1);goToDate(d.toISOString().slice(0,10));}}
              className="mgt-hover-scale"
              style={mkBtn({minHeight:40,minWidth:40,padding:"6px 10px",fontSize:18,background:BTN.nav})}
              dangerouslySetInnerHTML={{__html:"&#8249;"}} /><button
              onClick={function(){const d=new Date(viewDate);d.setDate(d.getDate()+1);goToDate(d.toISOString().slice(0,10));}}
              className="mgt-hover-scale"
              style={mkBtn({minHeight:40,minWidth:40,padding:"6px 10px",fontSize:18,background:BTN.nav})}
              dangerouslySetInnerHTML={{__html:"&#8250;"}} /><input
              type="date"
              value={viewDate}
              onChange={function(e){goToDate(e.target.value);}}
              className="mgt-hover-scale"
              style={{fontSize:14,padding:"8px 10px",borderRadius:12,border:"1px solid var(--app-date-border)",background:"var(--app-date-bg)",color:S.text,fontWeight:600,minWidth:130,minHeight:40,boxSizing:"border-box",boxShadow:"var(--shadow-input)"}} /></div><div style={{display:"flex",gap:6,alignItems:"center"}}><Presence show={viewDate!==new Date().toISOString().slice(0,10)} inClass="mgt-slide-in" outClass="mgt-slide-out" outMs={190} tag="span"><button
              onClick={function(){goToDate(new Date().toISOString().slice(0,10));}}
              className="mgt-hover-scale"
              style={mkBtn({minHeight:40,padding:"6px 14px",background:BTN.today})}>Today</button></Presence>{/* v16.0.0: waitlist badge — lives in the Today slot (to Today's right when
              Today is visible); the flex:1 Summary sibling absorbs the width change.
              Orange = a table currently fits someone waiting; slate = just waiting. */}
            <Presence show={dayWaiting.length>0} inClass="mgt-slide-in" outClass="mgt-slide-out" outMs={190} tag="span"><button
              onClick={function(){setShowWaitlist(true);}}
              className="mgt-hover-scale"
              style={mkBtn({minHeight:40,padding:"6px 14px",background:dayWaitAvail?BTN.orange:BTN.nav})}>{"⏳ "+dayWaiting.length}</button></Presence></div><div style={{flexGrow:1,flexShrink:1,flexBasis:isMobile?"100%":360,minWidth:0,transition:"flex-basis 260ms ease"}}>{summaryPanel}</div>{/* v17.0.0 round 8: 🔍 + ⚙ live HERE (right of Summary) for every
              view — Timeline's legend and List's card-header each used to carry
              their own copy and Plan had none. minHeight 40 aligns them with the
              date controls; marginLeft:auto keeps them right-aligned when the
              mobile full-width Summary wraps them onto their own line. */}
            <div style={{display:"flex",alignItems:"center",minHeight:40,marginLeft:"auto",flexShrink:0}}><ViewTools
              onOpenSearch={function(){setShowSearch(true);}}
              onOpenSettings={function(){setShowSettings(true);}} /></div></div><Reveal show={!isOnline}>{offlineBanner}</Reveal><Reveal show={!!writeWarning}>{writeWarningBanner}</Reveal><Reveal show={ineffShow}>{ineffBanner}</Reveal><Reveal show={hasOverlap}><OverlapBanner warnings={overlapBannerMap} bookings={bookings} collapseMax={generalSettings.lateCollapseMax} onReassign={reassignBooking} onDismiss={dismissOverlapRow} /></Reveal><Reveal show={hasLate}><LateBanner lateMap={lateBannerMap} bookings={bookings} nowMins={nowMins} collapseMax={generalSettings.lateCollapseMax} onNoShow={function(id){doCancelBooking(id,true);}} onDismiss={dismissLateRow} /></Reveal><Reveal show={hasWaitBanner}><WaitAvailBanner entries={waitBannerEntries} availability={waitAvail} onBook={bookFromWaitlist} onDismiss={dismissWaitRow} /></Reveal><Reveal show={!!reminderBanners}>{reminderBanners}</Reveal><div style={{position:"relative"}}>{floatingToasts}<SlideView key={slide.k} dir={slide.dir}>{mainView}</SlideView></div><ModalPresence show={showForm}>{showForm?<BookingFormModal
              form={form}
              setForm={setForm}
              editId={editId}
              error={error}
              bookings={bookings}
              liveBookings={liveBookings}
              tableBlocks={tableBlocks}
              autoOptimizer={autoOptimizer}
              isMobile={isMobile}
              currency={generalSettings.currency}
              regularMin={generalSettings.regularMin}
              onSave={function(){save();}}
              onSavePending={function(){save("pending");}}
              onSaveConfirm={function(){save("confirmed");}}
              onClose={function(){setShowForm(false);}}
              onClearSwap={function(){setSwapAffected(null);}}
              onBookAgain={bookAgain}
              onOpenPrefPicker={function(){setShowPrefPicker(true);}}
              onOpenManualAssign={function(target){setManualTarget(target);}}
              onOpenHistory={function(){setShowHistory(true);}}
              onRequestCancel={function(id){setConfirmCancel(id);}}
              onAddToWaitlist={addFormToWaitlist}
              standingEnabled={recurring.enabled!==false} />:null}</ModalPresence>{delModal}{manualModal}{walkinModal}{weekModal}{prefPickerModal}{waitlistModal}{daySheet}<ModalPresence show={showSearch}>{showSearch?<SearchPanel bookings={bookings} todayStr={new Date().toISOString().slice(0,10)} onPick={function(b){setShowSearch(false);setView("list");if(b.date===viewDate){setSelectedListId(b.id);const fin=b.status==="completed"||b.status==="cancelled";setShowFinished(fin);}else{pendingSelectRef.current=b.id;goToDate(b.date);}}} onClose={function(){setShowSearch(false);}} />:null}</ModalPresence><ModalPresence show={!!blockTarget}>{blockTarget?<BlockModal
          tableId={blockTarget}
          date={viewDate}
          blocks={tableBlocks}
          onSave={addBlock}
          onRemove={removeBlock}
          onClose={function(){setBlockTarget(null);}} />:null}</ModalPresence><ModalPresence show={!!confirmCancel}>{confirmCancel?<Overlay onClose={function(){setConfirmCancel(null);}} footer={<div style={{display:"flex",justifyContent:"flex-end",gap:8,flexWrap:"wrap"}}><button
              className="mgt-hover-scale"
              style={mkBtn({minHeight:44,padding:"10px 18px",background:"var(--app-btn-slate)"})}
              onClick={function(){setConfirmCancel(null);}}>Back</button><button
              onClick={function(){doCancelBooking(confirmCancel,true);setShowForm(false);}}
              className="mgt-hover-scale"
              style={{background:"var(--app-warn-solid)",border:"1px solid rgba(255,255,255,0.2)",borderRadius:14,padding:"10px 18px",cursor:"pointer",fontSize:14,fontWeight:600,color:"var(--text-on-accent)",minHeight:44,boxShadow:"0 2px 6px rgba(0,0,0,0.12), inset 0 1px 1px rgba(255,255,255,0.15)"}}>No show</button><button
              onClick={function(){doCancelBooking(confirmCancel,false);setShowForm(false);}}
              className="mgt-hover-scale"
              style={{background:BLOCK_BG.cancelled,border:"1px solid rgba(255,255,255,0.2)",borderRadius:14,padding:"10px 18px",cursor:"pointer",fontSize:14,fontWeight:600,color:"var(--text-on-accent)",minHeight:44,boxShadow:"0 2px 6px rgba(0,0,0,0.12), inset 0 1px 1px rgba(255,255,255,0.15)"}}>Cancel booking</button></div>}><div style={{fontSize:17,fontWeight:700,marginBottom:8,color:S.text}}>Cancel booking?</div><div style={{fontSize:14,color:S.text,marginBottom:18}}>Tables will be re-optimised after cancellation.</div></Overlay>:null}</ModalPresence><ModalPresence show={!!confirmKitchen}>{confirmKitchen?<Overlay onClose={function(){setConfirmKitchen(null);}} footer={<div style={{display:"flex",justifyContent:"flex-end",gap:8,flexWrap:"wrap"}}><button
              className="mgt-hover-scale"
              style={mkBtn({minHeight:44,padding:"10px 18px",background:"var(--app-btn-slate)"})}
              onClick={function(){setConfirmKitchen(null);}}>Back</button><button
              onClick={function(){const isW=confirmKitchen==="walkin";setConfirmKitchen(null);if(isW) doSaveWalkin();else doSave();}}
              className="mgt-hover-scale"
              style={{background:"var(--app-warn-solid)",border:"1px solid rgba(255,255,255,0.2)",borderRadius:14,padding:"10px 18px",cursor:"pointer",fontSize:14,fontWeight:600,color:"var(--text-on-accent)",minHeight:44,boxShadow:"0 2px 6px rgba(0,0,0,0.12), inset 0 1px 1px rgba(255,255,255,0.15)"}}>Confirm</button></div>}><div style={{fontSize:17,fontWeight:700,marginBottom:8,color:"var(--warn-text)"}}>Kitchen may be busy</div><div style={{fontSize:14,color:S.text,marginBottom:12}}>{"There are already "+(confirmKitchen==="walkin"?(function(){const wf=walkinForm;const t=wf.time||nowTime();const d=wf.customDur||getDur(Number(wf.size)||2);const l=getKitchenLoad(bookings,new Date().toISOString().slice(0,10),t,d,null);return l.starts+" booking"+(l.starts!==1?"s":"")+" with "+l.guests+" guest"+(l.guests!==1?"s":"");})():(function(){const f=formRef.current;const d=f.customDur||getDur(Number(f.size)||2);const l=getKitchenLoad(bookings,f.date,f.time,d,editId);return l.starts+" booking"+(l.starts!==1?"s":"")+" with "+l.guests+" guest"+(l.guests!==1?"s":"");})())+" starting at this time. Check the suggested alternatives below, or confirm to proceed anyway."}</div></Overlay>:null}</ModalPresence><ModalPresence show={confirmReshuffle}>{confirmReshuffle?<Overlay onClose={function(){setConfirmReshuffle(false);}} footer={<div style={{display:"flex",justifyContent:"flex-end",gap:8,flexWrap:"wrap"}}><button
              className="mgt-hover-scale"
              style={mkBtn({minHeight:44,padding:"10px 18px",background:"var(--app-btn-slate)"})}
              onClick={function(){setConfirmReshuffle(false);}}>Back</button><button
              onClick={function(){setConfirmReshuffle(false);forceReshuffle();}}
              className="mgt-hover-scale"
              style={{background:BTN.orange,border:"1px solid rgba(255,255,255,0.2)",borderRadius:14,padding:"10px 18px",cursor:"pointer",fontSize:14,fontWeight:600,color:"var(--text-on-accent)",minHeight:44,boxShadow:"0 2px 6px rgba(0,0,0,0.12), inset 0 1px 1px rgba(255,255,255,0.15)"}}>Reshuffle</button></div>}><div style={{fontSize:17,fontWeight:700,marginBottom:8,color:"var(--warn-text)"}}>Reshuffle all bookings?</div><div style={{fontSize:14,color:S.text,marginBottom:18}}>Confirmed bookings may be moved to different tables to improve efficiency. Seated bookings will not be moved.</div></Overlay>:null}</ModalPresence><ModalPresence show={showSettings}>{// v14 preview 3: Settings modal. Opened by the cog icon in TimelineView's
        // legend row or by pressing `?` anywhere no modal is open.
        // v14 preview 7: now tabbed (General / Reminders / Shortcuts). Tab state
        // resets to 'general' on close so reopens feel fresh.
        showSettings?<Overlay onClose={function(){setShowSettings(false);setSettingsTab("general");}} footer={<div style={{display:"flex",justifyContent:"flex-end"}}><button
              className="mgt-hover-scale"
              style={mkBtn({minHeight:40,padding:"8px 18px",background:"var(--app-btn-slate)"})}
              onClick={function(){setShowSettings(false);setSettingsTab("general");}}>Close</button></div>}><div style={{textAlign:"center",marginBottom:14}}><div
              style={{fontSize:16,fontWeight:700,color:"var(--text-on-accent)",display:"inline-block",padding:"8px 16px",borderRadius:12,background:"var(--app-btn-grey-strong)",border:"1px solid rgba(255,255,255,0.2)",boxShadow:"0 1px 4px rgba(0,0,0,0.1), inset 0 1px 1px rgba(255,255,255,0.15)"}}>Settings</div></div><SettingsContent
            appVersion={__APP_SIGNATURE__.version}
            isDark={isDark}
            onToggleDark={onToggleDark}
            appWidth={appWidth}
            onSetAppWidth={onSetAppWidth}
            weekHours={weekHours}
            onSaveDayHours={saveDayHours}
            onSaveAllDays={saveAllDays}
            weekRange={weekRange()}
            splitHour={dayShifts.split}
            shiftsEnabled={dayShifts.enabled}
            onSaveShifts={saveDayShifts}
            optimizerCutoff={optimizerSettings.cutoff}
            optimizerAutoSwitch={optimizerSettings.autoSwitch}
            onSaveOptimizer={saveOptimizerSettings}
            bookingDefaults={bookingDefaults}
            onSaveBookingDefaults={saveBookingDefaults}
            generalSettings={generalSettings}
            onSaveGeneralSettings={saveGeneralSettings}
            onBackup={doBackup}
            recurring={recurring}
            onSetRecurringEnabled={setRecurringEnabled}
            onSetRecurringHorizon={setRecurringHorizon}
            onUpdateRule={updateRule}
            onRemoveRule={removeRule}
            layout={layout}
            onSaveLayout={saveLayout}
            bookings={bookings}
            waitlist={waitlist}
            onDeleteCustomer={deleteCustomer}
            tab={settingsTab}
            setTab={setSettingsTab}
            reminders={reminders}
            onAddReminder={openNewReminder}
            onEditReminder={openEditReminder}
            onDeleteReminder={deleteReminder}
            onToggleReminder={toggleReminderActive} /></Overlay>:null}</ModalPresence><ModalPresence show={!!confirmReminderDel}>{// v14 p7 fix: in-app reminder-delete confirmation (replaces broken
        // window.confirm which is blocked in sandboxed preview environments).
        // Renders on top of Settings in DOM order so it visually covers the list.
        confirmReminderDel?<Overlay onClose={function(){setConfirmReminderDel(null);}} footer={<div style={{display:"flex",justifyContent:"flex-end",gap:8,flexWrap:"wrap"}}><button
              className="mgt-hover-scale"
              style={mkBtn({minHeight:44,padding:"10px 18px",background:"var(--app-btn-slate)"})}
              onClick={function(){setConfirmReminderDel(null);}}>Back</button><button
              onClick={function(){doDeleteReminder(confirmReminderDel);}}
              className="mgt-hover-scale"
              style={{background:BTN.del,border:"1px solid rgba(255,255,255,0.2)",borderRadius:14,padding:"10px 18px",cursor:"pointer",fontSize:14,fontWeight:600,color:"var(--text-on-accent)",minHeight:44,boxShadow:"0 2px 6px rgba(0,0,0,0.12), inset 0 1px 1px rgba(255,255,255,0.15)"}}>Delete</button></div>}><div style={{fontSize:17,fontWeight:700,marginBottom:8,color:S.text}}>Delete reminder?</div><div style={{fontSize:14,color:S.text,marginBottom:18}}>This reminder will be permanently removed.</div></Overlay>:null}</ModalPresence><ModalPresence show={!!reminderEditor}>{// v14 p7: Reminder editor modal — sits on top of Settings (z=250 vs 200).
        reminderEditor?<ReminderEditor
          draft={reminderEditor.draft}
          setDraft={function(d){setReminderEditor(function(prev){return prev?Object.assign({},prev,{draft:d}):null;});}}
          onSave={saveReminderFromEditor}
          onCancel={function(){setReminderEditor(null);}}
          isNew={reminderEditor.id==="new"} />:null}</ModalPresence>{historyPopup}</div></div>
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
      style={{background:"var(--bg-app)",minHeight:"100dvh",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"var(--font-app)",color:S.text,fontSize:15}}>Loading...</div>
  );
  if(!user) return <LoginScreen />;
  return <BookingApp />;
}
