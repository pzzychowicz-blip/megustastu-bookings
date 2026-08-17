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
import { useState, useRef, useEffect, useMemo, lazy, Suspense } from "react";
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
  OPEN, CLOSE, KITCHEN_TABLE_LIMIT, BLOCK_BG, S, BTN, R, EMPTY_FORM, hoursFor, weekRange, INDOOR, OUTDOOR, ALL_TABLES, M, T, FW, IC } from "./lib/constants";

import {
  getDur, toMins, genId,
  histEntry, diffBooking,
  isLocked, isActive, statusOrder,
  getBlockSlots, canAssign, getBusy, overlaps, comboCapBest,
  getKitchenLoad,
  applyOpt,
  optimizerActiveFor, syncLiveDurations, applySeatedShift, findFreeSlot, bookingsAfterAction, occupancyEnd, padEnd,
  checkInefficent, verifyClean, findConflicts,
  nowTime,
  lateState, freeingSoon, rankCombosContaining, comboExistsFor,
  undoSnapshots, applyUndo
} from "./lib/booking-logic";

import { normalizePhone, hasRealPhone } from "./lib/customers";
import { sameDraft } from "./lib/drafts";
import { hourLabel } from "./lib/time-grid";
// v17.8.0: the waitlist placement pass — pure, extracted from this file so it
// can be unit-tested (tests/waitlist-match.test.js).
import { placeWaitlist } from "./lib/waitlist-match";


// ── Phase B1 (v15-refactor): UI atoms extracted to ./components/atoms.jsx ──
// First component file in the codebase using JSX syntax. App.jsx now also
// uses JSX (Phase C3b) so the original B1 note about RC()-vs-JSX
// compatibility no longer applies — both files share a single style.
import { Overlay, ModalTitle, mkBtn, Reveal, Presence, ModalPresence, SlideView } from "./components/atoms";
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
import { BellIcon, BellRingIcon, ChevronLeftIcon, ChevronRightIcon, CogIcon, LateIcon, OverlapIcon, SearchIcon, WaitIcon } from "./components/Icons";
// v17.5.0: Split View — the T/L/P buttons + their long-press/RMB gesture and
// split toolbar (ViewSwitcher), the two-pane container (SplitLayout) and the
// three-step setup popup (SplitMenu).
import { ViewSwitcher }  from "./components/ViewSwitcher";
import { SplitLayout }   from "./components/SplitLayout";
import { SplitMenu }     from "./components/SplitMenu";
const WeekView = lazyChunk(function(){return import("./components/WeekView").then(function(m){return {default:m.WeekView};});},"WeekView"); // v17.1.0: lazy (opened on demand)
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
import { useUserPrefs } from "./hooks/useUserPrefs";
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
// v17.3.3: the global keyboard shortcuts + the neutral-space List-deselect
// listener (the whole kbRef machinery) live in useKeyboardShortcuts.js now.
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { WaitlistPanel } from "./components/WaitlistPanel";
import { WaitAvailBanner } from "./components/WaitAvailBanner";
const SearchPanel = lazyChunk(function(){return import("./components/SearchPanel").then(function(m){return {default:m.SearchPanel};});},"SearchPanel"); // v17.1.0: lazy (opened on demand)
import { PlanView } from "./components/PlanView"; // v17.0.0: the floor-plan view
import { DaySheet } from "./components/DaySheet";


