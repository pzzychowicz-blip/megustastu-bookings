// src/hooks/useSettingsPanel.js
//
// v18.13.1: the Settings panel's own state and the activity log's window, out of
// BookingApp. The first domain hook of the state-by-domain design, and the shape
// the others take: the statements moved verbatim and in their original order, the
// hook returns plain per-render values and functions, and App destructures them at
// the call.
//
//   settingsTab, settingsDirty, customerSeek     which tab, whether a tab holds a draft,
//                                                what Customers was sent to find
//   activityRows … activityLoadOlder             the feed for the range the log shows
//   activityFromDay, setActivityFrom, …          that range, and what it refuses
//   doClearActivity, doDownloadActivity,
//   doDownloadCrashes                            the log's three actions
//   openCustomerByName                           the log's jump to a customer
//   closeSettings, requestCloseSettings          the close, and the guarded close
//
// `refused`, `setWriteWarning` and the modal setters are App's; `endBackupOpen` is
// `useBackup`'s, so App calls this below that hook. **Never pass the returned object
// as a prop**: it is new every render, and a memoised view would re-render with it.

import { useState, useRef, useEffect } from "react";
import { activityWindow, clearOutcome, CLEAR_FAILED, retentionMs } from "../lib/activity";
import { downloadCrashes } from "../lib/crash-report";
import { todayStr } from "../lib/day";
import { saveTextFile } from "../lib/download";
// v18.0.0 session 8: `useActivityFeed` is the app's first Firebase QUERY, and is
// attached only while the log is open.
import { useActivityFeed, clearActivityAndLog, readCrashes, pruneActivity } from "./useActivityLog";

