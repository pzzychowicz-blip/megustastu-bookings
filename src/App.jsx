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
import React, { useState, useRef, useEffect } from "react";
import { ref, onValue, set } from "firebase/database";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { db, auth } from "./firebase";

// ── Phase A extraction (v15-refactor) ────────────────────────────────────────
// Pure data and pure logic moved into ./lib/* modules. Symbols below are now
// imported rather than defined inline. Behaviour and signatures are unchanged.
//
// Phase C2 (v15-refactor): import lists pruned to only what App.jsx actually
// references in its body. Symbols only used inside ./components/* and
// ./lib/* modules are no longer imported here — they're imported directly
// by their own consumers. Eliminates 31 leftover dead imports from B1–B5.
import {
  OPEN, CLOSE, KITCHEN_TABLE_LIMIT, BLOCK_BG, S, BTN, EMPTY_FORM
} from "./lib/constants";

import {
  getDur, toMins, toTime, genId,
  sanitize, histEntry, diffBooking, sanitizeAll,
  isLocked, isActive,
  getBlockSlots, canAssign,
  trialFits, findTimes, formatSugg,
  getKitchenLoad, findKitchenFriendlyTimes,
  applyOpt,
  optimizerActiveFor, syncLiveDurations, applySeatedShift, findFreeSlot, bookingsAfterAction,
  checkInefficent,
  nowTime
} from "./lib/booking-logic";

import {
  reminderAppliesTo, getActiveReminderBanners,
  pruneOldReminderFires, validateReminderDraft
} from "./lib/reminders";


// ── Phase B1 (v15-refactor): UI atoms extracted to ./components/atoms.jsx ──
// First component file in the codebase using JSX syntax. App.jsx itself stays
// in RC() style for now; atoms render correctly when called from RC()
// because React.createElement accepts any component reference.
import {
  Overlay, Fld, Section, TBadge,
  AvailBanner, mkInp, mkBtn
} from "./components/atoms";


// ── Phase B2 (v15-refactor): secondary modals + table grid ─────────────────
// TableGrid (the 13-table picker), ManualModal (assign/swap UI), and
// BlockModal (table-level block editor) extracted to ./components/. Each is
// JSX (matching atoms.jsx style template). App.jsx still calls them via
// `RC(Component, props)` — RC works with any component reference.
import { TableGrid }   from "./components/TableGrid";
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
// card list) extracted to ./components/. JSX style. App.jsx still calls them
// via `RC(Component, props)` — RC works with any component reference.
// CogIcon (originally imported by App.jsx in B3) moved to TimelineView's
// imports because TimelineView is its only consumer.
import { TimelineView } from "./components/TimelineView";
import { ListView }     from "./components/ListView";

// ── Phase B5 (v15-refactor): Final modal & screen extraction ──────────────
// LoginScreen (the unauthenticated entry screen), WalkinForm (the walk-in
// flow), PrefPickerModal (the preferred-tables soft-hint picker), and
// HistoryPopup (the per-booking audit trail) extracted to ./components/.
// JSX style. App.jsx still calls them via `RC(Component, props)` — RC works
// with any component reference. BookingForm intentionally NOT extracted in
// this phase: its dependency on ~25 closure values would force an 18+ prop
// API, which is the wrong shape for a structural-only refactor. Deferred to
// Phase C, when proper context wiring will reduce that to a clean 4–5 props.
import { LoginScreen }     from "./components/LoginScreen";
import { WalkinForm }      from "./components/WalkinForm";
import { PrefPickerModal } from "./components/PrefPickerModal";
import { HistoryPopup }    from "./components/HistoryPopup";


// ── Phase C2 (v15-refactor): custom hooks extracted to ./hooks/ ───────────
// `useWinW` (viewport-width hook used to compute isMobile) moved out of
// App.jsx. One hook per file in src/hooks/, mirroring the components/
// pattern. No barrel index — explicit imports keep dependencies visible.
import { useWinW } from "./hooks/useWinW";


// ── App fingerprint (do not remove) ──────────────────────────────────────────
// Module-level identity record. Survives bundling/minification — the strings
// below remain readable in any deployed bundle. Referenced by the boot banner
// (window assignment + console.log) so the bundler cannot tree-shake it.
// Forensic evidence of origin if this code appears in an unauthorized deployment.
var __APP_SIGNATURE__={
  app:"Me Gustas Tú Booking System",
  version:"14.1.3",
  author:"Patryk Zychowicz",
  contact:"pz.zychowicz@gmail.com",
  copyright:"© 2026 Patryk Zychowicz. All rights reserved.",
  license:"Proprietary — All rights reserved. See LICENSE.",
  build:"v14.1.3-deployment"
};
if(typeof window!=="undefined"){window.__MGT_BUILD__=__APP_SIGNATURE__;}

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

// ── v14 Deployment — Firebase + auth integrated ───────────────────────────────
// This file is the production target for v14. All v14 preview work is overlaid
// on top of v13 dev: Book Again, Overlap Reassign fix, Seated-shift on
// Confirmed→Seated, Settings cog & tabbed modal, full keyboard shortcuts,
// thicker grid lines, and the v14 preview 7 Reminder system.
// v14.1: connection-status banner, IP protection layer (header, LICENSE,
// fingerprint, console banner, visible credit in Settings).
// v14.1.1: file-split refactor complete (B1–B5).
// v14.1.2: helper consolidation (Phase C1) — getCapOf, pct, statusOrder,
// liveDur, nowTime promoted to lib/booking-logic.js; unused blockEl ref
// dropped; Follow button label fixed (Following / Follow).
// v14.1.3: useWinW hook extracted to ./hooks/useWinW.js (Phase C2);
// 31 leftover dead imports cleaned up from App.jsx import block.
// In-app version label (General tab in Settings): "version 14.1.3".


var RC=React.createElement;


