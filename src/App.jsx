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
import { useState, useRef, useEffect } from "react";
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
  OPEN, CLOSE, KITCHEN_TABLE_LIMIT, BLOCK_BG, S, BTN, EMPTY_FORM, hoursFor, weekRange, INDOOR, OUTDOOR
} from "./lib/constants";

import {
  getDur, toMins, genId,
  histEntry, diffBooking,
  isLocked, isActive, statusOrder,
  getBlockSlots, canAssign,
  getKitchenLoad,
  applyOpt,
  optimizerActiveFor, syncLiveDurations, applySeatedShift, findFreeSlot, bookingsAfterAction,
  checkInefficent,
  nowTime
} from "./lib/booking-logic";

import { validateReminderDraft } from "./lib/reminders";


// ── Phase B1 (v15-refactor): UI atoms extracted to ./components/atoms.jsx ──
// First component file in the codebase using JSX syntax. App.jsx now also
// uses JSX (Phase C3b) so the original B1 note about RC()-vs-JSX
// compatibility no longer applies — both files share a single style.
import { Overlay, mkBtn } from "./components/atoms";


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
import { SettingsContent }         from "./components/Settings";
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
import { WeekView }     from "./components/WeekView";

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


// ── App fingerprint (do not remove) ──────────────────────────────────────────
// Module-level identity record. Survives bundling/minification — the strings
// below remain readable in any deployed bundle. Referenced by the boot banner
// (window assignment + console.log) so the bundler cannot tree-shake it.
// Forensic evidence of origin if this code appears in an unauthorized deployment.
const __APP_SIGNATURE__={
  app:"Me Gustas Tú Booking System",
  version:"15.0.0",
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
  // v14.4.0: List-view keyboard focus — the booking the A/E/D/S/C/Delete
  // shortcuts act on. ↑/↓ move it; click a card to set it. Null = nothing focused.
  const [selectedListId, setSelectedListId] = useState(null);
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
  const [manualTarget, setManualTarget] = useState(null);
  const [dismissedIneff, setDismissedIneff] = useState(null);
  const formRef=useRef(EMPTY_FORM);
  const [swapAffected, setSwapAffected] = useState(null);
  const [confirmKitchen, setConfirmKitchen] = useState(null);
  const [showHistory, setShowHistory] = useState(false);
  const [showPrefPicker, setShowPrefPicker] = useState(false);
  // v14 preview 3: Settings / keyboard-shortcuts modal. Toggled by the cog
  // icon in TimelineView's legend row and by the `?` keyboard shortcut.
  const [showSettings, setShowSettings] = useState(false);
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
    loadBannerShown, reconnectShown,
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
  // Derived: bookings with seated-today durations synced to live time.
  // Used by form/walk-in availability checks so they match what bookingsAfterAction
  // will see on save.
  const liveBookings=(function(){
    const today=new Date().toISOString().slice(0,10);
    return syncLiveDurations(bookings,today,nowMins);
  })();
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
  const listDaySorted=bookings
    .filter(function(b){return b.date===viewDate;})
    .sort(function(a,b){const sa=statusOrder(a.status),sb=statusOrder(b.status);if(sa!==sb) return sa-sb;return a.time.localeCompare(b.time);});
  // Clear the List focus when the day changes — the focused booking won't be
  // on the new day. (A status change that drops a booking from view just leaves
  // selectedListId pointing at a missing id → shortcuts no-op until it's re-set.)
  useEffect(function(){setSelectedListId(null);},[viewDate]);

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

  function flash(){setReshuffled(true);setTimeout(function(){setReshuffled(false);},3000);}
  function openNew(){setForm(Object.assign({},EMPTY_FORM,{date:viewDate}));setEditId(null);setError("");setSwapAffected(null);setShowForm(true);}
  function openEdit(b){setForm({name:b.name,phone:b.phone||"+",date:b.date,time:b.time,size:b.size,preference:b.preference,notes:b.notes||"",status:b.status,customDur:(b.originalDuration||b.duration)!==getDur(b.size)?(b.originalDuration||b.duration):null,manualTables:[],preferredTables:Array.isArray(b.preferredTables)?b.preferredTables.slice():[],returnOf:null});setEditId(b.id);setError("");setSwapAffected(null);setShowHistory(false);setShowForm(true);}
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
    const schedTime=sourceBooking.scheduledTime||sourceBooking.time||"13:00";
    setForm(Object.assign({},EMPTY_FORM,{
      name:sourceBooking.name||"",
      phone:sourceBooking.phone||"+",
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
    const f=formRef.current;
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
      const cleanPhone=f.phone&&f.phone.trim()!=="+"?f.phone.trim():"";
      const mt=Array.isArray(f.manualTables)&&f.manualTables.length>0?f.manualTables:[];
      if(mt.length&&!swapAffected){let ex=liveBookings.filter(function(b){return b.date===f.date&&b.status!=="cancelled"&&b.id!==editId;}).map(function(b){return {tables:b.tables||[],s:toMins(b.time),e:toMins(b.time)+b.duration};});ex=ex.concat(getBlockSlots(tableBlocks,f.date));if(!canAssign(mt,ex,sm,sm+dur)){setError("Selected tables are not available at this time.");return;}}
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
        if(f.status==="completed"&&orig&&orig.status!=="completed"&&!f.customDur){const now=new Date();const nowMinsLocal=now.getHours()*60+now.getMinutes();const startMins=toMins(f.time);const actualDur=Math.max(15,nowMinsLocal-startMins);saveDur=actualDur;saveCustDur=actualDur;}
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
        const upd=bookings.map(function(b){
          if(b.id===editId){
            let h=(b.history||[]).concat([editHist]);
            if(seatedShift) h=h.concat([histEntry("seated "+seatedShift.direction+": time adjusted "+seatedShift.oldTime+" → "+seatedShift.newTime,getUser())]);
            const unlockForOpt=needsR&&wasSeatedLocked&&!mt.length&&!clearM;
            return Object.assign({},b,{name:f.name,phone:cleanPhone,date:f.date,time:saveTime,scheduledTime:saveScheduledTime,size:size,duration:saveDur,originalDuration:saveOrigDurFinal,preference:f.preference,notes:f.notes,status:unlockForOpt?"confirmed":f.status,tables:mt.length?mt:(clearM?[]:(!needsR?b.tables:[])),customDur:saveCustDur,_manual:mt.length>0?true:(clearM?false:b._manual),_locked:mt.length>0?true:(clearM?false:(unlockForOpt?false:b._locked)),preferredTables:Array.isArray(f.preferredTables)?f.preferredTables:[],history:h});
          }
          if(swapAffected){const match=swapAffected.find(function(ab){return ab.id===b.id;});if(match){const remaining=(b.tables||[]).filter(function(t){return !match.tables.includes(t);});return Object.assign({},b,{tables:remaining,_locked:false,_manual:false});}}
          return b;
        });
        // v14: when seating, force no-reshuffle of other bookings (same rule as
        // updateStatus). The seated-shift must not trigger cascading table moves.
        const optStateForSave=seatingNow?false:autoOptimizer;
        let fin=bookingsAfterAction(upd,f.date,tableBlocks,editId,needsR&&!mt.length,optStateForSave);
        if(wasSeatedLocked&&needsR&&!mt.length&&!clearM){fin=fin.map(function(b){if(b.id===editId) return Object.assign({},b,{status:f.status,_locked:b.tables&&b.tables.length>0,_manual:b.tables&&b.tables.length>0});return b;});}
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
        saveBookings(fin);if(needsR||swapAffected||f.status==="completed"||seatingNow) flash();setShowForm(false);setViewDate(f.date);
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
        // v14 p1: scheduledTime=f.time on creation (new bookings always start confirmed).
        const nb={id:newId,name:f.name,phone:cleanPhone,date:f.date,time:f.time,scheduledTime:f.time,size:size,duration:dur,originalDuration:dur,preference:f.preference,notes:f.notes,status:"confirmed",tables:mt.length?mt:[],customDur:f.customDur||null,_manual:mt.length>0,_locked:mt.length>0,preferredTables:Array.isArray(f.preferredTables)?f.preferredTables:[],returnOf:returnOfId,history:[createHist]};
        let base=bookings;
        if(swapAffected){base=bookings.map(function(b){const match=swapAffected.find(function(ab){return ab.id===b.id;});if(match){const remaining=(b.tables||[]).filter(function(t){return !match.tables.includes(t);});return Object.assign({},b,{tables:remaining,_locked:false,_manual:false});}return b;});}
        // If this is a Book Again creation, append a back-reference entry to the
        // source booking's history (purely informational — no status/table change).
        if(source){
          base=base.map(function(b){
            if(b.id!==returnOfId) return b;
            return Object.assign({},b,{history:(b.history||[]).concat([histEntry("Book Again → new booking on "+f.date+" at "+f.time,getUser())])});
          });
        }
        const fin=bookingsAfterAction(base.concat([nb]),f.date,tableBlocks,newId,!mt.length,autoOptimizer);
        if(!mt.length){
          const ne=fin.find(function(b){return b.id===newId;});
          if(!ne||(ne.tables||[]).length===0){setError("Could not assign a table — try manual assignment.");return;}
          const displaced=fin.filter(function(b){return b.id!==newId&&b.date===f.date&&isActive(b)&&(!b.tables||!b.tables.length||b._conflict);});
          const prevAssigned=base.filter(function(b){return b.date===f.date&&isActive(b)&&b.tables&&b.tables.length>0;});
          const kicked=displaced.filter(function(d){return prevAssigned.some(function(p){return p.id===d.id;});});
          if(kicked.length>0){setError("Not enough capacity — adding this booking would displace "+kicked.length+" existing booking"+(kicked.length>1?"s":"")+": "+kicked.map(function(k){return k.name;}).join(", ")+".");return;}
        }
        saveBookings(fin);flash();setShowForm(false);setViewDate(f.date);
      }
    }catch(err){setError("Error: "+err.message);}
  }
  function save(){
    const f=formRef.current;
    if(!f.time) return doSave();
    const size=Number(f.size)||2;const d=f.customDur||getDur(size);
    const load=getKitchenLoad(bookings,f.date,f.time,d,editId);
    if(load.starts+1>=KITCHEN_TABLE_LIMIT&&!confirmKitchen){
      setConfirmKitchen("form");return;
    }
    setConfirmKitchen(null);doSave();
  }

  function forceReshuffle(){saveBookings(function(b){return applyOpt(b,viewDate,tableBlocks);});flash();}
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
    saveBookings(function(prev){return prev.map(function(b){
      if(b.id!==id) return b;
      return Object.assign({},b,{tables:tables,_manual:false,_conflict:false,history:(b.history||[]).concat([histEntry("reassigned "+prevTables+" → "+tables.join("+"),user)])});
    });});
    setError("");
    flash();
  }
  function delBooking(id){saveBookings(function(b){const target=b.find(function(x){return x.id===id;});const d=target?target.date:viewDate;return bookingsAfterAction(b.filter(function(x){return x.id!==id;}),d,tableBlocks,null,false,autoOptimizer);});setConfirmDel(null);flash();}

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
    forceReshuffle:forceReshuffle,delBooking:delBooking,bookAgain:bookAgain
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
      // ── v14 p7: Settings tab-cycle with ←/→ ──
      // Active only when Settings is the top layer (reminderEditor and
      // confirmReminderDel are sub-modals on top of Settings — when they're
      // open, arrows should flow to their default behavior or be no-ops).
      // Takes priority over the global ←/→ day-nav shortcut below.
      if(K.showSettings&&!K.reminderEditor&&!K.confirmReminderDel){
        if(k==="ArrowLeft"||k==="ArrowRight"){
          e.preventDefault();
          const TABS=["general","layout","reminders","shortcuts"];
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
      const anyModal=K.showForm||K.showWalkin||K.showWeek||K.showHistory||K.confirmDel||K.confirmReshuffle||K.confirmCancel||K.confirmKitchen||K.manualTarget||K.blockTarget||K.showPrefPicker||K.showSettings||K.reminderEditor||K.confirmReminderDel;
      if(anyModal) return;
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
          if(k==="s"||k==="S"){e.preventDefault();K.updateStatus(sel.id,"seated");return;}
          if((k==="c"||k==="C")&&e.shiftKey){e.preventDefault();K.updateStatus(sel.id,"cancelled");return;}
          if(k==="c"||k==="C"){e.preventDefault();K.updateStatus(sel.id,"completed");return;}
          if(k==="d"||k==="D"){e.preventDefault();K.setConfirmDel(sel.id);return;}
        }
      }
      if(k==="?"){e.preventDefault();K.setShowSettings(true);return;}
      if(k==="t"||k==="T"){e.preventDefault();K.setView("timeline");return;}
      if(k==="l"||k==="L"){e.preventDefault();K.setView("list");return;}
      if(k==="d"||k==="D"){e.preventDefault();K.setViewDate(new Date().toISOString().slice(0,10));return;}
      if(k==="n"||k==="N"){e.preventDefault();K.openNew();return;}
      if(k==="w"||k==="W"){e.preventDefault();K.openWalkin();return;}
      // v14.6.0: toggle the Summary panel (provisional key — see SUMMARY_KEY).
      if(k===SUMMARY_KEY||k===SUMMARY_KEY.toUpperCase()){e.preventDefault();K.setSummaryOpen(function(o){return !o;});return;}
      if(k===WEEK_KEY||k===WEEK_KEY.toUpperCase()){e.preventDefault();K.setShowWeek(true);return;}
      if(k==="ArrowLeft"){e.preventDefault();const d1=new Date(K.viewDate);d1.setDate(d1.getDate()-1);K.setViewDate(d1.toISOString().slice(0,10));return;}
      if(k==="ArrowRight"){e.preventDefault();const d2=new Date(K.viewDate);d2.setDate(d2.getDate()+1);K.setViewDate(d2.toISOString().slice(0,10));return;}
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
    saveBookings(function(b){
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
        if(status==="completed"){
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
    if(status==="completed"||status==="seated") flash();
  }
  function doCancelBooking(id,noShow){
    const user=getUser();
    saveBookings(function(b){const target=b.find(function(x){return x.id===id;});const d=target?target.date:viewDate;const updated=b.map(function(x){if(x.id!==id) return x;const extra={status:"cancelled",history:(x.history||[]).concat([histEntry(noShow?"no show":"cancelled",user)])};if(noShow) extra.notes=(x.notes?x.notes+"\n":"")+"No show";return Object.assign({},x,extra);});return bookingsAfterAction(updated,d,tableBlocks,null,false,autoOptimizer);});
    setConfirmCancel(null);flash();
  }
  function manualAssign(bookingId,tables,locked,affected){
    const user=getUser();
    saveBookings(function(b){
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
    if(affected&&affected.length>0) flash();
  }

  function addBlock(block){
    const next=tableBlocks.concat([block]);
    saveBlocks(next);
    saveBookings(function(b){return bookingsAfterAction(b,block.date,next,null,false,autoOptimizer);});
    flash();
    setBlockTarget(null);
  }
  function removeBlock(block){
    const next=tableBlocks.filter(function(bl){return !(bl.tableId===block.tableId&&bl.date===block.date&&bl.allDay===block.allDay&&bl.from===block.from&&bl.to===block.to);});
    saveBlocks(next);
    saveBookings(function(b){return bookingsAfterAction(b,block.date,next,null,false,autoOptimizer);});
    flash();
    if(next.filter(function(bl){return bl.tableId===block.tableId&&bl.date===block.date;}).length===0) setBlockTarget(null);
  }

  const manualBooking=(function(){
    if(!manualTarget) return null;
    if(manualTarget==="__new__"){return {id:"__new__",name:form.name||"New booking",size:Number(form.size)||2,time:form.time||"13:00",duration:form.customDur||getDur(Number(form.size)||2),tables:Array.isArray(form.manualTables)?form.manualTables:[],date:form.date,status:"confirmed",_locked:true};}
    let found=bookings.find(function(b){return b.id===manualTarget;})||null;
    if(found&&manualTarget===editId){found=Object.assign({},found,{size:Number(form.size)||2,time:form.time||found.time,duration:form.customDur||getDur(Number(form.size)||2),date:form.date||found.date,preference:form.preference||found.preference});}
    return found;
  })();

  const prefPickerModal=showPrefPicker?<PrefPickerModal
    selected={form.preferredTables||[]}
    partySize={form.size}
    onChange={function(next){setForm(function(f){return Object.assign({},f,{preferredTables:next});});}}
    onClose={function(){setShowPrefPicker(false);}} />:null;

  const historyPopup=(showHistory&&editId)?(function(){const cur=bookings.find(function(b){return b.id===editId;});return cur?<HistoryPopup booking={cur} onClose={function(){setShowHistory(false);}} />:null;})():null;


  // reminderBanners is returned by useReminders (Phase D2) and rendered
  // alongside the other top banners further down. Derivation + JSX live
  // in ./hooks/useReminders.jsx.

  const reshuffledBanner=reshuffled?<div
    style={{background:"var(--app-saved-bg)",border:"2px solid var(--app-saved-border)",borderRadius:14,padding:"10px 14px",marginBottom:10,fontSize:13,fontWeight:600,color:"var(--app-saved-text)",boxShadow:"0 1px 4px rgba(0,0,0,0.04)"}}>{optimizerActiveFor(viewDate,autoOptimizer)?"Tables re-optimised.":"Booking saved."}</div>:null;
  const ineffBanner=(!reshuffled&&inefficient&&dismissedIneff!==viewDate&&optimizerActiveFor(viewDate,autoOptimizer))?<div
    style={{background:"var(--warn-bg)",border:"2px solid var(--warn-border)",borderRadius:14,padding:"10px 14px",marginBottom:10,fontSize:13,fontWeight:600,color:"var(--warn-text)",display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,flexWrap:"wrap",boxShadow:"0 1px 4px rgba(0,0,0,0.04)"}}><span>Tables could be reshuffled for better efficiency.</span><div style={{display:"flex",gap:6}}><button
        onClick={function(){setDismissedIneff(viewDate);}}
        className="mgt-hover-scale"
        style={mkBtn({fontSize:13,minHeight:36,padding:"6px 14px",background:BTN.dismiss})}>Dismiss</button><button
        onClick={function(){setConfirmReshuffle(true);}}
        className="mgt-hover-scale"
        style={{background:BTN.orange,color:"var(--text-on-accent)",border:"1px solid rgba(255,255,255,0.2)",borderRadius:12,padding:"6px 14px",cursor:"pointer",fontSize:13,fontWeight:600,minHeight:36,boxShadow:"0 1px 4px rgba(0,0,0,0.1), inset 0 1px 1px rgba(255,255,255,0.15)"}}>Reshuffle</button></div></div>:null;

  // Overlap warnings banner — shows when one or more seated guests are overstaying
  // into the start time of a booking on the same table. Each row shows a one-tap
  // Reassign button that reroutes the crowded-out booking to a free table without
  // disturbing anyone else. Visible regardless of view (timeline or list).
  const overlapEntries=Object.keys(overlapWarnings).map(function(sbId){
    const w=overlapWarnings[sbId];
    const sb=bookings.find(function(b){return b.id===sbId;});
    if(!sb) return null;
    const rowBg=w.overdue?"var(--danger-bg)":"var(--warn-bg)";
    const rowBrd=w.overdue?"var(--danger-border)":"var(--warn-border)";
    const rowTxt=w.overdue?"var(--danger-text)":"var(--warn-text)";
    const msg=sb.name+" (overstaying) → "+w.next+" at "+w.nextTime+(w.overdue?" — overdue":" — in "+w.gap+" min");
    return (
      <div
        key={sbId}
        style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,flexWrap:"wrap",padding:"8px 12px",borderRadius:12,background:rowBg,border:"1px solid "+rowBrd,marginTop:6}}><span
          style={{fontSize:13,color:rowTxt,fontWeight:600,flex:"1 1 auto",minWidth:0}}>{msg}</span><button
          onClick={function(){reassignBooking(w.nextId);}}
          className="mgt-hover-scale"
          style={mkBtn({fontSize:12,minHeight:32,padding:"4px 12px",background:BTN.orange})}>{"Reassign "+w.next}</button></div>
    );
  }).filter(Boolean);
  const overlapBanner=overlapEntries.length?<div
    style={{background:"var(--app-overlap-bg)",border:"2px solid var(--app-overlap-border)",borderRadius:14,padding:"10px 14px",marginBottom:10,boxShadow:"0 1px 4px rgba(0,0,0,0.04)"}}><div style={{fontSize:13,fontWeight:700,color:"var(--warn-text)",marginBottom:2}}>Overlap warnings</div>{overlapEntries}</div>:null;

  const mainView=view==="timeline"
    ?<TimelineView
    bookings={bookings}
    date={viewDate}
    onEdit={openEdit}
    onManual={function(id){setManualTarget(id);}}
    onStatus={updateStatus}
    blocks={tableBlocks}
    onBlock={function(id){setBlockTarget(id);}}
    nowMins={nowMins}
    warnings={overlapWarnings}
    zoom={timelineZoom}
    setZoom={setTimelineZoom}
    scrollPosRef={timelineScrollRef}
    followNow={followNow}
    setFollowNow={setFollowNow}
    autoOptimizer={autoOptimizer}
    setAutoOptimizer={setAutoOptimizer}
    onReshuffle={function(){setConfirmReshuffle(true);}}
    onOpenSettings={function(){setShowSettings(true);}} />
    :<ListView
    bookings={bookings}
    date={viewDate}
    onEdit={openEdit}
    onStatus={updateStatus}
    onDelete={function(id){setConfirmDel(id);}}
    onManual={function(id){setManualTarget(id);}}
    nowMins={nowMins}
    warnings={overlapWarnings}
    selectedId={selectedListId}
    onSelect={setSelectedListId} />;


  const summaryPanel=<Summary
    bookings={bookings}
    date={viewDate}
    splitHour={dayShifts.split}
    shiftsEnabled={dayShifts.enabled}
    isToday={viewDate===new Date().toISOString().slice(0,10)}
    open={summaryOpen}
    onToggle={function(){setSummaryOpen(function(o){return !o;});}}
    onOpenWeek={function(){setShowWeek(true);}} />;

  const delModal=confirmDel?<Overlay onClose={function(){setConfirmDel(null);}} footer={<div style={{display:"flex",justifyContent:"flex-end",gap:8}}><button
        className="mgt-hover-scale"
        style={mkBtn({minHeight:44,padding:"10px 18px",background:BTN.cancel})}
        onClick={function(){setConfirmDel(null);}}>Cancel</button><button
        onClick={function(){delBooking(confirmDel);}}
        className="mgt-hover-scale"
        style={{background:"var(--app-danger-solid)",border:"1px solid rgba(255,255,255,0.2)",borderRadius:14,padding:"10px 18px",cursor:"pointer",fontSize:14,fontWeight:600,color:"var(--text-on-accent)",minHeight:44,boxShadow:"0 2px 6px rgba(0,0,0,0.12), inset 0 1px 1px rgba(255,255,255,0.15)"}}>Delete</button></div>}><div style={{fontSize:17,fontWeight:700,marginBottom:8,color:S.text}}>Delete booking?</div><div style={{fontSize:14,color:S.text,marginBottom:18}}>Tables will be re-optimised after deletion.</div></Overlay>:null;

  const manualModal=manualBooking?<ManualModal
    booking={manualBooking}
    bookings={manualTarget==="__new__"?bookings.filter(function(b){return b.date===form.date;}):bookings}
    blocks={tableBlocks}
    onSave={function(tables,locked,affected){if(manualTarget==="__new__"){setForm(function(f){return Object.assign({},f,{manualTables:tables});});setSwapAffected(affected||null);setManualTarget(null);}else{manualAssign(manualBooking.id,tables,locked,affected);}}}
    onClose={function(){setManualTarget(null);}} />:null;

  const walkinModal=showWalkin?<WalkinForm
    draft={walkinForm}
    setDraft={setWalkinForm}
    error={walkinError}
    liveBookings={liveBookings}
    bookings={bookings}
    tableBlocks={tableBlocks}
    autoOptimizer={autoOptimizer}
    walkinNum={getNextWalkinNum()}
    isMobile={isMobile}
    onSave={saveWalkin}
    onClose={function(){setShowWalkin(false);}} />:null;

  const weekModal=showWeek?<WeekView
    bookings={bookings}
    viewDate={viewDate}
    onPick={function(d){setViewDate(d);setShowWeek(false);}}
    onClose={function(){setShowWeek(false);}} />:null;

  return (
    <div
      style={{background:"var(--bg-app)",minHeight:"100dvh",padding:isMobile?"12px 12px calc(12px + env(safe-area-inset-bottom))":"16px",fontFamily:"-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', 'Helvetica Neue', system-ui, sans-serif",color:S.text,boxSizing:"border-box"}}><div style={{maxWidth:1000,margin:"0 auto"}}><div
          style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12,flexWrap:"wrap",gap:8}}><div><div style={{fontSize:isMobile?18:22,fontWeight:700}}>Me Gustas Tú</div><div style={{fontSize:12,color:S.text,fontWeight:500}}>{INDOOR.length+" indoor  "+OUTDOOR.length+" outdoor  "+(hoursFor(viewDate).closed?"Closed":String(OPEN).padStart(2,"0")+":00 - "+String(CLOSE%24).padStart(2,"0")+":00")}</div></div><div style={{display:"flex",gap:6,flexWrap:"wrap"}}>{["timeline","list"].map(function(v){return (
              <button
                key={v}
                className="mgt-hover-scale"
                onClick={function(){setView(v);}}
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
              style={mkBtn({fontSize:12,minHeight:40,padding:"8px 14px",background:BTN.nav})}>Log out</button></div></div><div
          style={{display:"flex",alignItems:"flex-start",gap:8,marginBottom:12,flexWrap:"wrap"}}><div style={{display:"flex",gap:4,alignItems:"center"}}><button
              onClick={function(){const d=new Date(viewDate);d.setDate(d.getDate()-1);setViewDate(d.toISOString().slice(0,10));}}
              className="mgt-hover-scale"
              style={mkBtn({minHeight:40,minWidth:40,padding:"6px 10px",fontSize:18,background:BTN.nav})}
              dangerouslySetInnerHTML={{__html:"&#8249;"}} /><button
              onClick={function(){const d=new Date(viewDate);d.setDate(d.getDate()+1);setViewDate(d.toISOString().slice(0,10));}}
              className="mgt-hover-scale"
              style={mkBtn({minHeight:40,minWidth:40,padding:"6px 10px",fontSize:18,background:BTN.nav})}
              dangerouslySetInnerHTML={{__html:"&#8250;"}} /><input
              type="date"
              value={viewDate}
              onChange={function(e){setViewDate(e.target.value);}}
              className="mgt-hover-scale"
              style={{fontSize:14,padding:"8px 10px",borderRadius:12,border:"1px solid var(--app-date-border)",background:"var(--app-date-bg)",color:S.text,fontWeight:600,minWidth:130,minHeight:40,boxSizing:"border-box",boxShadow:"var(--shadow-input)"}} /></div><div style={{display:"flex",gap:6,alignItems:"center"}}>{viewDate!==new Date().toISOString().slice(0,10)?<button
              onClick={function(){setViewDate(new Date().toISOString().slice(0,10));}}
              className="mgt-hover-scale"
              style={mkBtn({minHeight:40,padding:"6px 14px",background:BTN.today})}>Today</button>:null}</div><div style={{flexGrow:1,flexShrink:1,flexBasis:isMobile?"100%":360,minWidth:0}}>{summaryPanel}</div></div>{!isOnline?<div
          style={{background:"var(--app-offline-bg)",border:"2px solid var(--app-offline-border)",borderRadius:14,padding:"10px 14px",marginBottom:10,fontSize:13,fontWeight:700,color:"var(--app-offline-text)",boxShadow:"0 1px 4px rgba(0,0,0,0.04)"}}>⚠ Working offline — your changes are saved locally and will sync when the connection returns. Keep this tab open.</div>:null}{reconnectShown?<div
          style={{background:"var(--app-reconnect-bg)",border:"2px solid var(--app-reconnect-border)",borderRadius:14,padding:"10px 14px",marginBottom:10,fontSize:13,fontWeight:600,color:"var(--app-reconnect-text)",boxShadow:"0 1px 4px rgba(0,0,0,0.04)"}}>✓ Reconnected — changes synced.</div>:null}{loadBannerShown?<div
          style={{background:"var(--suggest-bg)",border:"2px solid var(--suggest-border)",borderRadius:14,padding:"10px 14px",marginBottom:10,fontSize:13,fontWeight:600,color:"var(--success-text)",boxShadow:"0 1px 4px rgba(0,0,0,0.04)"}}>{"Firebase connected — "+(firstLoadCount.current||0)+" booking"+(firstLoadCount.current===1?"":"s")+" loaded."}</div>:null}{writeWarning?<div
          style={{background:"var(--danger-bg)",border:"2px solid var(--danger-border)",borderRadius:14,padding:"10px 14px",marginBottom:10,fontSize:13,fontWeight:700,color:"var(--danger-text)",display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,boxShadow:"0 1px 4px rgba(0,0,0,0.04)"}}><span>{"⚠ "+writeWarning}</span><button
            className="mgt-hover-scale"
            style={mkBtn({fontSize:12,background:"var(--app-btn-slate-dim)",minHeight:32,padding:"4px 12px"})}
            onClick={function(){setWriteWarning(null);}}>Dismiss</button></div>:null}{reshuffledBanner}{ineffBanner}{overlapBanner}{reminderBanners}{mainView}{showForm?<BookingFormModal
              form={form}
              setForm={setForm}
              editId={editId}
              error={error}
              bookings={bookings}
              liveBookings={liveBookings}
              tableBlocks={tableBlocks}
              autoOptimizer={autoOptimizer}
              isMobile={isMobile}
              onSave={save}
              onClose={function(){setShowForm(false);}}
              onClearSwap={function(){setSwapAffected(null);}}
              onBookAgain={bookAgain}
              onOpenPrefPicker={function(){setShowPrefPicker(true);}}
              onOpenManualAssign={function(target){setManualTarget(target);}}
              onOpenHistory={function(){setShowHistory(true);}}
              onRequestCancel={function(id){setConfirmCancel(id);}} />:null}{delModal}{manualModal}{walkinModal}{weekModal}{prefPickerModal}{blockTarget?<BlockModal
          tableId={blockTarget}
          date={viewDate}
          blocks={tableBlocks}
          onSave={addBlock}
          onRemove={removeBlock}
          onClose={function(){setBlockTarget(null);}} />:null}{confirmCancel?<Overlay onClose={function(){setConfirmCancel(null);}} footer={<div style={{display:"flex",justifyContent:"flex-end",gap:8,flexWrap:"wrap"}}><button
              className="mgt-hover-scale"
              style={mkBtn({minHeight:44,padding:"10px 18px",background:"var(--app-btn-slate)"})}
              onClick={function(){setConfirmCancel(null);}}>Back</button><button
              onClick={function(){doCancelBooking(confirmCancel,true);setShowForm(false);}}
              className="mgt-hover-scale"
              style={{background:"var(--app-warn-solid)",border:"1px solid rgba(255,255,255,0.2)",borderRadius:14,padding:"10px 18px",cursor:"pointer",fontSize:14,fontWeight:600,color:"var(--text-on-accent)",minHeight:44,boxShadow:"0 2px 6px rgba(0,0,0,0.12), inset 0 1px 1px rgba(255,255,255,0.15)"}}>No show</button><button
              onClick={function(){doCancelBooking(confirmCancel,false);setShowForm(false);}}
              className="mgt-hover-scale"
              style={{background:BLOCK_BG.cancelled,border:"1px solid rgba(255,255,255,0.2)",borderRadius:14,padding:"10px 18px",cursor:"pointer",fontSize:14,fontWeight:600,color:"var(--text-on-accent)",minHeight:44,boxShadow:"0 2px 6px rgba(0,0,0,0.12), inset 0 1px 1px rgba(255,255,255,0.15)"}}>Cancel booking</button></div>}><div style={{fontSize:17,fontWeight:700,marginBottom:8,color:S.text}}>Cancel booking?</div><div style={{fontSize:14,color:S.text,marginBottom:18}}>Tables will be re-optimised after cancellation.</div></Overlay>:null}{confirmKitchen?<Overlay onClose={function(){setConfirmKitchen(null);}} footer={<div style={{display:"flex",justifyContent:"flex-end",gap:8,flexWrap:"wrap"}}><button
              className="mgt-hover-scale"
              style={mkBtn({minHeight:44,padding:"10px 18px",background:"var(--app-btn-slate)"})}
              onClick={function(){setConfirmKitchen(null);}}>Back</button><button
              onClick={function(){const isW=confirmKitchen==="walkin";setConfirmKitchen(null);if(isW) doSaveWalkin();else doSave();}}
              className="mgt-hover-scale"
              style={{background:"var(--app-warn-solid)",border:"1px solid rgba(255,255,255,0.2)",borderRadius:14,padding:"10px 18px",cursor:"pointer",fontSize:14,fontWeight:600,color:"var(--text-on-accent)",minHeight:44,boxShadow:"0 2px 6px rgba(0,0,0,0.12), inset 0 1px 1px rgba(255,255,255,0.15)"}}>Confirm</button></div>}><div style={{fontSize:17,fontWeight:700,marginBottom:8,color:"var(--warn-text)"}}>Kitchen may be busy</div><div style={{fontSize:14,color:S.text,marginBottom:12}}>{"There are already "+(confirmKitchen==="walkin"?(function(){const wf=walkinForm;const t=wf.time||nowTime();const d=wf.customDur||getDur(Number(wf.size)||2);const l=getKitchenLoad(bookings,new Date().toISOString().slice(0,10),t,d,null);return l.starts+" booking"+(l.starts!==1?"s":"")+" with "+l.guests+" guest"+(l.guests!==1?"s":"");})():(function(){const f=formRef.current;const d=f.customDur||getDur(Number(f.size)||2);const l=getKitchenLoad(bookings,f.date,f.time,d,editId);return l.starts+" booking"+(l.starts!==1?"s":"")+" with "+l.guests+" guest"+(l.guests!==1?"s":"");})())+" starting at this time. Check the suggested alternatives below, or confirm to proceed anyway."}</div></Overlay>:null}{confirmReshuffle?<Overlay onClose={function(){setConfirmReshuffle(false);}} footer={<div style={{display:"flex",justifyContent:"flex-end",gap:8,flexWrap:"wrap"}}><button
              className="mgt-hover-scale"
              style={mkBtn({minHeight:44,padding:"10px 18px",background:"var(--app-btn-slate)"})}
              onClick={function(){setConfirmReshuffle(false);}}>Back</button><button
              onClick={function(){setConfirmReshuffle(false);forceReshuffle();}}
              className="mgt-hover-scale"
              style={{background:BTN.orange,border:"1px solid rgba(255,255,255,0.2)",borderRadius:14,padding:"10px 18px",cursor:"pointer",fontSize:14,fontWeight:600,color:"var(--text-on-accent)",minHeight:44,boxShadow:"0 2px 6px rgba(0,0,0,0.12), inset 0 1px 1px rgba(255,255,255,0.15)"}}>Reshuffle</button></div>}><div style={{fontSize:17,fontWeight:700,marginBottom:8,color:"var(--warn-text)"}}>Reshuffle all bookings?</div><div style={{fontSize:14,color:S.text,marginBottom:18}}>Confirmed bookings may be moved to different tables to improve efficiency. Seated bookings will not be moved.</div></Overlay>:null}{// v14 preview 3: Settings modal. Opened by the cog icon in TimelineView's
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
            layout={layout}
            onSaveLayout={saveLayout}
            tab={settingsTab}
            setTab={setSettingsTab}
            reminders={reminders}
            onAddReminder={openNewReminder}
            onEditReminder={openEditReminder}
            onDeleteReminder={deleteReminder}
            onToggleReminder={toggleReminderActive} /></Overlay>:null}{// v14 p7 fix: in-app reminder-delete confirmation (replaces broken
        // window.confirm which is blocked in sandboxed preview environments).
        // Renders on top of Settings in DOM order so it visually covers the list.
        confirmReminderDel?<Overlay onClose={function(){setConfirmReminderDel(null);}} footer={<div style={{display:"flex",justifyContent:"flex-end",gap:8,flexWrap:"wrap"}}><button
              className="mgt-hover-scale"
              style={mkBtn({minHeight:44,padding:"10px 18px",background:"var(--app-btn-slate)"})}
              onClick={function(){setConfirmReminderDel(null);}}>Back</button><button
              onClick={function(){doDeleteReminder(confirmReminderDel);}}
              className="mgt-hover-scale"
              style={{background:BTN.del,border:"1px solid rgba(255,255,255,0.2)",borderRadius:14,padding:"10px 18px",cursor:"pointer",fontSize:14,fontWeight:600,color:"var(--text-on-accent)",minHeight:44,boxShadow:"0 2px 6px rgba(0,0,0,0.12), inset 0 1px 1px rgba(255,255,255,0.15)"}}>Delete</button></div>}><div style={{fontSize:17,fontWeight:700,marginBottom:8,color:S.text}}>Delete reminder?</div><div style={{fontSize:14,color:S.text,marginBottom:18}}>This reminder will be permanently removed.</div></Overlay>:null}{// v14 p7: Reminder editor modal — sits on top of Settings (z=250 vs 200).
        reminderEditor?<ReminderEditor
          draft={reminderEditor.draft}
          setDraft={function(d){setReminderEditor(function(prev){return prev?Object.assign({},prev,{draft:d}):null;});}}
          onSave={saveReminderFromEditor}
          onCancel={function(){setReminderEditor(null);}}
          isNew={reminderEditor.id==="new"} />:null}{historyPopup}</div></div>
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
      style={{background:"var(--bg-app)",minHeight:"100dvh",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', 'Helvetica Neue', system-ui, sans-serif",color:S.text,fontSize:15}}>Loading...</div>
  );
  if(!user) return <LoginScreen />;
  return <BookingApp />;
}