export function useSettingsPanel({
  activityOpen, activityRetentionDays, endBackupOpen, isAdmin, refused,
  setActivityOpen, setConfirmDiscard, setShowSettings, setWriteWarning,
}) {
  // Settings reports its dirtiness up: its drafts are component-local.
  const [settingsDirty, setSettingsDirty] = useState(false);
  // Settings tab state — which tab is active in the Settings modal.
  // Resets to 'general' on modal close so reopens start fresh. Belongs to
  // the Settings subsystem; lived inside the reminder state block pre-D2
  // for historical reasons (the comment misleadingly grouped it there).
  const [settingsTab, setSettingsTab] = useState("general");
  // The RANGE the log is showing. It lives HERE and not inside the modal because
  // the feed lives here too: the listener must detach when the log closes, and a
  // range held inside the modal would unmount with it and take the window with
  // it.
  //
  // v18.0.0 session 11: two dates, and BOTH START EMPTY. The log used to open on
  // today and could only ever be asked about one day, so a search was a search of
  // that day — Patryk: *"Search box must search globally (as Find a booking
  // does) not by date only. Filtering by date should be one of options."* Empty
  // means "no bound this side", so the resting question is the whole log, newest
  // first, and narrowing to a day is a filter you apply rather than the only
  // thing on offer.
  const [activityFromDay,setActivityFromDay]=useState("");
  const [activityToDay,setActivityToDay]=useState("");
  // /code-review: changing the window clears whatever the last clear SAID.
  // Measured — cleared 2026-09-12 ("Cleared 27 entries."), emptied both fields
  // to go back to all time, and the sentence was still on screen under the
  // all-time list, where it reads as a claim about everything. The modal
  // already disarms the confirm on the same event; this is the other half of
  // "the confirm is a promise about a specific window".
  function setActivityFrom(v){setActivityClearMsg("");setActivityFromDay(v);}
  function setActivityTo(v){setActivityClearMsg("");setActivityToDay(v);}
  // Local midnight to local midnight: `at` is a wall-clock stamp and the
  // restaurant thinks in local days. `dayRangeMs` gives a whole day, so the FROM
  // field takes that day's first ms and the TO field takes its last — which is
  // what makes a one-day range the two fields holding the same date rather than
  // a mode of its own.
  //
  // v18.0.0 session 10 (/code-review), and it applies to both fields now: a date
  // input can be EMPTIED, and this query is the one place in the app where a
  // `viewDate`-shaped string reaches Firebase instead of `lib/day.js`.
  // `new Date("T00:00:00")` is Invalid Date, `.getTime()` is NaN, and
  // `startAt(NaN)` THROWS rather than returning nothing — inside an effect,
  // which the boundary catches by replacing the whole app. Measured live:
  // clearing "Day to show" gave `startAt failed: value argument contains NaN in
  // property 'activity'` and the error screen, from one keystroke on a shipped
  // surface.
  //
  // What changed in session 11 is that EMPTY is now legal and only UNREADABLE is
  // withheld. The two were the same condition while the field was required; they
  // are not the same condition now, and conflating them would withhold the
  // default view. A date is kept exactly as typed so the field stays editable
  // while it is being retyped; it is the QUERY that waits.
  //
  // The arithmetic is `activityWindow` (lib/activity.js), not inline here, for
  // the reason session 10 moved `dayRangeMs` out of this file: the one call
  // site that must not get it wrong should not also be the only place it can
  // be tested.
  const activityWin=activityWindow(activityFromDay,activityToDay);
  const activityFrom=activityWin.from;
  const activityTo=activityWin.to;
  // A typed-but-unreadable date, or a range that ends before it starts.
  //
  // The two are reachable to different degrees and it is worth saying which,
  // because CLAUDE.md's own rule is that a qualifier on a state that cannot
  // occur tells the next reader it CAN. `backwards` is ordinary use: two date
  // pickers, nothing stopping you. `badDay` is NOT reachable through this
  // surface — a `<input type="date">` holds either "" or a valid `yyyy-mm-dd`,
  // and the quick-range chips go through `todayStr`/`addDays` — so its message
  // is defence rather than a state anybody will see today. It is kept because
  // these are plain STRINGS that some later caller could set the way
  // `SearchPanel`'s onPick sets `viewDate`, and because `dayRangeMs` returning
  // null is the one thing standing between `isReadableDate`'s looser shapes
  // ("2026-8-3", "Sep 13 2026") and `startAt(NaN)`, which THROWS inside an
  // effect and takes the whole app down. Withholding the query is the guard;
  // the message only decides what is said while it is withheld.
  const activityBadDay=activityWin.badDay;
  const activityBackwards=activityWin.backwards;
  const activityRangeOk=activityWin.ok;
  const {rows:activityRows,loading:activityLoading,loadingMore:activityLoadingMore,hasMore:activityHasMore,loadOlder:activityLoadOlder}=useActivityFeed({from:activityFrom,to:activityTo,enabled:!!activityOpen&&activityRangeOk});
  // The 12-month retention promise, kept by the app because this plan has no
  // server-side scheduler — and kept HONEST by the rules, which refuse a delete
  // unless the caller is an admin and the entry really is older than a year. It
  // runs when an admin OPENS the log, which is the one moment somebody is
  // already waiting for the node and a few deletes cost nothing.
  //
  // Gated on `isAdmin` client-side as well: a staff account's attempt would be
  // refused anyway, and asking for a refusal on every open is noise in the
  // console for a promise that was never theirs to keep.
  // v18.0.0 session 11: clearing a range. Admin-only on the client because it is
  // admin-only in the rules — asking for a refusal a staff account was never
  // going to get is noise in the console for a control they cannot use.
  //
  // The busy flag is a ref MIRROR plus state, the `saveBookings` shape: the
  // guard has to be read synchronously in the handler (two taps arriving faster
  // than a render would otherwise start two clears over the same range), and
  // the state is what the button paints with.
  // v18.0.0 session 11: what the Customers tab should be searching for when we
  // send somebody there. A NAME and not the `guestKey`, because `searchCustomers`
  // matches on name or phone digits and never on a `guestId` — so seeding it
  // with the raw key would find nothing for exactly the phone-less guests this
  // was added to reach. Fed to `CustomersTabContent` as both `key` and
  // `seekQuery`, so a new seek remounts that subtree and its `useState`
  // initialiser picks the value up with no effect involved.
  //
  // /code-review: it is cleared when Settings CLOSES, or it outlives the jump.
  // Nothing reset it, so one jump for "Pau Estévez" left every later visit to
  // Settings → Customers pre-filtered by that name, with a query in the box the
  // user never typed — and because the tab takes this as its `key`, it also
  // remounted on the stale value each time.
  const [customerSeek,setCustomerSeek]=useState("");
  function openCustomerByName(name){
    const n=String(name||"").trim();
    if(!n) return;
    setActivityOpen(null);
    setSettingsTab("customers");
    setCustomerSeek(n);
  }
  const [activityClearing,setActivityClearing]=useState(false);
  // What the last clear did, so a REFUSAL is visible. Without it the button
  // simply returns to rest and the list is unchanged, which reads as a dead
  // control — measured on DEV, where the clear is denied because the database
  // is still running the rules deployed before this change.
  const [activityClearMsg,setActivityClearMsg]=useState("");
  const activityClearingRef=useRef(false);
  function doClearActivity(){
    if(activityClearingRef.current) return;
    if(!isAdmin) return;
    // Refuses an UNBOUNDED clear here as well as in the modal, because the modal
    // only disables a button and this is the function that does the deleting.
    if(activityFrom==null&&activityTo==null) return;
    if(!activityRangeOk) return;
    activityClearingRef.current=true;
    setActivityClearing(true);
    setActivityClearMsg("");
    clearActivityAndLog(activityFrom,activityTo,activityFromDay,activityToDay)
      // v18.11.0 (#17): the sentence for each outcome is `clearOutcome`
      // (lib/activity.js), with why there are four.
      .then(function(res){setActivityClearMsg(clearOutcome(res));})
      .catch(function(){setActivityClearMsg(CLEAR_FAILED);})
      .then(function(){activityClearingRef.current=false;setActivityClearing(false);});
  }
  // v18.0.0 session 11: the CSV. Gated on `dataExport` and NOT on `isAdmin`,
  // because it is the same act as "Download backup" — a file of the
  // restaurant's data leaving the building — and one capability should mean one
  // thing wherever it appears. The BUILDING of the file is pure and lives in
  // lib/activity.js; this is only the part that needs a DOM.
  function doDownloadActivity(text,filename){
    if(refused("dataExport")) return;
    try{saveTextFile(text,filename,"text/csv;charset=utf-8");}
    catch{setWriteWarning("Couldn't create the file on this device.");}
  }
  // v18.13.0 (#28): the same capability, the same reasoning. Resolves to what the log
  // should say, in the log: the banner cannot be read under a modal (measured, v18.13.0).
  function doDownloadCrashes(){
    if(refused("dataExport")) return Promise.resolve("");
    return downloadCrashes({read:readCrashes,save:saveTextFile,today:todayStr()});
  }
  const prunedRef=useRef(false);
  useEffect(function(){
    if(!activityOpen||!isAdmin){ if(!activityOpen) prunedRef.current=false; return; }
    if(prunedRef.current) return;   // once per opening, not once per render
    prunedRef.current=true;
    pruneActivity(retentionMs(activityRetentionDays));
  },[activityOpen,isAdmin,activityRetentionDays]);
  // v17.8.0: Settings keeps its tab reset on BOTH paths — the clean close here and
  // the discard in App's `doDiscard` — because that was part of the close behaviour
  // before the guard, not part of the guard.
  function closeSettings(){setShowSettings(false);setSettingsTab("general");setCustomerSeek("");endBackupOpen();}
  function requestCloseSettings(){if(settingsDirty) setConfirmDiscard("settings");else closeSettings();}
  return {
    settingsDirty, setSettingsDirty, settingsTab, setSettingsTab, customerSeek,
    activityFromDay, activityToDay, setActivityFrom, setActivityTo, activityBadDay, activityBackwards,
    activityRows, activityLoading, activityLoadingMore, activityHasMore, activityLoadOlder,
    openCustomerByName, activityClearing, activityClearMsg, doClearActivity,
    doDownloadActivity, doDownloadCrashes, closeSettings, requestCloseSettings,
  };
}