// ── Booking App ───────────────────────────────────────────────────────────────
function BookingApp(){
  var bs=useState([]);var bookings=bs[0],setBookings=bs[1];
  var tbs=useState([]);var tableBlocks=tbs[0],setTableBlocks=tbs[1];
  // ── Firebase write-guard system ─────────────────────────────────────────────
  // These refs track whether we've received AT LEAST ONE onValue callback from
  // Firebase for each path. Until that's happened, React state is [] / {}
  // regardless of what's in Firebase — writing that empty state would wipe
  // real data. Save helpers REFUSE to write until their respective
  // dataLoaded ref is true. This is the critical safety net added after the
  // v13 first-deploy incident where empty in-memory state was persisted to
  // Firebase before the read listener had fired.
  var bookingsLoaded=useRef(false);
  var blocksLoaded=useRef(false);
  // v14 p7 deployment: same write-guard pattern applied to reminder data.
  var remindersLoaded=useRef(false);
  var reminderFiresLoaded=useRef(false);
  var ws=useState(null);var writeWarning=ws[0],setWriteWarning=ws[1];
  var lbs=useState(false);var loadBannerShown=lbs[0],setLoadBannerShown=lbs[1];
  var firstLoadCount=useRef(null); // number of bookings on first successful load
  // v14.1: Connection-status state. isOnline drives the amber offline banner;
  // reconnectShown is a brief 4-second blue flash after offline→online.
  // hasConnectedRef gates BOTH banners so we never show "offline" before
  // the very first successful Firebase connection (avoids a false flash on boot).
  var ots=useState(true);var isOnline=ots[0],setIsOnline=ots[1];
  var rrs=useState(false);var reconnectShown=rrs[0],setReconnectShown=rrs[1];
  var hasConnectedRef=useRef(false);
  // Ensure optimal viewport scaling on all devices
  useEffect(function(){
    var meta=document.querySelector('meta[name="viewport"]');
    if(!meta){meta=document.createElement("meta");meta.name="viewport";document.head.appendChild(meta);}
    meta.content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover";
    document.documentElement.style.cssText="height:100%;overflow:hidden;";
    document.body.style.cssText="height:100%;overflow:auto;margin:0;-webkit-overflow-scrolling:touch;overscroll-behavior:none;";
    return function(){document.documentElement.style.cssText="";document.body.style.cssText="";};
  },[]);
  // Firebase save helpers — write-on-action only (prevents multi-device data corruption).
  // GUARDED: will refuse to write until Firebase has sent us the initial snapshot.
  // GUARDED: will refuse to overwrite non-empty Firebase with an empty in-memory array
  //   unless firstLoadCount was also 0 (i.e. DB is genuinely new/empty).
  // If `isSilent` is true, refusals only log to console — no user-facing warning.
  // If `isSilent` is false/omitted (default = user action), refusals also surface a red banner.
  // This keeps harmless mount-time effect calls quiet (auto-extend passes isSilent=true)
  // while still alerting on real user-blocked saves.
  function saveBookings(next,isSilent){
    function persist(computed){
      if(!bookingsLoaded.current){
        console.warn("[SAFE] Refused to write bookings — initial read has not completed yet.");
        if(!isSilent) setWriteWarning("Refused to write: Firebase not yet connected. If this persists, reload the page.");
        return;
      }
      if(Array.isArray(computed)&&computed.length===0&&firstLoadCount.current!==null&&firstLoadCount.current>0){
        console.warn("[SAFE] Refused to write empty bookings array — Firebase had "+firstLoadCount.current+" entries on load. This is a safety check against accidental wipe.");
        if(!isSilent) setWriteWarning("Refused to write empty data. Reload the page and try again. If you intended to delete everything, contact support.");
        return;
      }
      set(ref(db,"bookings"),computed).catch(function(){});
    }
    if(typeof next==="function"){
      setBookings(function(prev){var computed=next(prev);persist(computed);return computed;});
    } else {
      setBookings(next);persist(next);
    }
  }
  function saveBlocks(next,isSilent){
    function persist(computed){
      if(!blocksLoaded.current){
        console.warn("[SAFE] Refused to write tableBlocks — initial read has not completed yet.");
        return;
      }
      set(ref(db,"tableBlocks"),computed).catch(function(){});
    }
    if(typeof next==="function"){
      setTableBlocks(function(prev){var computed=next(prev);persist(computed);return computed;});
    } else {
      setTableBlocks(next);persist(next);
    }
  }
  // Firebase real-time listeners — read only, never write back.
  // The `bookingsLoaded.current=true` line MUST run on every callback, including
  // when val is null (truly empty DB), otherwise saves would stay blocked forever
  // on a brand-new database.
  useEffect(function(){
    var unsub=onValue(ref(db,"bookings"),function(snap){
      var val=snap.val();
      var arr=val?sanitizeAll(val):[];
      setBookings(arr);
      if(firstLoadCount.current===null){
        firstLoadCount.current=arr.length;
        setLoadBannerShown(true);
      }
      bookingsLoaded.current=true;
    });
    return unsub;
  },[]);
  useEffect(function(){
    var unsub=onValue(ref(db,"tableBlocks"),function(snap){
      var val=snap.val();
      if(val){var arr=Array.isArray(val)?val:Object.values(val);setTableBlocks(arr.filter(Boolean));}
      else setTableBlocks([]);
      blocksLoaded.current=true;
    });
    return unsub;
  },[]);
  // Auto-hide the first-load banner after 6 seconds
  useEffect(function(){
    if(!loadBannerShown) return;
    var t=setTimeout(function(){setLoadBannerShown(false);},6000);
    return function(){clearTimeout(t);};
  },[loadBannerShown]);
  // v14.1: Subscribe to Firebase's special .info/connected ref. Drives the
  // offline banner and the reconnected flash. The hasConnectedRef gate makes
  // sure the offline banner never shows before the first successful handshake.
  useEffect(function(){
    var unsub=onValue(ref(db,".info/connected"),function(snap){
      var connected=snap.val()===true;
      if(connected){
        if(!hasConnectedRef.current){
          // First successful connection on boot — silent.
          hasConnectedRef.current=true;
          setIsOnline(true);
          return;
        }
        // Reconnect after a real outage.
        setIsOnline(true);
        setReconnectShown(true);
        setTimeout(function(){setReconnectShown(false);},4000);
      } else {
        if(hasConnectedRef.current) setIsOnline(false);
      }
    });
    return unsub;
  },[]);

  var vs=useState("timeline");var view=vs[0],setView=vs[1];
  var zms=useState(1);var timelineZoom=zms[0],setTimelineZoom=zms[1];
  var timelineScrollRef=useRef(0);
  var fns=useState(false);var followNow=fns[0],setFollowNow=fns[1];
  var bts=useState(null);var blockTarget=bts[0],setBlockTarget=bts[1];
  var vds=useState(new Date().toISOString().slice(0,10));var viewDate=vds[0],setViewDate=vds[1];
  var sfs=useState(false);var showForm=sfs[0],setShowForm=sfs[1];
  var fms=useState(EMPTY_FORM);var form=fms[0],setForm=fms[1];
  var eis=useState(null);var editId=eis[0],setEditId=eis[1];
  var ers=useState("");var error=ers[0],setError=ers[1];
  var cds=useState(null);var confirmDel=cds[0],setConfirmDel=cds[1];
  var crs=useState(false);var confirmReshuffle=crs[0],setConfirmReshuffle=crs[1];
  var ccs=useState(null);var confirmCancel=ccs[0],setConfirmCancel=ccs[1];
  var rss=useState(false);var reshuffled=rss[0],setReshuffled=rss[1];
  var mts=useState(null);var manualTarget=mts[0],setManualTarget=mts[1];
  var dis=useState(null);var dismissedIneff=dis[0],setDismissedIneff=dis[1];
  var formRef=useRef(EMPTY_FORM);
  var sas=useState(null);var swapAffected=sas[0],setSwapAffected=sas[1];
  var cks=useState(null);var confirmKitchen=cks[0],setConfirmKitchen=cks[1];
  var shs=useState(false);var showHistory=shs[0],setShowHistory=shs[1];
  var pps=useState(false);var showPrefPicker=pps[0],setShowPrefPicker=pps[1];
  // v14 preview 3: Settings / keyboard-shortcuts modal. Toggled by the cog
  // icon in TimelineView's legend row and by the `?` keyboard shortcut.
  var sts=useState(false);var showSettings=sts[0],setShowSettings=sts[1];
  // v14 preview 7: Reminders state.
  //   reminders        — list of staff-set reminders (see reminderAppliesTo).
  //   reminderFires    — map of slot-key → {status, until?, at?} for dismissed
  //                      or snoozed fire slots. Scoped per-day via slot-key.
  //   settingsTab      — which Settings tab is active. Resets to 'general' on
  //                      modal close so reopens start fresh.
  //   reminderEditor   — null = editor closed; {id, draft} = editing/creating.
  //                      Sits on top of Settings (z=250) when open.
  //   setReminderTick  — unused readback; 30s interval bumps this so banners
  //                      re-evaluate even between nowMins minute-boundary
  //                      updates (catches snooze expiry and time-arrivals).
  var rms=useState([]);
  var reminders=rms[0],setReminders=rms[1];
  var rfs=useState({});
  var reminderFires=rfs[0],setReminderFires=rfs[1];
  var stts=useState("general");var settingsTab=stts[0],setSettingsTab=stts[1];
  var res=useState(null);var reminderEditor=res[0],setReminderEditor=res[1];
  // v14 p7 fix: in-app confirmation for reminder deletion — window.confirm is
  // blocked in sandboxed / embedded preview environments, so it never showed
  // the dialog. Matches the confirmDel / confirmCancel pattern used elsewhere.
  var crd=useState(null);var confirmReminderDel=crd[0],setConfirmReminderDel=crd[1];
  var rts30=useState(0);var setReminderTick=rts30[1];
  // v14 p7 deployment: Firebase-persisted reminder writes, write-guarded.
  //   `reminders` uses the same empty-array safety guard as bookings: if the
  //   DB had any reminders on load, saving an empty array would be refused
  //   unless user intent is explicit (i.e. prior delete+confirm flow).
  //   `reminderFires` does NOT have that guard — fire-state is allowed to
  //   shrink to {} legitimately (e.g. prune after midnight).
  function saveReminders(next,isSilent){
    function persist(computed){
      if(!remindersLoaded.current){
        console.warn("[SAFE] Refused to write reminders — initial read has not completed yet.");
        if(!isSilent) setWriteWarning("Refused to write: Firebase not yet connected. If this persists, reload the page.");
        return;
      }
      set(ref(db,"reminders"),computed).catch(function(){});
    }
    if(typeof next==="function"){
      setReminders(function(prev){var c=next(prev);persist(c);return c;});
    } else {setReminders(next);persist(next);}
  }
  function saveReminderFires(next){
    function persist(computed){
      if(!reminderFiresLoaded.current){
        console.warn("[SAFE] Refused to write reminderFires — initial read has not completed yet.");
        return;
      }
      set(ref(db,"reminderFires"),computed).catch(function(){});
    }
    if(typeof next==="function"){
      setReminderFires(function(prev){var c=next(prev);persist(c);return c;});
    } else {setReminderFires(next);persist(next);}
  }
  // Firebase listeners — reminders. Array stored; object-form also tolerated
  // (defensive — matches the tableBlocks pattern).
  useEffect(function(){
    var unsub=onValue(ref(db,"reminders"),function(snap){
      var val=snap.val();
      if(val){
        var arr=Array.isArray(val)?val:Object.values(val);
        setReminders(arr.filter(Boolean));
      } else {
        setReminders([]);
      }
      remindersLoaded.current=true;
    });
    return unsub;
  },[]);
  useEffect(function(){
    var unsub=onValue(ref(db,"reminderFires"),function(snap){
      var val=snap.val();
      setReminderFires(val&&typeof val==="object"?val:{});
      reminderFiresLoaded.current=true;
    });
    return unsub;
  },[]);
  // Prune fire-state entries older than today. Runs AFTER reminderFires has
  // loaded (hence the dep on reminderFiresLoaded.current via a second effect
  // that watches `reminderFires` itself — once data arrives, we clean it).
  // Using `reminderFires` as dep could loop infinitely if prune is a no-op
  // each time; we guard by only writing when the key set actually shrinks.
  useEffect(function(){
    if(!reminderFiresLoaded.current) return;
    var today=new Date().toISOString().slice(0,10);
    var pruned=pruneOldReminderFires(reminderFires,today);
    if(Object.keys(pruned).length!==Object.keys(reminderFires||{}).length){
      saveReminderFires(pruned);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[reminderFires]);
  // 30s tick so the banner list re-evaluates between nowMins ticks (which
  // only update on minute boundaries). Without this, a snooze expiring
  // mid-minute could stay hidden for up to 60s longer than intended.
  useEffect(function(){
    var t=setInterval(function(){setReminderTick(function(x){return x+1;});},30000);
    return function(){clearInterval(t);};
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);
  // Reminder action handlers.
  function markReminderDone(fireKey){
    saveReminderFires(function(prev){var n=Object.assign({},prev);n[fireKey]={status:"done",at:Date.now()};return n;});
  }
  function snoozeReminderFire(fireKey){
    saveReminderFires(function(prev){var n=Object.assign({},prev);n[fireKey]={status:"snoozed",until:Date.now()+15*60*1000};return n;});
  }
  function openNewReminder(){
    var today=new Date().toISOString().slice(0,10);
    setReminderEditor({id:"new",draft:{text:"",times:["21:00"],recurrence:{type:"once",date:today,days:[]},active:true}});
  }
  function openEditReminder(r){
    // Deep-clone to prevent live-editing the stored reminder.
    var draft={
      text:r.text,
      times:(r.times||[]).slice(),
      recurrence:Object.assign({},r.recurrence||{},{days:(r.recurrence&&r.recurrence.days||[]).slice()}),
      active:!!r.active
    };
    setReminderEditor({id:r.id,draft:draft});
  }
  function saveReminderFromEditor(){
    if(!reminderEditor) return;
    var d=reminderEditor.draft;
    if(validateReminderDraft(d)) return; // UI button is disabled; guard here too.
    // Normalize: dedupe times, sort ascending, trim text.
    var uniqTimes=Array.from(new Set(d.times));uniqTimes.sort();
    var cleanDraft=Object.assign({},d,{times:uniqTimes,text:d.text.trim()});
    var id=reminderEditor.id;
    if(id==="new"){
      var newR=Object.assign({id:genId(),createdAt:Date.now()},cleanDraft);
      saveReminders(function(prev){return prev.concat([newR]);});
    } else {
      saveReminders(function(prev){return prev.map(function(r){return r.id===id?Object.assign({},r,cleanDraft):r;});});
    }
    setReminderEditor(null);
  }
  function deleteReminder(id){
    // v14 p7 fix: open in-app confirmation. Actual removal happens in doDeleteReminder.
    setConfirmReminderDel(id);
  }
  function doDeleteReminder(id){
    saveReminders(function(prev){return prev.filter(function(r){return r.id!==id;});});
    setConfirmReminderDel(null);
  }
  function toggleReminderActive(id){
    saveReminders(function(prev){return prev.map(function(r){return r.id===id?Object.assign({},r,{active:!r.active}):r;});});
  }
  useEffect(function(){formRef.current=form;},[form]);
  useEffect(function(){if(error) setError("");},[form.time,form.size,form.date,form.preference,form.customDur]);
  // Real-time clock for seated duration
  var nms=useState(function(){var d=new Date();return d.getHours()*60+d.getMinutes();});var nowMins=nms[0],setNowMins=nms[1];
  useEffect(function(){var t=setInterval(function(){var d=new Date();setNowMins(d.getHours()*60+d.getMinutes());},15000);return function(){clearInterval(t);};},[]);
  // Optimizer auto-off at 15:00 for today's shift
  var aos=useState(function(){var d=new Date();return d.getHours()*60+d.getMinutes()<15*60;});
  var autoOptimizer=aos[0],setAutoOptimizer=aos[1];
  var autoFlippedRef=useRef(null);
  useEffect(function(){
    if(nowMins<15*60) return;
    var today=new Date().toISOString().slice(0,10);
    if(autoFlippedRef.current===today) return;
    autoFlippedRef.current=today;
    setAutoOptimizer(false);
  },[nowMins]);
  // Optimizer auto-on at new day start (before 15:00). Day transitions detected via
  // date-string key, so this fires at ~00:00 when the new day begins — or at app
  // mount if we start before 15:00. No reshuffle on flip.
  var autoOnRef=useRef(null);
  useEffect(function(){
    if(nowMins>=15*60) return;
    var today=new Date().toISOString().slice(0,10);
    if(autoOnRef.current===today) return;
    autoOnRef.current=today;
    setAutoOptimizer(true);
  },[nowMins]);
  // Auto-extend seated bookings that exceed their stored duration.
  // IMPORTANT: computes the update in a pure pass first and only calls saveBookings
  // if something actually needs to change. This prevents a spurious write attempt
  // on first mount (when onValue may not have returned yet, the write-guard would
  // fire even though no real change is being made).
  var lastExtend=useRef("");
  useEffect(function(){
    if(!bookingsLoaded.current) return; // no work to do until initial read lands
    var today=new Date().toISOString().slice(0,10);
    var needsUpdate=false;
    var updated=bookings.map(function(b){
      if(b.date!==today||b.status!=="seated") return b;
      var elapsed=nowMins-toMins(b.time);
      if(elapsed>b.duration){needsUpdate=true;return Object.assign({},b,{duration:elapsed,customDur:elapsed});}
      return b;
    });
    if(!needsUpdate) return;
    var seated=bookings.filter(function(b){return b.date===today&&b.status==="seated";});
    var key=seated.map(function(b){return b.id+":"+nowMins;}).join(",");
    if(key===lastExtend.current) return;
    lastExtend.current=key;
    saveBookings(bookingsAfterAction(updated,today,tableBlocks,null,false,autoOptimizer),true); // silent — non-interactive auto-extend
  },[nowMins,tableBlocks,autoOptimizer,bookings]);
  // Derived: bookings with seated-today durations synced to live time.
  // Used by form/walk-in availability checks so they match what bookingsAfterAction
  // will see on save.
  var liveBookings=(function(){
    var today=new Date().toISOString().slice(0,10);
    return syncLiveDurations(bookings,today,nowMins);
  })();
  var winW=useWinW();
  var isMobile=winW<600;
  // v14 deployment fix: history entries must attribute to the logged-in user
  // (their email), not the generic "staff" stub used in standalone preview.
  // "staff" remains as a fallback for the rare case where auth.currentUser
  // is unavailable at the moment of the write.
  function getUser(){return (auth.currentUser&&auth.currentUser.email)||"staff";}

  var dayCount=bookings.filter(function(b){return b.date===viewDate&&b.status!=="cancelled";}).length;
  var inefficient=bookings.length>0&&checkInefficent(bookings,viewDate);

  // Overlap warnings: seated bookings whose live end is within 15 min of next booking on same table
  var overlapWarnings=(function(){
    var today=new Date().toISOString().slice(0,10);
    if(viewDate!==today) return {};
    var warnings={};
    var active=bookings.filter(function(b){return b.date===today&&b.status!=="cancelled"&&b.status!=="completed"&&(b.tables||[]).length>0;});
    var seated=active.filter(function(b){return b.status==="seated";});
    seated.forEach(function(sb){
      var liveEnd=nowMins;
      var sbTables=sb.tables||[];
      var nextOnTable=null;var nextStart=Infinity;
      active.forEach(function(ob){
        if(ob.id===sb.id||ob.status==="seated") return;
        var oTables=ob.tables||[];
        var shared=sbTables.some(function(t){return oTables.includes(t);});
        if(!shared) return;
        var os=toMins(ob.time);
        if(os>=toMins(sb.time)&&os<nextStart){nextStart=os;nextOnTable=ob;}
      });
      if(nextOnTable){
        var gap=nextStart-liveEnd;
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
    var schedTime=sourceBooking.scheduledTime||sourceBooking.time||"13:00";
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

  // Walk-in
  var wis=useState(false);var showWalkin=wis[0],setShowWalkin=wis[1];
  var wfs=useState({size:2,notes:"",tables:[],time:""});var walkinForm=wfs[0],setWalkinForm=wfs[1];
  var wes=useState("");var walkinError=wes[0],setWalkinError=wes[1];
  function getNextWalkinNum(){
    var today=new Date().toISOString().slice(0,10);
    var max=0;bookings.forEach(function(b){if(b.date===today&&b.name&&b.name.indexOf("Walk-in ")===0){var n=parseInt(b.name.slice(8));if(n>max) max=n;}});
    return max+1;
  }
  function openWalkin(){setWalkinForm({size:2,notes:"",tables:[],time:nowTime(),customDur:null});setWalkinError("");setShowWalkin(true);}
  function doSaveWalkin(){
    var wf=walkinForm;
    if(!wf.tables||!wf.tables.length){setWalkinError("Please assign tables first.");return;}
    var t=wf.time||nowTime();var size=Number(wf.size)||2;var dur=wf.customDur||getDur(size);
    var nb={id:genId(),name:"Walk-in "+getNextWalkinNum(),phone:"",date:new Date().toISOString().slice(0,10),time:t,scheduledTime:t,size:size,duration:dur,originalDuration:dur,preference:"auto",notes:wf.notes||"",status:"seated",tables:wf.tables,customDur:wf.customDur||null,_manual:true,_locked:true,history:[histEntry("walk-in created",getUser())]};
    saveBookings(function(prev){return prev.concat([nb]);});
    setShowWalkin(false);setViewDate(new Date().toISOString().slice(0,10));
  }
  function saveWalkin(){
    var wf=walkinForm;
    var t=wf.time||nowTime();var size=Number(wf.size)||2;var dur=wf.customDur||getDur(size);
    var wDate=new Date().toISOString().slice(0,10);
    var load=getKitchenLoad(bookings,wDate,t,dur,null);
    if(load.starts+1>=KITCHEN_TABLE_LIMIT&&!confirmKitchen){
      setConfirmKitchen("walkin");return;
    }
    setConfirmKitchen(null);doSaveWalkin();
  }

  function doSave(){
    var f=formRef.current;
    try{
      if(!f.name||!f.name.trim()){setError("Customer name is required.");return;}
      // v14 p1 (Issue 3): date is required. Applies to both new bookings (including
      // Book Again) and edits. Walk-ins use today automatically so they are unaffected.
      if(!f.date){setError("Please set a date.");return;}
      if(!f.time){setError("Please set a time.");return;}
      var sm=toMins(f.time);
      if(sm<OPEN*60||sm>CLOSE*60){setError("Bookings accepted between "+OPEN+":00 and "+CLOSE+":00.");return;}
      var size=Number(f.size)||2;
      var dur=f.customDur||getDur(size);
      var cleanPhone=f.phone&&f.phone.trim()!=="+"?f.phone.trim():"";
      var mt=Array.isArray(f.manualTables)&&f.manualTables.length>0?f.manualTables:[];
      if(mt.length&&!swapAffected){var ex=liveBookings.filter(function(b){return b.date===f.date&&b.status!=="cancelled"&&b.id!==editId;}).map(function(b){return {tables:b.tables||[],s:toMins(b.time),e:toMins(b.time)+b.duration};});ex=ex.concat(getBlockSlots(tableBlocks,f.date));if(!canAssign(mt,ex,sm,sm+dur)){setError("Selected tables are not available at this time.");return;}}
      if(editId){
        var orig=bookings.find(function(b){return b.id===editId;});
        var origPt=(orig&&Array.isArray(orig.preferredTables))?orig.preferredTables.slice().sort().join(","):"";
        var newPt=Array.isArray(f.preferredTables)?f.preferredTables.slice().sort().join(","):"";
        var prefTablesChanged=origPt!==newPt;
        // v14: detect confirmed→seated transition here. Only auto-shift time if
        // staff did NOT manually edit time/date in the form (otherwise their
        // explicit edit wins). Compute BEFORE needsR so we can suppress reshuffle.
        var seatingNow=orig&&orig.status!=="seated"&&f.status==="seated";
        var timeUntouched=orig&&f.time===orig.time&&f.date===orig.date;
        var seatedShift=null;
        if(seatingNow&&timeUntouched){
          // Use live-synced bookings so overstaying seated guests' tables are
          // correctly treated as occupied when the overlap guard runs.
          seatedShift=applySeatedShift(orig,nowMins,liveBookings);
        }
        var needsR=!orig||size!==orig.size||f.time!==orig.time||f.date!==orig.date||f.preference!==orig.preference||f._clearManual||prefTablesChanged;
        var prefOnly=orig&&size===orig.size&&f.time===orig.time&&f.date===orig.date&&!f._clearManual;
        var formPlan=f.customDur||getDur(size);
        var origPlan=orig?(orig.originalDuration||orig.duration||90):formPlan;
        var planChanged=formPlan!==origPlan;
        var saveDur=planChanged?formPlan:(orig?(orig.duration||90):formPlan);
        var saveOrigDur=planChanged?formPlan:origPlan;
        var saveCustDur=planChanged?(f.customDur||null):(orig?(orig.customDur||null):(f.customDur||null));
        if(f.status==="completed"&&orig&&orig.status!=="completed"&&!f.customDur){var now=new Date();var nowMinsLocal=now.getHours()*60+now.getMinutes();var startMins=toMins(f.time);var actualDur=Math.max(15,nowMinsLocal-startMins);saveDur=actualDur;saveCustDur=actualDur;}
        // Apply seated shift (if any) to the values we'll write. Overrides plan
        // numbers above — the shift always wins over default-duration logic.
        var saveTime=f.time;
        if(seatedShift){
          saveTime=seatedShift.newTime;
          saveDur=seatedShift.newDuration;
          saveCustDur=seatedShift.newDuration;
        }
        var clearM=!!f._clearManual;
        var wasSeatedLocked=orig&&isLocked(orig)&&!mt.length;
        var editHist=orig?histEntry("edited: "+diffBooking(orig,f,size),getUser()):histEntry("edited",getUser());
        // v14 p1: scheduledTime resolution.
        // - If user manually changed time in the form (f.time !== orig.time), that
        //   is an explicit reschedule → scheduledTime follows the new time.
        // - If the ONLY time change is the seated-shift (auto), scheduledTime stays
        //   pinned to the original — this is what "Book Again" reads from later.
        // - For pre-v14 bookings without scheduledTime, sanitize already backfilled it.
        var userChangedTime=orig&&f.time!==orig.time;
        var saveScheduledTime=userChangedTime?f.time:(orig&&orig.scheduledTime?orig.scheduledTime:f.time);
        // v14 p1 (Issue 2 fix #2): when a seated-shift happens, originalDuration
        // must also move to the new duration so the ghost bar anchors at the true
        // scheduled end (e.g. 20:15 + 105 = 22:00), not at the stale 21:45.
        var saveOrigDurFinal=seatedShift?seatedShift.newDuration:saveOrigDur;
        var upd=bookings.map(function(b){
          if(b.id===editId){
            var h=(b.history||[]).concat([editHist]);
            if(seatedShift) h=h.concat([histEntry("seated "+seatedShift.direction+": time adjusted "+seatedShift.oldTime+" → "+seatedShift.newTime,getUser())]);
            var unlockForOpt=needsR&&wasSeatedLocked&&!mt.length&&!clearM;
            return Object.assign({},b,{name:f.name,phone:cleanPhone,date:f.date,time:saveTime,scheduledTime:saveScheduledTime,size:size,duration:saveDur,originalDuration:saveOrigDurFinal,preference:f.preference,notes:f.notes,status:unlockForOpt?"confirmed":f.status,tables:mt.length?mt:(clearM?[]:(!needsR?b.tables:[])),customDur:saveCustDur,_manual:mt.length>0?true:(clearM?false:b._manual),_locked:mt.length>0?true:(clearM?false:(unlockForOpt?false:b._locked)),preferredTables:Array.isArray(f.preferredTables)?f.preferredTables:[],history:h});
          }
          if(swapAffected){var match=swapAffected.find(function(ab){return ab.id===b.id;});if(match){var remaining=(b.tables||[]).filter(function(t){return !match.tables.includes(t);});return Object.assign({},b,{tables:remaining,_locked:false,_manual:false});}}
          return b;
        });
        // v14: when seating, force no-reshuffle of other bookings (same rule as
        // updateStatus). The seated-shift must not trigger cascading table moves.
        var optStateForSave=seatingNow?false:autoOptimizer;
        var fin=bookingsAfterAction(upd,f.date,tableBlocks,editId,needsR&&!mt.length,optStateForSave);
        if(wasSeatedLocked&&needsR&&!mt.length&&!clearM){fin=fin.map(function(b){if(b.id===editId) return Object.assign({},b,{status:f.status,_locked:b.tables&&b.tables.length>0,_manual:b.tables&&b.tables.length>0});return b;});}
        if(!mt.length&&needsR&&!prefOnly){
          var prevAssigned=bookings.filter(function(b){return b.date===f.date&&isActive(b)&&b.tables&&b.tables.length>0&&b.id!==editId;});
          var displaced=fin.filter(function(b){return b.id!==editId&&b.date===f.date&&isActive(b)&&(!b.tables||!b.tables.length||b._conflict);});
          var kicked=displaced.filter(function(d){return prevAssigned.some(function(p){return p.id===d.id;});});
          if(kicked.length>0){setError("Not enough capacity — this change would displace "+kicked.length+" existing booking"+(kicked.length>1?"s":"")+": "+kicked.map(function(k){return k.name;}).join(", ")+".");return;}
        }
        if(!mt.length&&needsR){
          var editedInFin=fin.find(function(b){return b.id===editId;});
          if(editedInFin&&(!editedInFin.tables||!editedInFin.tables.length)){setError("No tables available at this time — see suggestions below.");return;}
        }
        saveBookings(fin);if(needsR||swapAffected||f.status==="completed"||seatingNow) flash();setShowForm(false);setViewDate(f.date);
      } else {
        var newId=genId();
        // v14: Book Again flow. When f.returnOf is set, the new booking links
        // back to its source, gets a distinctive "created via Book Again" entry
        // in its own history, and the ORIGINAL booking gets a matching entry
        // indicating the customer re-booked.
        // v14 p1: history references source.scheduledTime (the confirmed time)
        // rather than source.time, so "created via Book Again (from X on YYYY-MM-DD
        // at 20:30)" stays accurate even if the source was seated-shifted to 20:15.
        var returnOfId=f.returnOf||null;
        var source=returnOfId?bookings.find(function(b){return b.id===returnOfId;}):null;
        var sourceSchedTime=source?(source.scheduledTime||source.time):"";
        var createHist=source?histEntry("created via Book Again (from "+source.name+" on "+source.date+" at "+sourceSchedTime+")",getUser()):histEntry("created",getUser());
        // v14 p1: scheduledTime=f.time on creation (new bookings always start confirmed).
        var nb={id:newId,name:f.name,phone:cleanPhone,date:f.date,time:f.time,scheduledTime:f.time,size:size,duration:dur,originalDuration:dur,preference:f.preference,notes:f.notes,status:"confirmed",tables:mt.length?mt:[],customDur:f.customDur||null,_manual:mt.length>0,_locked:mt.length>0,preferredTables:Array.isArray(f.preferredTables)?f.preferredTables:[],returnOf:returnOfId,history:[createHist]};
        var base=bookings;
        if(swapAffected){base=bookings.map(function(b){var match=swapAffected.find(function(ab){return ab.id===b.id;});if(match){var remaining=(b.tables||[]).filter(function(t){return !match.tables.includes(t);});return Object.assign({},b,{tables:remaining,_locked:false,_manual:false});}return b;});}
        // If this is a Book Again creation, append a back-reference entry to the
        // source booking's history (purely informational — no status/table change).
        if(source){
          base=base.map(function(b){
            if(b.id!==returnOfId) return b;
            return Object.assign({},b,{history:(b.history||[]).concat([histEntry("Book Again → new booking on "+f.date+" at "+f.time,getUser())])});
          });
        }
        var fin=bookingsAfterAction(base.concat([nb]),f.date,tableBlocks,newId,!mt.length,autoOptimizer);
        if(!mt.length){
          var ne=fin.find(function(b){return b.id===newId;});
          if(!ne||(ne.tables||[]).length===0){setError("Could not assign a table — try manual assignment.");return;}
          var displaced=fin.filter(function(b){return b.id!==newId&&b.date===f.date&&isActive(b)&&(!b.tables||!b.tables.length||b._conflict);});
          var prevAssigned=base.filter(function(b){return b.date===f.date&&isActive(b)&&b.tables&&b.tables.length>0;});
          var kicked=displaced.filter(function(d){return prevAssigned.some(function(p){return p.id===d.id;});});
          if(kicked.length>0){setError("Not enough capacity — adding this booking would displace "+kicked.length+" existing booking"+(kicked.length>1?"s":"")+": "+kicked.map(function(k){return k.name;}).join(", ")+".");return;}
        }
        saveBookings(fin);flash();setShowForm(false);setViewDate(f.date);
      }
    }catch(err){setError("Error: "+err.message);}
  }
  function save(){
    var f=formRef.current;
    if(!f.time) return doSave();
    var size=Number(f.size)||2;var d=f.customDur||getDur(size);
    var load=getKitchenLoad(bookings,f.date,f.time,d,editId);
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
    var target=bookings.find(function(b){return b.id===id;});
    if(!target){setError("Booking not found.");return;}
    if(isLocked(target)){setError("Booking is manually locked. Edit manually to change tables.");return;}
    var targetStart=toMins(target.time);
    var targetEnd=targetStart+(target.duration||90);
    // Build a search-view where any seated booking currently flagged as blocking
    // THIS target (or any seated booking sharing tables whose scheduled end is
    // before target.time) is stretched to at least targetStart+1 minute. That
    // guarantees findFreeSlot treats their tables as busy at target's start.
    var searchView=liveBookings.map(function(b){
      if(b.id===target.id) return b;
      if(b.status!=="seated") return b;
      if(b.date!==target.date) return b;
      var tables=b.tables||[];
      var sharesTable=tables.some(function(t){return (target.tables||[]).includes(t);});
      if(!sharesTable) return b;
      var bs=toMins(b.time);
      var be=bs+(b.duration||90);
      // Only extend if the seated booking ends before target's END (i.e., it could
      // plausibly overlap or free up within target's window). If it already runs
      // past target end, syncLiveDurations handled it.
      if(be>=targetEnd) return b;
      // Extend to cover target fully so findFreeSlot never considers these tables.
      var extendedDur=targetEnd-bs;
      return Object.assign({},b,{duration:extendedDur});
    });
    var tables=findFreeSlot(searchView,target.date,target.time,target.size||2,target.preference||"auto",target.duration||90,tableBlocks,id,target.preferredTables);
    if(!tables||!tables.length){setError("No alternative tables available for "+target.name+" at "+target.time+".");return;}
    // Sanity: if findFreeSlot returned the same tables (possible if the algorithm
    // found a valid-but-unchanged assignment), surface it as a no-op rather than
    // silently "succeeding" with nothing changed.
    var curKey=(target.tables||[]).slice().sort().join("|");
    var newKey=tables.slice().sort().join("|");
    if(curKey===newKey){setError("No alternative tables available for "+target.name+" at "+target.time+".");return;}
    var prevTables=(target.tables||[]).join("+")||"none";
    var user=getUser();
    saveBookings(function(prev){return prev.map(function(b){
      if(b.id!==id) return b;
      return Object.assign({},b,{tables:tables,_manual:false,_conflict:false,history:(b.history||[]).concat([histEntry("reassigned "+prevTables+" → "+tables.join("+"),user)])});
    });});
    setError("");
    flash();
  }
  function delBooking(id){saveBookings(function(b){var target=b.find(function(x){return x.id===id;});var d=target?target.date:viewDate;return bookingsAfterAction(b.filter(function(x){return x.id!==id;}),d,tableBlocks,null,false,autoOptimizer);});setConfirmDel(null);flash();}

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
  var kbRef=useRef({});
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
    openNew:openNew,openWalkin:openWalkin,
    save:save,doSave:doSave,saveWalkin:saveWalkin,doSaveWalkin:doSaveWalkin,
    forceReshuffle:forceReshuffle,delBooking:delBooking,bookAgain:bookAgain
  };
  useEffect(function(){
    function isTyping(el){if(!el) return false;var t=el.tagName;return t==="INPUT"||t==="TEXTAREA"||t==="SELECT"||el.isContentEditable;}
    function handler(e){
      if(e.ctrlKey||e.metaKey||e.altKey) return;
      var K=kbRef.current;var k=e.key;var typing=isTyping(e.target);
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
          var isW=K.confirmKitchen==="walkin";
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
          var TABS=["general","reminders","shortcuts"];
          var curIdx=TABS.indexOf(K.settingsTab);if(curIdx<0) curIdx=0;
          var newIdx=k==="ArrowLeft"?(curIdx-1+TABS.length)%TABS.length:(curIdx+1)%TABS.length;
          K.setSettingsTab(TABS[newIdx]);
          return;
        }
      }
      // ── Edit Booking modal shortcuts ──
      // Only fire when Edit is the TOP layer (no popup on top of it).
      // ── Preferred-table picker: captures C (= Clear). Sits ABOVE the
      //    form-modal block so A/P/B/H don't fire while the picker is open
      //    (which matches the user-intuitive "only the top modal responds"
      //    precedence).
      if(K.showPrefPicker){
        if(k==="c"||k==="C"){
          var prefs=Array.isArray(K.form&&K.form.preferredTables)?K.form.preferredTables:[];
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
      var topLayer=K.showSettings||K.showHistory||K.confirmKitchen||K.confirmReshuffle||K.confirmCancel||K.confirmDel||K.blockTarget||K.manualTarget||K.reminderEditor||K.confirmReminderDel;
      if(K.showForm&&!topLayer){
        if(k==="a"||k==="A"){e.preventDefault();K.setManualTarget(K.editId||"__new__");return;}
        if(k==="p"||k==="P"){e.preventDefault();K.setShowPrefPicker(true);return;}
        if(k==="c"||k==="C"){
          var mtLen=Array.isArray(K.form&&K.form.manualTables)?K.form.manualTables.length:0;
          if(mtLen>0){
            e.preventDefault();
            K.setForm(function(f){return Object.assign({},f,{manualTables:[]});});
            K.setSwapAffected(null);
          } else if(K.editId){
            var cur3=K.bookings.find(function(b){return b.id===K.editId;});
            var isManual3=cur3&&(cur3._manual||cur3._locked)&&cur3.tables&&cur3.tables.length>0;
            var alreadyCleared=!!(K.form&&K.form._clearManual);
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
            var cur=K.bookings.find(function(b){return b.id===K.editId;});
            if(cur&&(cur.status==="seated"||cur.status==="completed")){e.preventDefault();K.bookAgain(cur);}
            return;
          }
          if(k==="h"||k==="H"){
            var c2=K.bookings.find(function(b){return b.id===K.editId;});
            if(c2&&c2.history&&c2.history.length>0){e.preventDefault();K.setShowHistory(true);}
            return;
          }
        }
      }
      // ── Global shortcuts: suppressed while any modal is open ──
      var anyModal=K.showForm||K.showWalkin||K.showHistory||K.confirmDel||K.confirmReshuffle||K.confirmCancel||K.confirmKitchen||K.manualTarget||K.blockTarget||K.showPrefPicker||K.showSettings||K.reminderEditor||K.confirmReminderDel;
      if(anyModal) return;
      if(k==="?"){e.preventDefault();K.setShowSettings(true);return;}
      if(k==="t"||k==="T"){e.preventDefault();K.setView("timeline");return;}
      if(k==="l"||k==="L"){e.preventDefault();K.setView("list");return;}
      if(k==="d"||k==="D"){e.preventDefault();K.setViewDate(new Date().toISOString().slice(0,10));return;}
      if(k==="n"||k==="N"){e.preventDefault();K.openNew();return;}
      if(k==="w"||k==="W"){e.preventDefault();K.openWalkin();return;}
      if(k==="ArrowLeft"){e.preventDefault();var d1=new Date(K.viewDate);d1.setDate(d1.getDate()-1);K.setViewDate(d1.toISOString().slice(0,10));return;}
      if(k==="ArrowRight"){e.preventDefault();var d2=new Date(K.viewDate);d2.setDate(d2.getDate()+1);K.setViewDate(d2.toISOString().slice(0,10));return;}
      // ── Timeline-only shortcuts ──
      if(K.view==="timeline"){
        var today=new Date().toISOString().slice(0,10);
        var isToday=K.viewDate===today;
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
    var user=getUser();
    var nowM=nowMins;
    saveBookings(function(b){
      var target=b.find(function(x){return x.id===id;});
      var d=target?target.date:viewDate;
      // v14: detect confirmed → seated transition (for any prior non-seated status).
      // If the transition triggers a seated-shift, force no-reshuffle by passing
      // autoOptimizerState=false to bookingsAfterAction, so other bookings never
      // move as a side-effect of someone sitting down early/late.
      var seatedShiftHappened=false;
      var updated=b.map(function(x){
        if(x.id!==id) return x;
        var histEntries=[histEntry("status → "+status,user)];
        var extra={status:status};
        if(status==="completed"){
          var startMins=toMins(x.time);
          var actualDur=Math.max(15,nowM-startMins);
          extra.duration=actualDur;
          extra.customDur=actualDur;
        }
        if(status==="seated"&&x.status!=="seated"){
          var shift=applySeatedShift(x,nowM,b);
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
      var optState=(status==="seated")?false:autoOptimizer;
      return bookingsAfterAction(updated,d,tableBlocks,null,false,optState);
    });
    if(status==="completed"||status==="seated") flash();
  }
  function doCancelBooking(id,noShow){
    var user=getUser();
    saveBookings(function(b){var target=b.find(function(x){return x.id===id;});var d=target?target.date:viewDate;var updated=b.map(function(x){if(x.id!==id) return x;var extra={status:"cancelled",history:(x.history||[]).concat([histEntry(noShow?"no show":"cancelled",user)])};if(noShow) extra.notes=(x.notes?x.notes+"\n":"")+"No show";return Object.assign({},x,extra);});return bookingsAfterAction(updated,d,tableBlocks,null,false,autoOptimizer);});
    setConfirmCancel(null);flash();
  }
  function manualAssign(bookingId,tables,locked,affected){
    var user=getUser();
    saveBookings(function(b){
      var updated=b.map(function(x){
        if(x.id===bookingId) return Object.assign({},x,{tables:tables,_conflict:false,_manual:true,_locked:locked===true,history:(x.history||[]).concat([histEntry("tables manually assigned: "+tables.join(", "),user)])});
        // If swapping, strip taken tables from affected bookings and unlock them for re-optimization
        if(affected&&affected.length>0){
          var match=affected.find(function(ab){return ab.id===x.id;});
          if(match){
            var remaining=(x.tables||[]).filter(function(t){return !match.tables.includes(t);});
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
    var next=tableBlocks.concat([block]);
    saveBlocks(next);
    saveBookings(function(b){return bookingsAfterAction(b,block.date,next,null,false,autoOptimizer);});
    flash();
    setBlockTarget(null);
  }
  function removeBlock(block){
    var next=tableBlocks.filter(function(bl){return !(bl.tableId===block.tableId&&bl.date===block.date&&bl.allDay===block.allDay&&bl.from===block.from&&bl.to===block.to);});
    saveBlocks(next);
    saveBookings(function(b){return bookingsAfterAction(b,block.date,next,null,false,autoOptimizer);});
    flash();
    if(next.filter(function(bl){return bl.tableId===block.tableId&&bl.date===block.date;}).length===0) setBlockTarget(null);
  }

  var manualBooking=(function(){
    if(!manualTarget) return null;
    if(manualTarget==="__new__"){return {id:"__new__",name:form.name||"New booking",size:Number(form.size)||2,time:form.time||"13:00",duration:form.customDur||getDur(Number(form.size)||2),tables:Array.isArray(form.manualTables)?form.manualTables:[],date:form.date,status:"confirmed",_locked:true};}
    var found=bookings.find(function(b){return b.id===manualTarget;})||null;
    if(found&&manualTarget===editId){found=Object.assign({},found,{size:Number(form.size)||2,time:form.time||found.time,duration:form.customDur||getDur(Number(form.size)||2),date:form.date||found.date,preference:form.preference||found.preference});}
    return found;
  })();

  // Build form
  var inp=mkInp;
  var formCols=isMobile?"1fr":"1fr 1fr";
  var auto=getDur(Number(form.size));
  var dur=form.customDur||auto;

  // ── Real-time availability check (trial optimization) ──
  var formAvail=(function(){
    if(!showForm||!form.time) return null;
    var sm=toMins(form.time);
    if(sm<OPEN*60||sm>CLOSE*60) return null;
    var size=Number(form.size)||2;
    var d=form.customDur||getDur(size);
    var mt=Array.isArray(form.manualTables)&&form.manualTables.length>0?form.manualTables:null;
    if(mt) return {ok:true,tables:mt,sugg:null};
    var noResh=!optimizerActiveFor(form.date,autoOptimizer);
    var tables=trialFits(liveBookings,form.date,form.time,size,form.preference||"auto",d,tableBlocks,editId,form.preferredTables,noResh);
    if(tables) return {ok:true,tables:tables,sugg:null};
    var sugg=findTimes(form.date,size,form.preference,liveBookings,d,sm,tableBlocks,editId,noResh);
    return {ok:false,tables:null,sugg:formatSugg(sugg,sm)};
  })();

  var tablesBtn=(function(){
    var mt=Array.isArray(form.manualTables)&&form.manualTables.length>0?form.manualTables:null;
    var previewTbls=mt?null:(formAvail&&formAvail.ok?formAvail.tables:null);
    var prefs=form.preferredTables||[];
    var hasPref=prefs.length>0;
    var prefBtn=RC("button",{style:mkBtn({background:hasPref?"#0d9488":"#64748b",fontSize:12,padding:"6px 10px"}),onClick:function(){setShowPrefPicker(true);}},hasPref?"★ "+prefs.join("+"):"★ Preferred");
    if(editId){
      var cur=bookings.find(function(b){return b.id===editId;});
      var curPrefStr=cur&&Array.isArray(cur.preferredTables)?cur.preferredTables.slice().sort().join(","):"";
      var formPrefStr=Array.isArray(form.preferredTables)?form.preferredTables.slice().sort().join(","):"";
      var prefTblChanged=curPrefStr!==formPrefStr;
      var changed=cur&&(form.time!==cur.time||Number(form.size)!==cur.size||form.date!==cur.date||form.preference!==cur.preference||(form.customDur&&form.customDur!==cur.duration)||prefTblChanged);
      var hardChanged=cur&&(form.time!==cur.time||Number(form.size)!==cur.size||form.date!==cur.date||form.preference!==cur.preference||prefTblChanged);
      var cleared=!!form._clearManual;
      var curTbl=cur&&cur.tables&&cur.tables.length>0?cur.tables:null;
      var isManual=cur&&(cur._manual||cur._locked)&&curTbl;
      var showTbl=mt||(isManual&&!hardChanged&&!cleared?curTbl:((changed||cleared)?null:curTbl));
      var showClearManual=isManual&&!mt&&!cleared;
      var leftEls=[
        RC("span",{key:"lbl",style:{fontSize:13,color:"#4a5568",fontWeight:600}},"Tables")];
      if(showTbl) showTbl.forEach(function(id){leftEls.push(RC(TBadge,{key:id,id:id}));});
      else if(previewTbls){previewTbls.forEach(function(id){leftEls.push(RC(TBadge,{key:id,id:id}));});leftEls.push(RC("span",{key:"auto",style:{fontSize:11,color:S.muted,fontStyle:"italic"}},"(auto)"));}
      if((changed||cleared)&&!mt&&curTbl) leftEls.push(RC("span",{key:"prev",style:{fontSize:11,color:S.muted,fontStyle:"italic"}},"was: "+curTbl.join(", ")));
      if(mt) leftEls.push(RC("button",{key:"clrmt",style:mkBtn({fontSize:12,background:BTN.clear}),onClick:function(){setForm(function(f){return Object.assign({},f,{manualTables:[]});});setSwapAffected(null);}},"Clear"));
      if(showClearManual) leftEls.push(RC("button",{key:"clrman",style:mkBtn({fontSize:12,background:BTN.clear}),onClick:function(){setForm(function(f){return Object.assign({},f,{manualTables:[],_clearManual:true});});setSwapAffected(null);}},"Clear"));
      return RC(Section,null,RC("div",{style:{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,flexWrap:"wrap"}},
        RC("div",{style:{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",flex:1,minWidth:0}},leftEls),
        RC("div",{style:{display:"flex",gap:6,flexShrink:0}},
          RC("button",{style:mkBtn({background:BTN.tables}),onClick:function(){setManualTarget(editId);}},"= Assign"),
          prefBtn)));
    }
    var leftEls=[RC("span",{key:"lbl",style:{fontSize:13,color:"#4a5568",fontWeight:600}},"Tables")];
    if(mt) mt.forEach(function(id){leftEls.push(RC(TBadge,{key:id,id:id}));});
    else if(previewTbls){previewTbls.forEach(function(id){leftEls.push(RC(TBadge,{key:id,id:id}));});leftEls.push(RC("span",{key:"auto",style:{fontSize:11,color:S.muted,fontStyle:"italic"}},"(auto)"));}
    if(mt) leftEls.push(RC("button",{key:"clrmt",style:mkBtn({fontSize:12,background:BTN.clear}),onClick:function(){setForm(function(f){return Object.assign({},f,{manualTables:[]});});setSwapAffected(null);}},"Clear"));
    return RC(Section,null,RC("div",{style:{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,flexWrap:"wrap"}},
      RC("div",{style:{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",flex:1,minWidth:0}},leftEls),
      RC("div",{style:{display:"flex",gap:6,flexShrink:0}},
        RC("button",{style:mkBtn({background:BTN.tables}),onClick:function(){setManualTarget("__new__");}},"= Assign"),
        prefBtn)));
  })();

  var prefPickerModal=showPrefPicker?RC(PrefPickerModal,{selected:form.preferredTables||[],partySize:form.size,onChange:function(next){setForm(function(f){return Object.assign({},f,{preferredTables:next});});},onClose:function(){setShowPrefPicker(false);}}):null;

  var availBanner=showForm&&formAvail&&!formAvail.ok?RC(AvailBanner,{msg:"No tables available"+(form.preference!=="auto"?" ("+form.preference+" preference)":"")+".",sugg:formAvail.sugg,onTapTime:function(t){setForm(function(f){return Object.assign({},f,{time:t});});}}):null;

  var kitchenLoad=(showForm&&form.time)?getKitchenLoad(bookings,form.date,form.time,form.customDur||getDur(Number(form.size)||2),editId):null;
  var kitchenStarts=kitchenLoad?kitchenLoad.starts+1:1;
  var kitchenGuests=kitchenLoad?kitchenLoad.guests+(Number(form.size)||2):Number(form.size)||2;
  var kitchenBusy=kitchenLoad&&kitchenStarts>=KITCHEN_TABLE_LIMIT;
  var kitchenSugg=kitchenBusy?findKitchenFriendlyTimes(bookings,form.date,Number(form.size)||2,form.preference||"auto",form.customDur||getDur(Number(form.size)||2),form.time,editId,tableBlocks):null;
  function renderKitchenTimes(arr){
    if(!arr||!arr.length) return null;
    return arr.map(function(r){return RC("span",{key:r.timeStr,onClick:function(){setForm(function(f){return Object.assign({},f,{time:r.timeStr});});},style:{cursor:"pointer",padding:"3px 8px",borderRadius:6,fontWeight:600,fontSize:12,background:r.hasTables?"rgba(220,252,231,0.8)":"rgba(254,249,195,0.8)",color:r.hasTables?"#166534":"#854d0e",border:"1px solid "+(r.hasTables?"rgba(134,239,172,0.5)":"rgba(253,230,138,0.5)"),boxShadow:"0 1px 2px rgba(0,0,0,0.04)"}},r.timeStr);});
  }
  var kitchenSection=kitchenLoad?RC("div",{style:{padding:"10px 14px",borderRadius:14,border:"2px solid "+(kitchenBusy?"rgba(253,186,116,0.55)":"rgba(255,255,255,0.45)"),background:kitchenBusy?"rgba(255,237,213,0.6)":"rgba(255,255,255,0.35)",marginBottom:14,fontSize:13,color:kitchenBusy?"#9a3412":S.muted}},
    RC("div",{style:{display:"flex",justifyContent:"space-between",alignItems:"center"}},
      RC("span",null,RC("span",{style:{fontWeight:700}},"Starting at this time: "),kitchenStarts+" booking"+(kitchenStarts!==1?"s":"")+" · "+kitchenGuests+" guest"+(kitchenGuests!==1?"s":"")),
      kitchenBusy?RC("span",{style:{fontWeight:700,color:"#dc2626",fontSize:13,padding:"4px 12px",borderRadius:8,border:"1.5px solid rgba(220,38,38,0.4)",flexShrink:0}},"Kitchen busy"):null),
    kitchenSugg&&(kitchenSugg.before.length||kitchenSugg.after.length)?RC("div",{style:{marginTop:8}},
      RC("div",{style:{fontSize:11,color:S.muted,marginBottom:6}},RC("span",{style:{background:"rgba(220,252,231,0.8)",color:"#166534",padding:"2px 6px",borderRadius:6,fontSize:10,fontWeight:600}},"green")," = tables available  ",RC("span",{style:{background:"rgba(254,249,195,0.8)",color:"#854d0e",padding:"2px 6px",borderRadius:6,fontSize:10,fontWeight:600}},"yellow")," = kitchen ok, tables tight"),
      kitchenSugg.before.length?RC("div",{style:{marginBottom:4}},RC("span",{style:{fontWeight:700,fontSize:12}},"Before: "),RC("span",{style:{display:"inline-flex",gap:4,flexWrap:"wrap"}},renderKitchenTimes(kitchenSugg.before))):null,
      kitchenSugg.after.length?RC("div",null,RC("span",{style:{fontWeight:700,fontSize:12}},"After: "),RC("span",{style:{display:"inline-flex",gap:4,flexWrap:"wrap"}},renderKitchenTimes(kitchenSugg.after))):null):
    kitchenBusy?RC("div",{style:{marginTop:6,fontSize:12,color:"#991b1b"}},"No kitchen-friendly alternatives found nearby."):null):null;

  var quickStatusBtns=editId?RC(Section,null,
    RC("div",{style:{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center"}},
      RC("span",{style:{fontSize:13,color:"#4a5568",fontWeight:600,marginRight:4}},"Status:"),
      ["confirmed","seated","completed","cancelled"].filter(function(s){return s!==form.status;}).map(function(s){return RC("button",{key:s,style:mkBtn({background:BLOCK_BG[s],textTransform:"capitalize",minHeight:40}),onClick:function(){if(s==="cancelled"){setConfirmCancel(editId);return;}setForm(function(f){return Object.assign({},f,{status:s});});}},"> "+s);}))):null;

  var historyBtn=(function(){
    if(!editId) return null;
    var cur=bookings.find(function(b){return b.id===editId;});
    if(!cur||!cur.history||!cur.history.length) return null;
    return RC("button",{onClick:function(){setShowHistory(true);},style:mkBtn({fontSize:12,background:"#64748b",padding:"8px 16px",minHeight:36})},"History ("+cur.history.length+")");
  })();
  // v14: Book Again button — visible only in Edit Booking modal when status is
  // seated or completed. One tap closes the edit modal and opens a new-booking
  // form pre-filled with this customer's details (name, phone, size, preference,
  // preferred tables, original time). Staff must still pick a date.
  var bookAgainBtn=(function(){
    if(!editId) return null;
    var cur=bookings.find(function(b){return b.id===editId;});
    if(!cur) return null;
    if(cur.status!=="seated"&&cur.status!=="completed") return null;
    return RC("button",{onClick:function(){bookAgain(cur);},style:mkBtn({fontSize:12,background:"rgba(22,101,52,0.8)",padding:"8px 16px",minHeight:36})},"Book Again");
  })();
  // v14: "return guest" banner at top of form when this is a Book Again creation.
  // v14 p1: reads src.scheduledTime so the displayed time matches the confirmed
  // plan, not the seated-shifted time.
  var returnOfBanner=(function(){
    if(editId||!form.returnOf) return null;
    var src=bookings.find(function(b){return b.id===form.returnOf;});
    if(!src) return null;
    var srcTime=src.scheduledTime||src.time;
    return RC("div",{style:{background:"rgba(220,252,231,0.7)",border:"2px solid rgba(134,239,172,0.55)",borderRadius:14,padding:"10px 14px",marginBottom:10,fontSize:13,fontWeight:600,color:"#166534",boxShadow:"0 1px 4px rgba(0,0,0,0.04)"}},
      "Return guest — re-booking from "+src.name+" ("+src.date+" at "+srcTime+"). Please set a date.");
  })();

  var historyPopup=(showHistory&&editId)?(function(){var cur=bookings.find(function(b){return b.id===editId;});return cur?RC(HistoryPopup,{booking:cur,onClose:function(){setShowHistory(false);}}):null;})():null;

  var errorEl=error?RC("div",{style:{color:"#991b1b",fontSize:13,padding:"10px 14px",background:"rgba(254,226,226,0.7)",borderRadius:14,border:"2px solid rgba(252,165,165,0.55)",marginBottom:14}},error):null;

  // v14 p7: reminder banners. Recomputed each render (cheap). nowMins ticks
  // every minute; reminderTick forces re-render every 30s for snooze-expiry.
  // Uses TODAY (not viewDate) — reminders are operational, not tied to the
  // day being viewed. So a reminder fires at 21:00 regardless of whether
  // staff are looking at tomorrow's timeline.
  var reminderTodayStr=new Date().toISOString().slice(0,10);
  var activeReminderBanners=getActiveReminderBanners(reminders,reminderFires,reminderTodayStr,nowMins);
  // One row per active fire slot, stacked vertically. Amber (distinct from the
  // green success toasts and red error banners), with Done + Snooze actions.
  var reminderBanners=activeReminderBanners.length?RC("div",{style:{marginBottom:10}},
    activeReminderBanners.map(function(ab){
      return RC("div",{key:ab.fireKey,style:{background:"rgba(254,243,199,0.8)",border:"2px solid rgba(251,191,36,0.55)",borderRadius:14,padding:"10px 14px",marginBottom:6,display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,flexWrap:"wrap",boxShadow:"0 1px 4px rgba(0,0,0,0.06)"}},
        RC("div",{style:{display:"flex",alignItems:"center",gap:8,flex:1,minWidth:0,flexWrap:"wrap"}},
          RC("span",{style:{fontSize:14,fontWeight:700,color:"#78350f"}},"\u23f0 Reminder"),
          RC("span",{style:{fontSize:11,padding:"2px 8px",borderRadius:6,background:"rgba(146,64,14,0.15)",color:"#78350f",fontWeight:700,letterSpacing:"0.02em",whiteSpace:"nowrap"}},ab.time),
          RC("span",{style:{fontSize:14,color:"#78350f",fontWeight:700,wordBreak:"break-word"}},ab.reminder.text)),
        RC("div",{style:{display:"flex",gap:6,flexShrink:0}},
          RC("button",{onClick:function(){snoozeReminderFire(ab.fireKey);},style:mkBtn({fontSize:12,minHeight:34,padding:"4px 12px",background:BTN.nav})},"Snooze 15m"),
          RC("button",{onClick:function(){markReminderDone(ab.fireKey);},style:{background:"rgba(22,101,52,0.8)",border:"1px solid rgba(255,255,255,0.2)",borderRadius:12,padding:"6px 14px",cursor:"pointer",fontSize:12,fontWeight:600,color:"#fff",minHeight:34,boxShadow:"0 1px 4px rgba(0,0,0,0.1), inset 0 1px 1px rgba(255,255,255,0.15)"}},"Done")));
    })):null;

  var reshuffledBanner=reshuffled?RC("div",{style:{background:"rgba(254,249,195,0.7)",border:"2px solid rgba(253,230,138,0.55)",borderRadius:14,padding:"10px 14px",marginBottom:10,fontSize:13,fontWeight:600,color:"#854d0e",boxShadow:"0 1px 4px rgba(0,0,0,0.04)"}},optimizerActiveFor(viewDate,autoOptimizer)?"Tables re-optimised.":"Booking saved."):null;
  var ineffBanner=(!reshuffled&&inefficient&&dismissedIneff!==viewDate&&optimizerActiveFor(viewDate,autoOptimizer))?RC("div",{style:{background:"rgba(255,237,213,0.7)",border:"2px solid rgba(253,186,116,0.55)",borderRadius:14,padding:"10px 14px",marginBottom:10,fontSize:13,fontWeight:600,color:"#9a3412",display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,flexWrap:"wrap",boxShadow:"0 1px 4px rgba(0,0,0,0.04)"}},RC("span",null,"Tables could be reshuffled for better efficiency."),RC("div",{style:{display:"flex",gap:6}},RC("button",{onClick:function(){setDismissedIneff(viewDate);},style:mkBtn({fontSize:13,minHeight:36,padding:"6px 14px",background:BTN.dismiss})},"Dismiss"),RC("button",{onClick:function(){setConfirmReshuffle(true);},style:{background:BTN.orange,color:"#fff",border:"1px solid rgba(255,255,255,0.2)",borderRadius:12,padding:"6px 14px",cursor:"pointer",fontSize:13,fontWeight:600,minHeight:36,boxShadow:"0 1px 4px rgba(0,0,0,0.1), inset 0 1px 1px rgba(255,255,255,0.15)"}},"Reshuffle"))):null;

  // Overlap warnings banner — shows when one or more seated guests are overstaying
  // into the start time of a booking on the same table. Each row shows a one-tap
  // Reassign button that reroutes the crowded-out booking to a free table without
  // disturbing anyone else. Visible regardless of view (timeline or list).
  var overlapEntries=Object.keys(overlapWarnings).map(function(sbId){
    var w=overlapWarnings[sbId];
    var sb=bookings.find(function(b){return b.id===sbId;});
    if(!sb) return null;
    var rowBg=w.overdue?"rgba(254,226,226,0.6)":"rgba(255,237,213,0.6)";
    var rowBrd=w.overdue?"rgba(252,165,165,0.55)":"rgba(253,186,116,0.55)";
    var rowTxt=w.overdue?"#991b1b":"#9a3412";
    var msg=sb.name+" (overstaying) → "+w.next+" at "+w.nextTime+(w.overdue?" — overdue":" — in "+w.gap+" min");
    return RC("div",{key:sbId,style:{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,flexWrap:"wrap",padding:"8px 12px",borderRadius:12,background:rowBg,border:"1px solid "+rowBrd,marginTop:6}},
      RC("span",{style:{fontSize:13,color:rowTxt,fontWeight:600,flex:"1 1 auto",minWidth:0}},msg),
      RC("button",{onClick:function(){reassignBooking(w.nextId);},style:mkBtn({fontSize:12,minHeight:32,padding:"4px 12px",background:BTN.orange})},"Reassign "+w.next));
  }).filter(Boolean);
  var overlapBanner=overlapEntries.length?RC("div",{style:{background:"rgba(255,250,235,0.55)",border:"2px solid rgba(253,186,116,0.45)",borderRadius:14,padding:"10px 14px",marginBottom:10,boxShadow:"0 1px 4px rgba(0,0,0,0.04)"}},
    RC("div",{style:{fontSize:13,fontWeight:700,color:"#9a3412",marginBottom:2}},"Overlap warnings"),
    overlapEntries):null;

  var resetDurBtn=form.customDur?RC("button",{key:"rd",style:mkBtn({fontSize:12,background:BTN.reset}),onPointerDown:function(){setForm(function(f){return Object.assign({},f,{customDur:null});})}},  "Reset"):null;
  var endTime=form.time?toTime(toMins(form.time)+dur):"--";


  var mainView=view==="timeline"
    ?RC(TimelineView,{bookings:bookings,date:viewDate,onEdit:openEdit,onManual:function(id){setManualTarget(id);},onStatus:updateStatus,blocks:tableBlocks,onBlock:function(id){setBlockTarget(id);},nowMins:nowMins,warnings:overlapWarnings,zoom:timelineZoom,setZoom:setTimelineZoom,scrollPosRef:timelineScrollRef,followNow:followNow,setFollowNow:setFollowNow,autoOptimizer:autoOptimizer,setAutoOptimizer:setAutoOptimizer,onReshuffle:function(){setConfirmReshuffle(true);},onOpenSettings:function(){setShowSettings(true);}})
    :RC(ListView,{bookings:bookings,date:viewDate,onEdit:openEdit,onStatus:updateStatus,onDelete:function(id){setConfirmDel(id);},onManual:function(id){setManualTarget(id);},nowMins:nowMins,warnings:overlapWarnings});

  var formModal=showForm?RC(Overlay,{onClose:function(){setShowForm(false);}},
    RC("div",{style:{textAlign:"center",marginBottom:16}},RC("div",{style:{fontSize:16,fontWeight:700,color:"#fff",display:"inline-block",padding:"8px 16px",borderRadius:12,background:form.returnOf?"rgba(22,101,52,0.8)":"rgba(0,122,255,0.75)",border:"1px solid rgba(255,255,255,0.2)",boxShadow:"0 1px 4px rgba(0,0,0,0.1), inset 0 1px 1px rgba(255,255,255,0.15)"}},editId?"Edit booking":(form.returnOf?"New booking (Book Again)":"New booking"))),
    returnOfBanner,
    RC(Section,null,
      RC("div",{style:{display:"grid",gridTemplateColumns:formCols,gap:12}},
        RC(Fld,{label:"Customer name",req:true},RC("input",{value:form.name,onChange:function(e){setForm(function(f){return Object.assign({},f,{name:e.target.value});});},placeholder:"Full name",style:inp()})),
        RC(Fld,{label:"Phone number"},RC("input",{type:"tel",value:form.phone,onChange:function(e){setForm(function(f){return Object.assign({},f,{phone:e.target.value});});},onFocus:function(e){var el=e.target;if(!el.value) setForm(function(f){return Object.assign({},f,{phone:"+"});});setTimeout(function(){el.selectionStart=el.selectionEnd=el.value.length;},0);},placeholder:"+34 600 000 000",style:inp()})))),
    RC(Section,null,
      RC("div",{style:{display:"grid",gridTemplateColumns:formCols,gap:12}},
        RC(Fld,{label:"Date"},RC("input",{type:"date",value:form.date,onChange:function(e){setForm(function(f){return Object.assign({},f,{date:e.target.value});});},style:inp()})),
        RC(Fld,{label:"Time"},RC("input",{type:"time",value:form.time,onChange:function(e){setForm(function(f){return Object.assign({},f,{time:e.target.value});});},min:"13:00",max:"22:00",style:inp()})),
        RC(Fld,{label:"Seating preference"},RC("select",{value:form.preference,onChange:function(e){setForm(function(f){return Object.assign({},f,{preference:e.target.value});});},style:inp()},RC("option",{value:"auto"},"Auto (recommended)"),RC("option",{value:"indoor"},"Indoor"),RC("option",{value:"outdoor"},"Outdoor"))),
        RC(Fld,{label:"Number of guests"},RC("div",{style:{display:"flex",alignItems:"center",gap:6}},
          RC("button",{style:{background:"rgba(235,239,246,0.95)",border:"1px solid rgba(210,218,230,0.8)",borderRadius:12,width:42,height:42,fontSize:22,cursor:"pointer",color:S.text,fontWeight:600,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,boxShadow:"inset 0 1px 2px rgba(255,255,255,0.6), 0 1px 3px rgba(0,0,0,0.06)"},onPointerDown:function(e){e.preventDefault();var v=Math.max(1,(Number(form.size)||2)-1);setForm(function(f){return Object.assign({},f,{size:v});});}},"-"),
          RC("span",{style:{minWidth:56,textAlign:"center",fontSize:15,fontWeight:700,color:S.text}},String(Number(form.size)||2)),
          RC("button",{style:{background:"rgba(235,239,246,0.95)",border:"1px solid rgba(210,218,230,0.8)",borderRadius:12,width:42,height:42,fontSize:22,cursor:"pointer",color:S.text,fontWeight:600,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,boxShadow:"inset 0 1px 2px rgba(255,255,255,0.6), 0 1px 3px rgba(0,0,0,0.06)"},onPointerDown:function(e){e.preventDefault();var v=Math.min(25,(Number(form.size)||2)+1);setForm(function(f){return Object.assign({},f,{size:v});});}},"+"))),
        RC(Fld,{label:"Duration"},RC("div",{style:{display:"flex",alignItems:"center",gap:6}},
          RC("button",{style:{background:"rgba(235,239,246,0.95)",border:"1px solid rgba(210,218,230,0.8)",borderRadius:12,width:42,height:42,fontSize:22,cursor:"pointer",color:S.text,fontWeight:600,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,boxShadow:"inset 0 1px 2px rgba(255,255,255,0.6), 0 1px 3px rgba(0,0,0,0.06)"},onPointerDown:function(e){e.preventDefault();var v=Math.max(15,Math.min(480,dur-15));setForm(function(f){return Object.assign({},f,{customDur:v===auto?null:v});});}},"-"),
          RC("span",{style:{minWidth:56,textAlign:"center",fontSize:15,fontWeight:700,color:S.text}},dur+" min"),
          RC("button",{style:{background:"rgba(235,239,246,0.95)",border:"1px solid rgba(210,218,230,0.8)",borderRadius:12,width:42,height:42,fontSize:22,cursor:"pointer",color:S.text,fontWeight:600,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,boxShadow:"inset 0 1px 2px rgba(255,255,255,0.6), 0 1px 3px rgba(0,0,0,0.06)"},onPointerDown:function(e){e.preventDefault();var v=Math.max(15,Math.min(480,dur+15));setForm(function(f){return Object.assign({},f,{customDur:v===auto?null:v});});}},"+"),
          RC("span",{style:{fontSize:13,color:S.text,marginLeft:4}},"End: "+endTime),
          resetDurBtn)))),
    kitchenSection,
    tablesBtn,
    availBanner,
    quickStatusBtns,
    RC(Section,null,
      RC(Fld,{label:"Notes"},RC("textarea",{value:form.notes,onChange:function(e){setForm(function(f){return Object.assign({},f,{notes:e.target.value});});},rows:2,placeholder:"Allergies, special requests...",style:Object.assign({},inp(),{resize:"vertical"})}))),
    errorEl,
    RC("div",{style:{display:"flex",justifyContent:"space-between",alignItems:"center",gap:8,marginTop:18,flexWrap:"wrap"}},
      RC("div",{style:{display:"flex",gap:6,flexWrap:"wrap"}},historyBtn,bookAgainBtn),
      RC("div",{style:{display:"flex",gap:8}},
        RC("button",{style:mkBtn({minHeight:44,padding:"10px 18px",background:BTN.cancel}),onClick:function(){setShowForm(false);}},"Cancel"),
        (function(){
          // v14 p1 (Issue 3): Save is disabled when date is empty. Prevents the
          // dd.mm.yyyy placeholder state from being submitted (esp. via Book Again
          // where we intentionally clear the date to force staff to pick one).
          var canSave=!!form.date;
          return RC("button",{disabled:!canSave,onClick:save,style:{background:canSave?"rgba(0,122,255,0.8)":"rgba(180,180,190,0.4)",border:"1px solid rgba(255,255,255,0.2)",borderRadius:14,padding:"10px 22px",cursor:canSave?"pointer":"not-allowed",fontSize:14,fontWeight:600,color:"#fff",minHeight:44,boxShadow:canSave?"0 2px 8px rgba(0,122,255,0.25), inset 0 1px 1px rgba(255,255,255,0.2)":"none"}},"Save booking");
        })()))):null;

  var delModal=confirmDel?RC(Overlay,{onClose:function(){setConfirmDel(null);}},
    RC("div",{style:{fontSize:17,fontWeight:700,marginBottom:8,color:S.text}},"Delete booking?"),
    RC("div",{style:{fontSize:14,color:S.text,marginBottom:18}},"Tables will be re-optimised after deletion."),
    RC("div",{style:{display:"flex",justifyContent:"flex-end",gap:8}},
      RC("button",{style:mkBtn({minHeight:44,padding:"10px 18px",background:BTN.cancel}),onClick:function(){setConfirmDel(null);}},"Cancel"),
      RC("button",{onClick:function(){delBooking(confirmDel);},style:{background:"#dc2626",border:"1px solid rgba(255,255,255,0.2)",borderRadius:14,padding:"10px 18px",cursor:"pointer",fontSize:14,fontWeight:600,color:"#fff",minHeight:44,boxShadow:"0 2px 6px rgba(0,0,0,0.12), inset 0 1px 1px rgba(255,255,255,0.15)"}},"Delete"))):null;

  var manualModal=manualBooking?RC(ManualModal,{booking:manualBooking,bookings:manualTarget==="__new__"?bookings.filter(function(b){return b.date===form.date;}):bookings,blocks:tableBlocks,onSave:function(tables,locked,affected){if(manualTarget==="__new__"){setForm(function(f){return Object.assign({},f,{manualTables:tables});});setSwapAffected(affected||null);setManualTarget(null);}else{manualAssign(manualBooking.id,tables,locked,affected);}},onClose:function(){setManualTarget(null);}}):null;

  var walkinModal=showWalkin?RC(WalkinForm,{draft:walkinForm,setDraft:setWalkinForm,error:walkinError,liveBookings:liveBookings,bookings:bookings,tableBlocks:tableBlocks,autoOptimizer:autoOptimizer,walkinNum:getNextWalkinNum(),isMobile:isMobile,onSave:saveWalkin,onClose:function(){setShowWalkin(false);}}):null;

  return RC("div",{style:{background:"linear-gradient(135deg, #e8edf5 0%, #dfe6f0 20%, #e2e0ef 40%, #dce8f0 60%, #e5eaf2 80%, #e0e4ee 100%)",minHeight:"100dvh",padding:isMobile?"12px 12px calc(12px + env(safe-area-inset-bottom))":"16px",fontFamily:"-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', 'Helvetica Neue', system-ui, sans-serif",color:S.text,boxSizing:"border-box"}},
    RC("div",{style:{maxWidth:1000,margin:"0 auto"}},
      RC("div",{style:{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12,flexWrap:"wrap",gap:8}},
        RC("div",null,RC("div",{style:{fontSize:isMobile?18:22,fontWeight:700}},"Me Gustas T\u00fa"),RC("div",{style:{fontSize:12,color:S.text,fontWeight:500}},"4 indoor  9 outdoor  "+OPEN+":00 - "+CLOSE+":00")),
        RC("div",{style:{display:"flex",gap:6,flexWrap:"wrap"}},
          ["timeline","list"].map(function(v){return RC("button",{key:v,onClick:function(){setView(v);},style:mkBtn({background:view===v?S.accent:"rgba(120,130,150,0.55)",textTransform:"capitalize",minHeight:40})},v);}),
          RC("button",{onClick:openWalkin,style:{background:"rgba(22,101,52,0.75)",border:"1px solid rgba(255,255,255,0.2)",borderRadius:12,padding:"8px 14px",fontSize:13,cursor:"pointer",fontWeight:600,color:"#fff",minHeight:40,boxShadow:"0 1px 4px rgba(0,0,0,0.1), inset 0 1px 1px rgba(255,255,255,0.15)"}},"Walk-in"),
          RC("button",{onClick:openNew,style:{background:"rgba(0,122,255,0.75)",border:"1px solid rgba(255,255,255,0.2)",borderRadius:12,padding:"8px 14px",fontSize:13,cursor:"pointer",fontWeight:600,color:"#fff",minHeight:40,boxShadow:"0 1px 4px rgba(0,0,0,0.1), inset 0 1px 1px rgba(255,255,255,0.15)"}},"+ New"),
          RC("button",{onClick:function(){signOut(auth);},style:mkBtn({fontSize:12,minHeight:40,padding:"8px 14px",background:"rgba(120,130,150,0.5)"})},"Log out"))),
      RC("div",{style:{display:"flex",alignItems:"center",gap:8,marginBottom:12,flexWrap:"wrap"}},
        RC("div",{style:{display:"flex",gap:4,alignItems:"center"}},
          RC("button",{onClick:function(){var d=new Date(viewDate);d.setDate(d.getDate()-1);setViewDate(d.toISOString().slice(0,10));},style:mkBtn({minHeight:40,minWidth:40,padding:"6px 10px",fontSize:18,background:BTN.nav}),dangerouslySetInnerHTML:{__html:"&#8249;"}}),
          RC("button",{onClick:function(){var d=new Date(viewDate);d.setDate(d.getDate()+1);setViewDate(d.toISOString().slice(0,10));},style:mkBtn({minHeight:40,minWidth:40,padding:"6px 10px",fontSize:18,background:BTN.nav}),dangerouslySetInnerHTML:{__html:"&#8250;"}}),
          RC("input",{type:"date",value:viewDate,onChange:function(e){setViewDate(e.target.value);},style:{fontSize:14,padding:"8px 10px",borderRadius:12,border:"1px solid rgba(255,255,255,0.4)",background:"rgba(255,255,255,0.45)",color:S.text,fontWeight:600,minWidth:130,minHeight:40,boxSizing:"border-box",boxShadow:"inset 0 1px 2px rgba(255,255,255,0.6), 0 1px 3px rgba(0,0,0,0.06)"}})),
        RC("div",{style:{display:"flex",gap:6,alignItems:"center"}},
          viewDate!==new Date().toISOString().slice(0,10)?RC("button",{onClick:function(){setViewDate(new Date().toISOString().slice(0,10));},style:mkBtn({minHeight:40,padding:"6px 14px",background:BTN.today})},"Today"):null,
          RC("span",{style:{fontSize:13,color:S.text}},dayCount+" booking"+(dayCount!==1?"s":"")))),
      !isOnline?RC("div",{style:{background:"rgba(254,243,199,0.85)",border:"2px solid rgba(252,211,77,0.7)",borderRadius:14,padding:"10px 14px",marginBottom:10,fontSize:13,fontWeight:700,color:"#92400e",boxShadow:"0 1px 4px rgba(0,0,0,0.04)"}},"⚠ Working offline — your changes are saved locally and will sync when the connection returns. Keep this tab open."):null,
      reconnectShown?RC("div",{style:{background:"rgba(219,234,254,0.85)",border:"2px solid rgba(147,197,253,0.7)",borderRadius:14,padding:"10px 14px",marginBottom:10,fontSize:13,fontWeight:600,color:"#1e40af",boxShadow:"0 1px 4px rgba(0,0,0,0.04)"}},"✓ Reconnected — changes synced."):null,
      loadBannerShown?RC("div",{style:{background:"rgba(220,252,231,0.8)",border:"2px solid rgba(134,239,172,0.6)",borderRadius:14,padding:"10px 14px",marginBottom:10,fontSize:13,fontWeight:600,color:"#166534",boxShadow:"0 1px 4px rgba(0,0,0,0.04)"}},"Firebase connected — "+(firstLoadCount.current||0)+" booking"+(firstLoadCount.current===1?"":"s")+" loaded."):null,
      writeWarning?RC("div",{style:{background:"rgba(254,226,226,0.85)",border:"2px solid rgba(252,165,165,0.7)",borderRadius:14,padding:"10px 14px",marginBottom:10,fontSize:13,fontWeight:700,color:"#991b1b",display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,boxShadow:"0 1px 4px rgba(0,0,0,0.04)"}},RC("span",null,"⚠ "+writeWarning),RC("button",{style:mkBtn({fontSize:12,background:"#78828c",minHeight:32,padding:"4px 12px"}),onClick:function(){setWriteWarning(null);}},"Dismiss")):null,
      reshuffledBanner,
      ineffBanner,
      overlapBanner,
      reminderBanners,
      mainView,
      formModal,delModal,manualModal,walkinModal,prefPickerModal,
      blockTarget?RC(BlockModal,{tableId:blockTarget,date:viewDate,blocks:tableBlocks,onSave:addBlock,onRemove:removeBlock,onClose:function(){setBlockTarget(null);}}):null,
      confirmCancel?RC(Overlay,{onClose:function(){setConfirmCancel(null);}},
        RC("div",{style:{fontSize:17,fontWeight:700,marginBottom:8,color:S.text}},"Cancel booking?"),
        RC("div",{style:{fontSize:14,color:S.text,marginBottom:18}},"Tables will be re-optimised after cancellation."),
        RC("div",{style:{display:"flex",justifyContent:"flex-end",gap:8,flexWrap:"wrap"}},
          RC("button",{style:mkBtn({minHeight:44,padding:"10px 18px",background:"#64748b"}),onClick:function(){setConfirmCancel(null);}},"Back"),
          RC("button",{onClick:function(){doCancelBooking(confirmCancel,true);setShowForm(false);},style:{background:"#9a3412",border:"1px solid rgba(255,255,255,0.2)",borderRadius:14,padding:"10px 18px",cursor:"pointer",fontSize:14,fontWeight:600,color:"#fff",minHeight:44,boxShadow:"0 2px 6px rgba(0,0,0,0.12), inset 0 1px 1px rgba(255,255,255,0.15)"}},"No show"),
          RC("button",{onClick:function(){doCancelBooking(confirmCancel,false);setShowForm(false);},style:{background:BLOCK_BG.cancelled,border:"1px solid rgba(255,255,255,0.2)",borderRadius:14,padding:"10px 18px",cursor:"pointer",fontSize:14,fontWeight:600,color:"#fff",minHeight:44,boxShadow:"0 2px 6px rgba(0,0,0,0.12), inset 0 1px 1px rgba(255,255,255,0.15)"}},"Cancel booking"))):null,
      confirmKitchen?RC(Overlay,{onClose:function(){setConfirmKitchen(null);}},
        RC("div",{style:{fontSize:17,fontWeight:700,marginBottom:8,color:"#9a3412"}},"Kitchen may be busy"),
        RC("div",{style:{fontSize:14,color:S.text,marginBottom:12}},"There are already "+(confirmKitchen==="walkin"?(function(){var wf=walkinForm;var t=wf.time||nowTime();var d=wf.customDur||getDur(Number(wf.size)||2);var l=getKitchenLoad(bookings,new Date().toISOString().slice(0,10),t,d,null);return l.starts+" booking"+(l.starts!==1?"s":"")+" with "+l.guests+" guest"+(l.guests!==1?"s":"");})():(function(){var f=formRef.current;var d=f.customDur||getDur(Number(f.size)||2);var l=getKitchenLoad(bookings,f.date,f.time,d,editId);return l.starts+" booking"+(l.starts!==1?"s":"")+" with "+l.guests+" guest"+(l.guests!==1?"s":"");})())+" starting at this time. Check the suggested alternatives below, or confirm to proceed anyway."),
        RC("div",{style:{display:"flex",justifyContent:"flex-end",gap:8,flexWrap:"wrap"}},
          RC("button",{style:mkBtn({minHeight:44,padding:"10px 18px",background:"#64748b"}),onClick:function(){setConfirmKitchen(null);}},"Back"),
          RC("button",{onClick:function(){var isW=confirmKitchen==="walkin";setConfirmKitchen(null);if(isW) doSaveWalkin();else doSave();},style:{background:"#9a3412",border:"1px solid rgba(255,255,255,0.2)",borderRadius:14,padding:"10px 18px",cursor:"pointer",fontSize:14,fontWeight:600,color:"#fff",minHeight:44,boxShadow:"0 2px 6px rgba(0,0,0,0.12), inset 0 1px 1px rgba(255,255,255,0.15)"}},"Confirm"))):null,
      confirmReshuffle?RC(Overlay,{onClose:function(){setConfirmReshuffle(false);}},
        RC("div",{style:{fontSize:17,fontWeight:700,marginBottom:8,color:"#9a3412"}},"Reshuffle all bookings?"),
        RC("div",{style:{fontSize:14,color:S.text,marginBottom:18}},"Confirmed bookings may be moved to different tables to improve efficiency. Seated bookings will not be moved."),
        RC("div",{style:{display:"flex",justifyContent:"flex-end",gap:8,flexWrap:"wrap"}},
          RC("button",{style:mkBtn({minHeight:44,padding:"10px 18px",background:"#64748b"}),onClick:function(){setConfirmReshuffle(false);}},"Back"),
          RC("button",{onClick:function(){setConfirmReshuffle(false);forceReshuffle();},style:{background:BTN.orange,border:"1px solid rgba(255,255,255,0.2)",borderRadius:14,padding:"10px 18px",cursor:"pointer",fontSize:14,fontWeight:600,color:"#fff",minHeight:44,boxShadow:"0 2px 6px rgba(0,0,0,0.12), inset 0 1px 1px rgba(255,255,255,0.15)"}},"Reshuffle"))):null,
      // v14 preview 3: Settings modal. Opened by the cog icon in TimelineView's
      // legend row or by pressing `?` anywhere no modal is open.
      // v14 preview 7: now tabbed (General / Reminders / Shortcuts). Tab state
      // resets to 'general' on close so reopens feel fresh.
      showSettings?RC(Overlay,{onClose:function(){setShowSettings(false);setSettingsTab("general");}},
        RC("div",{style:{textAlign:"center",marginBottom:14}},RC("div",{style:{fontSize:16,fontWeight:700,color:"#fff",display:"inline-block",padding:"8px 16px",borderRadius:12,background:"rgba(120,130,150,0.75)",border:"1px solid rgba(255,255,255,0.2)",boxShadow:"0 1px 4px rgba(0,0,0,0.1), inset 0 1px 1px rgba(255,255,255,0.15)"}},"Settings")),
        RC(SettingsContent,{
          tab:settingsTab,setTab:setSettingsTab,
          reminders:reminders,
          onAddReminder:openNewReminder,
          onEditReminder:openEditReminder,
          onDeleteReminder:deleteReminder,
          onToggleReminder:toggleReminderActive
        }),
        RC("div",{style:{display:"flex",justifyContent:"flex-end",marginTop:18}},
          RC("button",{style:mkBtn({minHeight:40,padding:"8px 18px",background:"#64748b"}),onClick:function(){setShowSettings(false);setSettingsTab("general");}},"Close"))):null,
      // v14 p7 fix: in-app reminder-delete confirmation (replaces broken
      // window.confirm which is blocked in sandboxed preview environments).
      // Renders on top of Settings in DOM order so it visually covers the list.
      confirmReminderDel?RC(Overlay,{onClose:function(){setConfirmReminderDel(null);}},
        RC("div",{style:{fontSize:17,fontWeight:700,marginBottom:8,color:S.text}},"Delete reminder?"),
        RC("div",{style:{fontSize:14,color:S.text,marginBottom:18}},"This reminder will be permanently removed."),
        RC("div",{style:{display:"flex",justifyContent:"flex-end",gap:8,flexWrap:"wrap"}},
          RC("button",{style:mkBtn({minHeight:44,padding:"10px 18px",background:"#64748b"}),onClick:function(){setConfirmReminderDel(null);}},"Back"),
          RC("button",{onClick:function(){doDeleteReminder(confirmReminderDel);},style:{background:BTN.del,border:"1px solid rgba(255,255,255,0.2)",borderRadius:14,padding:"10px 18px",cursor:"pointer",fontSize:14,fontWeight:600,color:"#fff",minHeight:44,boxShadow:"0 2px 6px rgba(0,0,0,0.12), inset 0 1px 1px rgba(255,255,255,0.15)"}},"Delete"))):null,
      // v14 p7: Reminder editor modal — sits on top of Settings (z=250 vs 200).
      reminderEditor?RC(ReminderEditor,{
        draft:reminderEditor.draft,
        setDraft:function(d){setReminderEditor(function(prev){return prev?Object.assign({},prev,{draft:d}):null;});},
        onSave:saveReminderFromEditor,
        onCancel:function(){setReminderEditor(null);},
        isNew:reminderEditor.id==="new"
      }):null,
      historyPopup));
}


// ── Auth Wrapper ──────────────────────────────────────────────────────────────
export default function App(){
  var us=useState(null);var user=us[0],setUser=us[1];
  var cs=useState(true);var checking=cs[0],setChecking=cs[1];
  useEffect(function(){
    var unsub=onAuthStateChanged(auth,function(u){setUser(u);setChecking(false);});
    return unsub;
  },[]);
  if(checking) return RC("div",{style:{background:"linear-gradient(135deg, #e8edf5 0%, #dfe6f0 20%, #e2e0ef 40%, #dce8f0 60%, #e5eaf2 80%, #e0e4ee 100%)",minHeight:"100dvh",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', 'Helvetica Neue', system-ui, sans-serif",color:S.text,fontSize:15}},"Loading...");
  if(!user) return RC(LoginScreen,null);
  return RC(BookingApp,null);
}