// ── App fingerprint (do not remove) ──────────────────────────────────────────
// Module-level identity record. Survives bundling/minification — the strings
// below remain readable in any deployed bundle. Referenced by the boot banner
// (window assignment + console.log) so the bundler cannot tree-shake it.
// Forensic evidence of origin if this code appears in an unauthorized deployment.
const __APP_SIGNATURE__={
  app:"Me Gustas Tú Booking System",
  version:"17.10.0",
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
// the OS live). MUST mirror the no-flash inline script in index.html — same key,
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
const SPLIT_KEY="mgt-split";
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
    if(localStorage.getItem("mgt-split-enabled")==="0") return null;   // master switch off
    if(typeof window!=="undefined"&&window.innerWidth<600) return null; // tablet/desktop only
    const s=JSON.parse(localStorage.getItem(SPLIT_KEY)||"null");
    if(!s||typeof s!=="object") return null;
    if(VIEW_ORD.indexOf(s.a)===-1||VIEW_ORD.indexOf(s.b)===-1||s.a===s.b) return null;
    if(s.dir!=="v"&&s.dir!=="h") return null;
    const r=Number(s.ratio);
    return {a:s.a,b:s.b,dir:s.dir,ratio:Number.isFinite(r)&&r>=0.2&&r<=0.8?r:0.5};
  }catch{return null;}
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
  // v17.2.0: initial zoom = the per-device "Default zoom" setting (was 1).
  const [timelineZoom, setTimelineZoom] = useState(() => readTlSettings().defaultZoom);
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
  function openForm(next){setFormBaseline(next);setForm(next);}
  // Which surface the discard confirm is asking about: "form" | "walkin" |
  // "manual" | "reminder" | "block" | "settings" | null. One shared modal, six
  // callers as of v17.8.0.
  const [confirmDiscard, setConfirmDiscard] = useState(null);
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
  const [confirmKitchen, setConfirmKitchen] = useState(null);
  const [showHistory, setShowHistory] = useState(false);
  const [showPrefPicker, setShowPrefPicker] = useState(false);
  // v14 preview 3: Settings / keyboard-shortcuts modal. Toggled by the cog
  // icon in TimelineView's legend row and by the `?` keyboard shortcut.
  const [showSettings, setShowSettings] = useState(false);
  const [showSearch, setShowSearch] = useState(false); // v16.3.0: global booking search panel
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
    loadBannerShown, reconnectShown, resyncing, bookingsReady,
    loadStalled, readError, hasConnected,
    firstLoadCount,
  } = usePersistence({ autoOptimizer, nowMins });
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
  // ── Reminders hook ──────────────────────────────────────────────────────────
  // Owns all reminder state, savers, listeners, handlers, and the
  // reminderBanners JSX. nowMins drives banner re-evaluation; setWriteWarning
  // (from usePersistence above) lets reminder save-refusals share the same
  // banner as booking save-refusals. Phase D2 (v14.1.9).
  // See ./hooks/useReminders.jsx.
  const {
    reminders,
    reminderEditor, setReminderEditor,
    reminderDirty,
    confirmReminderDel, setConfirmReminderDel,
    saveReminderFromEditor,
    doDeleteReminder,
    openNewReminder, openEditReminder,
    deleteReminder, toggleReminderActive,
    reminderBanners, reminderCount,
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
  const [reduceMotion,setReduceMotion]=useState(function(){
    try{return localStorage.getItem("mgt-reduce-motion")==="1";}catch{return false;}
  });
  function onToggleReduceMotion(){
    const next=!reduceMotion;
    try{
      if(next) localStorage.setItem("mgt-reduce-motion","1");
      else localStorage.removeItem("mgt-reduce-motion");
    }catch{/* ignore */}
    if(next) document.documentElement.dataset.motion="reduce";
    else delete document.documentElement.dataset.motion;
    setReduceMotion(next);
    saveUserPrefs({reduceMotion:next});   // v17.6.0: follows the account
  }
  // v17.1.2: per-device "Plan zoom & pan" (Settings → General). Theme pattern:
  // localStorage["mgt-plan-gestures"]="0" only when OFF (absent = on, the
  // default) — gates PlanView's wheel/pinch zoom, drag pan and double-tap reset.
  const [planGestures,setPlanGestures]=useState(function(){
    try{return localStorage.getItem("mgt-plan-gestures")!=="0";}catch{return true;}
  });
  function onTogglePlanGestures(){
    const next=!planGestures;
    try{
      if(next) localStorage.removeItem("mgt-plan-gestures");
      else localStorage.setItem("mgt-plan-gestures","0");
    }catch{/* ignore */}
    setPlanGestures(next);
    saveUserPrefs({planGestures:next});   // v17.6.0: follows the account
  }
  // v17.5.0: per-device "Lock navigation" (Settings → General). Theme pattern,
  // but INVERTED vs planGestures because the default is OFF — only the non-
  // default value is ever stored, so localStorage["mgt-nav-lock"]="1" means on
  // and an absent key means off. Drives the `shellFixed` layout below.
  const [navLocked,setNavLocked]=useState(function(){
    try{return localStorage.getItem("mgt-nav-lock")==="1";}catch{return false;}
  });
  function onToggleNavLock(){
    const next=!navLocked;
    try{
      if(next) localStorage.setItem("mgt-nav-lock","1");
      else localStorage.removeItem("mgt-nav-lock");
    }catch{/* ignore */}
    setNavLocked(next);
    saveUserPrefs({navLocked:next});      // v17.6.0: follows the account
  }
  // v17.5.0: per-device Split View master switch (Settings → General).
  // v17.5.0 correction: default ON (was off), so the RMB / press-and-hold
  // gesture works out of the box. That puts it back on the house convention —
  // key absent = default, only the non-default "0" is stored — same shape as
  // planGestures. (navLocked stays inverted; its default really is off.)
  // While off, the gesture on a view button does nothing at all.
  const [splitEnabled,setSplitEnabled]=useState(function(){
    try{return localStorage.getItem("mgt-split-enabled")!=="0";}catch{return true;}
  });
  function onToggleSplitEnabled(){
    const next=!splitEnabled;
    try{
      if(next) localStorage.removeItem("mgt-split-enabled");
      else{localStorage.setItem("mgt-split-enabled","0");localStorage.removeItem(SPLIT_KEY);}
    }catch{/* ignore */}
    setSplitEnabled(next);
    saveUserPrefs({splitEnabled:next});   // v17.6.0: the SWITCH syncs; the saved
    // split LAYOUT (which two views + ratio) stays per-device, see useUserPrefs.
    if(!next) setSplit(null); // turning the feature off must also leave any active split
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
    }else if(themePref!==undefined){
      // Only seed an EXPLICIT device preference. `undefined` means this device
      // follows the OS, which is the absence of a choice — writing it up would
      // freeze the user to whatever the OS happened to say at first login.
      seed.theme=themePref?"dark":"light";
    }
    if(userPrefs.reduceMotion!==null){
      const v=userPrefs.reduceMotion;
      try{ if(v) localStorage.setItem("mgt-reduce-motion","1"); else localStorage.removeItem("mgt-reduce-motion"); }catch{/* ignore */}
      if(v) document.documentElement.dataset.motion="reduce"; else delete document.documentElement.dataset.motion;
      setReduceMotion(v);
    }else seed.reduceMotion=reduceMotion;
    if(userPrefs.planGestures!==null){
      const v=userPrefs.planGestures;
      try{ if(v) localStorage.removeItem("mgt-plan-gestures"); else localStorage.setItem("mgt-plan-gestures","0"); }catch{/* ignore */}
      setPlanGestures(v);
    }else seed.planGestures=planGestures;
    if(userPrefs.navLocked!==null){
      const v=userPrefs.navLocked;
      try{ if(v) localStorage.setItem("mgt-nav-lock","1"); else localStorage.removeItem("mgt-nav-lock"); }catch{/* ignore */}
      setNavLocked(v);
    }else seed.navLocked=navLocked;
    if(userPrefs.splitEnabled!==null){
      const v=userPrefs.splitEnabled;
      try{ if(v) localStorage.removeItem("mgt-split-enabled"); else{localStorage.setItem("mgt-split-enabled","0");localStorage.removeItem(SPLIT_KEY);} }catch{/* ignore */}
      setSplitEnabled(v);
      if(!v) setSplit(null);
    }else seed.splitEnabled=splitEnabled;
    if(Object.keys(seed).length) saveUserPrefs(seed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[prefsLoaded]);
  const [focusedPane,setFocusedPane]=useState("a");
  const [splitMenuFor,setSplitMenuFor]=useState(null); // which view's SplitMenu is open
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
  // v17.1.0 perf: useMemo (was a per-render IIFE) — a fresh object every render
  // would defeat the React.memo on the views it feeds.
  const overlapWarnings=useMemo(function(){
    const today=new Date().toISOString().slice(0,10);
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
    const today=new Date().toISOString().slice(0,10);
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
  const [lateDismissed,setLateDismissed]=useState(function(){return new Set();});
  const lateBannerMap=useMemo(function(){
    if(lateDismissed.size===0) return lateMap;
    const map={};
    Object.keys(lateMap).forEach(function(id){if(!lateDismissed.has(id)) map[id]=lateMap[id];});
    return map;
  },[lateMap,lateDismissed]);
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
  const freeingList=useMemo(function(){
    const today=new Date().toISOString().slice(0,10);
    if(viewDate!==today||!bookingDefaults.freeSoonEnabled) return EMPTY_ARR;
    return freeingSoon(bookings,today,nowMins,bookingDefaults.freeSoonWindow||15);
  },[bookings,nowMins,viewDate,bookingDefaults]);
  const freeingMap=useMemo(function(){
    if(freeingList.length===0) return EMPTY_OBJ;
    const map={};
    freeingList.forEach(function(f){map[f.id]=f.inMin;});
    return map;
  },[freeingList]);

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
      todayStr:new Date().toISOString().slice(0,10),
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
  function deleteCustomer(phoneKey){
    const key=normalizePhone(phoneKey);
    if(!key) return;
    saveBookings(function(prev){return prev.map(function(b){
      if(normalizePhone(b.phone)!==key) return b;
      return Object.assign({},b,{name:"Data removed",phone:"",notes:"",history:[],anonymized:true});
    });});
    saveWaitlist(function(prev){return prev.filter(function(w){return normalizePhone(w.phone)!==key;});},true);
  }

  function openNew(){pendingWaitlistRef.current=null;openForm(Object.assign({},EMPTY_FORM,{date:viewDate,phone:generalSettings.phonePrefix,size:generalSettings.defaultBookingSize}));setEditId(null);setError("");setSwapAffected(null);setShowForm(true);}
  function openEdit(b){pendingWaitlistRef.current=null;openForm({name:b.name,phone:b.phone||generalSettings.phonePrefix,date:b.date,time:b.time,size:b.size,preference:b.preference,notes:b.notes||"",status:b.status,customDur:(b.originalDuration||b.duration)!==getDur(b.size)?(b.originalDuration||b.duration):null,deposit:b.deposit?String(b.deposit):"",manualTables:[],preferredTables:Array.isArray(b.preferredTables)?b.preferredTables.slice():[],returnOf:null,guestId:b.guestId||null,guestSeed:null});setEditId(b.id);setError("");setSwapAffected(null);setShowHistory(false);setShowForm(true);}
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
    openForm(Object.assign({},EMPTY_FORM,{
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
    showWalkin, setShowWalkin,
    walkinForm, setWalkinForm,
    walkinError, walkinDirty,
    getNextWalkinNum,
    openWalkin, saveWalkin, doSaveWalkin,
  } = useWalkin({
    bookings, saveBookings,
    setViewDate, getUser,
    confirmKitchen, setConfirmKitchen,
    defaultWalkinSize: generalSettings.defaultWalkinSize,
  });

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

  // v17.10.0: the guest-identity BACK-STAMP. Picking an unjoined phone-less
  // guest from the name dropdown mints `guestId` into the draft and records the
  // source booking in `guestSeed`; this writes the same id onto that source, so
  // the two bookings become one customer.
  //
  // It runs INSIDE buildNext/applyBase, i.e. as part of the same pure transform
  // the new/edited booking goes through, so both children ride ONE saveBookings
  // call: the v15.5.0 per-booking diff-write patches them together and the
  // per-$id CAS covers both. A separate write would be a second thing to fail.
  //
  // `!b.guestId` is the guard that makes a replay safe — a retry on fresh data
  // finds the stamp already there and leaves it alone, and it also means a
  // booking already belonging to another group is never silently re-homed.
  function stampGuestSeed(list,f){
    if(!f||!f.guestSeed||!f.guestId) return list;
    return list.map(function(b){
      if(b.id!==f.guestSeed||b.guestId) return b;
      return Object.assign({},b,{guestId:f.guestId});
    });
  }
  function doSaveEdit(f,v){
    const size=v.size,cleanPhone=v.cleanPhone,mt=v.mt;
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
        // v17.6.0: record how long they ACTUALLY stayed, so the List card can
        // show it after the visit (booking-logic's stayedMins). Computed for
        // EVERY seated→completed save, including the `f.customDur` case the
        // truncation above skips — how long the party sat is a fact about the
        // visit, independent of the duration the user chose to store. 0 leaves
        // the existing value alone (never overwrite a real stay with a blank).
        let saveStayed=orig?(Number(orig.stayedMin)||0):0;
        if(f.status==="completed"&&orig&&orig.status==="seated"){
          const nowD=new Date();
          saveStayed=Math.max(15,(nowD.getHours()*60+nowD.getMinutes())-toMins(f.time));
        }
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
        // v17.4.0: the diff string is computed ONCE — it feeds the history entry
        // AND the undo gate below. diffBooking returns the sentinel "saved (no
        // field changes)" when nothing moved, which is exactly when undo must
        // NOT be armed (saveBookings still returns true for an empty patch —
        // persist() skips the write but reports dispatched — so `ok` alone
        // would offer an Undo for a save that changed nothing).
        const editDiff=orig?diffBooking(orig,f,size):"";
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
          const upd=stampGuestSeed(prev,f).map(function(b){
            if(b.id===editId){
              let h=(b.history||[]).concat([editHist]);
              if(seatedShift) h=h.concat([histEntry("seated "+seatedShift.direction+": time adjusted "+seatedShift.oldTime+" → "+seatedShift.newTime,getUser())]);
              const unlockForOpt=needsR&&wasSeatedLocked&&!mt.length&&!clearM;
              return Object.assign({},b,{name:f.name,phone:cleanPhone,date:f.date,time:saveTime,scheduledTime:saveScheduledTime,size:size,duration:saveDur,originalDuration:saveOrigDurFinal,preference:f.preference,notes:f.notes,deposit:Math.max(0,Number(f.deposit)||0),status:unlockForOpt?"confirmed":f.status,tables:mt.length?mt:(clearM?[]:(!needsR?b.tables:[])),customDur:saveCustDur,stayedMin:saveStayed,guestId:f.guestId||b.guestId||null,_manual:mt.length>0?true:(clearM?false:b._manual),_locked:mt.length>0?true:(clearM?false:(unlockForOpt?false:b._locked)),preferredTables:Array.isArray(f.preferredTables)?f.preferredTables:[],history:h});
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
        const buildNextMemo=memoByPrev(buildNext);
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
        // v17.4.0: form edits are undoable — the pre-edit `orig` is the snapshot
        // (undo swaps it back in wholesale, incl. tables/status/duration).
        if(ok&&editChanged) armUndo(undoDelta(bookings,fin),editId,"edit",false);
        setShowForm(false);setViewDate(f.date);
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
        const nb={id:newId,name:f.name,phone:cleanPhone,date:f.date,time:f.time,scheduledTime:f.time,size:size,duration:dur,originalDuration:dur,preference:f.preference,notes:f.notes,deposit:Math.max(0,Number(f.deposit)||0),status:(f.status==="pending"?"pending":"confirmed"),tables:mt.length?mt:[],customDur:f.customDur||null,_manual:mt.length>0,_locked:mt.length>0,preferredTables:Array.isArray(f.preferredTables)?f.preferredTables:[],returnOf:returnOfId,recurringId:recStampId,recurringDate:recStampId?f.date:null,guestId:f.guestId||null,history:[createHist]};
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
        function buildNext(prev){return bookingsAfterAction(applyBase(prev).concat([nb]),f.date,tableBlocks,newId,!mt.length,autoOptimizer);}
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
        if(ok) flash();
        // v16.0.0: this new booking converted a waitlist entry (Book from the
        // panel) — remove the entry now the booking is dispatched (a held write
        // shows optimistically + auto-retries, so the intent stands either way).
        if(pendingWaitlistRef.current){removeFromWaitlist(pendingWaitlistRef.current);pendingWaitlistRef.current=null;}
        setShowForm(false);setViewDate(f.date);
  }
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
      if(mt.length&&!swapAffected){let ex=liveBookings.filter(function(b){return b.date===f.date&&b.status!=="cancelled"&&b.status!=="completed"&&b.id!==editId;}).map(function(b){return {tables:b.tables||[],s:toMins(b.time),e:occupancyEnd(b,nowMins)};});ex=ex.concat(getBlockSlots(tableBlocks,f.date));if(!canAssign(mt,ex,sm,padEnd(sm+dur))){setError("Selected tables are not available at this time.");return;}}
      if(editId) doSaveEdit(f,{size:size,dur:dur,cleanPhone:cleanPhone,mt:mt});
      else doSaveNew(f,{size:size,dur:dur,cleanPhone:cleanPhone,mt:mt});
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
        const os=toMins(other.time),oe=Math.max(occupancyEnd(other,nowMins),os+1);
        const slots=dayActive.filter(function(b){return b.id!==other.id&&(b.tables||[]).length>0;}).map(function(b){return {tables:b.tables,s:toMins(b.time),e:occupancyEnd(b,nowMins)};}).concat(blockSlots);
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
    if(ok){flash();armUndo(undoDelta(bookings,postDel),id,"delete",false);}}

  // v17.3.3: the global keyboard shortcuts (precedence rules, every key) and
  // the v17.3.1 neutral-space List-deselect mousedown listener were extracted
  // VERBATIM into hooks/useKeyboardShortcuts.js. This object is the hook's
  // latest-values context, refreshed every render (the original kbRef pattern —
  // the hook mounts its window listeners once and reads this through a ref).
  // Adding a shortcut = add the state/handler HERE and use it in the hook.
  useKeyboardShortcuts({
    // v17.5.0: in a split, every view-sensitive shortcut (S/C status, ↑/↓ list
    // nav, the neutral-space and Esc list-deselect, the zoom keys) must act on
    // the FOCUSED pane, not on the stale single-view `view`. Passing activeView
    // here means the whole hook is split-aware without touching each branch.
    view:activeView,setView:setView,goView:pickView,
    viewDate:viewDate,setViewDate:setViewDate,
    timelineZoom:timelineZoom,setTimelineZoom:setTimelineZoom,tlFollowZoom:tlSettings.followZoom,tlMaxZoom:tlSettings.maxZoom,
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
    bumpListFocus:bumpListFocus, // v17.3.1: ↑/↓ scrolls the focused card into view
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
          // v17.6.0: stamp the real stay so the List card can show it after the
          // visit (booking-logic's stayedMins). Only a genuine seated→completed
          // transition reaches here, which is exactly the gate the tag needs.
          extra.stayedMin=actualDur;
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
    function cancelTransform(b){const target=b.find(function(x){return x.id===id;});const d=target?target.date:viewDate;const updated=b.map(function(x){if(x.id!==id) return x;const extra={status:"cancelled",history:(x.history||[]).concat([histEntry(noShow?"no show":"cancelled",user)])};if(noShow){extra.noShow=true;extra.notes=(x.notes?x.notes+"\n":"")+"No show";}return Object.assign({},x,extra);});return bookingsAfterAction(updated,d,tableBlocks,null,false,autoOptimizer);}
    // v17.4.0: prev-identity memo (the doSave pattern) so the delta computed for
    // undo and the dispatched write share ONE optimizer pass.
    const cancelMemo=memoByPrev(cancelTransform);
    const post=cancelMemo(bookings);
    const ok=saveBookings(cancelMemo);
    setConfirmCancel(null);
    if(ok){
      flash();
      armUndo(undoDelta(bookings,post),id,"cancel",!!noShow);
    }
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
    const todayStr=new Date().toISOString().slice(0,10);
    return undoSnapshots(syncLiveDurations(prev,todayStr,nowMins),post);
  }
  function armUndo(snapshots,primaryId,kind,noShow){
    if(!snapshots||!snapshots.length) return;
    if(undoTimerRef.current) clearTimeout(undoTimerRef.current);
    setUndoInfo({snapshots:snapshots,primaryId:primaryId,kind:kind,noShow:!!noShow});
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
      const today=new Date().toISOString().slice(0,10);
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
    const todayStr2=new Date().toISOString().slice(0,10);
    return (viewDate===todayStr2?dayWaiting:waitlist.filter(function(w){return w&&w.status==="waiting"&&w.date===todayStr2;}).slice().sort(function(a,b){return (a.createdAt||0)-(b.createdAt||0);}))
      .filter(function(w){return !!waitAvail[w.id]&&!waitNotifyDismissed.has(w.id);});
  },[dayWaiting,waitlist,viewDate,waitAvail,waitNotifyDismissed]);
  function dismissWaitRow(id){setWaitNotifyDismissed(function(prev){const next=new Set(prev);next.add(id);return next;});}
  const hasWaitBanner=waitBannerEntries.length>0;

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
  // overlap means two parties are on one table; late is a guest problem;
  // reminders are scheduled prompts; the waitlist is an opportunity, not a
  // problem, so it sits last and stays green. The strip shows the first entry
  // as its collapsed summary, which makes "worst thing first" load-bearing.
  const notifSections=[].concat(
    appBannerSections({
      isOnline:isOnline,
      writeWarning:writeWarning,
      onDismissWarning:function(){setWriteWarning(null);},
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
      dayClosed:hoursFor(viewDate).closed
    }),
    hasOverlap?[{id:"overlap",tone:"var(--warn-text)",tint:"var(--app-overlap-bg)",icon:OverlapIcon,
      title:"Overlap warnings",count:Object.keys(overlapBannerMap).length,
      node:<OverlapBanner warnings={overlapBannerMap} bookings={bookings} onReassign={reassignBooking} onDismiss={dismissOverlapRow} />}]:[],
    hasLate?[{id:"late",tone:"var(--warn-text)",tint:"var(--app-overlap-bg)",icon:LateIcon,
      title:"Running late",count:Object.keys(lateBannerMap).length,
      node:<LateBanner lateMap={lateBannerMap} bookings={bookings} nowMins={nowMins} onNoShow={function(id){doCancelBooking(id,true);}} onDismiss={dismissLateRow} />}]:[],
    reminderCount?[{id:"reminders",tone:"var(--warn-text)",tint:"var(--app-overlap-bg)",icon:BellRingIcon,
      title:reminderCount===1?"Reminder":"Reminders",count:reminderCount,node:reminderBanners}]:[],
    hasWaitBanner?[{id:"wait",tone:"var(--success-text)",tint:"var(--suggest-bg-soft)",icon:WaitIcon,
      title:"Waitlist — table free",count:waitBannerEntries.length,
      node:<WaitAvailBanner entries={waitBannerEntries} availability={waitAvail} onBook={bookFromWaitlist} onDismiss={dismissWaitRow} />}]:[]
  );
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
    onRemove={removeFromWaitlist}
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
  viewActionsRef.current={openNew,openEdit,updateStatus,doCancelBooking,dropOnTable,openWalkin,toggleShowFinished,setManualTarget,setBlockTarget,setConfirmDel,setConfirmReshuffle,setSummaryOpen,setShowWeek,setSelectedListId,waitlist,bookFromWaitlist};
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
      onDelete:function(id){R.current.setConfirmDel(id);},
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
      onPrint:function(){window.print();}
    };
  });

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
    onEdit={VA.onEdit}
    onStatus={VA.onStatus}
    onNoShow={VA.onNoShow}
    onWalkin={VA.onWalkin}
    gesturesEnabled={planGestures}
    turnBuffer={turnBuffer}
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
    onEdit={VA.onEdit}
    onManual={VA.onManual}
    onStatus={VA.onStatus}
    onDropOnTable={VA.onDropOnTable}
    blocks={tableBlocks}
    onBlock={VA.onBlock}
    nowMins={nowMins}
    warnings={overlapWarnings}
    late={lateMap}
    freeing={freeingMap}
    onNoShow={VA.onNoShow}
    zoom={timelineZoom}
    setZoom={setTimelineZoom}
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
    currency={generalSettings.currency} />;
  const listEl=<ListView
    bookings={bookings}
    date={viewDate}
    onEdit={VA.onEdit}
    onStatus={VA.onStatus}
    onDelete={VA.onDelete}
    onManual={VA.onManual}
    nowMins={nowMins}
    warnings={overlapWarnings}
    late={lateMap}
    onNoShow={VA.onNoShow}
    selectedId={selectedListId}
    focusReq={listFocusReq}
    onSelect={VA.onSelect}
    showFinished={showFinished}
    onToggleFinished={VA.onToggleFinished}
    onNew={VA.onNew}
    // Walk-in only on TODAY: a walk-in is a party standing at the door now, so
    // offering it on a future day would open a form for the wrong date.
    onWalkin={viewDate===new Date().toISOString().slice(0,10)?VA.onWalkin:null}
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
      if(split[other]===v){applySplit(Object.assign({},split,{a:split.b,b:split.a}));setFocusedPane(other);return;}
      if(split[focusedPane]===v) return;
      applySplit(Object.assign({},split,{[focusedPane]:v}));
      return;
    }
    if(v!==view) bumpSlide(VIEW_ORD.indexOf(v)>VIEW_ORD.indexOf(view)?"mgt-view-in-right":"mgt-view-in-left");
    setView(v);
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
    isToday={viewDate===new Date().toISOString().slice(0,10)}
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
  const daySheet=<DaySheet bookings={bookings} date={viewDate} splitHour={dayShifts.split} waitlist={waitlist} blocks={tableBlocks} restaurantName={generalSettings.restaurantName} currency={generalSettings.currency} />;

  const delModal=<ModalPresence show={!!confirmDel}>{confirmDel?<Overlay onClose={function(){setConfirmDel(null);}} footer={<div style={{display:"flex",justifyContent:"flex-end",gap:8}}><button
        className="mgt-hover-scale"
        style={mkBtn({minHeight:44,padding:"10px 18px",background:BTN.cancel})}
        onClick={function(){setConfirmDel(null);}}>Cancel</button><button
        onClick={function(){delBooking(confirmDel);}}
        className="mgt-hover-scale"
        style={{background:"var(--app-danger-solid)",border:"1px solid rgba(255,255,255,0.2)",borderRadius:R.pill,padding:"10px 18px",cursor:"pointer",fontSize: T.lead,fontWeight: FW.semi,color:"var(--text-on-accent)",minHeight:44,boxShadow:"0 2px 6px rgba(0,0,0,0.12), inset 0 1px 1px rgba(255,255,255,0.15)"}}>Delete</button></div>}><h2 style={{fontSize: T.title,fontWeight: FW.bold,margin:0,marginBottom:8,color:S.text}}>Delete booking?</h2><div style={{fontSize: T.lead,color:S.text,marginBottom:18}}>Tables will be re-optimised after deletion.</div></Overlay>:null}</ModalPresence>;

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
  const discardModal=<div style={{position:"relative",zIndex:260}}><ModalPresence show={!!confirmDiscard}>{confirmDiscard?<Overlay onClose={function(){setConfirmDiscard(null);}} footer={<div style={{display:"flex",justifyContent:"flex-end",gap:8}}><button
        className="mgt-hover-scale"
        style={mkBtn({minHeight:44,padding:"10px 18px",background:"var(--app-btn-slate)"})}
        onClick={function(){setConfirmDiscard(null);}}>Keep editing</button><button
        onClick={doDiscard}
        className="mgt-hover-scale"
        style={{background:"var(--app-danger-solid)",border:"1px solid rgba(255,255,255,0.2)",borderRadius:R.pill,padding:"10px 18px",cursor:"pointer",fontSize: T.lead,fontWeight: FW.semi,color:"var(--text-on-accent)",minHeight:44,boxShadow:"0 2px 6px rgba(0,0,0,0.12), inset 0 1px 1px rgba(255,255,255,0.15)"}}>Discard</button></div>}><h2 style={{fontSize: T.title,fontWeight: FW.bold,margin:0,marginBottom:8,color:S.text}}>Discard unsaved changes?</h2><div style={{fontSize: T.lead,color:S.text,marginBottom:18}}>{DISCARD_BODY[confirmDiscard]||"Your changes haven't been saved yet."}</div></Overlay>:null}</ModalPresence></div>;

  const manualModal=<ModalPresence show={!!manualBooking}>{manualBooking?<ManualModal
    booking={manualBooking}
    bookings={manualTarget==="__new__"?bookings.filter(function(b){return b.date===form.date;}):bookings}
    blocks={tableBlocks}
    onSave={function(tables,locked,affected){if(manualTarget==="__new__"){setForm(function(f){return Object.assign({},f,{manualTables:tables});});setSwapAffected(affected||null);setManualTarget(null);}else{manualAssign(manualBooking.id,tables,locked,affected);}}}
    onDirty={setManualDirty}
    onClose={requestCloseManual} />:null}</ModalPresence>;

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
        shellFixed?{height:"100dvh",display:"flex",flexDirection:"column"}:{minHeight:"100dvh"})}><div style={Object.assign({maxWidth:appWidth,margin:"0 auto"},shellFixed?{flex:1,minHeight:0,width:"100%",display:"flex",flexDirection:"column"}:null)}>{/* v17.0.0 correction: adjustable per-device width (Settings→General; was fixed 1000, then 1600) */}<div
          style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12,flexWrap:"wrap",gap:8,flexShrink:0}}>{/* v17.9.0 (Patryk): the cog leads the title block. The two lines
              beside it ARE the restaurant's configuration read back — its name,
              its table counts, its opening hours — and the control that edits
              all three now sits against them instead of across the row in a
              toolbar. minWidth:0 so the title, not the cog, absorbs a squeeze. */}<div style={{display:"flex",alignItems:"center",gap:10,minWidth:0}}><button
              onClick={function(){setShowSettings(true);}}
              title="Settings & keyboard shortcuts"
              aria-label="Settings & keyboard shortcuts"
              className="mgt-hover-scale"
              style={CHROME_BTN}><CogIcon size={IC.chrome} /></button><div style={{minWidth:0}}><div style={{fontSize:isMobile?T.title:T.display,fontWeight: FW.bold}}>{generalSettings.restaurantName}</div><div style={{fontSize: T.body,color:S.text,fontWeight: FW.medium}}>{INDOOR.length+" indoor  "+OUTDOOR.length+" outdoor  "+(hoursFor(viewDate).closed?"Closed":hourLabel(OPEN)+" - "+hourLabel(CLOSE))}</div></div></div><div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center"}}><ViewSwitcher
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
              style={{background:"var(--app-walkin)",border:"1px solid rgba(255,255,255,0.2)",borderRadius:R.pill,padding:"8px 14px",fontSize: T.body,cursor:"pointer",fontWeight: FW.semi,color:"var(--text-on-accent)",minHeight:40,boxShadow:"0 1px 4px rgba(0,0,0,0.1), inset 0 1px 1px rgba(255,255,255,0.15)"}}>Walk-in</button><button
              onClick={openNew}
              className="mgt-hover-scale"
              style={{background:"var(--app-new)",border:"1px solid rgba(255,255,255,0.2)",borderRadius:R.pill,padding:"8px 14px",fontSize: T.body,cursor:"pointer",fontWeight: FW.semi,color:"var(--text-on-accent)",minHeight:40,boxShadow:"0 1px 4px rgba(0,0,0,0.1), inset 0 1px 1px rgba(255,255,255,0.15)"}}>+ New</button>{/* v17.9.0 (Patryk): Find-a-booking moved here from the date-nav
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
              wrapped to a third row on a phone. */}<ConnectionStatus connected={isOnline} hasConnected={hasConnected} userEmail={auth.currentUser&&auth.currentUser.email} devices={presenceDevices} myKey={presenceKey} offset={presenceOffset} onLogout={function(){signOut(auth);}} /></div></div><div
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
          style={{display:"flex",alignItems:"flex-start",gap:8,marginBottom:12,flexWrap:"wrap",flexShrink:0}}><div style={{display:"flex",gap:4,alignItems:"center",transform:dateCtrlShift,transition:"transform "+M.shift}}><button
              onClick={function(){const d=new Date(viewDate);d.setDate(d.getDate()-1);goToDate(d.toISOString().slice(0,10));}}
              className="mgt-hover-scale"
              style={mkBtn({minHeight:40,minWidth:40,padding:"6px 10px",fontSize: T.title,background:BTN.nav})}
              aria-label="Previous day"
              title="Previous day (←)"
              ><ChevronLeftIcon size={IC.chrome} /></button><button
              onClick={function(){const d=new Date(viewDate);d.setDate(d.getDate()+1);goToDate(d.toISOString().slice(0,10));}}
              className="mgt-hover-scale"
              style={mkBtn({minHeight:40,minWidth:40,padding:"6px 10px",fontSize: T.title,background:BTN.nav})}
              aria-label="Next day"
              title="Next day (→)"
              ><ChevronRightIcon size={IC.chrome} /></button><input
              type="date"
              value={viewDate}
              onChange={function(e){goToDate(e.target.value);}}
              className="mgt-hover-scale"
              style={{fontSize: T.lead,padding:"8px 10px",borderRadius:R.pill,border:"1px solid var(--app-date-border)",background:"var(--app-date-bg)",color:S.text,fontWeight: FW.semi,minWidth:130,minHeight:40,boxSizing:"border-box",boxShadow:"var(--shadow-input)"}} /></div><div style={{display:"flex",gap:6,alignItems:"center",transform:dateCtrlShift,transition:"transform "+M.shift}}><Presence show={viewDate!==new Date().toISOString().slice(0,10)} inClass="mgt-slide-in" outClass="mgt-slide-out" outMs={190} tag="span"><button
              onClick={function(){goToDate(new Date().toISOString().slice(0,10));}}
              className="mgt-hover-scale"
              style={mkBtn({minHeight:40,padding:"6px 14px",background:BTN.today})}>Today</button></Presence>{/* v16.0.0: waitlist badge — lives in the Today slot (to Today's right when
              Today is visible); the flex:1 Summary sibling absorbs the width change.
              Orange = a table currently fits someone waiting; slate = just waiting. */}
            <Presence show={dayWaiting.length>0} inClass="mgt-slide-in" outClass="mgt-slide-out" outMs={190} tag="span"><button
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
            <div style={shellFixed?Object.assign({flex:1,minHeight:0,display:"flex",flexDirection:"column"},
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
              split?{overflow:"hidden"}:{overflowY:"auto",overflowX:"hidden",WebkitOverflowScrolling:"touch",marginInline:"-4%",paddingInline:"4%",paddingBlock:12}):undefined}><Reveal show={notifSections.length>0}>{/* null, not an empty strip: Reveal caches its last truthy
                  children, so the pane fades out fully drawn instead of blanking a
                  frame and then collapsing an empty box. */}{notifSections.length?<NotificationStrip sections={notifSections} collapseMax={generalSettings.lateCollapseMax} lidIcon={BellIcon} />:null}</Reveal><div style={shellFixed?{position:"relative",flex:1,minHeight:0,display:"flex",flexDirection:"column"}:{position:"relative"}}><StatusToasts
                bookingsReady={bookingsReady}
                loadStalled={loadStalled}
                resyncing={resyncing}
                reconnectShown={reconnectShown}
                syncFix={syncFix}
                waitAddedShown={waitAddedShown}
                undoInfo={undoInfo}
                onUndo={undoLastAction}
                undoNote={reshuffled&&optimizerActiveFor(viewDate,autoOptimizer)?"tables re-optimised":""}
                dragMsg={dragMsg}
                reshuffled={reshuffled}
                reshuffledMsg={optimizerActiveFor(viewDate,autoOptimizer)?"Tables re-optimised.":"Booking saved."}
                loadShown={loadBannerShown}
                loadMsg={"Firebase connected — "+(firstLoadCount.current||0)+" booking"+(firstLoadCount.current===1?"":"s")+" loaded."} /><SlideView key={slide.k} dir={slide.dir} fill={shellFixed}>{split?<SplitLayout
                dir={split.dir}
                ratio={split.ratio}
                onRatio={setSplitRatio}
                focused={focusedPane}
                onFocus={setFocusedPane}
                paneA={viewEl[split.a]}
                paneB={viewEl[split.b]} />:mainView}</SlideView></div></div>{splitMenuFor?<SplitMenu
              view={splitMenuFor}
              onConfirm={confirmSplit}
              onClose={function(){setSplitMenuFor(null);}} />:null}<ModalPresence show={showForm}>{showForm?<BookingFormModal
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
              onClose={requestCloseForm}
              onClearSwap={function(){setSwapAffected(null);}}
              onBookAgain={bookAgain}
              onOpenPrefPicker={function(){setShowPrefPicker(true);}}
              onOpenManualAssign={function(target){setManualTarget(target);}}
              onOpenHistory={function(){setShowHistory(true);}}
              onRequestCancel={function(id){setConfirmCancel(id);}}
              onRequestDelete={function(id){setConfirmDel(id);}}
              onAddToWaitlist={addFormToWaitlist}
              standingEnabled={recurring.enabled!==false} />:null}</ModalPresence>{delModal}{manualModal}{walkinModal}{discardModal}{weekModal}{prefPickerModal}{waitlistModal}{daySheet}<ModalPresence show={showSearch}>{showSearch?<Suspense fallback={null}><SearchPanel bookings={bookings} todayStr={new Date().toISOString().slice(0,10)} onPick={function(b){setShowSearch(false);setView("list");if(b.date===viewDate){setSelectedListId(b.id);const fin=b.status==="completed"||b.status==="cancelled";setShowFinished(fin);bumpListFocus();}else{pendingSelectRef.current=b.id;goToDate(b.date);}}} onClose={function(){setShowSearch(false);}} /></Suspense>:null}</ModalPresence><ModalPresence show={!!blockTarget}>{blockTarget?<BlockModal
          tableId={blockTarget}
          date={viewDate}
          blocks={tableBlocks}
          onSave={addBlock}
          onRemove={removeBlock}
          onDirty={setBlockDirty}
          onClose={requestCloseBlock} />:null}</ModalPresence><ModalPresence show={!!confirmCancel}>{confirmCancel?<Overlay onClose={function(){setConfirmCancel(null);}} footer={<div style={{display:"flex",justifyContent:"flex-end",gap:8,flexWrap:"wrap"}}><button
              className="mgt-hover-scale"
              style={mkBtn({minHeight:44,padding:"10px 18px",background:"var(--app-btn-slate)"})}
              onClick={function(){setConfirmCancel(null);}}>Back</button><button
              onClick={function(){doCancelBooking(confirmCancel,true);setShowForm(false);}}
              className="mgt-hover-scale"
              style={{background:"var(--app-warn-solid)",border:"1px solid rgba(255,255,255,0.2)",borderRadius:R.pill,padding:"10px 18px",cursor:"pointer",fontSize: T.lead,fontWeight: FW.semi,color:"var(--text-on-accent)",minHeight:44,boxShadow:"0 2px 6px rgba(0,0,0,0.12), inset 0 1px 1px rgba(255,255,255,0.15)"}}>No show</button><button
              onClick={function(){doCancelBooking(confirmCancel,false);setShowForm(false);}}
              className="mgt-hover-scale"
              style={{background:BLOCK_BG.cancelled,border:"1px solid rgba(255,255,255,0.2)",borderRadius:R.pill,padding:"10px 18px",cursor:"pointer",fontSize: T.lead,fontWeight: FW.semi,color:"var(--text-on-accent)",minHeight:44,boxShadow:"0 2px 6px rgba(0,0,0,0.12), inset 0 1px 1px rgba(255,255,255,0.15)"}}>Cancel booking</button></div>}><h2 style={{fontSize: T.title,fontWeight: FW.bold,margin:0,marginBottom:8,color:S.text}}>Cancel booking?</h2><div style={{fontSize: T.lead,color:S.text,marginBottom:18}}>Tables will be re-optimised after cancellation.</div></Overlay>:null}</ModalPresence><ModalPresence show={!!confirmKitchen}>{confirmKitchen?<Overlay onClose={function(){setConfirmKitchen(null);}} footer={<div style={{display:"flex",justifyContent:"flex-end",gap:8,flexWrap:"wrap"}}><button
              className="mgt-hover-scale"
              style={mkBtn({minHeight:44,padding:"10px 18px",background:"var(--app-btn-slate)"})}
              onClick={function(){setConfirmKitchen(null);}}>Back</button><button
              onClick={function(){const isW=confirmKitchen==="walkin";setConfirmKitchen(null);if(isW) doSaveWalkin();else doSave();}}
              className="mgt-hover-scale"
              style={{background:"var(--app-warn-solid)",border:"1px solid rgba(255,255,255,0.2)",borderRadius:R.pill,padding:"10px 18px",cursor:"pointer",fontSize: T.lead,fontWeight: FW.semi,color:"var(--text-on-accent)",minHeight:44,boxShadow:"0 2px 6px rgba(0,0,0,0.12), inset 0 1px 1px rgba(255,255,255,0.15)"}}>Confirm</button></div>}><h2 style={{fontSize: T.title,fontWeight: FW.bold,margin:0,marginBottom:8,color:"var(--warn-text)"}}>Kitchen may be busy</h2><div style={{fontSize: T.lead,color:S.text,marginBottom:12}}>{"There are already "+(confirmKitchen==="walkin"?(function(){const wf=walkinForm;const t=wf.time||nowTime();const d=wf.customDur||getDur(Number(wf.size)||2);const l=getKitchenLoad(bookings,new Date().toISOString().slice(0,10),t,d,null);return l.starts+" booking"+(l.starts!==1?"s":"")+" with "+l.guests+" guest"+(l.guests!==1?"s":"");})():(function(){const f=formRef.current;const d=f.customDur||getDur(Number(f.size)||2);const l=getKitchenLoad(bookings,f.date,f.time,d,editId);return l.starts+" booking"+(l.starts!==1?"s":"")+" with "+l.guests+" guest"+(l.guests!==1?"s":"");})())+" starting at this time. Check the suggested alternatives below, or confirm to proceed anyway."}</div></Overlay>:null}</ModalPresence><ModalPresence show={confirmReshuffle}>{confirmReshuffle?<Overlay onClose={function(){setConfirmReshuffle(false);}} footer={<div style={{display:"flex",justifyContent:"flex-end",gap:8,flexWrap:"wrap"}}><button
              className="mgt-hover-scale"
              style={mkBtn({minHeight:44,padding:"10px 18px",background:"var(--app-btn-slate)"})}
              onClick={function(){setConfirmReshuffle(false);}}>Back</button><button
              onClick={function(){setConfirmReshuffle(false);forceReshuffle();}}
              className="mgt-hover-scale"
              style={{background:BTN.orange,border:"1px solid rgba(255,255,255,0.2)",borderRadius:R.pill,padding:"10px 18px",cursor:"pointer",fontSize: T.lead,fontWeight: FW.semi,color:"var(--text-on-accent)",minHeight:44,boxShadow:"0 2px 6px rgba(0,0,0,0.12), inset 0 1px 1px rgba(255,255,255,0.15)"}}>Reshuffle</button></div>}><h2 style={{fontSize: T.title,fontWeight: FW.bold,margin:0,marginBottom:8,color:"var(--warn-text)"}}>Reshuffle all bookings?</h2><div style={{fontSize: T.lead,color:S.text,marginBottom:18}}>Confirmed bookings may be moved to different tables to improve efficiency. Seated bookings will not be moved.</div></Overlay>:null}</ModalPresence><ModalPresence show={showSettings}>{// v14 preview 3: Settings modal. Opened by the cog icon in TimelineView's
        // legend row or by pressing `?` anywhere no modal is open.
        // v14 preview 7: now tabbed (General / Reminders / Shortcuts). Tab state
        // resets to 'general' on close so reopens feel fresh.
        showSettings?<Overlay onClose={requestCloseSettings} footer={<div style={{display:"flex",justifyContent:"flex-end"}}><button
              className="mgt-hover-scale"
              style={mkBtn({minHeight:40,padding:"8px 18px",background:"var(--app-btn-slate)"})}
              onClick={requestCloseSettings}>Close</button></div>}><ModalTitle background="var(--app-btn-grey-strong)">Settings</ModalTitle><Suspense fallback={null}><SettingsContent
            appVersion={__APP_SIGNATURE__.version}
            onDirty={setSettingsDirty}
            isDark={isDark}
            onToggleDark={onToggleDark}
            appWidth={appWidth}
            onSetAppWidth={onSetAppWidth}
            reduceMotion={reduceMotion}
            onToggleReduceMotion={onToggleReduceMotion}
            navLocked={navLocked}
            onToggleNavLock={onToggleNavLock}
            splitEnabled={splitEnabled}
            onToggleSplitEnabled={onToggleSplitEnabled}
            planGestures={planGestures}
            onTogglePlanGestures={onTogglePlanGestures}
            tlSettings={tlSettings}
            onSetTlSetting={onSetTlSetting}
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
            onToggleReminder={toggleReminderActive} /></Suspense></Overlay>:null}</ModalPresence><ModalPresence show={!!confirmReminderDel}>{// v14 p7 fix: in-app reminder-delete confirmation (replaces broken
        // window.confirm which is blocked in sandboxed preview environments).
        // Renders on top of Settings in DOM order so it visually covers the list.
        confirmReminderDel?<Overlay onClose={function(){setConfirmReminderDel(null);}} footer={<div style={{display:"flex",justifyContent:"flex-end",gap:8,flexWrap:"wrap"}}><button
              className="mgt-hover-scale"
              style={mkBtn({minHeight:44,padding:"10px 18px",background:"var(--app-btn-slate)"})}
              onClick={function(){setConfirmReminderDel(null);}}>Back</button><button
              onClick={function(){doDeleteReminder(confirmReminderDel);}}
              className="mgt-hover-scale"
              style={{background:BTN.del,border:"1px solid rgba(255,255,255,0.2)",borderRadius:R.pill,padding:"10px 18px",cursor:"pointer",fontSize: T.lead,fontWeight: FW.semi,color:"var(--text-on-accent)",minHeight:44,boxShadow:"0 2px 6px rgba(0,0,0,0.12), inset 0 1px 1px rgba(255,255,255,0.15)"}}>Delete</button></div>}><h2 style={{fontSize: T.title,fontWeight: FW.bold,margin:0,marginBottom:8,color:S.text}}>Delete reminder?</h2><div style={{fontSize: T.lead,color:S.text,marginBottom:18}}>This reminder will be permanently removed.</div></Overlay>:null}</ModalPresence><ModalPresence show={!!reminderEditor}>{// v14 p7: Reminder editor modal — sits on top of Settings (z=250 vs 200).
        reminderEditor?<ReminderEditor
          draft={reminderEditor.draft}
          setDraft={function(d){setReminderEditor(function(prev){return prev?Object.assign({},prev,{draft:d}):null;});}}
          onSave={saveReminderFromEditor}
          onCancel={requestCloseReminderEditor}
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
      style={{background:"var(--bg-app)",minHeight:"100dvh",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"var(--font-app)",color:S.text,fontSize: T.lead}}>Loading...</div>
  );
  if(!user) return <LoginScreen />;
  // v17.6.0: `key={user.uid}` remounts BookingApp on an account switch, so a
  // previous user's per-device state can't survive into the next session; the
  // uid also feeds useUserPrefs' per-account node.
  return <BookingApp uid={user.uid} key={user.uid} />;
}
